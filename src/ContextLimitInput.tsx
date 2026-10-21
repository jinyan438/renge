import { useEffect, useId, useRef, useState } from "react";

export function ContextLimitInput({ value, onChange }: {
  value: number;
  onChange: (tokens: number) => void;
}) {
  const [draft, setDraft] = useState(() => String(value / 1_000));
  const lastValueRef = useRef(value);
  const errorId = useId();
  const labelId = `${errorId}-label`;
  const tokens = Math.round(Number(draft) * 1_000);
  const valid = draft.trim() !== "" && Number.isFinite(tokens) && tokens > 0;

  useEffect(() => {
    if (value === lastValueRef.current) return;
    lastValueRef.current = value;
    setDraft(String(value / 1_000));
  }, [value]);

  return (
    <label>
      <span id={labelId}>上下文上限（K Token）</span>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        aria-labelledby={labelId}
        aria-invalid={!valid}
        aria-describedby={!valid ? errorId : undefined}
        onChange={(event) => {
          const nextDraft = event.target.value;
          setDraft(nextDraft);
          const nextTokens = Math.round(Number(nextDraft) * 1_000);
          if (!nextDraft.trim() || !Number.isFinite(nextTokens) || nextTokens <= 0) return;
          // Keep the typed text (including a trailing decimal point) after saving.
          lastValueRef.current = nextTokens;
          onChange(nextTokens);
        }}
      />
      {!valid && (
        <small id={errorId} className="context-compression-input-error" role="status">
          请输入有效的正数，填写完成前保留上次有效值。
        </small>
      )}
    </label>
  );
}
