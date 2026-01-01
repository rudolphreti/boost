import { app, BrowserWindow, ipcMain } from "electron";
import { BoostController } from "./app/boostController.js";

const boost = new BoostController();
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
  win.loadFile("index.html");
  boost.setWindow(win);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  await boost.disconnect();
});

// IPC
ipcMain.handle("boost:connect", async () => {
  try {
    await boost.connect();
    return { ok: true };
  } catch (e) {
    boost.sendStatus("error", String(e?.message || e));
    boost.sendLog(`ERROR connect: ${String(e?.message || e)}`);
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle("boost:disconnect", async () => {
  await boost.disconnect();
  return { ok: true };
});

ipcMain.handle("boost:drive", async (_evt, { left, right }) => {
  await boost.drive(left, right);
  return { ok: true };
});

ipcMain.handle("boost:head", async (_evt, { power }) => {
  await boost.head(power);
  return { ok: true };
});

ipcMain.handle("boost:colorAttach", async (_evt, { port, mode }) => {
  try {
    const result = await boost.attachColorSensor(port, mode);
    return { ok: true, mode: result?.mode, modeId: result?.modeId };
  } catch (e) {
    boost.sendStatus("error", String(e?.message || e));
    boost.sendLog(`ERROR colorAttach: ${String(e?.message || e)}`);
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle("boost:listDevices", async () => {
  const devices = boost.listDevices();
  return { ok: true, devices };
});
