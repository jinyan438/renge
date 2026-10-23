export function RoleplayMemorySettings(props: {
  enabled: boolean; onEnabledChange: (enabled: boolean) => void;
}) {
  return <article className="llm-setting-card rp-memory-card">
    <div className="llm-setting-copy">
      <h3>角色扮演文件记忆</h3>
      <p>仅在角色扮演模式生效。生成前按需检索记忆，生成后按剧情需要提炼更新；AI 可随剧情持续新增目录和多级子目录，不生成正文副本。正文只注入最近 3 条（用户与角色合计），预设、角色卡、世界书等其他注入保持原规则。</p>
    </div>
    <label className="tool-toggle llm-feature-toggle">
      <input type="checkbox" aria-label="角色扮演文件记忆" checked={props.enabled}
        onChange={event => props.onEnabledChange(event.target.checked)} />
      <span>{props.enabled ? "开启" : "关闭"}</span>
    </label>
    <div className={`llm-setting-status ${props.enabled ? "enabled" : "disabled"}`}>
      <strong>{props.enabled ? "按需读取 · 正文后提炼" : "默认关闭"}</strong>
      <span>记忆保存在每个会话工作区的「角色记忆/会话-ID」目录；默认工作区保存在临时文件夹。请通过右侧栏「文件」统一查看和修改，修改会在下次生成时读取。每轮会增加检索与更新请求，需要支持工具调用的模型。</span>
    </div>
  </article>;
}
