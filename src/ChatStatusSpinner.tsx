import { LoaderCircle, type LucideProps } from "lucide-react";
import { useCallback, useRef } from "react";
import { animateChatStatusIcon } from "./chatStatusAnimation";

export function ChatStatusSpinner({ className = "", style, ...props }: LucideProps) {
  const cleanup = useRef<(() => void) | null>(null);
  const ref = useCallback((node: SVGSVGElement | null) => {
    cleanup.current?.();
    cleanup.current = node ? animateChatStatusIcon(node) : null;
  }, []);
  return <LoaderCircle {...props} ref={ref} className={`chat-status-spinner ${className}`} style={{ ...style, animation: "none" }} />;
}
