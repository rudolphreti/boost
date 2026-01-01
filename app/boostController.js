import { PoweredUP } from "node-poweredup";

const LEFT_PORT_DEFAULT = "A";
const RIGHT_PORT_DEFAULT = "B";

export class BoostController {
  win = null;
  poweredUP = null;
  hub = null;

  leftMotor = null;
  rightMotor = null;

  colorDevice = null;
  colorMode = null;
  colorModeName = null;

  setWindow(win) {
    this.win = win;
  }

  sendLog(line) {
    this.win?.webContents.send("ui:log", String(line));
  }

  sendStatus(state, msg) {
    this.win?.webContents.send("ui:status", { state, msg });
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
      this.win?.webContents.send("boost:raw", { port, value });
    });
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

  resolveColorMode(device, modeInput) {
    const raw = modeInput === undefined || modeInput === null ? "" : modeInput;
    const str = String(raw).trim();

    const maybeNumber = Number(str);
    if (Number.isFinite(maybeNumber)) return maybeNumber;

    const modeMap = device?._modeMap || device?.modeMap || {};

    if (str && modeMap[str] !== undefined) return modeMap[str];

    if (str === "colorDistance" && modeMap.colorAndDistance !== undefined) {
      return modeMap.colorAndDistance;
    }

    if (modeMap.color !== undefined) return modeMap.color;

    return null;
  }

  resolveColorModeName(device, modeId) {
    const modeMap = device?._modeMap || device?.modeMap || {};
    for (const [name, id] of Object.entries(modeMap)) {
      if (id === modeId) return name;
    }
    return null;
  }

  forwardColorPayload(port, eventName, payload) {
    const code = this.colorCodeFromPayload(payload);
    if (code !== null) {
      this.win?.webContents.send("boost:color", { port, mode: eventName, color: code, raw: payload });
    } else {
      this.win?.webContents.send("boost:raw", { port, value: payload, eventName });
    }
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
          this.sendLog(`Discovered hub: ${this.hub.name || "(no-name)"}`);
          this.sendStatus("connecting", "Łączę się z hubem...");
          await this.hub.connect();

          this.safeStopScan();
          this.attachHubDebugForwarding();

          this.sendStatus("connecting", "Wykrywam urządzenia...");

          const devices = this.hub.getDevices ? this.hub.getDevices() : [];
          const simplified = (devices || []).map((d) => ({
            portId: d?.portId ?? d?.port ?? d?.portID ?? null,
            name: d?.name ?? "device",
            type: d?.deviceType ?? d?.type ?? null
          }));

          this.win?.webContents.send("boost:devices", simplified);

          try { this.leftMotor = await this.hub.waitForDeviceAtPort(LEFT_PORT_DEFAULT); } catch {}
          try { this.rightMotor = await this.hub.waitForDeviceAtPort(RIGHT_PORT_DEFAULT); } catch {}

          this.sendStatus("connected", "Połączony");
          this.sendLog("Połączono OK");
          resolve(true);
        } catch (e) {
          reject(e);
        }
      });

      this.sendStatus("connecting", "Skanuję Bluetooth...");
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
    this.colorModeName = null;
    this.hub = null;
    this.poweredUP = null;

    this.sendStatus("disconnected", "Rozłączony");
    this.sendLog("Rozłączono");
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
    const requestedModeName = String(modeInput || "color").trim();

    if (!port && port !== 0) throw new Error("Port is empty");

    try {
      if (this.colorDevice && this.colorMode && this.colorDevice.unsubscribe) {
        await this.colorDevice.unsubscribe(this.colorMode);
      }
    } catch {}

    this.clearColorListeners();
    this.colorDevice = null;
    this.colorMode = null;
    this.colorModeName = null;

    this.sendLog(`waitForDeviceAtPort(${String(port)})...`);
    const dev = await this.hub.waitForDeviceAtPort(port);

    this.colorDevice = dev;

    const resolvedMode = this.resolveColorMode(dev, requestedModeName);
    if (resolvedMode === null) {
      throw new Error(`Nieznany tryb czujnika: "${requestedModeName}"`);
    }
    this.colorMode = resolvedMode;
    this.colorModeName = this.resolveColorModeName(dev, resolvedMode) || requestedModeName;

    const forward = (eventName, payload) => this.forwardColorPayload(port, eventName, payload);

    try { dev.on("color", (p) => forward("color", p)); } catch {}
    try { dev.on("colorAndDistance", (p) => forward("colorAndDistance", p)); } catch {}
    try { dev.on("colorDistance", (p) => forward("colorDistance", p)); } catch {}
    try { dev.on("portValue", (p) => forward("portValue", p)); } catch {}
    try { dev.on("value", (p) => forward("value", p)); } catch {}
    try { dev.on("data", (p) => forward("data", p)); } catch {}

    try { await dev.setMode?.(resolvedMode); } catch {}

    if (dev.subscribe) {
      this.sendLog(`subscribe(${this.colorModeName} -> mode ${resolvedMode})...`);
      await dev.subscribe(resolvedMode);
    } else {
      throw new Error("Device has no subscribe()");
    }

    this.sendLog(`OK: czujnik aktywny na porcie ${String(port)} (mode=${this.colorModeName}/${resolvedMode}).`);
    return { mode: this.colorModeName, modeId: resolvedMode };
  }

  listDevices() {
    const devices = this.hub?.getDevices ? this.hub.getDevices() : [];
    const simplified = (devices || []).map((d) => ({
      portId: d?.portId ?? d?.port ?? d?.portID ?? null,
      name: d?.name ?? "device",
      type: d?.deviceType ?? d?.type ?? null
    }));
    return simplified;
  }
}
