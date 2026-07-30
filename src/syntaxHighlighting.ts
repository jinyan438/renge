import highlightJs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dos from "highlight.js/lib/languages/dos";
import go from "highlight.js/lib/languages/go";
import groovy from "highlight.js/lib/languages/groovy";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGUAGE_DEFINITIONS = {
  bash,
  c,
  cpp,
  csharp,
  css,
  dos,
  go,
  groovy,
  ini,
  java,
  javascript,
  json,
  kotlin,
  lua,
  php,
  powershell,
  python,
  ruby,
  rust,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml,
} as const;

for (const [name, definition] of Object.entries(LANGUAGE_DEFINITIONS)) {
  highlightJs.registerLanguage(name, definition);
}

const EXTENSION_LANGUAGES: Record<string, keyof typeof LANGUAGE_DEFINITIONS> = {
  bash: "bash",
  bat: "dos",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cmd: "dos",
  conf: "ini",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  env: "ini",
  go: "go",
  gradle: "groovy",
  groovy: "groovy",
  h: "c",
  hpp: "cpp",
  htm: "xml",
  html: "xml",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsonl: "json",
  jsx: "javascript",
  kt: "kotlin",
  kts: "kotlin",
  lua: "lua",
  mjs: "javascript",
  php: "php",
  properties: "ini",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svelte: "xml",
  svg: "xml",
  swift: "swift",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  vue: "xml",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

export type HighlightedSource = {
  html: string;
  language: string;
};

function getSourceExtension(path: string) {
  const fileName = path.replace(/\\/g, "/").split("/").at(-1) ?? "";
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : "";
}

export function getSyntaxHighlightLanguage(path: string) {
  return EXTENSION_LANGUAGES[getSourceExtension(path)] ?? "";
}

export function escapeSourceHtml(content: string) {
  return content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function highlightSourceCode(content: string, path: string): HighlightedSource {
  const language = getSyntaxHighlightLanguage(path);
  if (!language) return { html: escapeSourceHtml(content), language: "plaintext" };
  try {
    return {
      html: highlightJs.highlight(content, { language, ignoreIllegals: true }).value,
      language,
    };
  } catch {
    return { html: escapeSourceHtml(content), language: "plaintext" };
  }
}
