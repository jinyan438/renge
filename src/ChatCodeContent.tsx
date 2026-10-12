import { memo, useMemo } from "react";
import { highlightMarkdownCode } from "./syntaxHighlighting";

// Keep finished code stable when the composer, timer, or another message updates.
export const ChatCodeContent = memo(function ChatCodeContent({
  content,
  language,
}: {
  content: string;
  language: string;
}) {
  const highlighted = useMemo(
    () => highlightMarkdownCode(content, language),
    [content, language],
  );

  return (
    <pre>
      {highlighted ? (
        <code
          className={`hljs language-${highlighted.language}`}
          dangerouslySetInnerHTML={{ __html: highlighted.html }}
        />
      ) : (
        <code>{content}</code>
      )}
    </pre>
  );
});
