export type PiRoleplayPromptMessage = {
  role?: string;
  [key: string]: unknown;
};

export function removeAssistantPrefillAfterLatestUser<
  Message extends PiRoleplayPromptMessage,
>(messages: Message[]) {
  const latestUserIndex = messages.reduce(
    (latest, message, index) => (message.role === "user" ? index : latest),
    -1,
  );
  if (latestUserIndex < 0 || latestUserIndex === messages.length - 1) return messages;

  // Character-card/preset prompts may append an assistant prefill after the
  // current user turn. Pi treats that as a continuation prompt and can resume
  // the previous scene instead of responding to the new action. System
  // messages after it remain valid; only assistant messages after the latest
  // user turn are prompt scaffolding and must be removed.
  return messages.filter(
    (message, index) => index <= latestUserIndex || message.role !== "assistant",
  );
}
