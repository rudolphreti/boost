import { app, BrowserWindow, ipcMain } from "electron";
import { PoweredUP } from "node-poweredup";

let win = null;
let poweredUP = null;
let hub = null;

let leftMotor = null;
let rightMotor = null;

let colorDevice = null;
let colorMode = null;
let colorModeName = null;

const LEFT_PORT_DEFAULT = "A";
const RIGHT_PORT_DEFAULT = "B";

function sendLog(line) {
  win?.webContents.send("ui:log", String(line));
}

function sendStatus(state, msg) {
  win?.webContents.send("ui:status", { state, msg });
}

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 720,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true
    }
  });
  win.loadFile("index.html");
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  await disconnectBoost();
});

function safeStopScan() {
  try { poweredUP?.stop?.(); } catch {}
  try { poweredUP?.stopScanning?.(); } catch {}
}

function clearColorListeners() {
  try { colorDevice?.removeAllListeners?.(); } catch {}
}

function attachHubDebugForwarding() {
  if (!hub?.on) return;

  try {
    hub.removeAllListeners("portValue");
  } catch {}

  hub.on("portValue", (port, value) => {
    win?.webContents.send("boost:raw", { port, value });
  });
}

async function connectBoost() {
  if (hub) return true;

  poweredUP = new PoweredUP();

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      try { safeStopScan(); } catch {}
      reject(new Error("BOOST not found (timeout)"));
    }, 20000);

    poweredUP.on("discover", async (discoveredHub) => {
      try {
        clearTimeout(timeout);

        hub = discoveredHub;
        sendLog(`Discovered hub: ${hub.name || "(no-name)"}`);
        sendStatus("connecting", "Łączę się z hubem...");
        await hub.connect();

        safeStopScan();

        attachHubDebugForwarding();

        sendStatus("connecting", "Wykrywam urządzenia...");

        const devices = hub.getDevices ? hub.getDevices() : [];
        const simplified = (devices || []).map((d) => ({
          portId: d?.portId ?? d?.port ?? d?.portID ?? null,
          name: d?.name ?? "device",
          type: d?.deviceType ?? d?.type ?? null
        }));

        win?.webContents.send("boost:devices", simplified);

        // Motors (optional; if missing, driving just won't work)
        try { leftMotor = await hub.waitForDeviceAtPort(LEFT_PORT_DEFAULT); } catch {}
        try { rightMotor = await hub.waitForDeviceAtPort(RIGHT_PORT_DEFAULT); } catch {}

        sendStatus("connected", "Połączony");
        sendLog("Połączono OK");
        resolve(true);
      } catch (e) {
        reject(e);
      }
    });

    sendStatus("connecting", "Skanuję Bluetooth...");
    await poweredUP.scan();
  });
}

async function disconnectBoost() {
  try {
    if (colorDevice && colorMode && colorDevice.unsubscribe) {
      await colorDevice.unsubscribe(colorMode);
    }
  } catch {}

  try { clearColorListeners(); } catch {}

  try { await hub?.disconnect?.(); } catch {}

  leftMotor = null;
  rightMotor = null;
  colorDevice = null;
  colorMode = null;
  hub = null;
  poweredUP = null;

  sendStatus("disconnected", "Rozłączony");
  sendLog("Rozłączono");
}

async function drive(left, right) {
  if (!hub || !leftMotor || !rightMotor) return;

  const l = Math.max(-100, Math.min(100, Math.trunc(left)));
  const r = Math.max(-100, Math.min(100, Math.trunc(right)));

  await leftMotor.setPower(l);
  await rightMotor.setPower(r);
}

function normalizePort(port) {
  // Accept "A"/"B"/"C"/"D" or numeric ids like "0","1","2"... (from hub.getDevices())
  if (port === null || port === undefined) return null;
  const s = String(port).trim();
  if (!s) return null;

  const upper = s.toUpperCase();
  if (["A", "B", "C", "D"].includes(upper)) return upper;

  const n = Number(s);
  if (Number.isFinite(n)) return n;

  return s;
}

function colorCodeFromPayload(payload) {
  // Try to extract a single numeric color code from different event shapes
  if (payload === null || payload === undefined) return null;

  if (typeof payload === "number") return payload;

  if (typeof payload === "object") {
    if (typeof payload.color === "number") return payload.color;
    if (Array.isArray(payload) && typeof payload[0] === "number") return payload[0];

    // Sometimes value could be { value: [color,...] } etc.
    if (Array.isArray(payload.value) && typeof payload.value[0] === "number") return payload.value[0];
    if (typeof payload.value === "number") return payload.value;
  }

  return null;
}

function resolveColorMode(device, modeInput) {
  const raw = modeInput === undefined || modeInput === null ? "" : modeInput;
  const str = String(raw).trim();

  // If the mode is already numeric, use it directly (Node will coerce strings to numbers, but let's be explicit)
  const maybeNumber = Number(str);
  if (Number.isFinite(maybeNumber)) return maybeNumber;

  const modeMap = device?._modeMap || device?.modeMap || {};

  if (str && modeMap[str] !== undefined) return modeMap[str];

  // Accept a common typo used in the UI: "colorDistance" should map to "colorAndDistance"
  if (str === "colorDistance" && modeMap.colorAndDistance !== undefined) {
    return modeMap.colorAndDistance;
  }

  // Fallback to plain color mode if available
  if (modeMap.color !== undefined) return modeMap.color;

  return null;
}

function resolveColorModeName(device, modeId) {
  const modeMap = device?._modeMap || device?.modeMap || {};
  for (const [name, id] of Object.entries(modeMap)) {
    if (id === modeId) return name;
  }
  return null;
}

async function attachColorSensor(portInput, modeInput) {
  if (!hub) throw new Error("Not connected");

  const port = normalizePort(portInput);
  const requestedModeName = String(modeInput || "color").trim();

  if (!port && port !== 0) throw new Error("Port is empty");

  // Detach previous
  try {
    if (colorDevice && colorMode && colorDevice.unsubscribe) {
      await colorDevice.unsubscribe(colorMode);
    }
  } catch {}

  clearColorListeners();
  colorDevice = null;
  colorMode = null;
  colorModeName = null;

  sendLog(`waitForDeviceAtPort(${String(port)})...`);
  const dev = await hub.waitForDeviceAtPort(port);

  colorDevice = dev;

  const resolvedMode = resolveColorMode(dev, requestedModeName);
  if (resolvedMode === null) {
    throw new Error(`Nieznany tryb czujnika: "${requestedModeName}"`);
  }
  colorMode = resolvedMode;
  colorModeName = resolveColorModeName(dev, resolvedMode) || requestedModeName;

  // Forward any likely events to UI
  const forward = (eventName, payload) => {
    const code = colorCodeFromPayload(payload);
    if (code !== null) {
      win?.webContents.send("boost:color", { port, mode: eventName, color: code, raw: payload });
    } else {
      win?.webContents.send("boost:raw", { port, value: payload, eventName });
    }
  };

  // Attach multiple listeners because different firmwares/devices report differently
  try { dev.on("color", (p) => forward("color", p)); } catch {}
  try { dev.on("colorAndDistance", (p) => forward("colorAndDistance", p)); } catch {}
  try { dev.on("colorDistance", (p) => forward("colorDistance", p)); } catch {}
  try { dev.on("portValue", (p) => forward("portValue", p)); } catch {}
  try { dev.on("value", (p) => forward("value", p)); } catch {}
  try { dev.on("data", (p) => forward("data", p)); } catch {}

  // Some device implementations require setMode before subscribe
  try { await dev.setMode?.(resolvedMode); } catch {}

  if (dev.subscribe) {
    sendLog(`subscribe(${colorModeName} -> mode ${resolvedMode})...`);
    await dev.subscribe(resolvedMode);
  } else {
    throw new Error("Device has no subscribe()");
  }

  sendLog(`OK: czujnik aktywny na porcie ${String(port)} (mode=${colorModeName}/${resolvedMode}).`);
  return { mode: colorModeName, modeId: resolvedMode };
}

// IPC
ipcMain.handle("boost:connect", async () => {
  try {
    await connectBoost();
    return { ok: true };
  } catch (e) {
    sendStatus("error", String(e?.message || e));
    sendLog(`ERROR connect: ${String(e?.message || e)}`);
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle("boost:disconnect", async () => {
  await disconnectBoost();
  return { ok: true };
});

ipcMain.handle("boost:drive", async (_evt, { left, right }) => {
  await drive(left, right);
  return { ok: true };
});

ipcMain.handle("boost:colorAttach", async (_evt, { port, mode }) => {
  try {
    const result = await attachColorSensor(port, mode);
    return { ok: true, mode: result?.mode, modeId: result?.modeId };
  } catch (e) {
    sendStatus("error", String(e?.message || e));
    sendLog(`ERROR colorAttach: ${String(e?.message || e)}`);
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle("boost:listDevices", async () => {
  const devices = hub?.getDevices ? hub.getDevices() : [];
  const simplified = (devices || []).map((d) => ({
    portId: d?.portId ?? d?.port ?? d?.portID ?? null,
    name: d?.name ?? "device",
    type: d?.deviceType ?? d?.type ?? null
  }));
  return { ok: true, devices: simplified };
});
