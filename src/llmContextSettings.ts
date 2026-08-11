export const LLM_CONTEXT_MODES = ["ai", "persona", "multi", "roleplay"] as const;
export type LlmContextMode = (typeof LLM_CONTEXT_MODES)[number];

export const LLM_CONTEXT_SOURCES = [
  "skills",
  "workspaceTools",
  "browserTools",
  "terminalTools",
  "mcpTools",
  "phoneTools",
] as const;
export type LlmContextSource = (typeof LLM_CONTEXT_SOURCES)[number];

export type LlmContextModeSettings = Record<LlmContextSource, boolean>;
export type LlmContextSettings = Record<LlmContextMode, LlmContextModeSettings>;

const ENABLED_CONTEXT: LlmContextModeSettings = {
  skills: true,
  workspaceTools: true,
  browserTools: true,
  terminalTools: true,
  mcpTools: true,
  phoneTools: false,
};

const DISABLED_CONTEXT: LlmContextModeSettings = {
  skills: false,
  workspaceTools: false,
  browserTools: false,
  terminalTools: false,
  mcpTools: false,
  phoneTools: false,
};

export const DEFAULT_LLM_CONTEXT_SETTINGS: LlmContextSettings = {
  ai: { ...ENABLED_CONTEXT },
  persona: { ...ENABLED_CONTEXT },
  multi: { ...ENABLED_CONTEXT },
  roleplay: { ...DISABLED_CONTEXT },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeLlmContextSettings(value: unknown): LlmContextSettings {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(
    LLM_CONTEXT_MODES.map((mode) => {
      const modeSource = isRecord(source[mode]) ? source[mode] : {};
      const defaults = DEFAULT_LLM_CONTEXT_SETTINGS[mode];
      return [
        mode,
        Object.fromEntries(
          LLM_CONTEXT_SOURCES.map((contextSource) => [
            contextSource,
            typeof modeSource[contextSource] === "boolean"
              ? modeSource[contextSource]
              : defaults[contextSource],
          ]),
        ) as LlmContextModeSettings,
      ];
    }),
  ) as LlmContextSettings;
}

export function updateLlmContextSource(
  settings: LlmContextSettings,
  mode: LlmContextMode,
  source: LlmContextSource,
  enabled: boolean,
): LlmContextSettings {
  return {
    ...settings,
    [mode]: {
      ...settings[mode],
      [source]: enabled,
    },
  };
}
