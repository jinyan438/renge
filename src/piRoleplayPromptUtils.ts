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

// Pi keeps the conversation itself and only takes the new user turn from each
// request, so it has to be told which message that is. Presets and scripts add
// their own user/assistant messages around the chat history, which makes the
// turn impossible to recognise by position or role once the prompt is built.
//
// The mark lives under a symbol: object spreads in the prompt pipeline carry
// it along, while JSON drops it, so it can never reach a model provider.
const PROMPT_PART = Symbol("rengePiPromptPart");

type PromptPart = "turn" | "suffix";

function getPromptPart(message: object) {
  return (message as { [PROMPT_PART]?: PromptPart })[PROMPT_PART];
}

function setPromptPart(message: object, part: PromptPart) {
  (message as { [PROMPT_PART]?: PromptPart })[PROMPT_PART] = part;
}

function findLastTurnIndex(messages: readonly object[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (getPromptPart(messages[index]) === "turn") return index;
  }
  return -1;
}

/**
 * Marks the user's latest message in the chat history. Call this on the
 * history alone, before presets and injections are composed around it.
 */
export function markLatestUserTurn<Message extends PiRoleplayPromptMessage>(
  history: Message[],
) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].role === "system") continue;
    if (history[index].role === "user") setPromptPart(history[index], "turn");
    break;
  }
  return history;
}

/**
 * Marks everything the finished prompt places after the user's turn. Messages
 * a tool loop appends later stay unmarked, which is how they are told apart.
 */
export function markPromptSuffix(messages: readonly PiRoleplayPromptMessage[]) {
  const turnIndex = findLastTurnIndex(messages);
  if (turnIndex < 0) return;
  for (let index = turnIndex + 1; index < messages.length; index += 1) {
    if (messages[index].role !== "system") setPromptPart(messages[index], "suffix");
  }
}

/**
 * Returns the index of the user's turn when the request is that turn followed
 * only by prompt scaffolding, and -1 otherwise. A script that rebuilt the
 * message, or a tool loop that appended to the request, both yield -1 so the
 * caller keeps the positional behaviour.
 */
export function findUserTurnIndex(messages: readonly PiRoleplayPromptMessage[]) {
  const turnIndex = findLastTurnIndex(messages);
  if (turnIndex < 0 || messages[turnIndex].role !== "user") return -1;
  for (let index = turnIndex + 1; index < messages.length; index += 1) {
    if (messages[index].role === "system") continue;
    if (getPromptPart(messages[index]) !== "suffix") return -1;
  }
  return turnIndex;
}
