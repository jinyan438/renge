import { useState } from "react";
import { strToU8, zipSync } from "fflate";
import { memoryPath, normalizeRoleplayFileMemory, writeMemoryFile, type RoleplayFileMemory } from "./roleplayFileMemory";
import "./roleplay-memory.css";

export function RoleplayMemorySettings(props: {
  enabled: boolean; onEnabledChange: (enabled: boolean) => void;
  memory: RoleplayFileMemory | null; sessionTitle?: string; busy: boolean;
  onChange: (memory: RoleplayFileMemory) => void;
}) {
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("");
  const memory = props.memory;
  const files = Object.keys(memory?.files ?? {}).sort();
  const readonly = path.startsWith("剧情原文/");
  const exportFiles = () => {
    if (!memory) return;
    const entries = Object.fromEntries(files.map(file => [`文件记忆/${file}`, strToU8(memory.files[file].content)]));
    const blob = new Blob([zipSync(entries) as BlobPart], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "角色扮演文件记忆.zip"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  const renderDirectory = (root: string) => {
    const prefix = root ? `${root}/` : "";
    const directories = (memory?.directories ?? []).filter(directory => directory.startsWith(prefix) && !directory.slice(prefix.length).includes("/"));
    return <>
      {directories.map(directory => <details key={directory} className="rp-memory-directory">
        <summary>{directory.slice(prefix.length)}/</summary>
        <div>{renderDirectory(directory)}</div>
      </details>)}
      {files.filter(file => file.startsWith(prefix) && !file.slice(prefix.length).includes("/")).map(file => <button
        key={file} type="button" className={path === file ? "active" : ""}
        onClick={() => { setPath(file); setContent(memory!.files[file].content); setStatus(""); }}
      >{file.slice(prefix.length)}</button>)}
    </>;
  };
  return <article className="llm-setting-card rp-memory-card">
    <div className="llm-setting-copy">
      <h3>角色扮演文件记忆</h3>
      <p>仅在角色扮演模式生效。生成前按需检索 Markdown 记忆，生成后自动分类更新；对话正文只注入最近 3 条（用户与角色合计），预设、角色卡、世界书等其他注入保持原规则。</p>
    </div>
    <label className="tool-toggle llm-feature-toggle">
      <input type="checkbox" aria-label="角色扮演文件记忆" checked={props.enabled}
        onChange={event => props.onEnabledChange(event.target.checked)} />
      <span>{props.enabled ? "开启" : "关闭"}</span>
    </label>
    <div className={`llm-setting-status ${props.enabled ? "enabled" : "disabled"}`}>
      <strong>{props.enabled ? "按需读取 · 正文后存档" : "默认关闭"}</strong>
      <span>不同工作区和会话各有独立目录，首次生成时自动创建。分类与层级由 AI 自由组织。文件随会话保存和备份，可导出为 Markdown 目录 ZIP。每轮会增加检索与更新请求，需要支持工具调用的模型。</span>
    </div>
    {memory?.lastError && <p role="alert">上次记忆更新未完成：{memory.lastError}。正文已归档，下次可按需检索。</p>}
    <details className="rp-memory-manager">
      <summary>查看与编辑当前会话记忆{props.sessionTitle ? ` · ${props.sessionTitle}` : ""}（{files.length} 个文件）</summary>
      {!memory ? <p>先打开角色扮演会话；开启后会在首次生成时建立目录。</p> : <>
        <div className="rp-memory-actions">
          <button type="button" className="ghost-action" disabled={!files.length} onClick={exportFiles}>导出 Markdown 目录</button>
          <button type="button" className="ghost-action" disabled={props.busy} onClick={() => { setPath(""); setContent(""); setStatus(""); }}>新建记忆文件</button>
        </div>
        <div className="rp-memory-workspace">
          <nav aria-label="记忆目录">{files.length ? renderDirectory("") : <p>目录尚未建立。生成剧情后 AI 会创建分类记忆。</p>}</nav>
          <div className="rp-memory-editor">
            <label className="field"><span>Markdown 相对路径</span><input aria-label="记忆文件路径" placeholder="人物/阿莉娅/关系.md" value={path} disabled={props.busy}
              onChange={event => setPath(event.target.value)} /></label>
            <label className="field"><span>{readonly ? "剧情原文（自动归档，只读）" : "Markdown 内容"}</span><textarea aria-label="记忆文件内容" value={content} readOnly={readonly || props.busy} onChange={event => setContent(event.target.value)} /></label>
            <button type="button" className="small-action" disabled={props.busy || readonly || !path.trim()} onClick={() => {
              try {
                memoryPath(path);
                const next = normalizeRoleplayFileMemory(memory, memory.scope);
                writeMemoryFile(next, path, content);
                props.onChange(next); setStatus("记忆文件已保存。");
              } catch (error) { setStatus(error instanceof Error ? error.message : "保存失败。"); }
            }}>保存记忆文件</button>
            {status && <p role="status">{status}</p>}
          </div>
        </div>
      </>}
    </details>
  </article>;
}
