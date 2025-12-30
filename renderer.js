const { ipcRenderer } = window.require("electron");

const statusEl = document.getElementById("status");
const speedEl = document.getElementById("speed");
const speedVal = document.getElementById("speedVal");
const steerEl = document.getElementById("steer");
const steerVal = document.getElementById("steerVal");

let connected = false;
let up=false, down=false, left=false, right=false;
let lastL=0, lastR=0;

function clamp100(x) {
  return Math.max(-100, Math.min(100, x));
}

function compute() {
  const speed = Number(speedEl.value);
  const steer = Number(steerEl.value) / 100;

  let throttle = up ? 1 : down ? -1 : 0;
  let s = left ? -1 : right ? 1 : 0;

  // Turn-in-place when no throttle (so left/right works immediately)
  if (throttle === 0) {
    if (s === 0) return { left: 0, right: 0 };
    const rot = Math.max(10, Math.trunc(speed)); // rotation power based on speed slider
    return { left: -s * rot, right: s * rot };
  }

  const base = throttle * speed;
  return {
    left: clamp100(base * (1 - s * steer)),
    right: clamp100(base * (1 + s * steer))
  };
}


async function send(l, r) {
  l = Math.trunc(l);
  r = Math.trunc(r);
  if (!connected) return;
  if (l === lastL && r === lastR) return;
  lastL = l; lastR = r;
  await ipcRenderer.invoke("boost:drive", { left: l, right: r });
}

function apply() {
  const t = compute();
  send(t.left, t.right);
}

document.getElementById("connect").onclick = async () => {
  statusEl.textContent = "łączenie...";
  await ipcRenderer.invoke("boost:connect");
  connected = true;
  statusEl.textContent = "połączony";
};

document.getElementById("disconnect").onclick = async () => {
  await ipcRenderer.invoke("boost:disconnect");
  connected = false;
  send(0,0);
  statusEl.textContent = "rozłączony";
};

document.getElementById("stop").onclick = () => {
  up=down=left=right=false;
  send(0,0);
};

speedEl.oninput = () => {
  speedVal.textContent = speedEl.value;
  apply();
};

steerEl.oninput = () => {
  steerVal.textContent = (steerEl.value/100).toFixed(2);
  apply();
};

window.addEventListener("keydown", e => {
  if (e.repeat) return;
  if (e.code==="ArrowUp") up=true;
  if (e.code==="ArrowDown") down=true;
  if (e.code==="ArrowLeft") left=true;
  if (e.code==="ArrowRight") right=true;
  if (e.code==="Space") { up=down=left=right=false; send(0,0); }
  apply();
});

window.addEventListener("keyup", e => {
  if (e.code==="ArrowUp") up=false;
  if (e.code==="ArrowDown") down=false;
  if (e.code==="ArrowLeft") left=false;
  if (e.code==="ArrowRight") right=false;
  apply();
});

window.addEventListener("blur", () => {
  up=down=left=right=false;
  send(0,0);
});
