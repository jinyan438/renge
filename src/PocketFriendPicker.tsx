import { useEffect, useRef, useState } from "react";
import { Sparkles, Trash2 } from "lucide-react";
import type { CharacterCard } from "./characterCardUtils";
import type { PocketProvider } from "./pocketPhoneChat";
import { availablePocketFriends, pocketFriendBatches, pocketFriendName, type PocketFriendContextBuilder, type PocketFriendProfile } from "./pocketFriendGeneration";
import { requestPocketFriends } from "./pocketFriendRequest";
import type { PocketFriendLibrary, PocketLibraryCharacter } from "./pocketFriendLibrary";

export type PocketFriendMode = "manual" | "context" | "card" | "library";
type Props = {
  mode: PocketFriendMode; onMode: (mode: PocketFriendMode) => void;
  sessionId: string; cards: CharacterCard[]; existing: PocketFriendProfile[]; excludedNames: string[];
  provider?: PocketProvider; modelId: string; buildContext: PocketFriendContextBuilder;
  library: PocketFriendLibrary; onDelete: (character: PocketLibraryCharacter) => void;
  onAdd: (profiles: PocketFriendProfile[]) => void;
};

export function PocketFriendPicker(props: Props) {
  const [cardId, setCardId] = useState("");
  const [candidates, setCandidates] = useState<PocketFriendProfile[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const cancel = () => { controllerRef.current?.abort(); controllerRef.current = null; setProgress(""); };
  useEffect(() => () => { controllerRef.current?.abort(); controllerRef.current = null; }, []);
  const profiles = props.mode === "library" ? props.library.characters : candidates;
  const available = availablePocketFriends(profiles, props.existing, props.excludedNames);
  const availableNames = new Set(available.map(person => pocketFriendName(person.name)));
  const chosen = available.filter(person => selected.includes(pocketFriendName(person.name)));
  const canGenerate = !!props.provider?.apiBaseUrl.trim() && !!props.modelId;

  function switchMode(mode: PocketFriendMode) {
    cancel(); setCandidates([]); setSelected([]); setNotice(""); setError(""); props.onMode(mode);
  }
  async function generate() {
    if (controllerRef.current) return;
    const controller = new AbortController(); controllerRef.current = controller;
    setCandidates([]); setSelected([]); setError(""); setNotice("");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const context = props.buildContext(props.sessionId, props.mode === "card" ? cardId : undefined);
      const batches = pocketFriendBatches(context.sources);
      if (!batches.length) throw new Error("没有可识别的资料，请先开始对话或选择有内容的角色卡。");
      let found: PocketFriendProfile[] = [];
      for (const [index, batch] of batches.entries()) {
        setProgress(`正在识别 ${index + 1}/${batches.length}…`);
        timeout = setTimeout(() => controller.abort(new Error("角色识别超时，请重新识别。")), 120000);
        const roles = await requestPocketFriends(props.provider, props.modelId, batch, context, [...props.existing, ...found], props.excludedNames, controller.signal, () => setProgress(`正在补全 ${index + 1}/${batches.length} 的人物资料…`));
        clearTimeout(timeout); controller.signal.throwIfAborted();
        found = [...found, ...availablePocketFriends(roles, [...props.existing, ...found], props.excludedNames)];
      }
      if (controllerRef.current !== controller) return;
      const fresh = availablePocketFriends(found, props.existing, props.excludedNames);
      setCandidates(fresh);
      setNotice(fresh.length ? `识别到 ${fresh.length} 位新朋友，请勾选要添加的角色。` : "没有识别到新角色；已添加的同名角色和玩家已忽略。");
    } catch (failure) {
      if (controllerRef.current === controller && (!controller.signal.aborted || controller.signal.reason instanceof Error && controller.signal.reason.name !== "AbortError")) setError(failure instanceof Error ? failure.message : "角色识别失败，请重试。");
    } finally {
      clearTimeout(timeout);
      if (controllerRef.current === controller) { controllerRef.current = null; setProgress(""); }
    }
  }

  return <div className="pocket-friend-picker">
    <div className="pocket-friend-modes" aria-label="添加朋友方式">{([ ["manual", "手动创建"], ["context", "上下文识别"], ["card", "角色卡识别"], ["library", "角色库"] ] as const).map(([mode, label]) => <button key={mode} type="button" aria-pressed={props.mode === mode} onClick={() => switchMode(mode)}>{label}</button>)}</div>
    {props.mode !== "manual" && <>
      <p className="pocket-friend-hint">{props.mode === "library" ? "已添加联系人会自动保存到全局角色库，可在其他会话导入。删除库中角色会保留各会话已有联系人和聊天。" : props.mode === "card" ? "从角色卡、问候语和启用的世界书识别人物，快速生成简短设定。" : "根据当前会话上下文识别出场人物，快速生成简短设定，自动忽略已添加的同名角色。"}</p>
      {props.mode === "card" && <label className="pocket-field">选择角色卡<select aria-label="选择角色卡" value={cardId} onChange={event => { cancel(); setCardId(event.target.value); setCandidates([]); setSelected([]); setNotice(""); setError(""); }}><option value="">请选择角色卡</option>{props.cards.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label>}
      {props.mode !== "library" && <div className="pocket-friend-tools"><button type="button" className="pocket-primary" disabled={!canGenerate || props.mode === "card" && !cardId || !!progress} onClick={() => void generate()}><Sparkles size={14} />{progress || "识别并生成人设"}</button>{progress && <button type="button" onClick={cancel}>停止识别</button>}</div>}
      {!canGenerate && props.mode !== "library" && <p className="pocket-friend-hint">请先在手机设置中配置模型。</p>}
      {notice && <p className="pocket-friend-hint" role="status">{notice}</p>}
      {error && <p className="pocket-editor-error" role="alert">{error}</p>}
      {props.mode === "library" && !profiles.length && <p className="pocket-friend-hint">角色库还没有角色，添加朋友后会自动保存。</p>}
      {!!profiles.length && <>
        <div className="pocket-friend-tools"><span>已选 {chosen.length} / {available.length}</span><button type="button" onClick={() => setSelected(chosen.length === available.length ? [] : available.map(person => pocketFriendName(person.name)))}>{chosen.length === available.length ? "取消全选" : "全选"}</button></div>
        <div className="pocket-friend-candidates">{profiles.map(person => {
          const name = pocketFriendName(person.name); const disabled = !availableNames.has(name);
          return <article className="pocket-friend-candidate" key={name}><label><input type="checkbox" aria-label={`添加${person.name}`} disabled={disabled} checked={!disabled && selected.includes(name)} onChange={event => setSelected(previous => event.target.checked ? [...previous, name] : previous.filter(item => item !== name))} /><img src={person.avatar} alt="" /><span><strong>{person.name}</strong><small>{disabled ? "已添加或当前用户" : person.nickname || person.sourceLabel}</small></span></label><details><summary>查看人设</summary><p>{person.personality}</p>{person.greeting && <p>招呼：{person.greeting}</p>}</details>{props.mode === "library" && <button type="button" className="pocket-friend-delete" aria-label={`从角色库删除${person.name}`} onClick={() => props.onDelete(person as PocketLibraryCharacter)}><Trash2 size={13} /></button>}</article>;
        })}</div>
        <button type="button" className="pocket-primary" disabled={!chosen.length || !!progress} onClick={() => props.onAdd(chosen)}>添加所选朋友（{chosen.length}）</button>
      </>}
    </>}
  </div>;
}
