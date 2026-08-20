import { isUtf8 } from "node:buffer";

const UTF8_CONTINUATION = 0x80;
const UTF8_CONTINUATION_MASK = 0xc0;
const ENCODING_DETECTION_LIMIT = 4096;

function hasIncompleteUtf8Tail(buffer) {
  const start = Math.max(0, buffer.length - 3);
  for (let index = buffer.length - 1; index >= start; index -= 1) {
    const byte = buffer[index];
    let expectedLength = 0;
    if (byte >= 0xc2 && byte <= 0xdf) expectedLength = 2;
    else if (byte >= 0xe0 && byte <= 0xef) expectedLength = 3;
    else if (byte >= 0xf0 && byte <= 0xf4) expectedLength = 4;
    if (!expectedLength) continue;
    const available = buffer.length - index;
    if (available >= expectedLength) continue;
    for (let continuation = index + 1; continuation < buffer.length; continuation += 1) {
      if ((buffer[continuation] & UTF8_CONTINUATION_MASK) !== UTF8_CONTINUATION) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function detectUtf16Encoding(buffer) {
  if (buffer.length < 2) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return "utf-16le";
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return "utf-16be";
  if (buffer.length < 4) return null;

  const sampleLength = Math.min(buffer.length, 512);
  let evenZeroes = 0;
  let oddZeroes = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] !== 0) continue;
    if (index % 2 === 0) evenZeroes += 1;
    else oddZeroes += 1;
  }
  const threshold = Math.max(2, Math.floor(sampleLength / 8));
  if (oddZeroes >= threshold && oddZeroes > evenZeroes * 2) return "utf-16le";
  if (evenZeroes >= threshold && evenZeroes > oddZeroes * 2) return "utf-16be";
  return null;
}

function chooseEncoding(buffer) {
  if (buffer.length === 0) return null;
  const utf16Encoding = detectUtf16Encoding(buffer);
  if (utf16Encoding) return utf16Encoding;
  if (!buffer.some((byte) => byte >= 0x80)) return null;
  if (hasIncompleteUtf8Tail(buffer)) return null;
  if (isUtf8(buffer)) return "utf8";
  return "gb18030";
}

/**
 * Decode command output bytes without corrupting Windows' legacy code-page output.
 * The callback receives UTF-8 encoded Buffers so Pi's native output accumulator
 * can keep handling truncation and streaming exactly as before.
 */
export function createCommandOutputDecoder(onText) {
  const sink = typeof onText === "function" ? onText : () => {};
  let encoding;
  let pending = Buffer.alloc(0);
  let decoder;
  let finished = false;

  const emit = (text) => {
    if (text) sink(Buffer.from(text, "utf8"));
  };

  const selectEncoding = () => {
    if (encoding || pending.length === 0) return;
    const selected = chooseEncoding(pending);
    if (!selected) {
      const asciiOnly = !pending.some((byte) => byte >= 0x80);
      if (!asciiOnly || pending.length < ENCODING_DETECTION_LIMIT) return;
    }
    encoding = selected;
    if (!encoding) encoding = "utf8";
    decoder = new TextDecoder(encoding);
    emit(decoder.decode(pending, { stream: true }));
    pending = Buffer.alloc(0);
  };

  return {
    push(chunk) {
      if (finished) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (bytes.length === 0) return;
      if (!encoding) {
        pending = Buffer.concat([pending, bytes]);
        selectEncoding();
        if (!encoding) return;
        return;
      }
      emit(decoder.decode(bytes, { stream: true }));
    },
    finish() {
      if (finished) return;
      finished = true;
      if (!encoding) {
        encoding = chooseEncoding(pending) ?? "utf8";
        decoder = new TextDecoder(encoding);
        emit(decoder.decode(pending, { stream: true }));
        pending = Buffer.alloc(0);
      }
      emit(decoder.decode());
    },
    get encoding() {
      return encoding ?? "utf8";
    },
  };
}

export function decodeCommandOutput(chunks) {
  let output = Buffer.alloc(0);
  const decoder = createCommandOutputDecoder((chunk) => {
    output = Buffer.concat([output, chunk]);
  });
  for (const chunk of chunks ?? []) decoder.push(chunk);
  decoder.finish();
  return { encoding: decoder.encoding, text: output.toString("utf8") };
}
