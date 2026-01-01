const { ipcRenderer } = window.require("electron");

const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");

const speedEl = document.getElementById("speed");
const speedVal = document.getElementById("speedVal");
const steerEl = document.getElementById("steer");
const steerVal = document.getElementById("steerVal");

const colorPortEl = document.getElementById("colorPort");
const colorModeEl = document.getElementById("colorMode");
const colorAttachBtn = document.getElementById("colorAttach");
const refreshDevicesBtn = document.getElementById("refreshDevices");

const colorNameEl = document.getElementById("colorName");
const colorCodeEl = document.getElementById("colorCode");
const colorSourceEl = document.getElementById("colorSource");

let connected = false;
let up=false, down=false, left=false, right=false;
let lastL=0, lastR=0;

const COLOR_PL = {
  0: "Czarny",
  3: "Niebieski",
  5: "Zielony",
  7: "Żółty",
  9: "Czerwony",
  10: "Biały"
};

let lastSpoken = null;
let lastColorCode = null;

function now() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function log(line) {
  logEl.value += `[${now()}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function speakPL(text) {
  if (!text) return;

  // Avoid repeating the same word nonstop when the sensor jitters
  if (text === lastSpoken) return;
  lastSpoken = text;

  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "pl-PL";
  u.rate = 1.0;
  window.speechSynthesis.speak(u);
}

function clamp100(x) {
  return Math.max(-100, Math.min(100, x));
}

function computeDrive() {
  const speed = Number(speedEl.value);
  const steer = Number(steerEl.value) / 100;

  const throttle = up ? 1 : down ? -1 : 0;
  const s = left ? -1 : right ? 1 : 0;

  if (throttle === 0) {
    if (s === 0) return { left: 0, right: 0 };
    const rot = Math.max(10, Math.trunc(speed));
    return { left: -s * rot, right: s * rot };
  }

  const base = throttle * speed;
  return {
    left: clamp100(base * (1 - s * steer)),
    right: clamp100(base * (1 + s * steer))
  };
}

async function sendDrive(l, r) {
  l = Math.trunc(l);
  r = Math.trunc(r);
  if (!connected) return;
  if (l === lastL && r === lastR) return;
  lastL = l; lastR = r;
  await ipcRenderer.invoke("boost:drive", { left: l, right: r });
}

function applyDrive() {
  const t = computeDrive();
  sendDrive(t.left, t.right);
}

function updateColorUI(colorCode, source) {
  const name = COLOR_PL[colorCode] || `Kod ${colorCode}`;
  colorNameEl.textContent = name;
  colorCodeEl.textContent = String(colorCode);
  colorSourceEl.textContent = source || "—";

  if (COLOR_PL[colorCode]) {
    speakPL(name);
  }
}

async function refreshDevices() {
  const res = await ipcRenderer.invoke("boost:listDevices");
  if (!res?.ok) return;

  const devices = res.devices || [];
  log(`Urządzenia (hub.getDevices): ${devices.length}`);

  // Add numeric ports to dropdown (without duplicating existing)
  const existing = new Set([...colorPortEl.options].map(o => o.value));

  for (const d of devices) {
    const pid = d.portId;
    if (pid === null || pid === undefined) continue;
    const val = String(pid);
    if (existing.has(val)) continue;

    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = `${val} (type=${d.type ?? "?"})`;
    colorPortEl.appendChild(opt);
    existing.add(val);
  }
}

document.getElementById("connect").onclick = async () => {
  log("Klik: Połącz");
  setStatus("łączenie...");
  const res = await ipcRenderer.invoke("boost:connect");
  if (res?.ok) {
    connected = true;
    setStatus("połączony");
    log("Połączono OK");
    await refreshDevices();
  } else {
    connected = false;
    setStatus("błąd");
    log(`Błąd połączenia: ${res?.error || "?"}`);
  }
};

document.getElementById("disconnect").onclick = async () => {
  log("Klik: Rozłącz");
  await ipcRenderer.invoke("boost:disconnect");
  connected = false;
  setStatus("rozłączony");
  sendDrive(0,0);
};

document.getElementById("stop").onclick = () => {
  log("Klik: STOP");
  up=down=left=right=false;
  sendDrive(0,0);
};

speedEl.oninput = () => {
  speedVal.textContent = speedEl.value;
  applyDrive();
};

steerEl.oninput = () => {
  steerVal.textContent = (steerEl.value/100).toFixed(2);
  applyDrive();
};

window.addEventListener("keydown", e => {
  if (e.repeat) return;
  if (e.code==="ArrowUp") up=true;
  if (e.code==="ArrowDown") down=true;
  if (e.code==="ArrowLeft") left=true;
  if (e.code==="ArrowRight") right=true;
  if (e.code==="Space") { up=down=left=right=false; sendDrive(0,0); }
  applyDrive();
});

window.addEventListener("keyup", e => {
  if (e.code==="ArrowUp") up=false;
  if (e.code==="ArrowDown") down=false;
  if (e.code==="ArrowLeft") left=false;
  if (e.code==="ArrowRight") right=false;
  applyDrive();
});

window.addEventListener("blur", () => {
  up=down=left=right=false;
  sendDrive(0,0);
});

colorAttachBtn.onclick = async () => {
  const port = colorPortEl.value;
  const mode = colorModeEl.value;

  log(`Klik: Aktywuj czujnik -> port=${port} mode=${mode}`);
  const res = await ipcRenderer.invoke("boost:colorAttach", { port, mode });

  if (res?.ok) {
    log(`OK: czujnik aktywny (port=${port}, mode=${mode}). Przyłóż klocek.`);
    lastSpoken = null;
    lastColorCode = null;
    colorNameEl.textContent = "—";
    colorCodeEl.textContent = "—";
    colorSourceEl.textContent = `${port}/${mode}`;
  } else {
    log(`Błąd aktywacji czujnika: ${res?.error || "?"}`);
  }
};

refreshDevicesBtn.onclick = async () => {
  log("Klik: Odśwież listę portów");
  await refreshDevices();
};

// Messages from main process
ipcRenderer.on("ui:log", (_evt, line) => log(line));

ipcRenderer.on("ui:status", (_evt, s) => {
  if (!s) return;
  if (s.state === "connecting") setStatus("łączenie...");
  if (s.state === "connected") setStatus("połączony");
  if (s.state === "disconnected") setStatus("rozłączony");
  if (s.state === "error") setStatus("błąd");
  if (s.msg) log(`STATUS: ${s.state} - ${s.msg}`);
});

ipcRenderer.on("boost:devices", (_evt, devices) => {
  if (!devices) return;
  log(`Połączono. Urządzenia widoczne:`);
  for (const d of devices) {
    log(`- port=${String(d.portId)} name=${d.name} type=${d.type}`);
  }
});

ipcRenderer.on("boost:raw", (_evt, payload) => {
  // This is only for debugging if the hub reports something but not color
  if (!payload) return;
  const p = payload.port !== undefined ? `port=${payload.port}` : "";
  const ev = payload.eventName ? `event=${payload.eventName}` : "";
  log(`RAW: ${p} ${ev} value=${JSON.stringify(payload.value ?? payload)}`);
});

ipcRenderer.on("boost:color", (_evt, msg) => {
  if (!msg) return;
  const code = msg.color;
  const source = `${msg.port}/${msg.mode}`;

  if (code === lastColorCode) return;
  lastColorCode = code;

  log(`COLOR: ${source} -> ${code} (${COLOR_PL[code] || "?"})`);
  updateColorUI(code, source);
});

log("renderer.js załadowany OK");
