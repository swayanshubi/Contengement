const { app, BrowserWindow, Menu, ipcMain, screen } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const isDev = !app.isPackaged;
const appIconPath = path.join(app.getAppPath(), "electron", "assets", "icon.png");

let mainWindow = null;
let nextServerProcess = null;

function waitForServer(url, timeoutMs = 30000, intervalMs = 500) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });

      req.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }

        setTimeout(check, intervalMs);
      });

      req.setTimeout(intervalMs, () => {
        req.destroy();
      });
    };

    check();
  });
}

function startNextServer() {
  const nextCli = path.join(app.getAppPath(), "node_modules", "next", "dist", "bin", "next");

  nextServerProcess = spawn(process.execPath, [nextCli, "start", "-p", String(PORT), "-H", HOST], {
    cwd: app.getAppPath(),
    env: {
      ...process.env,
      NODE_ENV: "production"
    },
    stdio: "inherit"
  });

  nextServerProcess.on("exit", (code) => {
    if (code !== 0) {
      console.error(`Next.js server exited with code ${code}`);
    }
  });
}

async function createWindow() {
  const targetUrl = isDev
    ? process.env.ELECTRON_DEV_URL || `http://${HOST}:${PORT}`
    : `http://${HOST}:${PORT}`;

  if (!isDev) {
    startNextServer();
    await waitForServer(targetUrl);
  }

  const { workArea } = screen.getPrimaryDisplay();
  const initialWidth = Math.min(1366, workArea.width);
  const initialHeight = Math.min(900, workArea.height);
  const initialX = workArea.x + Math.max(0, Math.floor((workArea.width - initialWidth) / 2));
  const initialY = workArea.y + Math.max(0, Math.floor((workArea.height - initialHeight) / 2));

  mainWindow = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    x: initialX,
    y: initialY,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    frame: false,
    icon: appIconPath,
    backgroundColor: "#09090b",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.setMenuBarVisibility(false);

  await mainWindow.loadURL(targetUrl);
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.webContents.once("did-finish-load", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) mainWindow.show();
  });
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) mainWindow.show();
  }, 5000);

}

app.whenReady().then(async () => {
  try {
    Menu.setApplicationMenu(null);
    app.setAppUserModelId("com.contengement.app");
    await createWindow();

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createWindow();
      }
    });
  } catch (error) {
    console.error(error);
    app.quit();
  }
});

ipcMain.handle("window:minimize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.minimize();
});

ipcMain.handle("window:maximize-toggle", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  if (win.isMaximized()) {
    win.unmaximize();
    return false;
  }
  win.maximize();
  return true;
});

ipcMain.handle("window:is-maximized", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return Boolean(win && win.isMaximized());
});

ipcMain.handle("window:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (nextServerProcess && !nextServerProcess.killed) {
    nextServerProcess.kill("SIGTERM");
  }
});
