export type ChatAudioEmbed = {
  type: "audio";
  src: string;
  downloadUrl: string;
  fileName: string;
  downloadLabel: string;
};

export type ChatAudioSegment =
  | { type: "text"; content: string }
  | ChatAudioEmbed;

const audioFileExtensionPattern = /\.(?:mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)(?:[?#]|$)/i;

function decodeHtmlAttributeValue(value: string) {
  return value
    .replace(/&(?:amp|#0*38|#x0*26);/gi, "&")
    .replace(/&(?:quot|#0*34|#x0*22);/gi, '"')
    .replace(/&(?:apos|#0*39|#x0*27);/gi, "'");
}

function readHtmlAttribute(tag: string, attributeName: string) {
  const pattern = new RegExp(
    `\\b${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`,
    "i",
  );
  const match = pattern.exec(tag);
  return decodeHtmlAttributeValue(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function normalizeChatAudioUrl(value: string) {
  const normalized = decodeHtmlAttributeValue(value).trim();
  if (!normalized || /[\u0000-\u0020\u007f]/.test(normalized)) return "";

  if (/^data:/i.test(normalized)) {
    return /^data:audio\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*(?:;base64)?,/i.test(normalized)
      ? normalized
      : "";
  }
  if (/^blob:/i.test(normalized)) {
    return /^blob:https?:\/\//i.test(normalized) ? normalized : "";
  }
  if (/^\/\//.test(normalized)) return `https:${normalized}`;

  const explicitScheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized)?.[1]?.toLowerCase();
  if (explicitScheme && explicitScheme !== "http" && explicitScheme !== "https") return "";
  return normalized;
}

function stripHtmlText(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function getAudioFileName(src: string) {
  if (/^data:audio\//i.test(src)) return "嵌入音频";

  try {
    const url = new URL(src, "http://renge.local");
    const pathName = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    const decodedName = decodeURIComponent(pathName);
    return decodedName || "远程音频";
  } catch {
    return "远程音频";
  }
}

function parseChatAudioMarkup(markup: string): ChatAudioEmbed | null {
  const audioTag = /<audio\b[^>]*>/i.exec(markup)?.[0] ?? "";
  const sourceTag = /<source\b[^>]*>/i.exec(markup)?.[0] ?? "";
  const anchorMatch = /<a\b[^>]*>([\s\S]*?)<\/a\s*>/i.exec(markup);
  const anchorTag = anchorMatch ? /<a\b[^>]*>/i.exec(anchorMatch[0])?.[0] ?? "" : "";
  const anchorUrl = normalizeChatAudioUrl(readHtmlAttribute(anchorTag, "href"));
  const declaredSource =
    readHtmlAttribute(audioTag, "src") || readHtmlAttribute(sourceTag, "src");
  const src = normalizeChatAudioUrl(
    declaredSource || (audioFileExtensionPattern.test(anchorUrl) ? anchorUrl : ""),
  );

  if (!src) return null;

  return {
    type: "audio",
    src,
    downloadUrl: anchorUrl || src,
    fileName: getAudioFileName(src),
    downloadLabel: stripHtmlText(anchorMatch?.[1] ?? "") || "下载音频",
  };
}

export function containsChatAudioMarkup(content: string) {
  return /<audio\b|<\|\s*\/?(?:delete(?:d)?|remove)?audio\s*\|>/i.test(content);
}

export function splitChatAudioEmbeds(content: string): ChatAudioSegment[] {
  if (!containsChatAudioMarkup(content)) return [{ type: "text", content }];

  const segments: ChatAudioSegment[] = [];
  const audioBlockPattern = /<\|\s*(?:delete(?:d)?|remove)?audio\s*\|>([\s\S]*?)<\|\s*\/?(?:delete(?:d)?|remove)?audio\s*\|>|<audio\b[^>]*>[\s\S]*?<\/audio\s*>|<audio\b[^>]*>(?:\s*<a\b[^>]*>[\s\S]*?<\/a\s*>)?/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = audioBlockPattern.exec(content))) {
    const audio = parseChatAudioMarkup(match[1] ?? match[0]);
    if (!audio) continue;

    if (match.index > cursor) {
      segments.push({ type: "text", content: content.slice(cursor, match.index) });
    }
    segments.push(audio);
    cursor = match.index + match[0].length;
  }

  if (cursor === 0) return [{ type: "text", content }];
  if (cursor < content.length) {
    segments.push({ type: "text", content: content.slice(cursor) });
  }
  return segments;
}
