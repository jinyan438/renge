import { memo, useMemo } from "react";

const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

// A streaming message changes on every fragment; its timestamp does not.
export const ChatMessageTime = memo(function ChatMessageTime({ createdAt }: { createdAt: string }) {
  const text = useMemo(() => {
    const date = new Date(createdAt);
    return Number.isNaN(date.getTime()) ? "Invalid Date" : timeFormat.format(date);
  }, [createdAt]);
  return <time dateTime={createdAt}>{text}</time>;
});
