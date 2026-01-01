const { ipcRenderer } = window.require("electron");

const ui = {
  status: document.getElementById("status"),
  log: document.getElementById("log"),
  speed: document.getElementById("speed"),
  speedVal: document.getElementById("speedVal"),
  headSpeed: document.getElementById("headSpeed"),
  headSpeedVal: document.getElementById("headSpeedVal"),
  steer: document.getElementById("steer"),
  steerVal: document.getElementById("steerVal")
};

const COLOR_PORT = "D";

const state = {
  connected: false,
  directions: { up: false, down: false, left: false, right: false },
  head: { left: false, right: false },
  lastDrive: { left: 0, right: 0 },
  lastHead: 0,
  lastSpoken: null,
  lastColorCode: null
};

const COLOR_PL = {
  0: "Czarny",
  3: "Niebieski",
  5: "Zielony",
  7: "Żółty",
  9: "Czerwony",
  10: "Biały"
};

function now() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function log(line) {
  ui.log.value += `[${now()}] ${line}\n`;
  ui.log.scrollTop = ui.log.scrollHeight;
}

function setStatus(text) {
  ui.status.textContent = text;
}

function setConnected(isConnected) {
  state.connected = Boolean(isConnected);
}

function speakPL(text) {
  if (!text) return;

  // Avoid repeating the same word nonstop when the sensor jitters
  if (text === state.lastSpoken) return;
  state.lastSpoken = text;

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
  const speed = Number(ui.speed.value);
  const steer = Number(ui.steer.value) / 100;

  const throttle = state.directions.up ? 1 : state.directions.down ? -1 : 0;
  const s = state.directions.left ? -1 : state.directions.right ? 1 : 0;

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

function computeHead() {
  const speed = Number(ui.headSpeed.value);
  const direction = state.head.left ? -1 : state.head.right ? 1 : 0;
  return clamp100(direction * speed);
}

async function sendDrive(l, r) {
  l = Math.trunc(l);
  r = Math.trunc(r);
  if (!state.connected) return;
  if (l === state.lastDrive.left && r === state.lastDrive.right) return;
  state.lastDrive = { left: l, right: r };
  await ipcRenderer.invoke("boost:drive", { left: l, right: r });
}

async function sendHead(power) {
  power = Math.trunc(power);
  if (!state.connected) return;
  if (power === state.lastHead) return;
  state.lastHead = power;
  await ipcRenderer.invoke("boost:head", { power });
}

function applyDrive() {
  const t = computeDrive();
  sendDrive(t.left, t.right);
}

function applyHead() {
  const p = computeHead();
  sendHead(p);
}

function resetDirections() {
  state.directions = { up: false, down: false, left: false, right: false };
}

function resetHead() {
  state.head = { left: false, right: false };
  state.lastHead = 0;
}

async function activateColorSensor() {
  log(`Auto: aktywacja czujnika koloru na porcie ${COLOR_PORT}...`);
  const res = await ipcRenderer.invoke("boost:colorAttach", { port: COLOR_PORT, mode: "color" });

  if (res?.ok) {
    const activeMode = res.mode || "color";
    const activeModeId = res.modeId !== undefined ? `id=${res.modeId}` : "";
    log(`OK: czujnik koloru aktywny (port=${COLOR_PORT}, mode=${activeMode} ${activeModeId}).`);
    state.lastSpoken = null;
    state.lastColorCode = null;
  } else {
    log(`Błąd aktywacji czujnika na porcie ${COLOR_PORT}: ${res?.error || "?"}`);
  }
}

function preventArrowKeyAdjust(inputEl) {
  if (!inputEl) return;
  inputEl.addEventListener("keydown", (e) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
      e.preventDefault();
    }
  });
}

document.getElementById("connect").onclick = async () => {
  log("Klik: Połącz");
  setStatus("łączenie...");
  const res = await ipcRenderer.invoke("boost:connect");
  if (res?.ok) {
    setConnected(true);
    setStatus("połączony");
    log("Połączono OK");
    await activateColorSensor();
  } else {
    setConnected(false);
    setStatus("błąd");
    log(`Błąd połączenia: ${res?.error || "?"}`);
  }
};

document.getElementById("disconnect").onclick = async () => {
  log("Klik: Rozłącz");
  await ipcRenderer.invoke("boost:disconnect");
  setConnected(false);
  setStatus("rozłączony");
  sendDrive(0,0);
  sendHead(0);
};

document.getElementById("stop").onclick = () => {
  log("Klik: STOP");
  resetDirections();
  resetHead();
  sendDrive(0,0);
  sendHead(0);
};

ui.speed.oninput = () => {
  ui.speedVal.textContent = ui.speed.value;
  applyDrive();
};

ui.headSpeed.oninput = () => {
  ui.headSpeedVal.textContent = ui.headSpeed.value;
  applyHead();
};

ui.steer.oninput = () => {
  ui.steerVal.textContent = (ui.steer.value/100).toFixed(2);
  applyDrive();
};

window.addEventListener("keydown", e => {
  if (e.repeat) return;
  if (e.code==="ArrowUp") state.directions.up=true;
  if (e.code==="ArrowDown") state.directions.down=true;
  if (e.code==="ArrowLeft") state.directions.left=true;
  if (e.code==="ArrowRight") state.directions.right=true;
  if (e.code==="KeyA") state.head.left=true;
  if (e.code==="KeyD") state.head.right=true;
  if (e.code==="Space") { resetDirections(); resetHead(); sendDrive(0,0); sendHead(0); }
  applyDrive();
  applyHead();
});

window.addEventListener("keyup", e => {
  if (e.code==="ArrowUp") state.directions.up=false;
  if (e.code==="ArrowDown") state.directions.down=false;
  if (e.code==="ArrowLeft") state.directions.left=false;
  if (e.code==="ArrowRight") state.directions.right=false;
  if (e.code==="KeyA") state.head.left=false;
  if (e.code==="KeyD") state.head.right=false;
  applyDrive();
  applyHead();
});

window.addEventListener("blur", () => {
  resetDirections();
  resetHead();
  sendDrive(0,0);
  sendHead(0);
});

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

  log(`Wykryty kolor : ${code},\nŹródło: ${source}`);
  const spoken = COLOR_PL[code];
  if (spoken && code !== state.lastColorCode) speakPL(spoken);
  state.lastColorCode = code;
});

preventArrowKeyAdjust(ui.speed);
preventArrowKeyAdjust(ui.steer);
preventArrowKeyAdjust(ui.headSpeed);
log("renderer.js załadowany OK");
