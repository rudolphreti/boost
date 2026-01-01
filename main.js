import { app, BrowserWindow, ipcMain } from "electron";
import { PoweredUP } from "node-poweredup";

const LEFT_PORT_DEFAULT = "A";
const RIGHT_PORT_DEFAULT = "B";

class UIBridge {
  constructor() {
    this.window = null;
  }

  attachWindow(window) {
    this.window = window;
  }

  send(channel, payload) {
    this.window?.webContents.send(channel, payload);
  }

  log(line) {
    this.send("ui:log", String(line));
  }

  status(state, msg) {
    this.send("ui:status", { state, msg });
  }

  boostDevices(devices) {
    this.send("boost:devices", devices);
  }

  boostRaw(payload) {
    this.send("boost:raw", payload);
  }

  boostColor(payload) {
    this.send("boost:color", payload);
  }
}

class BoostController {
  constructor(uiBridge) {
    this.ui = uiBridge;
    this.poweredUP = null;
    this.hub = null;
    this.leftMotor = null;
    this.rightMotor = null;
    this.colorDevice = null;
    this.colorMode = null;
  }

  safeStopScan() {
    try { this.poweredUP?.stop?.(); } catch {}
    try { this.poweredUP?.stopScanning?.(); } catch {}
  }

  clearColorListeners() {
    try { this.colorDevice?.removeAllListeners?.(); } catch {}
  }

  attachHubDebugForwarding() {
    if (!this.hub?.on) return;

    try {
      this.hub.removeAllListeners("portValue");
    } catch {}

    this.hub.on("portValue", (port, value) => {
      this.ui.boostRaw({ port, value });
    });
  }

  simplifyDevices(devices) {
    return (devices || []).map((d) => ({
      portId: d?.portId ?? d?.port ?? d?.portID ?? null,
      name: d?.name ?? "device",
      type: d?.deviceType ?? d?.type ?? null
    }));
  }

  normalizePort(port) {
    if (port === null || port === undefined) return null;
    const s = String(port).trim();
    if (!s) return null;

    const upper = s.toUpperCase();
    if (["A", "B", "C", "D"].includes(upper)) return upper;

    const n = Number(s);
    if (Number.isFinite(n)) return n;

    return s;
  }

  colorCodeFromPayload(payload) {
    if (payload === null || payload === undefined) return null;

    if (typeof payload === "number") return payload;

    if (typeof payload === "object") {
      if (typeof payload.color === "number") return payload.color;
      if (Array.isArray(payload) && typeof payload[0] === "number") return payload[0];

      if (Array.isArray(payload.value) && typeof payload.value[0] === "number") return payload.value[0];
      if (typeof payload.value === "number") return payload.value;
    }

    return null;
  }

  async connect() {
    if (this.hub) return true;

    this.poweredUP = new PoweredUP();

    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        try { this.safeStopScan(); } catch {}
        reject(new Error("BOOST not found (timeout)"));
      }, 20000);

      this.poweredUP.on("discover", async (discoveredHub) => {
        try {
          clearTimeout(timeout);

          this.hub = discoveredHub;
          this.ui.log(`Discovered hub: ${this.hub.name || "(no-name)"}`);
          this.ui.status("connecting", "Łączę się z hubem...");
          await this.hub.connect();

          this.safeStopScan();

          this.attachHubDebugForwarding();

          this.ui.status("connecting", "Wykrywam urządzenia...");

          const devices = this.hub.getDevices ? this.hub.getDevices() : [];
          this.ui.boostDevices(this.simplifyDevices(devices));

          try { this.leftMotor = await this.hub.waitForDeviceAtPort(LEFT_PORT_DEFAULT); } catch {}
          try { this.rightMotor = await this.hub.waitForDeviceAtPort(RIGHT_PORT_DEFAULT); } catch {}

          this.ui.status("connected", "Połączony");
          this.ui.log("Połączono OK");
          resolve(true);
        } catch (e) {
          reject(e);
        }
      });

      this.ui.status("connecting", "Skanuję Bluetooth...");
      await this.poweredUP.scan();
    });
  }

  async disconnect() {
    try {
      if (this.colorDevice && this.colorMode && this.colorDevice.unsubscribe) {
        await this.colorDevice.unsubscribe(this.colorMode);
      }
    } catch {}

    try { this.clearColorListeners(); } catch {}

    try { await this.hub?.disconnect?.(); } catch {}

    this.leftMotor = null;
    this.rightMotor = null;
    this.colorDevice = null;
    this.colorMode = null;
    this.hub = null;
    this.poweredUP = null;

    this.ui.status("disconnected", "Rozłączony");
    this.ui.log("Rozłączono");
  }

  async drive(left, right) {
    if (!this.hub || !this.leftMotor || !this.rightMotor) return;

    const l = Math.max(-100, Math.min(100, Math.trunc(left)));
    const r = Math.max(-100, Math.min(100, Math.trunc(right)));

    await this.leftMotor.setPower(l);
    await this.rightMotor.setPower(r);
  }

  async attachColorSensor(portInput, modeInput) {
    if (!this.hub) throw new Error("Not connected");

    const port = this.normalizePort(portInput);
    const mode = String(modeInput || "color").trim();

    if (!port && port !== 0) throw new Error("Port is empty");

    try {
      if (this.colorDevice && this.colorMode && this.colorDevice.unsubscribe) {
        await this.colorDevice.unsubscribe(this.colorMode);
      }
    } catch {}

    this.clearColorListeners();
    this.colorDevice = null;
    this.colorMode = null;

    this.ui.log(`waitForDeviceAtPort(${String(port)})...`);
    const dev = await this.hub.waitForDeviceAtPort(port);

    this.colorDevice = dev;
    this.colorMode = mode;

    const forward = (eventName, payload) => {
      const code = this.colorCodeFromPayload(payload);
      if (code !== null) {
        this.ui.boostColor({ port, mode: eventName, color: code, raw: payload });
      } else {
        this.ui.boostRaw({ port, value: payload, eventName });
      }
    };

    try { dev.on("color", (p) => forward("color", p)); } catch {}
    try { dev.on("colorAndDistance", (p) => forward("colorAndDistance", p)); } catch {}
    try { dev.on("colorDistance", (p) => forward("colorDistance", p)); } catch {}
    try { dev.on("portValue", (p) => forward("portValue", p)); } catch {}
    try { dev.on("value", (p) => forward("value", p)); } catch {}
    try { dev.on("data", (p) => forward("data", p)); } catch {}

    try { await dev.setMode?.(mode); } catch {}

    if (dev.subscribe) {
      this.ui.log(`subscribe(${mode})...`);
      await dev.subscribe(mode);
    } else {
      throw new Error("Device has no subscribe()");
    }

    this.ui.log(`OK: czujnik aktywny na porcie ${String(port)} (mode=${mode}).`);
    return true;
  }

  listDevices() {
    const devices = this.hub?.getDevices ? this.hub.getDevices() : [];
    return this.simplifyDevices(devices);
  }
}

const uiBridge = new UIBridge();
const controller = new BoostController(uiBridge);
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 720,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true
    }
  });

  uiBridge.attachWindow(win);
  win.loadFile("index.html");
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  await controller.disconnect();
});

ipcMain.handle("boost:connect", async () => {
  try {
    await controller.connect();
    return { ok: true };
  } catch (e) {
    uiBridge.status("error", String(e?.message || e));
    uiBridge.log(`ERROR connect: ${String(e?.message || e)}`);
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle("boost:disconnect", async () => {
  await controller.disconnect();
  return { ok: true };
});

ipcMain.handle("boost:drive", async (_evt, { left, right }) => {
  await controller.drive(left, right);
  return { ok: true };
});

ipcMain.handle("boost:colorAttach", async (_evt, { port, mode }) => {
  try {
    const ok = await controller.attachColorSensor(port, mode);
    return { ok };
  } catch (e) {
    uiBridge.status("error", String(e?.message || e));
    uiBridge.log(`ERROR colorAttach: ${String(e?.message || e)}`);
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle("boost:listDevices", async () => {
  const simplified = controller.listDevices();
  return { ok: true, devices: simplified };
});
