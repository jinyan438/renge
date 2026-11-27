// A compact STscript interpreter for the commands character cards commonly
// send through `triggerSlash`. Commands that create messages or drive the
// composer are delegated to the host; everything here is pure pipeline logic.

export type TavernSlashVariableScope = "chat" | "global";

export type TavernSlashHost = {
  getVariable(scope: TavernSlashVariableScope, key: string): unknown;
  setVariable(scope: TavernSlashVariableScope, key: string, value: unknown): void | Promise<void>;
  deleteVariable(scope: TavernSlashVariableScope, key: string): void | Promise<void>;
  /** Runs message/composer commands (`/send`, `/sys`, `/trigger`, ...). Throws when unsupported. */
  runLegacy(command: string): Promise<unknown> | unknown;
  notify?(severity: "info" | "success" | "warning" | "error", message: string, title: string): void;
  getMessageCount?(): number;
  setMessagesHidden?(indexes: number[], hidden: boolean): void | Promise<void>;
  deleteMessages?(indexes: number[]): void | Promise<void>;
  generate?(prompt: string, options: { raw: boolean; system: string }): Promise<string> | string;
  stopGeneration?(): unknown;
  injectPrompt?(prompt: {
    id: string;
    position: "in_chat" | "none";
    depth: number;
    role: "system" | "user" | "assistant";
    content: string;
    should_scan: boolean;
  }): void;
  uninjectPrompts?(ids: string[] | null): void;
  emitEvent?(eventName: string, args: unknown[]): Promise<unknown> | unknown;
  audio?(action: string, named: Record<string, string>, text: string): Promise<unknown> | unknown;
  /** Expands host macros such as `{{user}}` and `{{char}}`. */
  substituteMacros?(text: string): string;
};

export type ParsedTavernSlashSegment = {
  name: string;
  named: Record<string, string>;
  text: string;
  raw: string;
};

/** Splits a script on top-level pipes, ignoring quotes, closures and macros. */
export function splitTavernSlashPipeline(script: string) {
  const segments: string[] = [];
  let current = "";
  let quote = "";
  let closureDepth = 0;
  let macroDepth = 0;
  for (let index = 0; index < script.length; index += 1) {
    const char = script[index];
    const pair = script.slice(index, index + 2);
    if (char === "\\" && index + 1 < script.length) {
      current += script[index + 1] === "|" ? "|" : char + script[index + 1];
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      current += char;
      continue;
    }
    if (pair === "{:") {
      closureDepth += 1;
      current += pair;
      index += 1;
      continue;
    }
    if (pair === ":}" && closureDepth > 0) {
      closureDepth -= 1;
      current += pair;
      index += 1;
      continue;
    }
    if (pair === "{{") {
      macroDepth += 1;
      current += pair;
      index += 1;
      continue;
    }
    if (pair === "}}" && macroDepth > 0) {
      macroDepth -= 1;
      current += pair;
      index += 1;
      continue;
    }
    if (char === '"' && closureDepth === 0 && macroDepth === 0) {
      quote = char;
      current += char;
      continue;
    }
    if (char === "|" && closureDepth === 0 && macroDepth === 0) {
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments.map((segment) => segment.trim()).filter(Boolean);
}

function unquote(value: string) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  return trimmed;
}

function readBalancedClosure(input: string): { value: string; length: number } | null {
  if (!input.startsWith("{:")) return null;
  let depth = 0;
  for (let index = 0; index < input.length; index += 1) {
    const pair = input.slice(index, index + 2);
    if (pair === "{:") {
      depth += 1;
      index += 1;
      continue;
    }
    if (pair === ":}") {
      depth -= 1;
      index += 1;
      if (depth === 0) return { value: input.slice(0, index + 1), length: index + 1 };
    }
  }
  return null;
}

/** Parses `/name key=value key2="quoted value" unnamed text`. */
export function parseTavernSlashSegment(segment: string): ParsedTavernSlashSegment | null {
  const match = /^\/([A-Za-z0-9_?#-]+)(?:\s+([\s\S]*))?$/.exec(segment.trim());
  if (!match) return null;
  const named: Record<string, string> = {};
  let rest = (match[2] ?? "").trimStart();
  for (;;) {
    const keyMatch = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(rest);
    if (!keyMatch) break;
    const afterEq = rest.slice(keyMatch[0].length);
    const closure = readBalancedClosure(afterEq);
    if (closure && (closure.length === afterEq.length || /^\s/.test(afterEq.slice(closure.length)))) {
      named[keyMatch[1].toLowerCase()] = closure.value;
      rest = afterEq.slice(closure.length).trimStart();
      continue;
    }
    const option = /^([A-Za-z_][A-Za-z0-9_]*)=(?:"((?:\\.|[^"\\])*)"|(\S*))(?:\s+|$)/.exec(rest);
    if (!option) break;
    named[option[1].toLowerCase()] =
      option[2] !== undefined ? option[2].replace(/\\(["\\])/g, "$1") : option[3] ?? "";
    rest = rest.slice(option[0].length);
  }
  return { name: match[1].toLowerCase(), named, text: rest.trim(), raw: segment.trim() };
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || !/^[[{]/.test(trimmed)) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function toNumber(value: unknown) {
  const parsed = Number(typeof value === "string" ? value.trim() : value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isTruthy(value: string) {
  return /^(?:1|true|on|yes)$/i.test(value.trim());
}

function parseRange(text: string, count: number) {
  const trimmed = text.trim();
  const last = count - 1;
  const single = /^-?\d+$/.exec(trimmed);
  const toIndex = (value: number) => (value < 0 ? count + value : value);
  let start: number;
  let end: number;
  if (single) {
    start = end = toIndex(Number(trimmed));
  } else {
    const range = /^(-?\d+)\s*-\s*(-?\d+)$/.exec(trimmed);
    if (!range) return [];
    start = toIndex(Number(range[1]));
    end = toIndex(Number(range[2]));
  }
  const indexes: number[] = [];
  for (let index = Math.max(0, Math.min(start, end)); index <= Math.min(last, Math.max(start, end)); index += 1) {
    indexes.push(index);
  }
  return indexes;
}

const VARIABLE_COMMANDS: Readonly<
  Record<string, { scope: TavernSlashVariableScope; action: "set" | "get" | "add" | "inc" | "dec" | "flush" }>
> = {
  setvar: { scope: "chat", action: "set" },
  setchatvar: { scope: "chat", action: "set" },
  getvar: { scope: "chat", action: "get" },
  getchatvar: { scope: "chat", action: "get" },
  addvar: { scope: "chat", action: "add" },
  addchatvar: { scope: "chat", action: "add" },
  incvar: { scope: "chat", action: "inc" },
  decvar: { scope: "chat", action: "dec" },
  flushvar: { scope: "chat", action: "flush" },
  flushchatvar: { scope: "chat", action: "flush" },
  setglobalvar: { scope: "global", action: "set" },
  getglobalvar: { scope: "global", action: "get" },
  addglobalvar: { scope: "global", action: "add" },
  incglobalvar: { scope: "global", action: "inc" },
  decglobalvar: { scope: "global", action: "dec" },
  flushglobalvar: { scope: "global", action: "flush" },
};

const MATH_COMMANDS: Readonly<Record<string, (values: number[]) => number>> = {
  add: (values) => values.reduce((sum, value) => sum + value, 0),
  sub: (values) => values.slice(1).reduce((result, value) => result - value, values[0] ?? 0),
  mul: (values) => values.reduce((product, value) => product * value, 1),
  div: (values) => values.slice(1).reduce((result, value) => result / value, values[0] ?? 0),
  mod: (values) => (values[0] ?? 0) % (values[1] ?? 1),
  pow: (values) => (values[0] ?? 0) ** (values[1] ?? 1),
  max: (values) => Math.max(...values),
  min: (values) => Math.min(...values),
  abs: (values) => Math.abs(values[0] ?? 0),
  sqrt: (values) => Math.sqrt(values[0] ?? 0),
  round: (values) => Math.round(values[0] ?? 0),
  sin: (values) => Math.sin(values[0] ?? 0),
  cos: (values) => Math.cos(values[0] ?? 0),
  log: (values) => Math.log(values[0] ?? 0),
};

const COMPARISON_RULES: Readonly<Record<string, (left: string, right: string) => boolean>> = {
  eq: (left, right) => compareValues(left, right) === 0,
  neq: (left, right) => compareValues(left, right) !== 0,
  lt: (left, right) => compareValues(left, right) < 0,
  lte: (left, right) => compareValues(left, right) <= 0,
  gt: (left, right) => compareValues(left, right) > 0,
  gte: (left, right) => compareValues(left, right) >= 0,
  in: (left, right) => left.toLowerCase().includes(right.toLowerCase()),
  nin: (left, right) => !left.toLowerCase().includes(right.toLowerCase()),
  not: (left) => !left || left === "0" || left.toLowerCase() === "false",
};

function compareValues(left: string, right: string) {
  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);
  if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber) && left.trim() && right.trim()) {
    return leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1;
  }
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a === b ? 0 : a < b ? -1 : 1;
}

function stripClosure(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("{:") && trimmed.endsWith(":}") ? trimmed.slice(2, -2).trim() : unquote(trimmed);
}

/** Whether the interpreter (rather than the host) owns a command name. */
export function isTavernSlashPipelineCommand(name: string) {
  const normalized = name.toLowerCase();
  return (
    normalized in VARIABLE_COMMANDS ||
    normalized in MATH_COMMANDS ||
    PIPELINE_COMMANDS.has(normalized)
  );
}

const PIPELINE_COMMANDS = new Set([
  "pass", "return", "echo", "popup", "delay", "wait", "sleep", "rand", "len", "upper", "lower", "trimstart",
  "trimend", "hide", "unhide", "del", "cut", "gen", "genraw", "stop", "inject", "flushinject", "flushinjects",
  "if", "run", "event-emit", "audioenable", "audioplay", "audiopause", "audioimport", "audioselect", "audiomode",
  "?", "abort", "breakpoint", "let", "var",
]);

type PipelineScope = { variables: Map<string, string>; depth: number };

/**
 * Executes an STscript pipeline and returns the final pipe value as a string,
 * matching what Tavern Helper's `triggerSlash` resolves with.
 */
export async function executeTavernSlashPipeline(
  script: string,
  host: TavernSlashHost,
  scope: PipelineScope = { variables: new Map(), depth: 0 },
  initialPipe = "",
): Promise<string> {
  if (scope.depth > 16) throw new Error("STscript 嵌套层级过深。");
  const segments = splitTavernSlashPipeline(script);
  let pipe = initialPipe;

  const expand = (text: string) => {
    let output = text
      .replace(/\{\{pipe\}\}/gi, () => pipe)
      .replace(/\{\{getvar::([\s\S]*?)\}\}/gi, (_match, key: string) => stringify(host.getVariable("chat", key.trim())))
      .replace(/\{\{getglobalvar::([\s\S]*?)\}\}/gi, (_match, key: string) =>
        stringify(host.getVariable("global", key.trim())),
      )
      .replace(/\{\{var::([\s\S]*?)\}\}/gi, (_match, key: string) => scope.variables.get(key.trim()) ?? "");
    if (host.substituteMacros) output = host.substituteMacros(output);
    return output;
  };

  for (let index = 0; index < segments.length; index += 1) {
    const parsed = parseTavernSlashSegment(segments[index]);
    if (!parsed) throw new Error(`无法解析酒馆命令：${segments[index]}`);
    const { name } = parsed;

    if (!isTavernSlashPipelineCommand(name) || ((name === "gen" || name === "genraw") && !parsed.text)) {
      // Message and composer commands keep their combined semantics
      // (`/send text | /trigger`), so hand the whole run to the host at once.
      let end = index;
      while (end + 1 < segments.length && /^\/(?:trigger|gen)\s*$/i.test(segments[end + 1])) end += 1;
      const result = await host.runLegacy(segments.slice(index, end + 1).map(expand).join(" | "));
      pipe = typeof result === "string" || typeof result === "number" ? String(result) : pipe;
      index = end;
      continue;
    }

    const named = Object.fromEntries(Object.entries(parsed.named).map(([key, value]) => [key, expand(value)]));
    const rawText = parsed.text;
    const text = expand(unquote(rawText));
    const unnamed = rawText ? text : pipe;

    const variableCommand = VARIABLE_COMMANDS[name];
    if (variableCommand) {
      const { scope: variableScope, action } = variableCommand;
      let key = named.key ?? named.name ?? "";
      let value = text;
      if (!key) {
        const split = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text);
        key = split?.[1] ?? "";
        value = split?.[2] ?? "";
      }
      key = unquote(key);
      if (action === "flush") {
        if (key) await host.deleteVariable(variableScope, key);
        pipe = "";
        continue;
      }
      if (!key) throw new Error(`/${name} 缺少变量名。`);
      const current = host.getVariable(variableScope, key);
      const indexKey = named.index;
      if (action === "get") {
        const source = indexKey !== undefined ? parseJsonValue(current) : current;
        const result =
          indexKey !== undefined && source && typeof source === "object"
            ? (source as Record<string, unknown>)[indexKey]
            : current;
        pipe = stringify(result);
        continue;
      }
      if (action === "inc" || action === "dec") {
        const next = (Number.isNaN(toNumber(current)) ? 0 : toNumber(current)) + (action === "inc" ? 1 : -1);
        await host.setVariable(variableScope, key, next);
        pipe = String(next);
        continue;
      }
      if (action === "add") {
        const container = parseJsonValue(current);
        let next: unknown;
        if (Array.isArray(container)) {
          next = [...container, parseJsonValue(value)];
        } else if (!Number.isNaN(toNumber(current ?? 0)) && !Number.isNaN(toNumber(value)) && value.trim()) {
          next = toNumber(current ?? 0) + toNumber(value);
        } else {
          next = `${stringify(current)}${value}`;
        }
        await host.setVariable(variableScope, key, typeof current === "string" && Array.isArray(next) ? JSON.stringify(next) : next);
        pipe = stringify(next);
        continue;
      }
      const assigned = named.key === undefined && named.name === undefined ? value : rawText ? text : pipe;
      if (indexKey !== undefined) {
        const container = parseJsonValue(current);
        const target: Record<string, unknown> | unknown[] =
          container && typeof container === "object"
            ? (container as Record<string, unknown>)
            : /^\d+$/.test(indexKey)
              ? []
              : {};
        (target as Record<string, unknown>)[indexKey] = parseJsonValue(assigned);
        await host.setVariable(variableScope, key, typeof current === "object" && current ? target : JSON.stringify(target));
      } else {
        const typed =
          named.as === "number" ? toNumber(assigned)
            : named.as === "boolean" ? isTruthy(assigned)
              : named.as === "array" || named.as === "object" || named.as === "dictionary" || named.as === "list"
                ? parseJsonValue(assigned)
                : assigned;
        await host.setVariable(variableScope, key, typed);
      }
      pipe = assigned;
      continue;
    }

    const mathCommand = MATH_COMMANDS[name];
    if (mathCommand) {
      const list = parseJsonValue(unnamed);
      const values = (Array.isArray(list) ? list : unnamed.split(/\s+/).filter(Boolean)).map(toNumber);
      const result = mathCommand(values);
      pipe = Number.isNaN(result) ? "0" : String(result);
      continue;
    }

    switch (name) {
      case "pass":
      case "return":
        pipe = unnamed;
        break;
      case "let":
      case "var": {
        const key = named.key ?? /^(\S+)/.exec(text)?.[1] ?? "";
        const value = named.key !== undefined ? unnamed : text.replace(/^\S+\s*/, "");
        if (key) scope.variables.set(key, value);
        pipe = value;
        break;
      }
      case "echo":
      case "popup": {
        const severity = (named.severity ?? "info").toLowerCase();
        host.notify?.(
          severity === "success" || severity === "warning" || severity === "error" ? severity : "info",
          unnamed,
          named.title ?? "",
        );
        pipe = unnamed;
        break;
      }
      case "delay":
      case "wait":
      case "sleep": {
        const duration = Math.min(Math.max(0, toNumber(unnamed) || 0), 60_000);
        await new Promise<void>((resolve) => setTimeout(resolve, duration));
        break;
      }
      case "rand": {
        const from = toNumber(named.from ?? "0") || 0;
        const to = Number.isNaN(toNumber(named.to ?? unnamed)) ? 1 : toNumber(named.to ?? unnamed);
        const value = from + Math.random() * (to - from);
        const rounding = (named.round ?? "").toLowerCase();
        pipe = String(
          rounding === "round" ? Math.round(value)
            : rounding === "ceil" ? Math.ceil(value)
              : rounding === "floor" ? Math.floor(value)
                : value,
        );
        break;
      }
      case "len": {
        const value = parseJsonValue(unnamed);
        pipe = String(
          Array.isArray(value) ? value.length
            : value && typeof value === "object" ? Object.keys(value).length
              : unnamed.length,
        );
        break;
      }
      case "upper":
        pipe = unnamed.toUpperCase();
        break;
      case "lower":
        pipe = unnamed.toLowerCase();
        break;
      case "trimstart":
        pipe = unnamed.trimStart();
        break;
      case "trimend":
        pipe = unnamed.trimEnd();
        break;
      case "hide":
      case "unhide": {
        const count = host.getMessageCount?.() ?? 0;
        const indexes = unnamed.trim() ? parseRange(unnamed, count) : count > 0 ? [count - 1] : [];
        if (indexes.length > 0) await host.setMessagesHidden?.(indexes, name === "hide");
        pipe = "";
        break;
      }
      case "cut": {
        const indexes = parseRange(unnamed, host.getMessageCount?.() ?? 0);
        if (indexes.length > 0) await host.deleteMessages?.(indexes);
        pipe = "";
        break;
      }
      case "del": {
        const count = host.getMessageCount?.() ?? 0;
        const amount = Math.max(0, Math.min(count, Math.trunc(toNumber(unnamed) || 1)));
        const indexes = Array.from({ length: amount }, (_unused, offset) => count - amount + offset);
        if (indexes.length > 0) await host.deleteMessages?.(indexes);
        pipe = "";
        break;
      }
      case "gen":
      case "genraw": {
        if (!host.generate) throw new Error("当前环境不支持 /gen。");
        pipe = String(await host.generate(text, { raw: name === "genraw", system: named.system ?? "" }));
        break;
      }
      case "stop":
        host.stopGeneration?.();
        break;
      case "inject": {
        const id = named.id ?? "";
        if (!id) throw new Error("/inject 缺少 id。");
        const position = (named.position ?? "after").toLowerCase();
        const role = (named.role ?? "system").toLowerCase();
        host.injectPrompt?.({
          id,
          position: position === "none" ? "none" : "in_chat",
          depth: position === "chat" ? Math.max(0, Math.trunc(toNumber(named.depth ?? "4") || 0)) : 0,
          role: role === "user" || role === "assistant" ? role : "system",
          content: unnamed,
          should_scan: isTruthy(named.scan ?? "false"),
        });
        pipe = "";
        break;
      }
      case "flushinject":
      case "flushinjects":
        host.uninjectPrompts?.(text ? [text] : null);
        pipe = "";
        break;
      case "event-emit": {
        const eventName = named.event ?? text.split(/\s+/)[0] ?? "";
        if (eventName) await host.emitEvent?.(eventName, named.data !== undefined ? [parseJsonValue(named.data)] : []);
        pipe = eventName;
        break;
      }
      case "audioenable":
      case "audioplay":
      case "audiopause":
      case "audioimport":
      case "audioselect":
      case "audiomode":
        await host.audio?.(name.slice("audio".length), named, text);
        pipe = "";
        break;
      case "if": {
        const left = named.left ?? "";
        const right = named.right ?? "";
        const rule = COMPARISON_RULES[(named.rule ?? "eq").toLowerCase()] ?? COMPARISON_RULES.eq;
        const branch = rule(left, right) ? rawText : parsed.named.else ?? "";
        const body = stripClosure(branch);
        if (body) {
          pipe = body.startsWith("/")
            ? await executeTavernSlashPipeline(body, host, { variables: scope.variables, depth: scope.depth + 1 }, pipe)
            : expand(body);
        }
        break;
      }
      case "run": {
        const body = stripClosure(rawText);
        if (!body.startsWith("/")) throw new Error("/run 仅支持内联闭包。");
        pipe = await executeTavernSlashPipeline(body, host, { variables: scope.variables, depth: scope.depth + 1 }, pipe);
        break;
      }
      case "abort":
        return pipe;
      case "?":
      case "breakpoint":
        break;
      default:
        throw new Error(`暂不支持该酒馆命令：/${name}`);
    }
  }
  return pipe;
}
