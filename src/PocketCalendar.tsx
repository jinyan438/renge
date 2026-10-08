import { useState, type FormEvent } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Clock, CornerDownRight } from "lucide-react";
import { formatPocketCalendarTime, parsePocketCalendarTime, pocketCalendarFields, pocketCalendarMonth, shiftPocketCalendarMonth } from "./pocketCalendarState";

export function PocketCalendar({ now, onJump, onExit }: { now: string; onJump: (time: string) => void | Promise<void>; onExit: () => void }) {
  const [fields, setFields] = useState(() => pocketCalendarFields(now));
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selected = parsePocketCalendarTime(fields.date, fields.time);
  const month = pocketCalendarMonth(fields.date) || pocketCalendarMonth(pocketCalendarFields(now).date)!;
  const current = pocketCalendarFields(now);
  const isCurrent = fields.date === current.date && fields.time === current.time;
  function patch(next: Partial<typeof fields>) { setFields(previous => ({ ...previous, ...next })); setFeedback(""); setError(""); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || saving || isCurrent && !error) return;
    setSaving(true); setFeedback(""); setError("");
    try { await onJump(selected); setFeedback(`已跳转到 ${formatPocketCalendarTime(selected)}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "时间暂未保存，请重试。"); }
    finally { setSaving(false); }
  }
  return <div className="pocket-calendar pocket-scroll">
    <div className="pocket-app-heading"><button type="button" onClick={onExit} aria-label="返回手机桌面"><ArrowLeft size={19} /></button><h2>日历</h2></div>
    <div className="pocket-calendar-current"><Clock size={18} /><span><small>当前剧情时间</small><strong>{formatPocketCalendarTime(now)}</strong></span></div>
    <form onSubmit={submit} aria-busy={saving}>
      <div className="pocket-calendar-month">
        <button type="button" aria-label="上个月" disabled={!shiftPocketCalendarMonth(fields.date, -1)} onClick={() => patch({ date: shiftPocketCalendarMonth(fields.date, -1)! })}><ChevronLeft size={18} /></button>
        <strong>{month.year} 年 {month.month} 月</strong>
        <button type="button" aria-label="下个月" disabled={!shiftPocketCalendarMonth(fields.date, 1)} onClick={() => patch({ date: shiftPocketCalendarMonth(fields.date, 1)! })}><ChevronRight size={18} /></button>
      </div>
      <div className="pocket-calendar-grid" aria-label="选择日期">
        {["一", "二", "三", "四", "五", "六", "日"].map(day => <small key={day}>{day}</small>)}
        {Array.from({ length: month.offset }, (_, index) => <span key={`empty-${index}`} />)}
        {Array.from({ length: month.days }, (_, index) => {
          const day = index + 1; const date = `${String(month.year).padStart(4, "0")}-${String(month.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          return <button type="button" key={day} className={date === current.date ? "is-current-day" : ""} aria-label={`${month.year}年${month.month}月${day}日`} aria-pressed={date === fields.date} onClick={() => patch({ date })}>{day}</button>;
        })}
      </div>
      <label className="pocket-settings-label" htmlFor="pocket-calendar-date">跳转日期</label>
      <input id="pocket-calendar-date" className="pocket-input" type="date" min="0001-01-01" max="9999-12-31" required value={fields.date} onChange={event => patch({ date: event.target.value })} />
      <label className="pocket-settings-label" htmlFor="pocket-calendar-time">跳转时间</label>
      <input id="pocket-calendar-time" className="pocket-input" type="time" step={60} required value={fields.time} onChange={event => patch({ time: event.target.value })} />
      <p className="pocket-calendar-note">跳转后会同步手机时间，并将选定时间加入会话上下文。</p>
      <button className="pocket-primary pocket-calendar-jump" type="submit" disabled={saving || !selected || isCurrent && !error}><CornerDownRight size={16} />{saving ? "正在保存…" : error ? "重试保存时间" : "跳转到选定时间"}</button>
      <button className="pocket-calendar-reset" type="button" onClick={() => { setFields(pocketCalendarFields(now)); setFeedback(""); setError(""); }}>查看当前时间</button>
      {error && <p className="pocket-error" role="alert">{error}</p>}
      {feedback && <p className="pocket-calendar-feedback" role="status"><Check size={14} />{feedback}</p>}
    </form>
  </div>;
}
