import { ArrowLeft, Check, File, FolderOpen, HardDrive, Server, X } from "lucide-react";

export type PcConnectionSidebarEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
};

export type PcConnectionSidebarControl = {
  serverUrl: string;
  currentPath: string;
  entries: PcConnectionSidebarEntry[];
  status: {
    status: "idle" | "loading" | "success" | "error";
    message: string;
  };
  onOpen: () => void;
  onServerUrlChange: (value: string) => void;
  onLoadDirectory: (path: string) => void | Promise<void>;
  onNavigateUp: () => void | Promise<void>;
  onSelectWorkspace: () => void;
};

type PcConnectionSidebarPanelProps = PcConnectionSidebarControl & {
  onBack: () => void;
  onClose: () => void;
};

export function PcConnectionSidebarPanel({
  serverUrl,
  currentPath,
  entries,
  status,
  onBack,
  onClose,
  onServerUrlChange,
  onLoadDirectory,
  onNavigateUp,
  onSelectWorkspace,
}: PcConnectionSidebarPanelProps) {
  return (
    <section className="right-tool-content pc-connection-sidebar" aria-label="连接电脑">
      <header className="right-tool-page-header">
        <button className="right-tool-page-back" onClick={onBack} type="button">
          <ArrowLeft size={16} />
          <span>连接电脑</span>
        </button>
        <button aria-label="关闭右侧栏" onClick={onClose} title="关闭右侧栏" type="button">
          <X size={16} />
        </button>
      </header>

      <div className="pc-connection-sidebar-body">
        <div className="pc-connection-sidebar-intro">
          <span aria-hidden="true">
            <Server size={19} />
          </span>
          <div>
            <strong>电脑工作区</strong>
            <p>连接同一局域网中的电脑并选择工作区</p>
          </div>
        </div>

        <div className="pc-connection-card">
          <label className="pc-connection-field">
            <span>电脑地址</span>
            <input
              value={serverUrl}
              placeholder="例如：192.168.1.20:5190"
              onChange={(event) => onServerUrlChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void onLoadDirectory("");
              }}
            />
          </label>
          <button
            className="pc-connection-primary-action"
            disabled={status.status === "loading"}
            onClick={() => void onLoadDirectory("")}
            type="button"
          >
            <Server size={15} />
            {status.status === "loading" ? "连接中" : "连接"}
          </button>
        </div>

        <div className={`pc-connection-status ${status.status}`} aria-live="polite">
          {status.message || "电脑端先运行 npm run build && npm run serve。"}
        </div>

        <div className="pc-directory-card">
          <div className="pc-directory-toolbar">
            <button disabled={!currentPath} onClick={() => void onNavigateUp()} type="button">
              <ArrowLeft size={14} />
              上级
            </button>
            <button onClick={() => void onLoadDirectory("")} type="button">
              <HardDrive size={14} />
              磁盘
            </button>
          </div>
          <div className="pc-directory-path" title={currentPath || "电脑磁盘"}>
            {currentPath || "电脑磁盘"}
          </div>
          <div className="pc-directory-list">
            {entries.length > 0 ? (
              entries.map((entry) => (
                <button
                  className={entry.kind}
                  disabled={entry.kind !== "directory"}
                  key={entry.path}
                  onClick={() => {
                    if (entry.kind === "directory") void onLoadDirectory(entry.path);
                  }}
                  type="button"
                >
                  {entry.kind === "directory" ? <FolderOpen size={15} /> : <File size={15} />}
                  <span>{entry.name}</span>
                </button>
              ))
            ) : (
              <div className="pc-directory-empty">
                <HardDrive size={22} />
                <span>{status.status === "loading" ? "正在读取目录…" : "连接后在这里选择目录"}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="pc-connection-sidebar-footer">
        <span title={currentPath}>{currentPath ? "已选择当前目录" : "请选择一个电脑目录"}</span>
        <button disabled={!currentPath} onClick={onSelectWorkspace} type="button">
          <Check size={15} />
          设为工作区
        </button>
      </footer>
    </section>
  );
}
