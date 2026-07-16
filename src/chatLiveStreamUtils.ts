export type ChatLiveStreamTextItem = {
  text: string;
  color?: string;
};

export type ChatLiveStreamSuperChat = {
  amount: string;
  sender: string;
  message: string;
  color?: string;
};

export type ChatLiveStreamEmbed = {
  type: "liveStream";
  viewers: string;
  heat: string;
  trend: string;
  superChat?: ChatLiveStreamSuperChat;
  lanes: ChatLiveStreamTextItem[][];
};

export type ChatLiveStreamSegment =
  | { type: "text"; content: string }
  | ChatLiveStreamEmbed;

function stripQuotePrefix(value: string) {
  return value.replace(/^\s*>+\s?/, "");
}

function decodeLegacyHtmlText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function readLegacyHtmlAttribute(tag: string, attributeName: string) {
  const pattern = new RegExp(
    `\\b${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`,
    "i",
  );
  const match = pattern.exec(tag);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function normalizeLegacyColor(value: string) {
  const normalized = value.trim().replace(/^＃/, "#");
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(normalized)) {
    return normalized;
  }
  if (/^[a-z]{3,24}$/i.test(normalized)) return normalized;
  if (/^(?:rgb|hsl)a?\(\s*[\d.%+,-]+\s*\)$/i.test(normalized)) return normalized;
  return undefined;
}

function appendLiveStreamItems(
  items: ChatLiveStreamTextItem[],
  value: string,
  color?: string,
) {
  const text = decodeLegacyHtmlText(value);
  if (!text) return;

  text
    .split(/[·、]+/)
    .map((item) => item.replace(/^[\s,，.。・]+|[\s,，・]+$/g, "").trim())
    .filter(Boolean)
    .forEach((item) => items.push({ text: item, ...(color ? { color } : {}) }));
}

function parseLiveStreamLane(markup: string) {
  const items: ChatLiveStreamTextItem[] = [];
  const fontPattern = /<font\b([^>]*)>([\s\S]*?)<\/font\s*>/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fontPattern.exec(markup))) {
    appendLiveStreamItems(items, markup.slice(cursor, match.index));
    const color = normalizeLegacyColor(readLegacyHtmlAttribute(match[1], "color"));
    appendLiveStreamItems(items, match[2], color);
    cursor = match.index + match[0].length;
  }

  appendLiveStreamItems(items, markup.slice(cursor));
  return items;
}

function parseLiveStreamHeader(line: string) {
  const content = stripQuotePrefix(line);
  const readValue = (label: string) =>
    new RegExp(`【\\s*${label}[^:：】\\]]*[:：]\\s*([^】\\]]+)[】\\]]`, "i")
      .exec(content)?.[1]
      ?.trim() ?? "";
  const viewers = readValue("直播人数");
  const heat = readValue("直播热度");
  const trend = readValue("弹幕风向");
  return viewers && heat && trend ? { viewers, heat, trend } : null;
}

function parseLiveStreamSuperChat(line: string): ChatLiveStreamSuperChat | undefined {
  const content = stripQuotePrefix(line).trim();
  const match = /^【?\s*SC\s+(.+?)\s+BY\s+([\s\S]*?)[】\]]?\s*$/i.exec(content);
  if (!match) return undefined;

  const amount = decodeLegacyHtmlText(match[1]);
  const senderAndMessageMarkup = match[2];
  const fontTag = /<font\b([^>]*)>/i.exec(senderAndMessageMarkup)?.[1] ?? "";
  const color = normalizeLegacyColor(readLegacyHtmlAttribute(fontTag, "color"));
  const senderAndMessage = decodeLegacyHtmlText(senderAndMessageMarkup);
  const separatorIndex = senderAndMessage.search(/[:：]/);
  const sender = (separatorIndex >= 0
    ? senderAndMessage.slice(0, separatorIndex)
    : senderAndMessage).trim();
  const message = (separatorIndex >= 0
    ? senderAndMessage.slice(separatorIndex + 1)
    : "").trim();

  if (!amount || !sender) return undefined;
  return { amount, sender, message, ...(color ? { color } : {}) };
}

function readMarqueeBlock(lines: string[], startIndex: number) {
  const firstLine = stripQuotePrefix(lines[startIndex]);
  const openingMatch = /<marquee\b[^>]*>/i.exec(firstLine);
  if (!openingMatch) return null;

  const closingPattern = /<\/marque(?:e|o)\s*>/i;
  let body = firstLine.slice((openingMatch.index ?? 0) + openingMatch[0].length);
  let endIndex = startIndex;

  for (let offset = 0; offset < 8; offset += 1) {
    const closingMatch = closingPattern.exec(body);
    if (closingMatch) {
      body = body.slice(0, closingMatch.index);
      break;
    }

    const nextIndex = endIndex + 1;
    if (nextIndex >= lines.length) break;
    const nextLine = stripQuotePrefix(lines[nextIndex]);
    if (/<marquee\b/i.test(nextLine)) break;
    body += `\n${nextLine}`;
    endIndex = nextIndex;
  }

  return {
    endIndex,
    items: parseLiveStreamLane(body),
  };
}

function parseLiveStreamBlock(lines: string[], startIndex: number) {
  const header = parseLiveStreamHeader(lines[startIndex]);
  if (!header) return null;

  let index = startIndex + 1;
  while (index < lines.length && !lines[index].trim()) index += 1;

  const superChat = index < lines.length
    ? parseLiveStreamSuperChat(lines[index])
    : undefined;
  if (superChat) index += 1;

  const lanes: ChatLiveStreamTextItem[][] = [];
  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }
    const marquee = readMarqueeBlock(lines, index);
    if (!marquee) break;
    if (marquee.items.length > 0) lanes.push(marquee.items);
    index = marquee.endIndex + 1;
  }

  if (!superChat && lanes.length === 0) return null;
  return {
    embed: {
      type: "liveStream" as const,
      ...header,
      ...(superChat ? { superChat } : {}),
      lanes,
    },
    nextIndex: index,
  };
}

export function containsChatLiveStreamMarkup(content: string) {
  return /^\s*>\s*【\s*直播人数[^\n]*直播热度[^\n]*弹幕风向/m.test(content);
}

export function splitChatLiveStreamEmbeds(content: string): ChatLiveStreamSegment[] {
  if (!containsChatLiveStreamMarkup(content)) return [{ type: "text", content }];

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const segments: ChatLiveStreamSegment[] = [];
  let textLines: string[] = [];
  let index = 0;

  const flushText = () => {
    if (textLines.length === 0) return;
    segments.push({ type: "text", content: textLines.join("\n") });
    textLines = [];
  };

  while (index < lines.length) {
    const block = parseLiveStreamBlock(lines, index);
    if (!block) {
      textLines.push(lines[index]);
      index += 1;
      continue;
    }

    flushText();
    segments.push(block.embed);
    index = block.nextIndex;
  }

  flushText();
  return segments;
}
