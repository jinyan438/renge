const windowTitles = {
  studio: "人格工作室",
  characters: "角色卡",
  extensions: "扩展管理器",
  settings: "系统设置",
  chat: "Agent Chat",
  "home-studio": "人格工作室",
  "home-characters": "角色卡",
  "home-extensions": "扩展管理器",
  "home-settings": "系统设置",
  "home-chat": "Agent Chat",
  "home-recent": "最近会话",
  "home-about": "关于 Renge",
};

export function createDesktopWindowManager({ screen, icon, onWindowCreated = () => {} }) {
  const windows = new Map();
  const drags = new Map();
  let owner = null;
  let lastActiveWindow = null;
  const send = (id, state) => {
    if (owner && !owner.isDestroyed()) {
      owner.webContents.send("desktop-window:state", { id, ...state });
    }
  };

  return {
    attach(mainWindow) {
      owner = mainWindow;
      mainWindow.on("focus", () => { lastActiveWindow = mainWindow; });
      const hostUrl = () => new URL("/desktop-window.html", mainWindow.webContents.getURL()).href;
      mainWindow.webContents.setWindowOpenHandler(({ url, frameName }) => {
        const id = frameName.replace(/^renge-desktop-/, "");
        if (url !== hostUrl() || frameName !== `renge-desktop-${id}` || !Object.hasOwn(windowTitles, id)) {
          return { action: "deny" };
        }
        const { workArea } = screen.getDisplayMatching(mainWindow.getBounds());
        const bounds = mainWindow.getContentBounds();
        const summary = id.startsWith("home-");
        const width = Math.min(summary ? 760 : 1240, workArea.width);
        const height = Math.min(summary ? 560 : 820, workArea.height);
        const step = (windows.size % 5) * 24;
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            title: `Renge Agent Lab — ${windowTitles[id]}`,
            icon,
            frame: false,
            show: false,
            backgroundColor: "#f8f8fa",
            autoHideMenuBar: true,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: false,
              webviewTag: true,
            },
            minWidth: Math.min(summary ? 420 : 860, workArea.width),
            minHeight: Math.min(summary ? 300 : 560, workArea.height),
            width,
            height,
            x: Math.max(workArea.x, Math.min(bounds.x + 40 + step, workArea.x + workArea.width - width)),
            y: Math.max(workArea.y, Math.min(bounds.y + 40 + step, workArea.y + workArea.height - height)),
          },
        };
      });
      mainWindow.webContents.on("did-create-window", (child, { frameName }) => {
        const id = frameName.slice("renge-desktop-".length);
        windows.set(id, child);
        child.on("focus", () => { lastActiveWindow = child; });
        child.removeMenu();
        child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        child.webContents.on("will-navigate", (event, url) => {
          if (url !== hostUrl()) event.preventDefault();
        });
        for (const name of ["maximize", "unmaximize", "minimize", "restore", "focus"]) {
          child.on(name, () => send(id, {
            maximized: child.isMaximized(),
            minimized: child.isMinimized(),
            focused: child.isFocused(),
          }));
        }
        child.on("closed", () => {
          if (windows.get(id) !== child) return;
          windows.delete(id);
          drags.delete(id);
          send(id, { closed: true });
        });
        onWindowCreated(child);
      });
      // Portals share the main renderer's state and must not survive its reload.
      mainWindow.webContents.on("did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
        if (isMainFrame && !inPlace) this.closeAll();
      });
      mainWindow.on("closed", () => this.closeAll());
    },
    control(event, { id, action, deltaX, deltaY } = {}) {
      if (!owner || owner.isDestroyed() || event.sender !== owner.webContents) {
        throw new Error("桌面窗口操作来源无效");
      }
      const child = windows.get(id);
      if (!child || child.isDestroyed()) return { ok: false };
      switch (action) {
        case "show":
          if (child.isMinimized()) child.restore();
          child.show();
          child.focus();
          break;
        case "minimize": child.minimize(); break;
        case "toggle-maximize":
          if (child.isMaximized()) child.unmaximize();
          else child.maximize();
          break;
        case "close": child.close(); break;
        case "drag-start": drags.set(id, child.getBounds()); break;
        case "drag-move": {
          const start = drags.get(id);
          if (start && Number.isFinite(deltaX) && Number.isFinite(deltaY)) {
            child.setPosition(Math.round(start.x + deltaX), Math.round(start.y + deltaY));
          }
          break;
        }
        case "drag-end": drags.delete(id); break;
        default: throw new Error("未知的桌面窗口操作");
      }
      return { ok: true };
    },
    getFocusedWindow() {
      return [...windows.values()].find((child) => !child.isDestroyed() && child.isFocused());
    },
    getWindow(id) {
      const child = windows.get(id);
      return child && !child.isDestroyed() ? child : undefined;
    },
    getDialogWindow() {
      if (owner && !owner.isDestroyed() && owner.isFocused()) return owner;
      return this.getFocusedWindow() ??
        (lastActiveWindow && !lastActiveWindow.isDestroyed() ? lastActiveWindow : owner);
    },
    closeAll() {
      for (const child of windows.values()) {
        if (!child.isDestroyed()) child.destroy();
      }
      windows.clear();
      drags.clear();
    },
  };
}
