import { useState, type ReactNode } from "react";
import { ArrowLeft, Check, ChevronDown, Link, Palette, RotateCcw, SlidersHorizontal, Smartphone } from "lucide-react";
import { POCKET_THEMES, type PocketSettings } from "./pocketPhoneState";
import { POCKET_PROMPTS, type PocketPromptId, type PocketPromptOverrides } from "./pocketPhonePrompts";
import type { PocketProvider } from "./pocketPhoneChat";

function SettingsCard({ title, icon, children, open = false }: { title: string; icon: ReactNode; children: ReactNode; open?: boolean }) {
  return <details className="pocket-settings-card" open={open || undefined}>
    <summary>{icon}<strong>{title}</strong><ChevronDown size={16} /></summary>
    <div className="pocket-settings-card-body">{children}</div>
  </details>;
}

export function PocketPhoneSettings({ settings, promptOverrides, nickname, owner, providers, provider, modelId, canChat, onChange, onPromptChange, onExit }: {
  settings: PocketSettings; nickname: string; owner: boolean; providers: PocketProvider[];
  provider?: PocketProvider; modelId: string; canChat: boolean;
  promptOverrides: PocketPromptOverrides; onPromptChange: (prompts: PocketPromptOverrides) => string;
  onChange: (patch: Partial<PocketSettings>) => void; onExit: () => void;
}) {
  const [drafts, setDrafts] = useState<PocketPromptOverrides>({});
  const [feedback, setFeedback] = useState<Partial<Record<PocketPromptId, string>>>({});
  const overrides = promptOverrides;
  function save(id: PocketPromptId, defaultText: string) {
    const text = drafts[id] ?? overrides[id] ?? defaultText;
    if (!text.trim()) { setFeedback(previous => ({ ...previous, [id]: "提示词不能为空。" })); return; }
    const next = { ...overrides };
    if (text === defaultText) delete next[id]; else next[id] = text;
    const warning = onPromptChange(next);
    setDrafts(previous => { const nextDrafts = { ...previous }; delete nextDrafts[id]; return nextDrafts; });
    setFeedback(previous => ({ ...previous, [id]: warning || "已全局保存，下次生成生效。" }));
  }
  function reset(id: PocketPromptId) {
    const next = { ...overrides }; delete next[id];
    const warning = onPromptChange(next);
    setDrafts(previous => { const nextDrafts = { ...previous }; delete nextDrafts[id]; return nextDrafts; });
    setFeedback(previous => ({ ...previous, [id]: warning || "已全局恢复默认。" }));
  }
  return <div className="pocket-settings pocket-scroll">
    <header className="pocket-settings-heading">
      <button type="button" onClick={onExit} aria-label="返回手机桌面"><ArrowLeft size={20} /></button>
      <h2>设置</h2>
      <button type="button" onClick={onExit} aria-label="完成手机设置"><Check size={20} /></button>
    </header>
    <div className="pocket-settings-section-title">操作</div>
    <SettingsCard title="手机" icon={<Smartphone size={20} />} open>
      <label className="pocket-settings-label" htmlFor="pocket-nickname">{owner ? "手机主人" : "我的昵称"}</label>
      {owner ? <p className="pocket-settings-owner">{nickname}</p> : <input id="pocket-nickname" className="pocket-input" maxLength={24} placeholder={nickname} value={settings.nickname} onChange={event => onChange({ nickname: event.target.value })} />}
      <button className="pocket-setting-toggle" type="button" role="switch" aria-label="大一点的聊天文字" aria-checked={settings.largeText} onClick={() => onChange({ largeText: !settings.largeText })}><span><strong>大一点的聊天文字</strong><small>微信聊天更容易阅读</small></span><i className={settings.largeText ? "is-on" : ""} /></button>
    </SettingsCard>
    <div className="pocket-settings-section-title">外观</div>
    <SettingsCard title="手机主题" icon={<Palette size={20} />}>
      <div className="pocket-theme-options">{POCKET_THEMES.map(theme => <button type="button" key={theme.id} className={settings.theme === theme.id ? "is-selected" : ""} onClick={() => onChange({ theme: theme.id })} aria-pressed={settings.theme === theme.id}><span style={{ background: theme.color }}>{settings.theme === theme.id && <Check size={16} />}</span><small>{theme.name}</small></button>)}</div>
    </SettingsCard>
    <div className="pocket-settings-section-title">接口</div>
    <SettingsCard title="API（全局共用）" icon={<Link size={20} />}>
      <div className="pocket-settings-group">
        <label htmlFor="pocket-provider">模型渠道</label><select id="pocket-provider" value={settings.providerId} onChange={event => onChange({ providerId: event.target.value, modelId: "" })}><option value="">跟随应用当前渠道</option>{providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}{settings.providerId && !provider && <option value={settings.providerId}>渠道已移除，请重新选择</option>}</select>
        <label htmlFor="pocket-model">聊天模型</label><select id="pocket-model" disabled={!settings.providerId || !provider} value={modelId} onChange={event => onChange({ modelId: event.target.value })}>{Array.from(new Set([modelId, provider?.modelId, ...provider?.models || []].filter((value): value is string => !!value))).map(model => <option key={model} value={model}>{model}</option>)}{!modelId && <option value="">暂无可用模型</option>}</select>
        <p>{canChat ? "当前会话的手机应用共用此模型，包括 ta 的手机。" : "请先在应用的模型渠道中配置接口和模型。"}</p>
      </div>
    </SettingsCard>
    <div className="pocket-settings-section-title">生成</div>
    <SettingsCard title="提示词修改" icon={<SlidersHorizontal size={20} />}>
      <p className="pocket-prompt-intro">提示词全局共用，保存后适用于所有会话的手机和 ta 的手机。双花括号内的变量会自动填入当前角色、资料和记录。请保留输出格式中的字段，方便应用读取。</p>
      <button type="button" className="pocket-prompt-reset-all" onClick={() => { onPromptChange({}); setDrafts({}); setFeedback({}); }}><RotateCcw size={13} />全部恢复默认</button>
      {(["微信", "ta 的手机", "便签", "朋友圈", "小红书", "通用"] as const).map(group => <details className="pocket-prompt-app" key={group}>
        <summary><strong>{group}</strong><small>{POCKET_PROMPTS.filter(prompt => prompt.group === group).length} 项</small><ChevronDown size={14} /></summary>
        {POCKET_PROMPTS.filter(prompt => prompt.group === group).map(prompt => {
          const value = drafts[prompt.id] ?? overrides[prompt.id] ?? prompt.defaultText;
          const variables = [...new Set([...prompt.defaultText.matchAll(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g)].map(match => match[0]))];
          return <details className="pocket-prompt-item" key={prompt.id} data-prompt-id={prompt.id}>
            <summary><span>{prompt.title}</span><small>{overrides[prompt.id] ? "自定义" : "默认"}</small><ChevronDown size={13} /></summary>
            <div className="pocket-prompt-editor">
              <label htmlFor={`pocket-prompt-${prompt.id}`}>{prompt.title}提示词</label>
              <textarea id={`pocket-prompt-${prompt.id}`} value={value} maxLength={50000} rows={12} spellCheck={false} onChange={event => { setDrafts(previous => ({ ...previous, [prompt.id]: event.target.value })); setFeedback(previous => ({ ...previous, [prompt.id]: "尚未保存" })); }} />
              {!!variables.length && <p className="pocket-prompt-variables">可用变量：{variables.join("、")}</p>}
              <div className="pocket-prompt-actions"><button type="button" className="pocket-primary" onClick={() => save(prompt.id, prompt.defaultText)}>保存提示词</button><button type="button" onClick={() => reset(prompt.id)}><RotateCcw size={12} />恢复默认</button></div>
              <p className="pocket-prompt-feedback" role="status">{feedback[prompt.id] || "修改后点击保存提示词。"}</p>
            </div>
          </details>;
        })}
      </details>)}
    </SettingsCard>
  </div>;
}
