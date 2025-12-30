import { app, BrowserWindow, ipcMain } from "electron";
import { PoweredUP } from "node-poweredup";

const LEFT_PORT = "A";
const RIGHT_PORT = "B";

let win;
let hub = null;
let leftMotor = null;
let rightMotor = null;

let lastL = 0;
let lastR = 0;

function clamp100(x) {
  return Math.max(-100, Math.min(100, x));
}

function send(l, r) {
  l = Math.trunc(clamp100(l));
  r = Math.trunc(clamp100(r));

  if (leftMotor && l !== lastL) {
    leftMotor.setPower(l);
    lastL = l;
  }
  if (rightMotor && r !== lastR) {
    rightMotor.setPower(r);
    lastR = r;
  }
}

async function connectBoost() {
  const poweredUP = new PoweredUP();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Hub not found")), 15000);

    poweredUP.on("discover", async (h) => {
      try {
        clearTimeout(timeout);
        hub = h;

        if (poweredUP.stopScanning) poweredUP.stopScanning();

        await hub.connect();
        leftMotor = await hub.waitForDeviceAtPort(LEFT_PORT);
        rightMotor = await hub.waitForDeviceAtPort(RIGHT_PORT);

        send(0, 0);
        resolve();
      } catch (e) {
        reject(e);
      }
    });

    poweredUP.scan();
  });
}

async function disconnectBoost() {
  try {
    send(0, 0);
    leftMotor?.brake();
    rightMotor?.brake();
  } catch {}
  try {
    await hub?.disconnect();
  } catch {}
  hub = null;
  leftMotor = null;
  rightMotor = null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 520,
    height: 420,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile("index.html");

  win.on("close", async (e) => {
    e.preventDefault();
    await disconnectBoost();
    win.destroy();
  });
}

app.whenReady().then(createWindow);

ipcMain.handle("boost:connect", async () => {
  await connectBoost();
  return { ok: true };
});

ipcMain.handle("boost:disconnect", async () => {
  await disconnectBoost();
  return { ok: true };
});

ipcMain.handle("boost:drive", async (_evt, payload) => {
  send(payload.left, payload.right);
  return { ok: true };
});
