const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isDesktop: true,
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:maximize-toggle"),
  isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
});
