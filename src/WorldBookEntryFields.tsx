import type { WorldBookEntry } from "./worldbookUtils";

type WorldBookEntryFieldsProps = {
  entry: WorldBookEntry;
  onChange: (patch: Partial<WorldBookEntry>) => void;
  onDelete?: () => void;
};

function splitKeywords(value: string) {
  return value
    .split(/[\n,，]+/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

export function WorldBookEntryFields({
  entry,
  onChange,
  onDelete,
}: WorldBookEntryFieldsProps) {
  return (
    <>
      <div className="worldbook-entry-editor-title">
        <strong>编辑条目</strong>
        {onDelete && (
          <button type="button" className="danger-action" onClick={onDelete}>
            删除条目
          </button>
        )}
      </div>
      <label className="field">
        <span>条目名称</span>
        <input
          value={entry.comment}
          onChange={(event) => onChange({ comment: event.target.value })}
        />
      </label>
      <div className="worldbook-key-fields">
        <label className="field">
          <span>主关键词</span>
          <textarea
            value={entry.keys.join("\n")}
            placeholder="每行一个，或使用逗号分隔"
            onChange={(event) => onChange({ keys: splitKeywords(event.target.value) })}
          />
        </label>
        <label className="field">
          <span>次关键词</span>
          <textarea
            value={entry.secondaryKeys.join("\n")}
            placeholder="选择性匹配时使用"
            onChange={(event) =>
              onChange({ secondaryKeys: splitKeywords(event.target.value) })
            }
          />
        </label>
      </div>
      <label className="field worldbook-content-field">
        <span>条目内容</span>
        <textarea
          value={entry.content}
          placeholder="命中后注入会话的设定、规则或背景内容"
          onChange={(event) => onChange({ content: event.target.value })}
        />
      </label>

      <div className="worldbook-toggle-grid">
        <label className={`provider-thinking-toggle ${entry.enabled ? "active" : ""}`}>
          <input
            type="checkbox"
            checked={entry.enabled}
            onChange={(event) => onChange({ enabled: event.target.checked })}
          />
          启用条目
        </label>
        <label className={`provider-thinking-toggle ${entry.constant ? "active" : ""}`}>
          <input
            type="checkbox"
            checked={entry.constant}
            onChange={(event) => onChange({ constant: event.target.checked })}
          />
          常驻条目
        </label>
        <label className={`provider-thinking-toggle ${entry.selective ? "active" : ""}`}>
          <input
            type="checkbox"
            checked={entry.selective}
            onChange={(event) => onChange({ selective: event.target.checked })}
          />
          选择性匹配
        </label>
        <label className={`provider-thinking-toggle ${entry.caseSensitive ? "active" : ""}`}>
          <input
            type="checkbox"
            checked={entry.caseSensitive}
            onChange={(event) => onChange({ caseSensitive: event.target.checked })}
          />
          区分大小写
        </label>
        <label className={`provider-thinking-toggle ${entry.matchWholeWords ? "active" : ""}`}>
          <input
            type="checkbox"
            checked={entry.matchWholeWords}
            onChange={(event) => onChange({ matchWholeWords: event.target.checked })}
          />
          完整词匹配
        </label>
        <label className={`provider-thinking-toggle ${entry.useRegex ? "active" : ""}`}>
          <input
            type="checkbox"
            checked={entry.useRegex}
            onChange={(event) => onChange({ useRegex: event.target.checked })}
          />
          正则匹配
        </label>
        <label className={`provider-thinking-toggle ${entry.useProbability ? "active" : ""}`}>
          <input
            type="checkbox"
            checked={entry.useProbability}
            onChange={(event) => onChange({ useProbability: event.target.checked })}
          />
          使用触发概率
        </label>
      </div>

      <div className="worldbook-advanced-fields">
        <label className="field">
          <span>次关键词逻辑</span>
          <select
            value={entry.selectiveLogic}
            disabled={!entry.selective}
            onChange={(event) => onChange({ selectiveLogic: Number(event.target.value) })}
          >
            <option value={0}>任一命中</option>
            <option value={3}>全部命中</option>
            <option value={2}>全部不命中</option>
            <option value={1}>非全部命中</option>
          </select>
        </label>
        <label className="field">
          <span>注入位置</span>
          <select
            value={entry.position}
            onChange={(event) =>
              onChange({ position: event.target.value as WorldBookEntry["position"] })
            }
          >
            <option value="before_char">角色定义之前</option>
            <option value="after_char">角色定义之后</option>
            <option value="before_examples">示例对话之前</option>
            <option value="after_examples">示例对话之后</option>
            <option value="before_an">作者注释之前</option>
            <option value="after_an">作者注释之后</option>
            <option value="at_depth">指定聊天深度</option>
          </select>
        </label>
        <label className="field">
          <span>注入深度</span>
          <input
            type="number"
            min="0"
            step="1"
            value={entry.depth}
            onChange={(event) =>
              onChange({ depth: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })
            }
          />
        </label>
        <label className="field">
          <span>扫描深度</span>
          <input
            type="number"
            min="0"
            step="1"
            value={entry.scanDepth ?? ""}
            placeholder="默认 8"
            onChange={(event) =>
              onChange({
                scanDepth: event.target.value
                  ? Math.max(0, Math.trunc(Number(event.target.value) || 0))
                  : null,
              })
            }
          />
        </label>
        <label className="field">
          <span>排序</span>
          <input
            type="number"
            step="1"
            value={entry.order}
            onChange={(event) => onChange({ order: Math.trunc(Number(event.target.value) || 0) })}
          />
        </label>
        <label className="field">
          <span>触发概率（%）</span>
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            disabled={!entry.useProbability}
            value={entry.probability}
            onChange={(event) =>
              onChange({
                probability: Math.min(100, Math.max(0, Number(event.target.value) || 0)),
              })
            }
          />
        </label>
      </div>
    </>
  );
}
