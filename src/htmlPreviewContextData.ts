import type { HtmlPreviewTavernSnapshot } from "./htmlPreviewTavernHelperApi";
import type { TavernScriptScope, TavernScriptTree } from "./tavernScriptTreeUtils";

export type HtmlPreviewDataRequest = {
  characters: string[];
  presets: string[];
  regexes: boolean;
  characterAvatars: string[];
  personaAvatars: string[];
  scriptTrees: boolean;
  globals: string[];
};

/** Inspect actual inline module code, including compiled data-URL frontends. */
export function getHtmlPreviewDataRequest(content: string): HtmlPreviewDataRequest {
  const sources = [content];
  let externalScript = false;
  for (const match of content.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)) {
    const url = match[2];
    if (!url.startsWith("data:")) { externalScript = true; continue; }
    try {
      const comma = url.indexOf(",");
      sources.push(/;base64$/i.test(url.slice(0, comma))
        ? new TextDecoder().decode(Uint8Array.from(atob(url.slice(comma + 1)), character => character.charCodeAt(0)))
        : decodeURIComponent(url.slice(comma + 1)));
    } catch { /* A malformed author script is reported by the iframe. */ }
  }
  const source = sources.join("\n");
  const callTargets = (name: string, fallback: string) => Array.from(new Set(Array.from(
    source.matchAll(new RegExp(`\\b${name}\\s*\\(\\s*(?:(["'])(.*?)\\1)?`, "g")), match => match[2] || fallback,
  )));
  const literalTargets = (pattern: RegExp, fallback: string) =>
    Array.from(new Set([fallback, ...Array.from(source.matchAll(pattern), match => match[2])]));
  const characters = externalScript || /\b(?:getCharData\s*\(|RawCharacter\b)|(?:SillyTavern|getContext\s*\([^)]*\))\s*\.\s*characters\b/.test(source);
  const presets = externalScript || /\b(?:getPreset|setPreset|updatePresetWith|replacePreset)\s*\(|\bpromptManager\b/.test(source);
  return {
    characters: characters ? literalTargets(/\bgetCharData\s*\(\s*(["'])(.*?)\1/g, "current") : [],
    presets: presets ? literalTargets(/\bgetPreset\s*\(\s*(["'])(.*?)\1/g, "in_use") : [],
    regexes: externalScript || /\b(?:getTavernRegexes|formatAsTavernRegexedString|formatAsDisplayedMessage|isCharacterTavernRegexesEnabled|renderMarkdown)\s*\(/.test(source),
    characterAvatars: callTargets("getCharAvatarPath", "current"),
    personaAvatars: callTargets("getPersonaAvatarPath", "current"),
    scriptTrees: /\b(?:getScriptTrees|replaceScriptTrees|updateScriptTreesWith)\s*\(/.test(source),
    globals: Array.from(new Set(Array.from(source.matchAll(/\.\s*([A-Za-z_$][\w$]*)|\[\s*["']([A-Za-z_$][\w$]*)["']\s*\]/g), match => match[1] || match[2]))),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Heavy data travels as structured RPC data, only for APIs used by this frame. */
export async function loadHtmlPreviewContextData(
  request: HtmlPreviewDataRequest,
  call: (name: string, args: unknown[]) => Promise<unknown>,
  currentPersonaId: string,
) {
  const tavern: Partial<HtmlPreviewTavernSnapshot> = {};
  for (const name of request.characters) {
    const data = await call("getCharData", [name]);
    if (!isRecord(data)) continue;
    if (name === "current") tavern.charData = data;
    else (tavern.charDataByName ??= {})[name.replace(/\.png$/i, "")] = data;
  }
  for (const name of request.presets) {
    // An author may deliberately probe an unavailable preset in try/catch.
    // Let that API call fail in its original place rather than failing startup.
    const preset = await call("getPreset", [name]).catch(() => null);
    if (!isRecord(preset)) continue;
    if (name === "in_use") tavern.inUsePreset = preset;
    else (tavern.namedPresets ??= {})[name] = preset;
  }
  if (request.regexes) tavern.regexes = await call("getTavernRegexes", []) as Array<Record<string, unknown>>;
  for (const name of request.characterAvatars) {
    const avatar = await call("getCharAvatarPath", [name]) as string | null;
    if (name === "current") tavern.currentCharacterAvatar = avatar;
    else if (avatar) (tavern.characterAvatars ??= {})[name] = avatar;
  }
  for (const name of request.personaAvatars) {
    const persona = name === "current" ? null : await call("getPersona", [name]);
    const id = isRecord(persona) ? String(persona.avatar_id ?? name) : currentPersonaId;
    const avatar = await call("getPersonaAvatarPath", [name]);
    if (typeof avatar === "string") (tavern.personaAvatars ??= {})[id] = avatar;
  }
  let scriptTrees: Partial<Record<TavernScriptScope, TavernScriptTree[]>> | undefined;
  if (request.scriptTrees) {
    scriptTrees = {};
    for (const scope of ["global", "preset", "character"] as const) {
      scriptTrees[scope] = await call("getScriptTrees", [{ type: scope }]) as TavernScriptTree[];
    }
  }
  return { tavern, ...(scriptTrees ? { scriptTrees } : {}) };
}
