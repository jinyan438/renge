import { type ReactNode, useEffect, useState } from "react";

/** Closed tool histories must not build previews, diffs or thousands of DOM nodes. */
export function ChatDeferredDetails({
  className, autoOpen = false, summary, children,
}: {
  className: string;
  autoOpen?: boolean;
  summary: ReactNode;
  children: () => ReactNode;
}) {
  const [expanded, setExpanded] = useState(autoOpen);
  useEffect(() => setExpanded(autoOpen), [autoOpen]);
  return (
    <details className={className} tabIndex={-1} open={expanded}
      onToggle={(event) => { if (event.target === event.currentTarget) setExpanded(event.currentTarget.open); }}>
      {summary}
      {expanded ? children() : null}
    </details>
  );
}
