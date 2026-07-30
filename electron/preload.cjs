const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rengeDesktop", {
  isElectron: true,
  clearAppStorage: () => ipcRenderer.invoke("app-data:clear-storage"),
  loadDesktopProjectPositions: () => ipcRenderer.invoke("desktop-layout:load"),
  saveDesktopProjectPositions: (positions) => ipcRenderer.invoke("desktop-layout:save", positions),
  listSidebarFiles: (options) => ipcRenderer.invoke("sidebar-files:list", options),
  readSidebarTextFile: (options) => ipcRenderer.invoke("sidebar-files:read-text", options),
  readSidebarBinaryFile: (options) => ipcRenderer.invoke("sidebar-files:read-binary", options),
  importTemporaryFiles: () => ipcRenderer.invoke("sidebar-files:import-temporary"),
  runSidebarFileAction: (options) => ipcRenderer.invoke("sidebar-files:system-action", options),
  selectWorkspace: () => ipcRenderer.invoke("workspace:select"),
  selectSkillFolder: () => ipcRenderer.invoke("skill:select-folder"),
  restoreWorkspace: (options) => ipcRenderer.invoke("workspace:restore", options),
  setFullAccess: (options) => ipcRenderer.invoke("workspace:set-full-access", options),
  listFiles: (options) => ipcRenderer.invoke("workspace:list", options),
  readFile: (options) => ipcRenderer.invoke("workspace:read", options),
  readBinaryFile: (options) => ipcRenderer.invoke("workspace:read-binary", options),
  readFileRange: (options) => ipcRenderer.invoke("workspace:read-range", options),
  fileInfo: (options) => ipcRenderer.invoke("workspace:info", options),
  searchFiles: (options) => ipcRenderer.invoke("workspace:search", options),
  writeFile: (options) => ipcRenderer.invoke("workspace:write", options),
  writeBinaryFile: (options) => ipcRenderer.invoke("workspace:write-binary", options),
  editFile: (options) => ipcRenderer.invoke("workspace:edit", options),
  createDirectory: (options) => ipcRenderer.invoke("workspace:mkdir", options),
  renamePath: (options) => ipcRenderer.invoke("workspace:rename", options),
  deletePath: (options) => ipcRenderer.invoke("workspace:delete", options),
  runScript: (options) => ipcRenderer.invoke("workspace:run-script", options),
  runCommand: (options) => ipcRenderer.invoke("workspace:run-command", options),
  gitStatus: () => ipcRenderer.invoke("workspace:git-status"),
  gitDiff: (options) => ipcRenderer.invoke("workspace:git-diff", options),
  detectStack: () => ipcRenderer.invoke("workspace:detect-stack"),
  searchRegex: (options) => ipcRenderer.invoke("workspace:search-regex", options),
  findSymbols: (options) => ipcRenderer.invoke("workspace:find-symbols", options),
  readPackageJson: () => ipcRenderer.invoke("workspace:package-json"),
  scanTodos: (options) => ipcRenderer.invoke("workspace:todos", options),
  listSidebarBrowserDownloads: () => ipcRenderer.invoke("sidebar-browser:downloads-list"),
  runSidebarBrowserDownloadAction: (options) =>
    ipcRenderer.invoke("sidebar-browser:download-action", options),
  captureSidebarBrowserPage: (options) => ipcRenderer.invoke("sidebar-browser:capture", options),
  setSidebarBrowserDeviceEmulation: (options) =>
    ipcRenderer.invoke("sidebar-browser:device-emulation", options),
  importSidebarBrowserProfile: () => ipcRenderer.invoke("sidebar-browser:import-profile"),
  getSidebarBrowserProfile: () => ipcRenderer.invoke("sidebar-browser:profile"),
  updateSidebarBrowserProfile: (options) =>
    ipcRenderer.invoke("sidebar-browser:profile-setting", options),
  getSidebarBrowserAutofill: (options) => ipcRenderer.invoke("sidebar-browser:autofill", options),
  clearSidebarBrowserData: (options) => ipcRenderer.invoke("sidebar-browser:clear-data", options),
  runSidebarBrowserContextAction: (options) =>
    ipcRenderer.invoke("sidebar-browser:context-action", options),
  onSidebarBrowserContextMenu: (listener) => {
    if (typeof listener !== "function") return () => undefined;
    const wrappedListener = (_event, payload) => listener(payload);
    ipcRenderer.on("sidebar-browser:context-menu", wrappedListener);
    return () => ipcRenderer.removeListener("sidebar-browser:context-menu", wrappedListener);
  },
  onSidebarBrowserDownloads: (listener) => {
    if (typeof listener !== "function") return () => undefined;
    const wrappedListener = (_event, payload) => listener(payload);
    ipcRenderer.on("sidebar-browser:downloads-updated", wrappedListener);
    return () => ipcRenderer.removeListener("sidebar-browser:downloads-updated", wrappedListener);
  },
  onSidebarBrowserOpenTab: (listener) => {
    if (typeof listener !== "function") return () => undefined;
    const wrappedListener = (_event, payload) => listener(payload);
    ipcRenderer.on("sidebar-browser:open-tab", wrappedListener);
    return () => ipcRenderer.removeListener("sidebar-browser:open-tab", wrappedListener);
  },
});
