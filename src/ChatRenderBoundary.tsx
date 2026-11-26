import { memo, useCallback, useLayoutEffect, useRef, type ReactNode } from "react";

function sameDependencies(previous: readonly unknown[], next: readonly unknown[]) {
  return previous.length === next.length &&
    previous.every((value, index) => Object.is(value, next[index]));
}

/**
 * Re-renders one chat item only when its dependencies change, so a streaming
 * tail does not rebuild every earlier message. A skipped item keeps the event
 * handlers from its last render: handlers inside must be stable callbacks.
 */
export const ChatRenderBoundary = memo(
  function ChatRenderBoundary({ render }: { deps: readonly unknown[]; render: () => ReactNode }) {
    return render();
  },
  (previous, next) => sameDependencies(previous.deps, next.deps),
);

export function useStableChatCallback<T extends (...args: never[]) => unknown>(callback: T): T {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });
  return useCallback(((...args: Parameters<T>) => callbackRef.current(...args)) as T, []);
}
