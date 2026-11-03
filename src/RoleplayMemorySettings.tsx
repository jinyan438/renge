export function RoleplayMemorySettings(props: {
  enabled: boolean; onEnabledChange: (enabled: boolean) => void;
}) {
  return <article className="llm-setting-card rp-memory-card">
    <div className="llm-setting-copy">
      <h3>角色扮演文件记忆</h3>
    </div>
    <label className="tool-toggle llm-feature-toggle">
      <input type="checkbox" aria-label="角色扮演文件记忆" checked={props.enabled}
        onChange={event => props.onEnabledChange(event.target.checked)} />
      <span>{props.enabled ? "开启" : "关闭"}</span>
    </label>
  </article>;
}
