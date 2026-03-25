const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const DEV_URL = process.env.ELECTRON_DEV_URL || `http://${HOST}:${PORT}`;

let nextProcess = null;
let electronProcess = null;
let startedNextHere = false;

function isPortOpen(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

function waitForServer(url, timeoutMs = 60000, intervalMs = 500) {
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

      req.setTimeout(intervalMs, () => req.destroy());
    };

    check();
  });
}

function startNext() {
  const nextCli = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  nextProcess = spawn(process.execPath, [nextCli, "dev", "-H", HOST, "-p", String(PORT)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  startedNextHere = true;
}

function startElectron() {
  const electronBinary = process.platform === "win32"
    ? path.join(process.cwd(), "node_modules", "electron", "dist", "electron.exe")
    : path.join(process.cwd(), "node_modules", "electron", "dist", "electron");
  const electronEnv = {
    ...process.env,
    ELECTRON_DEV_URL: DEV_URL,
  };
  delete electronEnv.ELECTRON_RUN_AS_NODE;

  electronProcess = spawn(electronBinary, ["."], {
    cwd: process.cwd(),
    env: electronEnv,
    stdio: "inherit",
  });

  electronProcess.on("exit", (code) => {
    if (startedNextHere && nextProcess && !nextProcess.killed) {
      nextProcess.kill("SIGTERM");
    }
    process.exit(code ?? 0);
  });
}

function shutdown() {
  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill("SIGTERM");
  }
  if (startedNextHere && nextProcess && !nextProcess.killed) {
    nextProcess.kill("SIGTERM");
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

(async () => {
  const running = await isPortOpen(HOST, PORT);
  if (!running) {
    console.log(`[electron:dev] Starting Next dev server on ${HOST}:${PORT}...`);
    startNext();
  } else {
    console.log(`[electron:dev] Reusing existing server at ${DEV_URL}`);
  }

  await waitForServer(DEV_URL);
  console.log(`[electron:dev] Launching Electron with ${DEV_URL}`);
  startElectron();
})().catch((error) => {
  console.error(error);
  shutdown();
  process.exit(1);
});
