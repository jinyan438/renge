import {
  ArrowLeft,
  Bot,
  Bookmark,
  BookOpen,
  Boxes,
  Braces,
  ChevronDown,
  Check,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  FileJson,
  FolderOpen,
  GripHorizontal,
  GripVertical,
  Home,
  KeyRound,
  ListPlus,
  Languages,
  MessageSquare,
  Menu,
  Palette,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Send,
  Tags,
  Trash2,
  Upload,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type Dispatch,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
  type SetStateAction,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import jquerySource from "jquery/dist/jquery.min.js?raw";
import {
  buildPersonaPrompt,
  createPersonaFromPromptText,
  createEntry,
  createEntryType,
  createPersona,
  displayEntryKind,
  getEnabledEntryCount,
  getEntryCount,
  influenceLevels,
  mergeBuiltInPersonas,
  normalizePersona,
} from "./personaData";
import { personaStore } from "./personaStore";
import {
  applyChatPresetToMessages,
  buildChatPresetRequestParameters,
  createDefaultChatPreset,
  importSillyTavernPreset,
  loadChatPresetsFromStorage,
  normalizeChatPreset,
  type ChatPreset,
  type ChatPresetPrompt,
} from "./presetUtils";
import {
  buildWorldBookPrompt,
  createWorldBook,
  createWorldBookEntry,
  importSillyTavernWorldBook,
  loadWorldBooksFromStorage,
  normalizeActiveWorldBookIds,
  normalizeWorldBook,
  type WorldBook,
  type WorldBookEntry,
} from "./worldbookUtils";
import {
  appendSillyTavernStatusPlaceholderToGreeting,
  applyRegexScripts,
  createRegexScript,
  getRegexScriptError,
  importSillyTavernRegexFile,
  loadRegexScriptsFromStorage,
  normalizeRegexScript,
  type RegexScript,
} from "./regexUtils";
import {
  applyCharacterTranslations,
  buildCharacterCardPrompt,
  collectCharacterTranslationFields,
  createCharacterCard,
  exportCharacterCardJson,
  exportCharacterCardPng,
  getCharacterCardGreetings,
  importCharacterCardFile,
  loadCharacterCardsFromDatabase,
  loadCharacterCardsFromStorage,
  normalizeCharacterCard,
  saveCharacterCardsToDatabase,
  type CharacterCard,
} from "./characterCardUtils";
import {
  createTavernScript,
  exportTavernScriptCollectionJson,
  exportTavernScriptJson,
  importSillyTavernScriptFile,
  loadTavernScriptsFromStorage,
  normalizeTavernScript,
  normalizeTavernVariables,
  type TavernScript,
} from "./tavernScriptUtils";
import {
  TAVERN_EVENTS,
  TavernScriptRuntime,
  type TavernRuntimeButton,
  type TavernRuntimeLog,
  type TavernRuntimeMessage,
  type TavernRuntimeStatus,
} from "./tavernScriptRuntime";
import type { AgentPersona, InfluenceLevel, PersonalityEntry, PersonalityEntryType } from "./types";

const AVATAR_OUTPUT_SIZE = 512;
const CROP_PREVIEW_SIZE = 320;

type AvatarCropState = {
  target: "persona" | "user";
  src: string;
  zoom: number;
  offsetX: number;
  offsetY: number;
  naturalWidth: number;
  naturalHeight: number;
};

type DragPlacement = "before" | "after";

type EntryDragTarget = {
  typeId: string;
  entryId: string;
  placement: DragPlacement;
};

type TypeDragTarget = {
  typeId: string;
  placement: DragPlacement;
};

type AppView = "home" | "studio" | "characters" | "settings" | "chat";
type SettingsTab = "providers" | "prompts" | "presets" | "worldbooks" | "regexes" | "scripts" | "user" | "personalization" | "mcp" | "skills" | "device";
type ProviderPullState = "idle" | "loading" | "success" | "error";
type ChatGenerationState = "idle" | "running" | "stopping";
type ChatMode = "ai" | "persona" | "multi" | "roleplay";
type ChatRole = "user" | "assistant";
type ChatApiRole = "system" | "user" | "assistant" | "tool";
type ChatSenderKind = "user" | "persona" | "system";
type ProviderReasoningEffort = "low" | "medium" | "high" | "xhigh";
type RegexScriptScope = "global" | "preset";
type TavernScriptScope = "global" | "character";

type RegexScriptTarget = {
  key: string;
  scope: RegexScriptScope;
  script: RegexScript;
  index: number;
  total: number;
  presetId?: string;
  presetName?: string;
};

type TavernScriptTarget = {
  key: string;
  scope: TavernScriptScope;
  script: TavernScript;
  index: number;
  total: number;
  characterId?: string;
  characterName?: string;
};

type ChatSenderIdentity = {
  kind: ChatSenderKind;
  personaId?: string;
};

type ModelProviderChannel = {
  id: string;
  name: string;
  apiBaseUrl: string;
  apiKey: string;
  modelId: string;
  models: string[];
  reasoningEnabled: boolean;
  reasoningEffort: ProviderReasoningEffort;
  updatedAt: string;
};

type MultiAgentModelConfig = {
  providerId: string;
  modelId: string;
};

type MultiAgentModelConfigs = Record<string, MultiAgentModelConfig>;

type ChatAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  downloadUrl?: string;
  textContent?: string;
  createdAt: string;
};

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  reasoning?: string;
  createdAt: string;
  sender?: ChatSenderIdentity;
  attachments?: ChatAttachment[];
  source?: "heartbeat" | "roleplay-greeting";
  variables?: Record<string, unknown>;
  extra?: Record<string, unknown>;
};

type ChatHeartbeatConfig = {
  enabled: boolean;
  intervalMinutes: number;
  event: string;
  loopLimit: number | null;
  runCount: number;
  lastRunAt?: string;
  nextRunAt?: string;
  updatedAt: string;
};

type ChatHeartbeatPatch = {
  enabled?: boolean;
  intervalMinutes?: number;
  event?: string;
  loopLimit?: number | null;
  resetRunCount?: boolean;
};

type ChatSession = {
  id: string;
  workspaceKey: string;
  workspaceName: string;
  workspacePath?: string;
  title: string;
  messages: ChatMessage[];
  heartbeat: ChatHeartbeatConfig;
  memoryPersonaIds: string[];
  roleplayCharacterCardId?: string;
  roleplayGreetingIndex?: number;
  scriptVariables: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type SystemPromptProfile = {
  id: string;
  name: string;
  content: string;
  updatedAt: string;
};

type UserProfile = {
  nickname: string;
  bio: string;
  avatarImage: string;
  sendToAi: boolean;
  updatedAt: string;
};

type ChatPersonalizationSettings = {
  quoteStyleEnabled: boolean;
  quoteStyleColor: string;
  italicStyleEnabled: boolean;
  italicStyleColor: string;
};

type PcConnectionData = {
  baseUrl?: string;
  workspacePath?: string;
  workspaceName?: string;
};

type McpServerTransport = "stdio" | "http";

type McpServerConfig = {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpServerTransport;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  updatedAt: string;
};

type SkillProfile = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  sourceType: "folder" | "zip";
  path: string;
  entryFile: string;
  importedAt: string;
  updatedAt: string;
};

type ChatToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
};

type McpToolDefinition = ChatToolDefinition & {
  serverId: string;
  serverName: string;
  originalName: string;
};

type RengeAppData = {
  version?: number;
  personas?: AgentPersona[];
  activePersonaId?: string;
  providers?: ModelProviderChannel[];
  activeProviderId?: string;
  chatSessions?: ChatSession[];
  chatMode?: ChatMode;
  multiAgentPersonaIds?: string[];
  multiAgentRounds?: number;
  multiAgentModelConfigs?: MultiAgentModelConfigs;
  multiAgentAutoStopEnabled?: boolean;
  multiAgentStopCondition?: string;
  systemPrompts?: SystemPromptProfile[];
  activeSystemPromptId?: string;
  activeSystemPromptIds?: string[];
  chatPresets?: ChatPreset[];
  activeChatPresetId?: string;
  chatPresetEnabled?: boolean;
  worldBooks?: WorldBook[];
  activeWorldBookIds?: string[];
  regexScripts?: RegexScript[];
  tavernScripts?: TavernScript[];
  tavernGlobalVariables?: Record<string, unknown>;
  characterCards?: CharacterCard[];
  activeCharacterCardId?: string;
  userProfile?: UserProfile;
  chatSender?: ChatSenderIdentity;
  chatMultiBubbleEnabled?: boolean;
  chatHtmlRenderEnabled?: boolean;
  chatReasoningVisible?: boolean;
  chatHeartbeatReminderVisible?: boolean;
  chatPersonalization?: ChatPersonalizationSettings;
  mcpServers?: McpServerConfig[];
  skills?: SkillProfile[];
  pcConnection?: PcConnectionData;
  updatedAt?: string;
};

type LocalFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: string | Blob | ArrayBuffer): Promise<void>;
    close(): Promise<void>;
  }>;
};

type LocalDirectoryHandle = {
  kind: "directory";
  name: string;
  values(): AsyncIterable<LocalFileHandle | LocalDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<LocalFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<LocalDirectoryHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission?(options: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "read" | "readwrite" }): Promise<PermissionState>;
};

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: () => Promise<LocalDirectoryHandle>;
};

type ElectronWorkspaceHandle = {
  kind: "electron";
  name: string;
  path: string;
};

type AndroidWorkspaceHandle = {
  kind: "android";
  name: string;
  uri: string;
};

type PcWorkspaceHandle = {
  kind: "pc";
  name: string;
  baseUrl: string;
  path: string;
};

type PcFileEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  modifiedAt?: string;
};

type RengeDesktopApi = {
  isElectron: boolean;
  selectWorkspace(): Promise<ElectronWorkspaceHandle | null>;
  selectSkillFolder?(): Promise<{ path: string; name: string } | null>;
  restoreWorkspace(options: { path: string }): Promise<ElectronWorkspaceHandle>;
  listFiles(options: { path?: string; recursive?: boolean }): Promise<unknown>;
  readFile(options: { path: string }): Promise<unknown>;
  readBinaryFile(options: { path: string }): Promise<unknown>;
  readFileRange(options: { path: string; startLine?: number; endLine?: number }): Promise<unknown>;
  fileInfo(options: { path: string }): Promise<unknown>;
  searchFiles(options: { query: string; path?: string; includeContent?: boolean }): Promise<unknown>;
  writeFile(options: { path: string; content: string }): Promise<unknown>;
  writeBinaryFile(options: { path: string; base64: string; mimeType?: string }): Promise<unknown>;
  editFile(options: { path: string; find: string; replace: string }): Promise<unknown>;
  createDirectory(options: { path: string }): Promise<unknown>;
  renamePath(options: { from: string; to: string }): Promise<unknown>;
  deletePath(options: { path: string; recursive?: boolean }): Promise<unknown>;
  runScript(options: { script: string; args?: string[] }): Promise<unknown>;
  runCommand(options: { command: string; args?: string[]; timeoutMs?: number }): Promise<unknown>;
  gitStatus(): Promise<unknown>;
  gitDiff(options: { path?: string; staged?: boolean }): Promise<unknown>;
  detectStack(): Promise<unknown>;
  searchRegex(options: { pattern: string; path?: string; flags?: string; maxMatches?: number }): Promise<unknown>;
  findSymbols(options: { query?: string; path?: string; maxMatches?: number }): Promise<unknown>;
  readPackageJson(): Promise<unknown>;
  scanTodos(options: { path?: string; maxMatches?: number }): Promise<unknown>;
};

type RengeAndroidApi = {
  isAndroid: boolean;
  selectWorkspace(): Promise<AndroidWorkspaceHandle | null>;
  selectRootWorkspace(options: { path: string }): Promise<AndroidWorkspaceHandle>;
  restoreWorkspace(options: { uri: string; name?: string }): Promise<AndroidWorkspaceHandle>;
  listFiles(options: { path?: string; recursive?: boolean }): Promise<unknown>;
  readFile(options: { path: string }): Promise<unknown>;
  readBinaryFile(options: { path: string }): Promise<unknown>;
  readFileRange(options: { path: string; startLine?: number; endLine?: number }): Promise<unknown>;
  fileInfo(options: { path: string }): Promise<unknown>;
  searchFiles(options: { query: string; path?: string; includeContent?: boolean }): Promise<unknown>;
  createDirectory(options: { path: string }): Promise<unknown>;
  writeFile(options: { path: string; content: string }): Promise<unknown>;
  writeBinaryFile(options: { path: string; base64: string; mimeType?: string }): Promise<unknown>;
  transferFileToPc(options: {
    sourcePath: string;
    targetPath: string;
    pcBaseUrl: string;
    pcWorkspacePath: string;
  }): Promise<unknown>;
  transferFileFromPc(options: {
    sourcePath: string;
    targetPath: string;
    pcBaseUrl: string;
    pcWorkspacePath: string;
  }): Promise<unknown>;
  deletePath(options: { path: string; recursive?: boolean }): Promise<unknown>;
  requestRootAccess(options?: { timeoutSeconds?: number }): Promise<{
    granted: boolean;
    persisted?: boolean;
    timedOut?: boolean;
    exitCode?: number;
    output?: string;
    errorOutput?: string;
    message?: string;
  }>;
  getRootAccessStatus(options?: Record<string, never>): Promise<{
    granted: boolean;
    persisted?: boolean;
    message?: string;
  }>;
  getWorkspaceStatus(options?: Record<string, never>): Promise<{
    available: boolean;
    kind?: "android";
    name?: string;
    uri?: string;
    root?: boolean;
    path?: string;
    message?: string;
  }>;
};

declare global {
  interface Window {
    rengeDesktop?: RengeDesktopApi;
    rengeAndroid?: RengeAndroidApi;
  }
}

type ChatToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type ChatApiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: string; [key: string]: unknown };

type ChatApiMessage = {
  role: ChatApiRole;
  name?: string;
  content: string | ChatApiContentPart[] | null;
  reasoning?: unknown;
  reasoning_content?: unknown;
  reasoning_details?: unknown;
  thinking?: unknown;
  thinking_content?: unknown;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
};

const PROVIDER_STORAGE_KEY = "renge_provider_channels";
const ACTIVE_PROVIDER_STORAGE_KEY = "renge_active_provider";
const CHAT_SESSIONS_STORAGE_KEY = "renge_chat_sessions";
const CHAT_MODE_STORAGE_KEY = "renge_chat_mode";
const MULTI_AGENT_PERSONAS_STORAGE_KEY = "renge_multi_agent_personas";
const MULTI_AGENT_ROUNDS_STORAGE_KEY = "renge_multi_agent_rounds";
const MULTI_AGENT_MODELS_STORAGE_KEY = "renge_multi_agent_models";
const MULTI_AGENT_AUTO_STOP_STORAGE_KEY = "renge_multi_agent_auto_stop";
const MULTI_AGENT_STOP_CONDITION_STORAGE_KEY = "renge_multi_agent_stop_condition";
const ACTIVE_PERSONA_STORAGE_KEY = "renge_active_persona";
const SYSTEM_PROMPTS_STORAGE_KEY = "renge_system_prompts";
const ACTIVE_SYSTEM_PROMPT_STORAGE_KEY = "renge_active_system_prompt";
const ACTIVE_SYSTEM_PROMPTS_STORAGE_KEY = "renge_active_system_prompts";
const CHAT_PRESETS_STORAGE_KEY = "renge_chat_presets";
const ACTIVE_CHAT_PRESET_STORAGE_KEY = "renge_active_chat_preset";
const CHAT_PRESET_ENABLED_STORAGE_KEY = "renge_chat_preset_enabled";
const WORLD_BOOKS_STORAGE_KEY = "renge_world_books";
const ACTIVE_WORLD_BOOKS_STORAGE_KEY = "renge_active_world_books";
const REGEX_SCRIPTS_STORAGE_KEY = "renge_regex_scripts";
const TAVERN_SCRIPTS_STORAGE_KEY = "renge_tavern_scripts";
const TAVERN_GLOBAL_VARIABLES_STORAGE_KEY = "renge_tavern_global_variables";
const CHARACTER_CARDS_STORAGE_KEY = "renge_character_cards";
const ACTIVE_CHARACTER_CARD_STORAGE_KEY = "renge_active_character_card";
const USER_PROFILE_STORAGE_KEY = "renge_user_profile";
const CHAT_SENDER_STORAGE_KEY = "renge_chat_sender";
const CHAT_MULTI_BUBBLE_STORAGE_KEY = "renge_chat_multi_bubble_enabled";
const CHAT_HTML_RENDER_STORAGE_KEY = "renge_chat_html_render_enabled";
const CHAT_REASONING_VISIBLE_STORAGE_KEY = "renge_chat_reasoning_visible";
const CHAT_HEARTBEAT_REMINDER_VISIBLE_STORAGE_KEY = "renge_chat_heartbeat_reminder_visible";
const CHAT_PERSONALIZATION_STORAGE_KEY = "renge_chat_personalization";
const MCP_SERVERS_STORAGE_KEY = "renge_mcp_servers";
const SKILLS_STORAGE_KEY = "renge_skills";
const PC_SERVER_URL_STORAGE_KEY = "renge_pc_server_url";
const PC_WORKSPACE_PATH_STORAGE_KEY = "renge_pc_workspace_path";
const PC_WORKSPACE_NAME_STORAGE_KEY = "renge_pc_workspace_name";
const DEFAULT_WORKSPACE_KEY = "default";
const DEFAULT_WORKSPACE_NAME = "默认工作区";
const CHAT_TIME_GROUP_MS = 5 * 60 * 1000;
const DEFAULT_HEARTBEAT_INTERVAL_MINUTES = 5;
const MIN_HEARTBEAT_INTERVAL_MINUTES = 1;
const MAX_HEARTBEAT_INTERVAL_MINUTES = 24 * 60;
const MAX_MULTI_AGENT_ROUNDS = 20;
const DEFAULT_CHAT_PERSONALIZATION: ChatPersonalizationSettings = {
  quoteStyleEnabled: false,
  quoteStyleColor: "#E18A24",
  italicStyleEnabled: false,
  italicStyleColor: "#808080",
};
const VOLCENGINE_CODING_PLAN_NAME = "火山方舟 Coding Plan";
const VOLCENGINE_CODING_PLAN_API_BASE_URL = "https://ark.cn-beijing.volces.com/api/coding/v3";
const VOLCENGINE_CODING_PLAN_MODEL_ID = "ark-code-latest";
const providerReasoningEffortOptions: Array<{
  value: ProviderReasoningEffort;
  label: string;
}> = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "超高" },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getCropMetrics(crop: AvatarCropState) {
  const coverScale = Math.max(
    CROP_PREVIEW_SIZE / crop.naturalWidth,
    CROP_PREVIEW_SIZE / crop.naturalHeight,
  );
  const displayWidth = crop.naturalWidth * coverScale;
  const displayHeight = crop.naturalHeight * coverScale;
  const scaledWidth = displayWidth * crop.zoom;
  const scaledHeight = displayHeight * crop.zoom;

  return {
    displayWidth,
    displayHeight,
    scaledWidth,
    scaledHeight,
    maxOffsetX: Math.max(0, (scaledWidth - CROP_PREVIEW_SIZE) / 2),
    maxOffsetY: Math.max(0, (scaledHeight - CROP_PREVIEW_SIZE) / 2),
  };
}

function clampAvatarCrop(crop: AvatarCropState): AvatarCropState {
  const metrics = getCropMetrics(crop);

  return {
    ...crop,
    offsetX: clamp(crop.offsetX, -metrics.maxOffsetX, metrics.maxOffsetX),
    offsetY: clamp(crop.offsetY, -metrics.maxOffsetY, metrics.maxOffsetY),
  };
}

function stampPersona(persona: AgentPersona): AgentPersona {
  return { ...persona, updatedAt: new Date().toISOString() };
}

function normalizeProviderReasoningEffort(value: unknown): ProviderReasoningEffort {
  const normalizedValue = String(value ?? "").trim().toLowerCase().replace(/[-\s]+/g, "_");

  if (
    normalizedValue === "xhigh" ||
    normalizedValue === "x_high" ||
    normalizedValue === "extra_high" ||
    normalizedValue === "very_high" ||
    normalizedValue === "ultra" ||
    normalizedValue === "ultra_high"
  ) {
    return "xhigh";
  }

  if (normalizedValue === "high") return "high";
  if (normalizedValue === "low") return "low";
  return "medium";
}

function getProviderReasoningEffortLabel(effort: ProviderReasoningEffort) {
  return (
    providerReasoningEffortOptions.find((option) => option.value === effort)?.label ?? "中"
  );
}

function buildProviderReasoningRequest(provider?: ModelProviderChannel) {
  if (!provider?.reasoningEnabled) return {};
  const effort = normalizeProviderReasoningEffort(provider.reasoningEffort);
  const apiBaseUrl = provider.apiBaseUrl.toLowerCase();
  if (apiBaseUrl.includes("openrouter.ai")) {
    return {
      reasoning_effort: effort,
      reasoning: {
        effort,
        exclude: false,
      },
      include_reasoning: true,
    };
  }

  if (apiBaseUrl.includes("api.openai.com")) {
    return {
      reasoning_effort: effort,
    };
  }

  return {
    reasoning_effort: effort,
    include_reasoning: true,
  };
}

function createProviderChannel(name = "OpenAI Compatible"): ModelProviderChannel {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    apiBaseUrl: "https://api.openai.com/v1",
    apiKey: "",
    modelId: "",
    models: [],
    reasoningEnabled: false,
    reasoningEffort: "medium",
    updatedAt: timestamp,
  };
}

function createVolcengineCodingPlanProviderChannel(): ModelProviderChannel {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: VOLCENGINE_CODING_PLAN_NAME,
    apiBaseUrl: VOLCENGINE_CODING_PLAN_API_BASE_URL,
    apiKey: "",
    modelId: VOLCENGINE_CODING_PLAN_MODEL_ID,
    models: [VOLCENGINE_CODING_PLAN_MODEL_ID],
    reasoningEnabled: false,
    reasoningEffort: "medium",
    updatedAt: timestamp,
  };
}

function createDefaultProviderChannels() {
  return [createProviderChannel(), createVolcengineCodingPlanProviderChannel()];
}

function normalizeProviderChannel(rawProvider: Partial<ModelProviderChannel>): ModelProviderChannel {
  return {
    id: rawProvider.id ?? crypto.randomUUID(),
    name: rawProvider.name ?? "OpenAI Compatible",
    apiBaseUrl: rawProvider.apiBaseUrl ?? "",
    apiKey: rawProvider.apiKey ?? "",
    modelId: rawProvider.modelId ?? "",
    models: Array.isArray(rawProvider.models) ? rawProvider.models.filter(Boolean) : [],
    reasoningEnabled: rawProvider.reasoningEnabled === true,
    reasoningEffort: normalizeProviderReasoningEffort(rawProvider.reasoningEffort),
    updatedAt: rawProvider.updatedAt ?? new Date().toISOString(),
  };
}

function getEffectiveProviderModelId(provider?: ModelProviderChannel) {
  if (!provider) return "";
  return provider.modelId || provider.models[0] || "";
}

function getProviderModelIds(provider?: ModelProviderChannel) {
  if (!provider) return [];
  return Array.from(
    new Set([provider.modelId.trim(), ...provider.models].filter(Boolean)),
  );
}

function loadProviderChannels() {
  try {
    const rawValue = localStorage.getItem(PROVIDER_STORAGE_KEY);
    if (!rawValue) return createDefaultProviderChannels();
    const parsedValue = JSON.parse(rawValue) as Partial<ModelProviderChannel>[];
    const providers = Array.isArray(parsedValue)
      ? parsedValue.map(normalizeProviderChannel)
      : [];
    return providers.length > 0 ? providers : createDefaultProviderChannels();
  } catch {
    return createDefaultProviderChannels();
  }
}

function createMcpServerConfig(name = "MCP Server"): McpServerConfig {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    enabled: true,
    transport: "stdio",
    command: "",
    args: [],
    cwd: "",
    env: {},
    url: "",
    headers: {},
    updatedAt: timestamp,
  };
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined && entryValue !== null)
      .map(([key, entryValue]) => [String(key), String(entryValue)]),
  );
}

function normalizeMcpServerConfig(
  rawServer: Partial<McpServerConfig> & Record<string, unknown>,
  fallbackName = "MCP Server",
): McpServerConfig {
  const url =
    typeof rawServer.url === "string"
      ? rawServer.url
      : typeof rawServer.baseUrl === "string"
        ? rawServer.baseUrl
        : "";
  const command = typeof rawServer.command === "string" ? rawServer.command : "";
  const rawTransport = String(rawServer.transport ?? rawServer.type ?? "").toLowerCase();
  const transport: McpServerTransport =
    rawTransport === "http" ||
    rawTransport === "streamablehttp" ||
    rawTransport === "streamable_http" ||
    rawTransport === "sse" ||
    (url && !command)
      ? "http"
      : "stdio";
  return {
    id: typeof rawServer.id === "string" ? rawServer.id : crypto.randomUUID(),
    name: typeof rawServer.name === "string" && rawServer.name.trim()
      ? rawServer.name
      : fallbackName,
    enabled: rawServer.disabled === true ? false : rawServer.enabled !== false,
    transport,
    command,
    args: Array.isArray(rawServer.args) ? rawServer.args.map(String) : [],
    cwd: typeof rawServer.cwd === "string" ? rawServer.cwd : "",
    env: normalizeStringRecord(rawServer.env),
    url,
    headers: normalizeStringRecord(rawServer.headers),
    updatedAt: typeof rawServer.updatedAt === "string" ? rawServer.updatedAt : new Date().toISOString(),
  };
}

function loadMcpServers() {
  try {
    const rawValue = localStorage.getItem(MCP_SERVERS_STORAGE_KEY);
    if (!rawValue) return [];
    const parsedValue = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsedValue)
      ? parsedValue.map((server, index) =>
          normalizeMcpServerConfig(
            server && typeof server === "object" && !Array.isArray(server)
              ? (server as Partial<McpServerConfig> & Record<string, unknown>)
              : {},
            `MCP Server ${index + 1}`,
          ),
        )
      : [];
  } catch {
    return [];
  }
}

function parseMcpServersFromJson(rawJson: string): McpServerConfig[] {
  const parsed = JSON.parse(rawJson) as unknown;
  const source =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) && "mcpServers" in parsed
      ? (parsed as { mcpServers?: unknown }).mcpServers
      : parsed;

  if (Array.isArray(source)) {
    return source.map((server, index) =>
      normalizeMcpServerConfig(
        server && typeof server === "object" && !Array.isArray(server)
          ? (server as Partial<McpServerConfig> & Record<string, unknown>)
          : {},
        `MCP Server ${index + 1}`,
      ),
    );
  }

  if (source && typeof source === "object") {
    return Object.entries(source).map(([name, server]) =>
      normalizeMcpServerConfig(
        {
          ...(server && typeof server === "object" && !Array.isArray(server)
            ? (server as Partial<McpServerConfig> & Record<string, unknown>)
            : {}),
          name,
        },
        name,
      ),
    );
  }

  throw new Error("没有识别到 MCP 服务器配置。");
}

function formatJsonForTextarea(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function buildMcpServerExportJson(servers: McpServerConfig[]) {
  const usedNames = new Set<string>();
  const mcpServers = Object.fromEntries(
    servers.map((server, index) => {
      const baseName = server.name.trim() || `MCP Server ${index + 1}`;
      let name = baseName;
      let suffix = 2;
      while (usedNames.has(name)) {
        name = `${baseName} ${suffix}`;
        suffix += 1;
      }
      usedNames.add(name);

      const exportedServer: Record<string, unknown> =
        server.transport === "http"
          ? {
              url: server.url,
              ...(Object.keys(server.headers).length > 0 ? { headers: server.headers } : {}),
            }
          : {
              command: server.command,
              ...(server.args.length > 0 ? { args: server.args } : {}),
              ...(server.cwd.trim() ? { cwd: server.cwd } : {}),
              ...(Object.keys(server.env).length > 0 ? { env: server.env } : {}),
            };

      return [name, exportedServer];
    }),
  );

  return JSON.stringify({ mcpServers }, null, 2);
}

function getMcpServerSummary(server: McpServerConfig) {
  if (server.transport === "http") return server.url || "未设置 URL";
  return [server.command, ...server.args].filter(Boolean).join(" ") || "未设置命令";
}

function normalizeSkillProfile(rawSkill: Partial<SkillProfile> & Record<string, unknown>): SkillProfile {
  const timestamp = new Date().toISOString();
  return {
    id: typeof rawSkill.id === "string" ? rawSkill.id : crypto.randomUUID(),
    name: typeof rawSkill.name === "string" && rawSkill.name.trim()
      ? rawSkill.name
      : "未命名技能",
    description: typeof rawSkill.description === "string" ? rawSkill.description : "",
    enabled: rawSkill.enabled !== false,
    sourceType: rawSkill.sourceType === "zip" ? "zip" : "folder",
    path: typeof rawSkill.path === "string" ? rawSkill.path : "",
    entryFile: typeof rawSkill.entryFile === "string" && rawSkill.entryFile.trim()
      ? rawSkill.entryFile
      : "SKILL.md",
    importedAt: typeof rawSkill.importedAt === "string" ? rawSkill.importedAt : timestamp,
    updatedAt: typeof rawSkill.updatedAt === "string" ? rawSkill.updatedAt : timestamp,
  };
}

function loadSkills() {
  try {
    const rawValue = localStorage.getItem(SKILLS_STORAGE_KEY);
    if (!rawValue) return [];
    const parsedValue = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsedValue)
      ? parsedValue.map((skill) =>
          normalizeSkillProfile(
            skill && typeof skill === "object" && !Array.isArray(skill)
              ? (skill as Partial<SkillProfile> & Record<string, unknown>)
              : {},
          ),
        )
      : [];
  } catch {
    return [];
  }
}

function getSkillSummary(skill: SkillProfile) {
  return skill.description.trim() || `${skill.sourceType === "zip" ? "ZIP" : "文件夹"} / ${skill.entryFile}`;
}

async function readFileAsBase64(file: File) {
  const dataUrl = await readFileAsDataUrl(file);
  return dataUrl.replace(/^data:[^,]*,/, "");
}

async function blobToBase64(blob: Blob) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Blob 读取失败"));
    reader.readAsDataURL(blob);
  });
  return dataUrl.replace(/^data:[^,]*,/, "");
}

function createSystemPromptProfile(name = "默认提示词"): SystemPromptProfile {
  return {
    id: crypto.randomUUID(),
    name,
    content: "",
    updatedAt: new Date().toISOString(),
  };
}

function normalizeSystemPromptProfile(
  rawPrompt: Partial<SystemPromptProfile>,
): SystemPromptProfile {
  return {
    id: rawPrompt.id ?? crypto.randomUUID(),
    name: rawPrompt.name ?? "未命名提示词",
    content: rawPrompt.content ?? "",
    updatedAt: rawPrompt.updatedAt ?? new Date().toISOString(),
  };
}

function loadSystemPrompts() {
  try {
    const rawValue = localStorage.getItem(SYSTEM_PROMPTS_STORAGE_KEY);
    if (!rawValue) return [createSystemPromptProfile()];
    const parsedValue = JSON.parse(rawValue) as Partial<SystemPromptProfile>[];
    const prompts = Array.isArray(parsedValue)
      ? parsedValue.map(normalizeSystemPromptProfile)
      : [];
    return prompts.length > 0 ? prompts : [createSystemPromptProfile()];
  } catch {
    return [createSystemPromptProfile()];
  }
}

function normalizeChatMode(value: unknown): ChatMode {
  if (value === "ai" || value === "multi" || value === "roleplay") return value;
  return "persona";
}

function loadChatMode() {
  return normalizeChatMode(localStorage.getItem(CHAT_MODE_STORAGE_KEY));
}

function normalizeMultiAgentPersonaIds(
  rawPersonaIds: unknown,
  personas: AgentPersona[] = [],
) {
  if (!Array.isArray(rawPersonaIds)) return [];
  const validPersonaIds = new Set(personas.map((persona) => persona.id));
  return rawPersonaIds.filter(
    (personaId, index, personaIds): personaId is string =>
      typeof personaId === "string" &&
      personaIds.indexOf(personaId) === index &&
      (personas.length === 0 || validPersonaIds.has(personaId)),
  );
}

function loadMultiAgentPersonaIds() {
  try {
    const rawValue = localStorage.getItem(MULTI_AGENT_PERSONAS_STORAGE_KEY);
    return rawValue ? normalizeMultiAgentPersonaIds(JSON.parse(rawValue)) : [];
  } catch {
    return [];
  }
}

function normalizeMultiAgentRounds(value: unknown) {
  const parsedValue = Math.floor(Number(value));
  return clamp(
    Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 1,
    1,
    MAX_MULTI_AGENT_ROUNDS,
  );
}

function loadMultiAgentRounds() {
  return normalizeMultiAgentRounds(
    localStorage.getItem(MULTI_AGENT_ROUNDS_STORAGE_KEY),
  );
}

function normalizeMultiAgentModelConfigs(
  rawConfigs: unknown,
  personas: AgentPersona[] = [],
  providers: ModelProviderChannel[] = [],
  fallbackProviderId = "",
): MultiAgentModelConfigs {
  const source =
    rawConfigs && typeof rawConfigs === "object" && !Array.isArray(rawConfigs)
      ? (rawConfigs as Record<string, unknown>)
      : {};
  const providerIds = new Set(providers.map((provider) => provider.id));
  const fallbackProvider =
    providers.find((provider) => provider.id === fallbackProviderId) ?? providers[0];
  const personaIds =
    personas.length > 0 ? personas.map((persona) => persona.id) : Object.keys(source);

  return Object.fromEntries(
    personaIds.map((personaId) => {
      const rawConfig = source[personaId] as Partial<MultiAgentModelConfig> | undefined;
      const hasValidStoredProvider = Boolean(
        rawConfig?.providerId &&
          (providers.length === 0 || providerIds.has(rawConfig.providerId)),
      );
      const provider =
        hasValidStoredProvider && rawConfig?.providerId
          ? providers.find((item) => item.id === rawConfig.providerId) ?? fallbackProvider
          : fallbackProvider;
      const providerId = provider?.id ?? rawConfig?.providerId ?? "";
      const modelId =
        hasValidStoredProvider &&
        typeof rawConfig?.modelId === "string" &&
        rawConfig.modelId.trim()
          ? rawConfig.modelId.trim()
          : getEffectiveProviderModelId(provider);
      return [personaId, { providerId, modelId }];
    }),
  );
}

function loadMultiAgentModelConfigs() {
  try {
    const rawValue = localStorage.getItem(MULTI_AGENT_MODELS_STORAGE_KEY);
    return rawValue
      ? normalizeMultiAgentModelConfigs(JSON.parse(rawValue))
      : {};
  } catch {
    return {};
  }
}

function loadMultiAgentStopCondition() {
  return localStorage.getItem(MULTI_AGENT_STOP_CONDITION_STORAGE_KEY) ?? "";
}

function loadMultiAgentAutoStopEnabled() {
  return localStorage.getItem(MULTI_AGENT_AUTO_STOP_STORAGE_KEY) === "true";
}

function getStoredActiveSystemPromptIds() {
  try {
    const rawValue = localStorage.getItem(ACTIVE_SYSTEM_PROMPTS_STORAGE_KEY);
    if (!rawValue) return null;
    const parsedValue = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsedValue)
      ? parsedValue.filter((promptId): promptId is string => typeof promptId === "string")
      : null;
  } catch {
    return null;
  }
}

function normalizeActiveSystemPromptIds(
  promptIds: string[],
  prompts: SystemPromptProfile[],
) {
  const validIds = new Set(prompts.map((promptProfile) => promptProfile.id));
  return promptIds.filter((promptId, index) => validIds.has(promptId) && promptIds.indexOf(promptId) === index);
}

function normalizeChatSenderIdentity(
  rawSender?: Partial<ChatSenderIdentity>,
  personas: AgentPersona[] = [],
): ChatSenderIdentity {
  if (rawSender?.kind === "system") return { kind: "system" };

  if (rawSender?.kind === "persona") {
    const personaExists =
      rawSender.personaId && personas.some((persona) => persona.id === rawSender.personaId);
    return rawSender.personaId && (personas.length === 0 || personaExists)
      ? { kind: "persona", personaId: rawSender.personaId }
      : { kind: "user" };
  }

  return { kind: "user" };
}

function loadChatSender() {
  try {
    const rawValue = localStorage.getItem(CHAT_SENDER_STORAGE_KEY);
    if (!rawValue) return { kind: "user" } satisfies ChatSenderIdentity;
    return normalizeChatSenderIdentity(JSON.parse(rawValue) as Partial<ChatSenderIdentity>);
  } catch {
    return { kind: "user" } satisfies ChatSenderIdentity;
  }
}

function createUserProfile(): UserProfile {
  return {
    nickname: "User",
    bio: "",
    avatarImage: "",
    sendToAi: false,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeUserProfile(rawProfile?: Partial<UserProfile>): UserProfile {
  return {
    nickname: rawProfile?.nickname ?? "User",
    bio: rawProfile?.bio ?? "",
    avatarImage: rawProfile?.avatarImage ?? "",
    sendToAi: Boolean(rawProfile?.sendToAi),
    updatedAt: rawProfile?.updatedAt ?? new Date().toISOString(),
  };
}

function loadUserProfile() {
  try {
    const rawValue = localStorage.getItem(USER_PROFILE_STORAGE_KEY);
    if (!rawValue) return createUserProfile();
    return normalizeUserProfile(JSON.parse(rawValue) as Partial<UserProfile>);
  } catch {
    return createUserProfile();
  }
}

function normalizePersonalizationColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value.toUpperCase()
    : fallback;
}

function normalizeChatPersonalization(
  rawSettings?: Partial<ChatPersonalizationSettings> | null,
): ChatPersonalizationSettings {
  return {
    quoteStyleEnabled:
      typeof rawSettings?.quoteStyleEnabled === "boolean"
        ? rawSettings.quoteStyleEnabled
        : DEFAULT_CHAT_PERSONALIZATION.quoteStyleEnabled,
    quoteStyleColor: normalizePersonalizationColor(
      rawSettings?.quoteStyleColor,
      DEFAULT_CHAT_PERSONALIZATION.quoteStyleColor,
    ),
    italicStyleEnabled:
      typeof rawSettings?.italicStyleEnabled === "boolean"
        ? rawSettings.italicStyleEnabled
        : DEFAULT_CHAT_PERSONALIZATION.italicStyleEnabled,
    italicStyleColor: normalizePersonalizationColor(
      rawSettings?.italicStyleColor,
      DEFAULT_CHAT_PERSONALIZATION.italicStyleColor,
    ),
  };
}

function loadChatPersonalization() {
  try {
    const rawValue = localStorage.getItem(CHAT_PERSONALIZATION_STORAGE_KEY);
    if (!rawValue) return { ...DEFAULT_CHAT_PERSONALIZATION };
    return normalizeChatPersonalization(
      JSON.parse(rawValue) as Partial<ChatPersonalizationSettings>,
    );
  } catch {
    return { ...DEFAULT_CHAT_PERSONALIZATION };
  }
}

function normalizeChatAttachment(rawAttachment: Partial<ChatAttachment>): ChatAttachment | null {
  if (!rawAttachment) return null;

  return {
    id: rawAttachment.id ?? crypto.randomUUID(),
    name: rawAttachment.name ?? "未命名文件",
    type: rawAttachment.type ?? "",
    size: Number.isFinite(rawAttachment.size) ? Number(rawAttachment.size) : 0,
    ...(typeof rawAttachment.dataUrl === "string" ? { dataUrl: rawAttachment.dataUrl } : {}),
    ...(typeof rawAttachment.downloadUrl === "string"
      ? { downloadUrl: rawAttachment.downloadUrl }
      : {}),
    ...(typeof rawAttachment.textContent === "string"
      ? { textContent: rawAttachment.textContent }
      : {}),
    createdAt: rawAttachment.createdAt ?? new Date().toISOString(),
  };
}

function normalizeChatMessage(rawMessage: Partial<ChatMessage>): ChatMessage {
  const role = rawMessage.role === "assistant" ? "assistant" : "user";
  const attachments = Array.isArray(rawMessage.attachments)
    ? rawMessage.attachments
        .map((attachment) => normalizeChatAttachment(attachment))
        .filter((attachment): attachment is ChatAttachment => Boolean(attachment))
    : [];

  const normalizedSender = normalizeChatSenderIdentity(rawMessage.sender);

  return {
    id: rawMessage.id ?? crypto.randomUUID(),
    role,
    content: rawMessage.content ?? "",
    ...(typeof rawMessage.reasoning === "string" && rawMessage.reasoning.trim()
      ? { reasoning: rawMessage.reasoning }
      : {}),
    createdAt: rawMessage.createdAt ?? new Date().toISOString(),
    ...(role === "user"
      ? { sender: normalizedSender }
      : normalizedSender.kind === "persona"
        ? { sender: normalizedSender }
        : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(rawMessage.source === "heartbeat" || rawMessage.source === "roleplay-greeting"
      ? { source: rawMessage.source }
      : {}),
    ...(isObjectRecord(rawMessage.variables)
      ? { variables: normalizeTavernVariables(rawMessage.variables) }
      : {}),
    ...(isObjectRecord(rawMessage.extra)
      ? { extra: normalizeTavernVariables(rawMessage.extra) }
      : {}),
  };
}

function createDefaultHeartbeatConfig(): ChatHeartbeatConfig {
  return {
    enabled: false,
    intervalMinutes: DEFAULT_HEARTBEAT_INTERVAL_MINUTES,
    event: "",
    loopLimit: null,
    runCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeHeartbeatConfig(rawConfig?: Partial<ChatHeartbeatConfig>): ChatHeartbeatConfig {
  const intervalMinutes = clamp(
    Number(rawConfig?.intervalMinutes ?? DEFAULT_HEARTBEAT_INTERVAL_MINUTES),
    MIN_HEARTBEAT_INTERVAL_MINUTES,
    MAX_HEARTBEAT_INTERVAL_MINUTES,
  );
  const rawLoopLimit = rawConfig?.loopLimit;
  const loopLimit =
    typeof rawLoopLimit === "number" && Number.isFinite(rawLoopLimit) && rawLoopLimit > 0
      ? Math.floor(rawLoopLimit)
      : null;
  const runCount = Math.max(0, Math.floor(Number(rawConfig?.runCount ?? 0)));

  return {
    enabled: Boolean(rawConfig?.enabled),
    intervalMinutes,
    event: String(rawConfig?.event ?? ""),
    loopLimit,
    runCount,
    ...(typeof rawConfig?.lastRunAt === "string" ? { lastRunAt: rawConfig.lastRunAt } : {}),
    ...(typeof rawConfig?.nextRunAt === "string" ? { nextRunAt: rawConfig.nextRunAt } : {}),
    updatedAt: rawConfig?.updatedAt ?? new Date().toISOString(),
  };
}

function getHeartbeatNextRunAt(intervalMinutes: number) {
  return new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString();
}

function formatHeartbeatTime(value?: string) {
  if (!value) return "未安排";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "未安排";
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function applyHeartbeatPatch(
  currentHeartbeat: ChatHeartbeatConfig,
  patch: ChatHeartbeatPatch,
  timestamp: string,
) {
  const intervalMinutes =
    patch.intervalMinutes === undefined
      ? currentHeartbeat.intervalMinutes
      : clamp(
          Math.floor(Number(patch.intervalMinutes)),
          MIN_HEARTBEAT_INTERVAL_MINUTES,
          MAX_HEARTBEAT_INTERVAL_MINUTES,
        );
  const loopLimit =
    patch.loopLimit === undefined
      ? currentHeartbeat.loopLimit
      : typeof patch.loopLimit === "number" && Number.isFinite(patch.loopLimit) && patch.loopLimit > 0
        ? Math.floor(patch.loopLimit)
        : null;
  const event = patch.event === undefined ? currentHeartbeat.event : String(patch.event);
  const enabled = patch.enabled === undefined ? currentHeartbeat.enabled : Boolean(patch.enabled);
  const runCount = patch.resetRunCount === true ? 0 : currentHeartbeat.runCount;
  const shouldSchedule = enabled && event.trim().length > 0;
  const updatedConfig: ChatHeartbeatConfig = {
    ...currentHeartbeat,
    enabled: shouldSchedule,
    intervalMinutes,
    event,
    loopLimit,
    runCount,
    ...(shouldSchedule ? { nextRunAt: getHeartbeatNextRunAt(intervalMinutes) } : {}),
    updatedAt: timestamp,
  };

  if (!shouldSchedule) {
    delete updatedConfig.nextRunAt;
  }

  return updatedConfig;
}

function createChatSession(
  workspaceKey = DEFAULT_WORKSPACE_KEY,
  workspaceName = DEFAULT_WORKSPACE_NAME,
  workspacePath = workspaceKey !== DEFAULT_WORKSPACE_KEY && !workspaceKey.startsWith("browser:")
    ? workspaceKey
    : undefined,
  roleplay?: { characterCardId: string; greetingIndex?: number },
): ChatSession {
  const timestamp = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    workspaceKey,
    workspaceName,
    ...(workspacePath ? { workspacePath } : {}),
    title: "新会话",
    messages: [],
    heartbeat: createDefaultHeartbeatConfig(),
    memoryPersonaIds: [],
    scriptVariables: {},
    ...(roleplay
      ? {
          roleplayCharacterCardId: roleplay.characterCardId,
          roleplayGreetingIndex: roleplay.greetingIndex ?? 0,
        }
      : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function normalizeChatSession(rawSession: Partial<ChatSession>): ChatSession {
  const messages = Array.isArray(rawSession.messages)
    ? rawSession.messages.map((message) => normalizeChatMessage(message))
    : [];
  const rawTitle = rawSession.title ?? "新会话";
  const title = rawTitle.trim().startsWith("【心跳检查】")
    ? inferChatSessionTitle(messages)
    : rawTitle;

  return {
    id: rawSession.id ?? crypto.randomUUID(),
    workspaceKey: rawSession.workspaceKey ?? DEFAULT_WORKSPACE_KEY,
    workspaceName: rawSession.workspaceName ?? DEFAULT_WORKSPACE_NAME,
    workspacePath:
      rawSession.workspacePath ??
      (rawSession.workspaceKey && rawSession.workspaceKey !== DEFAULT_WORKSPACE_KEY && !rawSession.workspaceKey.startsWith("browser:")
        ? rawSession.workspaceKey
        : undefined),
    title,
    messages,
    heartbeat: normalizeHeartbeatConfig(rawSession.heartbeat),
    memoryPersonaIds: Array.isArray(rawSession.memoryPersonaIds)
      ? rawSession.memoryPersonaIds.filter(
          (personaId, index, personaIds): personaId is string =>
            typeof personaId === "string" && personaIds.indexOf(personaId) === index,
        )
      : [],
    scriptVariables: normalizeTavernVariables(rawSession.scriptVariables),
    ...(typeof rawSession.roleplayCharacterCardId === "string" &&
    rawSession.roleplayCharacterCardId.trim()
      ? {
          roleplayCharacterCardId: rawSession.roleplayCharacterCardId,
          roleplayGreetingIndex: Math.max(
            0,
            Math.floor(Number(rawSession.roleplayGreetingIndex) || 0),
          ),
        }
      : {}),
    createdAt: rawSession.createdAt ?? new Date().toISOString(),
    updatedAt: rawSession.updatedAt ?? new Date().toISOString(),
  };
}

function createRoleplayGreetingMessage(
  card: CharacterCard,
  userName: string,
  greetingIndex = 0,
): ChatMessage | null {
  const greetings = getCharacterCardGreetings(card, userName);
  if (greetings.length === 0) return null;
  const safeIndex = Math.max(0, Math.min(greetingIndex, greetings.length - 1));
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: greetings[safeIndex],
    source: "roleplay-greeting",
    createdAt: new Date().toISOString(),
  };
}

function deleteChatSessionsWithMemoryCleanup(
  sessions: ChatSession[],
  shouldDelete: (session: ChatSession) => boolean,
) {
  return sessions
    .map((session) =>
      shouldDelete(session)
        ? {
            ...session,
            memoryPersonaIds: [],
            updatedAt: new Date().toISOString(),
          }
        : session,
    )
    .filter((session) => !shouldDelete(session));
}

function loadChatSessions() {
  try {
    const rawValue = localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY);
    if (!rawValue) return [createChatSession()];
    const parsedValue = JSON.parse(rawValue) as Partial<ChatSession>[];
    const sessions = Array.isArray(parsedValue)
      ? parsedValue.map(normalizeChatSession)
      : [];
    return sessions.length > 0 ? sessions : [createChatSession()];
  } catch {
    return [createChatSession()];
  }
}

async function loadPersistentAppData(): Promise<RengeAppData | null> {
  try {
    const response = await fetch("/api/app-data", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as { data?: RengeAppData };
    return payload.data && typeof payload.data === "object" ? payload.data : null;
  } catch {
    return null;
  }
}

async function savePersistentAppData(data: RengeAppData) {
  try {
    await fetch("/api/app-data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    });
  } catch {
    // The app can still run with localStorage when the persistence API is unavailable.
  }
}

function getStoredPcConnection(): PcConnectionData {
  return {
    baseUrl: localStorage.getItem(PC_SERVER_URL_STORAGE_KEY) ?? "",
    workspacePath: localStorage.getItem(PC_WORKSPACE_PATH_STORAGE_KEY) ?? "",
    workspaceName: localStorage.getItem(PC_WORKSPACE_NAME_STORAGE_KEY) ?? "",
  };
}

function normalizePcWorkspaceHandle(connection: PcConnectionData | undefined | null) {
  const baseUrl = typeof connection?.baseUrl === "string" ? connection.baseUrl.trim() : "";
  const path =
    typeof connection?.workspacePath === "string" ? connection.workspacePath.trim() : "";
  if (!baseUrl || !path) return null;
  const name =
    typeof connection?.workspaceName === "string" && connection.workspaceName.trim()
      ? connection.workspaceName.trim()
      : path.replace(/[\\/]+$/g, "").split(/[\\/]/).filter(Boolean).at(-1) || "电脑工作区";
  return {
    kind: "pc" as const,
    name,
    baseUrl,
    path,
  };
}

function syncPcConnectionToLocalStorage(baseUrl: string, workspace: PcWorkspaceHandle | null) {
  localStorage.setItem(PC_SERVER_URL_STORAGE_KEY, baseUrl);
  if (workspace) {
    localStorage.setItem(PC_SERVER_URL_STORAGE_KEY, workspace.baseUrl);
    localStorage.setItem(PC_WORKSPACE_PATH_STORAGE_KEY, workspace.path);
    localStorage.setItem(PC_WORKSPACE_NAME_STORAGE_KEY, workspace.name);
    return;
  }
  localStorage.removeItem(PC_WORKSPACE_PATH_STORAGE_KEY);
  localStorage.removeItem(PC_WORKSPACE_NAME_STORAGE_KEY);
}

function inferChatSessionTitle(messages: ChatMessage[]) {
  const firstUserMessage = messages.find(
    (message) => message.role === "user" && !isHeartbeatCheckMessage(message),
  );
  const title = firstUserMessage?.content.trim().replace(/\s+/g, " ");
  if (title) return title.slice(0, 32);
  const firstAttachmentName = firstUserMessage?.attachments?.[0]?.name;
  return firstAttachmentName ? `文件：${firstAttachmentName}`.slice(0, 32) : "新会话";
}

function isHeartbeatCheckMessage(message: ChatMessage) {
  return message.source === "heartbeat" || message.content.trim().startsWith("【心跳检查】");
}

function isHeartbeatToolProgressMessage(message: ChatMessage) {
  const content = message.content.trim();
  if (message.role !== "assistant") return false;
  return (
    content === "更新当前会话心跳设置。" ||
    content.startsWith("心跳已更新：") ||
    content.startsWith("心跳将在本轮心跳完成后更新：") ||
    content.includes("chat_update_heartbeat")
  );
}

function isHeartbeatUiReminderMessage(message: ChatMessage) {
  return isHeartbeatCheckMessage(message) || isHeartbeatToolProgressMessage(message);
}

function isToolProgressStartLine(line: string) {
  const trimmedLine = line.trim();
  if (!trimmedLine) return false;
  if (trimmedLine.startsWith("执行 MCP 工具：")) return true;
  if (trimmedLine.startsWith("MCP 工具执行完成")) return true;
  if (trimmedLine.startsWith("MCP 工具失败：")) return true;
  if (trimmedLine.startsWith("操作失败：")) return true;
  if (toolActionTitleMap.some(([prefix]) => trimmedLine.startsWith(prefix))) return true;
  return Boolean(parseToolProgressContent(trimmedLine));
}

function isLikelyPlainNarrationLine(line: string) {
  const trimmedLine = line.trim();
  if (!trimmedLine) return false;
  if (/^[{[\]},\]"]/.test(trimmedLine)) return false;
  if (/^(参数|输出|错误输出|预览)：/.test(trimmedLine)) return false;
  if (/^[A-Za-z0-9_$.-]+:/.test(trimmedLine)) return false;
  if (/^[-*]\s/.test(trimmedLine)) return false;
  return /[\u4e00-\u9fff]/.test(trimmedLine);
}

function splitAssistantToolProgressSegments(content: string) {
  const rawLines = content.replace(/\r\n/g, "\n").split("\n");
  const segments: string[] = [];
  let currentLines: string[] = [];
  let currentKind: "text" | "tool" | null = null;

  const flush = () => {
    const segment = currentLines.join("\n").trim();
    if (segment) segments.push(segment);
    currentLines = [];
    currentKind = null;
  };

  for (const rawLine of rawLines) {
    const trimmedLine = rawLine.trim();
    const isToolStart = isToolProgressStartLine(trimmedLine);

    if (isToolStart) {
      flush();
      currentKind = "tool";
      currentLines.push(rawLine);
      continue;
    }

    if (
      currentKind === "tool" &&
      trimmedLine &&
      isLikelyPlainNarrationLine(trimmedLine) &&
      currentLines.some((line) => line.trim().startsWith("MCP 工具执行完成"))
    ) {
      flush();
      currentKind = "text";
      currentLines.push(rawLine);
      continue;
    }

    if (currentKind === null) {
      currentKind = "text";
    }
    currentLines.push(rawLine);
  }

  flush();

  if (segments.length <= 1) return [content];
  if (!segments.some((segment) => parseToolProgressContent(segment))) return [content];
  return segments;
}

function getChatMessageSegments(message: ChatMessage, splitShortChatLines = true) {
  const content = message.content.trim();
  if (!content) return [""];
  if (message.role !== "assistant") return [content];
  if (parseToolProgressContent(content)) return [content];
  if (content.includes("```")) return [content];

  const toolProgressSegments = splitAssistantToolProgressSegments(content);
  if (toolProgressSegments.length > 1) return toolProgressSegments;
  if (!splitShortChatLines) return [content];

  const lines = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1 || lines.length > 4) return [content];

  const hasMarkdownStructure = lines.some((line) =>
    /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|)/.test(line),
  );
  if (hasMarkdownStructure) return [content];

  const allShortChatLines = lines.every((line) => line.length <= 80);
  return allShortChatLines ? lines : [content];
}

function getRenderedChatSegments(messages: ChatMessage[], multiBubbleEnabled: boolean) {
  let previousTimestamp: number | null = null;

  return messages.flatMap((message) => {
    const timestamp = new Date(message.createdAt).getTime();
    const messageSegments =
      message.role === "assistant"
        ? getChatMessageSegments(message, multiBubbleEnabled)
        : multiBubbleEnabled
          ? getChatMessageSegments(message)
          : [message.content];

    return messageSegments.map((segment, segmentIndex) => {
      const showTime =
        previousTimestamp === null ||
        Math.abs(timestamp - previousTimestamp) >= CHAT_TIME_GROUP_MS;
      previousTimestamp = timestamp;

      return {
        id: `${message.id}-${segmentIndex}`,
        message,
        segment,
        segmentIndex,
        showTime,
      };
    });
  });
}

type RenderedChatSegment = ReturnType<typeof getRenderedChatSegments>[number];

type RenderedChatItem =
  | ({ kind: "segment" } & RenderedChatSegment)
  | {
      kind: "toolGroup";
      id: string;
      message: ChatMessage;
      segments: RenderedChatSegment[];
      blocks: ChatToolProgressBlock[];
      showTime: boolean;
      startedAt: string;
      endedAt: string;
    };

type ChatContentPart =
  | { type: "text"; content: string }
  | { type: "code"; content: string; language: string; executable: boolean };

type HtmlPreviewContext = {
  currentMessageIndex: number;
  messages: Array<{
    role: ChatRole;
    content: string;
    variables: Record<string, unknown>;
    extra: Record<string, unknown>;
  }>;
  chatVariables: Record<string, unknown>;
  characterVariables: Record<string, unknown>;
  globalVariables: Record<string, unknown>;
  userName: string;
  characterName: string;
  chatId: string;
  chatInput: string;
};

type ChatToolProgressLink = {
  label: string;
  href?: string;
};

type ChatToolProgressBlock = {
  variant: "action" | "success" | "error";
  title: string;
  badge: string;
  links: ChatToolProgressLink[];
  details: string[];
};

const executableCommandNames = new Set(["npm", "pnpm", "yarn", "node", "git"]);
const shellLanguages = new Set(["sh", "shell", "bash", "zsh", "cmd", "bat", "powershell", "ps1"]);
const htmlLanguages = new Set(["html", "htm", "xhtml"]);
const HTML_PREVIEW_RESIZE_MESSAGE = "renge-html-preview-resize";
const HTML_PREVIEW_VARIABLES_UPDATE_MESSAGE = "renge-html-preview-variables-update";
const HTML_PREVIEW_CONTEXT_UPDATE_MESSAGE = "renge-html-preview-context-update";
const HTML_PREVIEW_COMMAND_MESSAGE = "renge-html-preview-command";
const HTML_PREVIEW_COMMAND_RESULT_MESSAGE = "renge-html-preview-command-result";
const HYPNOOS_APPEND_OPERATION_MESSAGE = "HYPNOOS_APPEND_OPERATION";
const HTML_PREVIEW_MAX_HEIGHT = 12000;

type ParsedTavernSlashCommand =
  | { type: "set-input"; text: string; append: boolean; submit: boolean }
  | { type: "send-as"; text: string; name: string }
  | { type: "trigger" };

function parseTavernSlashCommand(command: string): ParsedTavernSlashCommand | null {
  const normalized = command.trim();
  if (!normalized) return null;
  const parts = normalized.split(/\s*\|\s*(?=\/)/);
  const primary = parts.shift()?.trim() ?? "";
  const hasTrigger = parts.some((part) => /^\/(?:trigger|gen)\b/i.test(part.trim()));

  const sendAsMatch = /^\/sendas\b\s*([\s\S]*)$/i.exec(primary);
  if (sendAsMatch) {
    let remainder = sendAsMatch[1].trim();
    let name = "";
    const nameMatch = /^name=(?:"([^"]*)"|'([^']*)'|(\S+))\s*/i.exec(remainder);
    if (nameMatch) {
      name = nameMatch[1] ?? nameMatch[2] ?? nameMatch[3] ?? "";
      remainder = remainder.slice(nameMatch[0].length);
    }
    return remainder ? { type: "send-as", text: remainder, name } : null;
  }

  const setInputMatch = /^\/setinput(?:\s+([\s\S]*))?$/i.exec(primary);
  if (setInputMatch) {
    return {
      type: "set-input",
      text: setInputMatch[1] ?? "",
      append: false,
      submit: hasTrigger,
    };
  }

  const appendInputMatch = /^\/appendinput(?:\s+([\s\S]*))?$/i.exec(primary);
  if (appendInputMatch) {
    return {
      type: "set-input",
      text: appendInputMatch[1] ?? "",
      append: true,
      submit: hasTrigger,
    };
  }

  const sendMatch = /^\/send(?:\s+([\s\S]*))?$/i.exec(primary);
  if (sendMatch) {
    return {
      type: "set-input",
      text: sendMatch[1] ?? "",
      append: false,
      submit: true,
    };
  }

  if (/^\/(?:trigger|gen)\b/i.test(primary)) return { type: "trigger" };
  return null;
}
const htmlPreviewStyle = [
  '<style data-renge-html-preview="true">',
  "html,body{overflow:hidden!important;}",
  "body{box-sizing:border-box;}",
  "</style>",
].join("");
const htmlPreviewJqueryScript = [
  '<script data-renge-html-preview-jquery="true">',
  jquerySource.replace(/<\/script/gi, "<\\/script"),
  "</script>",
].join("");
const htmlPreviewBootstrapScript = [
  '<script data-renge-html-preview-bootstrap="true">',
  "(() => {",
  "const createMemoryStorage = () => {",
  "  const store = new Map();",
  "  return {",
  "    get length() { return store.size; },",
  "    key(index) { return Array.from(store.keys())[index] ?? null; },",
  "    getItem(key) { key = String(key); return store.has(key) ? store.get(key) : null; },",
  "    setItem(key, value) { store.set(String(key), String(value)); },",
  "    removeItem(key) { store.delete(String(key)); },",
  "    clear() { store.clear(); },",
  "  };",
  "};",
  "const installStorage = (name) => {",
  "  try {",
  "    const storage = window[name];",
  '    const testKey = "__renge_html_preview_storage_test__";',
  '    storage.setItem(testKey, "1");',
  "    storage.removeItem(testKey);",
  "  } catch {",
  "    try {",
  "      Object.defineProperty(window, name, {",
  "        value: createMemoryStorage(),",
  "        configurable: true,",
  "      });",
  "    } catch {}",
  "  }",
  "};",
  'installStorage("localStorage");',
  'installStorage("sessionStorage");',
  "const installDollarLoadCompatibility = () => {",
  '  if (typeof window.$ === "function") return;',
  "  const getTarget = (selector) => {",
  '    if (selector === window || selector === document) return document.body;',
  '    if (typeof Element !== "undefined" && selector instanceof Element) return selector;',
  '    if (typeof selector === "string") {',
  "      try { return document.querySelector(selector); } catch { return null; }",
  "    }",
  "    return null;",
  "  };",
  "  const copyAttributes = (source, target, excluded = new Set()) => {",
  "    Array.from(source.attributes || []).forEach((attribute) => {",
  "      if (!excluded.has(attribute.name)) target.setAttribute(attribute.name, attribute.value);",
  "    });",
  "  };",
  "  const activateScript = (source, destination) => new Promise((resolve) => {",
  '    const script = document.createElement("script");',
  '    copyAttributes(source, script, new Set(["data-renge-remote-script-index"]));',
  '    script.setAttribute("data-renge-remote-load", "true");',
  "    const waitsForLoad = Boolean(script.src) || String(script.type).toLowerCase() === \"module\";",
  "    if (waitsForLoad) {",
  '      script.addEventListener("load", () => resolve(), { once: true });',
  '      script.addEventListener("error", () => resolve(), { once: true });',
  "    }",
  "    script.textContent = source.textContent || \"\";",
  "    if (destination?.parentNode) destination.parentNode.replaceChild(script, destination);",
  "    else document.head.appendChild(script);",
  "    if (!waitsForLoad) resolve();",
  "  });",
  "  const installRemoteDocument = async (target, html, responseUrl) => {",
  "    const parsed = new DOMParser().parseFromString(html, \"text/html\");",
  '    document.head.querySelectorAll("[data-renge-remote-load]").forEach((node) => node.remove());',
  '    const base = document.createElement("base");',
  "    base.href = responseUrl;",
  '    base.setAttribute("data-renge-remote-load", "true");',
  "    document.head.appendChild(base);",
  "    Array.from(parsed.documentElement?.attributes || []).forEach((attribute) => {",
  "      if (attribute.name !== \"class\" && attribute.name !== \"style\") return;",
  "      document.documentElement.setAttribute(attribute.name, attribute.value);",
  "    });",
  "    Array.from(parsed.body?.attributes || []).forEach((attribute) => {",
  "      target.setAttribute(attribute.name, attribute.value);",
  "    });",
  "    const headScripts = [];",
  "    Array.from(parsed.head?.childNodes || []).forEach((node) => {",
  '      if (node.nodeType === 1 && node.tagName?.toLowerCase() === "script") {',
  "        headScripts.push(node);",
  "        return;",
  "      }",
  "      const clone = node.cloneNode(true);",
  '      if (clone.nodeType === 1) clone.setAttribute("data-renge-remote-load", "true");',
  "      document.head.appendChild(clone);",
  "    });",
  "    const bodyScripts = Array.from(parsed.body?.querySelectorAll(\"script\") || []);",
  "    bodyScripts.forEach((script, index) => {",
  '      script.setAttribute("data-renge-remote-script-index", String(index));',
  "    });",
  "    const bodyClone = parsed.body?.cloneNode(true);",
  "    target.replaceChildren(...Array.from(bodyClone?.childNodes || []));",
  "    for (const script of headScripts) await activateScript(script, null);",
  "    for (let index = 0; index < bodyScripts.length; index += 1) {",
  '      const inertScript = target.querySelector(`script[data-renge-remote-script-index="${index}"]`);',
  "      await activateScript(bodyScripts[index], inertScript);",
  "    }",
  "    window.dispatchEvent(new Event(\"load\"));",
  "  };",
  "  const dollar = (selector) => {",
  "    const target = getTarget(selector);",
  "    return {",
  "      0: target,",
  "      length: target ? 1 : 0,",
  "      load(resource, data, complete) {",
  "        if (typeof data === \"function\") { complete = data; data = undefined; }",
  "        const remoteUrl = String(resource || \"\").trim().split(/\\s+/)[0];",
  "        if (!target || !remoteUrl) return this;",
  "        void fetch(remoteUrl, { mode: \"cors\", credentials: \"omit\" })",
  "          .then(async (response) => {",
  "            if (!response.ok) throw new Error(`HTTP ${response.status}`);",
  "            const responseText = await response.text();",
  "            await installRemoteDocument(target, responseText, response.url || remoteUrl);",
  "            if (typeof complete === \"function\") complete.call(target, responseText, \"success\", response);",
  "          })",
  "          .catch((error) => {",
  '            target.innerHTML = `<div style="box-sizing:border-box;margin:16px;padding:14px;border:1px solid #f0b7b7;border-radius:10px;background:#fff5f5;color:#9f2424;font:13px/1.6 system-ui,sans-serif"><strong>远程 HTML 加载失败</strong><br>${String(error?.message || error)}</div>`;',
  "            if (typeof complete === \"function\") complete.call(target, \"\", \"error\", error);",
  "          });",
  "        return this;",
  "      },",
  "    };",
  "  };",
  '  dollar.__rengeLoadCompatibility = true;',
  '  window.$ = window.jQuery = dollar;',
  "};",
  "installDollarLoadCompatibility();",
  'window.addEventListener("pointerdown", () => { try { window.focus(); } catch {} }, true);',
  'window.addEventListener("touchstart", () => { try { window.focus(); } catch {} }, true);',
  "})();",
  "</script>",
].join("");

function serializeHtmlPreviewValue(value: unknown) {
  return (JSON.stringify(value) ?? "null")
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function buildHtmlPreviewVariablesScript(previewId: string, context: HtmlPreviewContext) {
  const previewIdLiteral = serializeHtmlPreviewValue(previewId);
  const messageTypeLiteral = serializeHtmlPreviewValue(HTML_PREVIEW_VARIABLES_UPDATE_MESSAGE);
  const contextMessageTypeLiteral = serializeHtmlPreviewValue(
    HTML_PREVIEW_CONTEXT_UPDATE_MESSAGE,
  );
  const commandMessageTypeLiteral = serializeHtmlPreviewValue(HTML_PREVIEW_COMMAND_MESSAGE);
  const commandResultMessageTypeLiteral = serializeHtmlPreviewValue(
    HTML_PREVIEW_COMMAND_RESULT_MESSAGE,
  );
  const contextLiteral = serializeHtmlPreviewValue(context);

  return [
    '<script data-renge-html-preview-variables="true">',
    "(() => {",
    `const previewId = ${previewIdLiteral};`,
    `const updateMessageType = ${messageTypeLiteral};`,
    `const contextUpdateMessageType = ${contextMessageTypeLiteral};`,
    `const commandMessageType = ${commandMessageTypeLiteral};`,
    `const commandResultMessageType = ${commandResultMessageTypeLiteral};`,
    `const snapshot = ${contextLiteral};`,
    "const clone = (value) => {",
    "  if (value == null) return value;",
    "  try { return structuredClone(value); } catch {}",
    "  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }",
    "};",
    "const isRecord = (value) => Boolean(value) && typeof value === \"object\" && !Array.isArray(value);",
    "const lodashCompat = window._ && (typeof window._ === \"object\" || typeof window._ === \"function\") ? window._ : {};",
    "if (typeof lodashCompat.get !== \"function\") {",
    "  lodashCompat.get = (source, path, fallback) => {",
    "    const segments = Array.isArray(path) ? path : String(path ?? \"\").replace(/\\[([^\\]]+)\\]/g, \".$1\").split(\".\");",
    "    let current = source;",
    "    for (const rawSegment of segments) {",
    "      const segment = String(rawSegment).trim().replace(/^['\\\"]|['\\\"]$/g, \"\");",
    "      if (!segment) continue;",
    "      if (current == null || !(segment in Object(current))) return fallback;",
    "      current = current[segment];",
    "    }",
    "    return current === undefined ? fallback : current;",
    "  };",
    "}",
    "window._ = lodashCompat;",
    "const bridgeEventHandlers = new Map();",
    "const pendingCommandRequests = new Map();",
    "let commandRequestSequence = 0;",
    "const eventOn = (eventName, callback) => {",
    "  if (typeof callback !== \"function\") return callback;",
    "  const key = String(eventName);",
    "  const callbacks = bridgeEventHandlers.get(key) || new Set();",
    "  callbacks.add(callback);",
    "  bridgeEventHandlers.set(key, callbacks);",
    "  return callback;",
    "};",
    "const eventRemoveListener = (eventName, callback) => {",
    "  const callbacks = bridgeEventHandlers.get(String(eventName));",
    "  if (!callbacks) return false;",
    "  callbacks.delete(callback);",
    "  if (callbacks.size === 0) bridgeEventHandlers.delete(String(eventName));",
    "  return true;",
    "};",
    "const eventOnce = (eventName, callback) => {",
    "  if (typeof callback !== \"function\") return callback;",
    "  const once = (...args) => { eventRemoveListener(eventName, once); return callback(...args); };",
    "  eventOn(eventName, once);",
    "  return once;",
    "};",
    "const eventEmit = async (eventName, ...args) => {",
    "  const callbacks = Array.from(bridgeEventHandlers.get(String(eventName)) || []);",
    "  for (const callback of callbacks) await callback(...args);",
    "  return callbacks.length > 0;",
    "};",
    "const emitVariableUpdate = () => void eventEmit(String(window.Mvu?.events?.VARIABLE_UPDATE_ENDED || \"mag_variable_update_ended\"), clone(snapshot));",
    "window.addEventListener(\"message\", (event) => {",
    "  if (event.source !== parent || !isRecord(event.data)) return;",
    "  if (event.data.type === commandResultMessageType && event.data.id === previewId) {",
    "    const pending = pendingCommandRequests.get(String(event.data.requestId));",
    "    if (!pending) return;",
    "    pendingCommandRequests.delete(String(event.data.requestId));",
    "    clearTimeout(pending.timeoutId);",
    "    if (event.data.error) pending.reject(new Error(String(event.data.error)));",
    "    else pending.resolve(clone(event.data.result));",
    "    return;",
    "  }",
    "  if (event.data.type !== contextUpdateMessageType || event.data.id !== previewId) return;",
    "  if (!isRecord(event.data.context)) return;",
    "  Object.assign(snapshot, clone(event.data.context));",
    "  emitVariableUpdate();",
    "  try { window.dispatchEvent(new CustomEvent(\"renge-html-preview-context-updated\", { detail: clone(snapshot) })); } catch {}",
    "});",
    "const requestParentCommand = (operation, data = {}) => new Promise((resolve, reject) => {",
    "  const requestId = `${previewId}:${Date.now()}:${++commandRequestSequence}`;",
    "  const timeoutId = setTimeout(() => {",
    "    pendingCommandRequests.delete(requestId);",
    "    reject(new Error(`Renge 命令执行超时：${String(operation)}`));",
    "  }, 15000);",
    "  pendingCommandRequests.set(requestId, { resolve, reject, timeoutId });",
    "  try {",
    "    parent.postMessage({ type: commandMessageType, id: previewId, requestId, operation, ...clone(data) }, \"*\");",
    "  } catch (error) {",
    "    clearTimeout(timeoutId);",
    "    pendingCommandRequests.delete(requestId);",
    "    reject(error);",
    "  }",
    "});",
    "const normalizeMessageId = (value, defaultToCurrent = true) => {",
    "  if (value == null || value === \"current\") return defaultToCurrent ? snapshot.currentMessageIndex : snapshot.messages.length - 1;",
    "  if (value === \"latest\") return snapshot.messages.length - 1;",
    "  const parsed = Number(value);",
    "  if (!Number.isInteger(parsed)) return defaultToCurrent ? snapshot.currentMessageIndex : snapshot.messages.length - 1;",
    "  return parsed < 0 ? snapshot.messages.length + parsed : parsed;",
    "};",
    "const normalizeVariableOption = (option) => {",
    "  if (isRecord(option)) return option;",
    "  if (typeof option === \"number\" || typeof option === \"string\") return { type: \"message\", message_id: option };",
    "  return { type: \"message\", message_id: snapshot.currentMessageIndex };",
    "};",
    "const resolveVariables = (option) => {",
    "  const normalized = normalizeVariableOption(option);",
    "  const type = String(normalized.type || \"message\").toLowerCase();",
    "  if (type === \"global\") return snapshot.globalVariables;",
    "  if (type === \"chat\") return snapshot.chatVariables;",
    "  if (type === \"character\" || type === \"char\") return snapshot.characterVariables;",
    "  const index = normalizeMessageId(normalized.message_id, true);",
    "  return snapshot.messages[index]?.variables || {};",
    "};",
    "const assignVariables = (variables, option) => {",
    "  const normalized = normalizeVariableOption(option);",
    "  const type = String(normalized.type || \"message\").toLowerCase();",
    "  const next = isRecord(variables) ? clone(variables) : {};",
    "  if (type === \"global\") snapshot.globalVariables = next;",
    "  else if (type === \"chat\") snapshot.chatVariables = next;",
    "  else if (type === \"character\" || type === \"char\") snapshot.characterVariables = next;",
    "  else {",
    "    const index = normalizeMessageId(normalized.message_id, true);",
    "    if (snapshot.messages[index]) snapshot.messages[index].variables = next;",
    "  }",
    "  emitVariableUpdate();",
    "  try {",
    "    parent.postMessage({",
    "      type: updateMessageType,",
    "      id: previewId,",
    "      operation: \"replaceVariables\",",
    "      option: clone(normalized),",
    "      variables: clone(next),",
    "    }, \"*\");",
    "  } catch {}",
    "  return clone(next);",
    "};",
    "const getVariables = (option) => clone(resolveVariables(option) || {});",
    "const replaceVariables = async (variables, option) => assignVariables(variables, option);",
    "const updateVariablesWith = async (updater, option) => {",
    "  const current = getVariables(option);",
    "  let next = current;",
    "  if (typeof updater === \"function\") {",
    "    const result = await updater(current);",
    "    if (isRecord(result)) next = result;",
    "  } else if (isRecord(updater)) next = { ...current, ...clone(updater) };",
    "  return assignVariables(next, option);",
    "};",
    "const insertOrAssignVariables = async (variables, option) => {",
    "  const current = getVariables(option);",
    "  return assignVariables(isRecord(variables) ? { ...current, ...clone(variables) } : current, option);",
    "};",
    "const formatMessage = (message, index, sillyTavern = false) => {",
    "  const variables = clone(message.variables || {});",
    "  const extra = clone(message.extra || {});",
    "  return {",
    "    message_id: index, mesid: index, id: index,",
    "    name: message.role === \"user\" ? snapshot.userName : snapshot.characterName,",
    "    role: message.role, is_user: message.role === \"user\", is_system: false, is_hidden: false,",
    "    message: message.content, mes: message.content, data: variables,",
    "    variables: sillyTavern ? [clone(variables)] : variables, extra, swipe_id: 0,",
    "    swipes: [message.content], swipes_data: [clone(variables)], swipes_info: [clone(extra)],",
    "  };",
    "};",
    "const getChatMessages = (range = null, options = {}) => {",
    "  const formatted = snapshot.messages.map((message, index) => formatMessage(message, index));",
    "  const filter = (items) => !isRecord(options) || options.role == null || options.role === \"all\"",
    "    ? items : items.filter((item) => item.role === options.role);",
    "  if (range == null || range === \"\") return filter(formatted);",
    "  if (typeof range === \"number\" || /^-?\\d+$/.test(String(range).trim())) {",
    "    const index = normalizeMessageId(range, false);",
    "    return filter(formatted[index] ? [formatted[index]] : []);",
    "  }",
    "  const match = /^(-?\\d+)\\s*-\\s*(-?\\d+)$/.exec(String(range).trim());",
    "  if (!match) return [];",
    "  const start = normalizeMessageId(match[1], false);",
    "  const end = normalizeMessageId(match[2], false);",
    "  return filter(formatted.slice(Math.max(0, start), Math.max(0, end) + 1));",
    "};",
    "const applyMessageUpdates = (updates) => {",
    "  if (!Array.isArray(updates)) return false;",
    "  updates.forEach((update) => {",
    "    if (!isRecord(update)) return;",
    "    const index = normalizeMessageId(update.message_id, false);",
    "    const message = snapshot.messages[index];",
    "    if (!message) return;",
    "    if (typeof update.message === \"string\") message.content = update.message;",
    "    else if (typeof update.content === \"string\") message.content = update.content;",
    "    const swipeIndex = Number.isInteger(Number(update.swipe_id)) ? Math.max(0, Number(update.swipe_id)) : 0;",
    "    if (Array.isArray(update.swipes) && typeof update.swipes[swipeIndex] === \"string\") message.content = update.swipes[swipeIndex];",
    "    if (update.role === \"user\" || update.role === \"assistant\") message.role = update.role;",
    "    if (isRecord(update.data)) message.variables = clone(update.data);",
    "    else if (Array.isArray(update.swipes_data) && isRecord(update.swipes_data[swipeIndex])) message.variables = clone(update.swipes_data[swipeIndex]);",
    "    else if (Array.isArray(update.variables) && isRecord(update.variables[swipeIndex])) message.variables = clone(update.variables[swipeIndex]);",
    "    else if (isRecord(update.variables)) message.variables = clone(update.variables);",
    "    if (isRecord(update.extra)) message.extra = clone(update.extra);",
    "    else if (Array.isArray(update.swipes_info) && isRecord(update.swipes_info[swipeIndex])) message.extra = clone(update.swipes_info[swipeIndex]);",
    "  });",
    "  return true;",
    "};",
    "const setChatMessages = async (updates) => {",
    "  if (!applyMessageUpdates(updates)) return false;",
    "  try { parent.postMessage({ type: updateMessageType, id: previewId, operation: \"setChatMessages\", updates: clone(updates) }, \"*\"); } catch {}",
    "  return true;",
    "};",
    "const getAllVariables = () => {",
    "  const messageVariables = snapshot.messages",
    "    .slice(0, Math.max(0, snapshot.currentMessageIndex) + 1)",
    "    .map((message) => message?.variables)",
    "    .filter(isRecord);",
    "  return clone(Object.assign(",
    "    {},",
    "    isRecord(snapshot.globalVariables) ? snapshot.globalVariables : {},",
    "    isRecord(snapshot.characterVariables) ? snapshot.characterVariables : {},",
    "    isRecord(snapshot.chatVariables) ? snapshot.chatVariables : {},",
    "    ...messageVariables,",
    "  ));",
    "};",
    "const waitGlobalInitialized = (globalName = \"Mvu\", timeout = 30000) => new Promise((resolve, reject) => {",
    "  const startedAt = Date.now();",
    "  const check = () => {",
    "    const value = window[String(globalName)];",
    "    if (value != null) { resolve(value); return; }",
    "    if (Date.now() - startedAt >= Math.max(0, Number(timeout) || 0)) {",
    "      reject(new Error(`等待 ${String(globalName)} 初始化超时`));",
    "      return;",
    "    }",
    "    setTimeout(check, 25);",
    "  };",
    "  check();",
    "});",
    "const errorCatched = (callback) => async (...args) => {",
    "  try { return await callback(...args); }",
    "  catch (error) { console.error(\"[TavernHelper] HTML 脚本执行失败\", error); return null; }",
    "};",
    "const getInput = () => String(snapshot.chatInput ?? \"\");",
    "const setInput = async (text) => {",
    "  snapshot.chatInput = String(text ?? \"\");",
    "  return requestParentCommand(\"setInput\", { text: snapshot.chatInput });",
    "};",
    "const appendInput = async (text) => {",
    "  const value = String(text ?? \"\");",
    "  snapshot.chatInput = `${getInput()}${value}`;",
    "  return requestParentCommand(\"appendInput\", { text: value });",
    "};",
    "const triggerSlash = (command) => requestParentCommand(\"triggerSlash\", { command: String(command ?? \"\") });",
    "const sendMessage = (text = getInput()) => requestParentCommand(\"send\", { text: String(text ?? \"\") });",
    "const generate = (config = {}) => {",
    "  const text = isRecord(config) ? String(config.user_input ?? config.prompt ?? getInput()) : String(config ?? getInput());",
    "  return requestParentCommand(\"send\", { text });",
    "};",
    "const getContext = () => ({",
    "  chat: snapshot.messages.map((message, index) => formatMessage(message, index, true)),",
    "  characters: [], characterId: snapshot.characterName ? \"0\" : undefined,",
    "  name1: snapshot.userName, name2: snapshot.characterName, chatId: snapshot.chatId,",
    "  saveChat: async () => true, getRequestHeaders: () => ({ \"Content-Type\": \"application/json\" }),",
    "});",
    "const api = {",
    "  getVariables, setVariables: replaceVariables, replaceVariables, updateVariablesWith, insertOrAssignVariables,",
    "  getAllVariables, waitGlobalInitialized, errorCatched,",
    "  getInput, setInput, appendInput, triggerSlash, sendMessage, generate,",
    "  getCurrentMessageId: () => snapshot.currentMessageIndex,",
    "  getLastMessageId: () => snapshot.messages.length - 1,",
    "  getChatMessages, setChatMessages, getContext, eventOn, eventOnce, eventEmit, eventRemoveListener,",
    "};",
    "Object.assign(window, api);",
    "window.getCurrentMessage = () => getChatMessages(snapshot.currentMessageIndex)[0] || null;",
    "window.setChatMessage = async (messageOrId, idOrContent) => isRecord(messageOrId)",
    "  ? setChatMessages([{ ...clone(messageOrId), message_id: idOrContent }])",
    "  : setChatMessages([{ message_id: messageOrId, message: String(idOrContent ?? \"\") }]);",
    "window.TavernHelper = window.tavernHelper = window.tavernHelperAPI = window.th = api;",
    "const sillyTavern = { version: \"3.5.0\", getContext, getCurrentChatId: () => snapshot.chatId, saveChat: async () => true };",
    "Object.defineProperties(sillyTavern, {",
    "  chat: { get: () => snapshot.messages.map((message, index) => formatMessage(message, index, true)), configurable: true },",
    "  name1: { get: () => snapshot.userName, configurable: true },",
    "  name2: { get: () => snapshot.characterName, configurable: true },",
    "});",
    "window.SillyTavern = sillyTavern;",
    "const mvu = isRecord(window.Mvu) ? window.Mvu : {};",
    "mvu.events = isRecord(mvu.events) ? mvu.events : {};",
    "mvu.events.VARIABLE_INITIALIZED ||= \"mag_variable_initialized\";",
    "mvu.events.VARIABLE_UPDATE_ENDED ||= \"mag_variable_update_ended\";",
    "mvu.getMvuData = (option) => getVariables(option);",
    "mvu.setMvuData = (variables, option) => replaceVariables(variables, option);",
    "window.Mvu = mvu;",
    "})();",
    "</script>",
  ].join("");
}
const toolActionTitleMap: Array<[string, string]> = [
  ["列出文件", "列出文件"],
  ["预览电脑图片", "预览图片"],
  ["读取二进制文件", "读取二进制"],
  ["读取文件片段", "读取文件片段"],
  ["读取文件", "读取文件"],
  ["查看路径信息", "查看路径信息"],
  ["搜索文件", "搜索文件"],
  ["创建目录", "创建目录"],
  ["重命名/移动", "重命名/移动"],
  ["运行脚本", "运行脚本"],
  ["运行命令", "运行命令"],
  ["查看 Git 状态", "查看 Git 状态"],
  ["查看 Git diff", "查看 Git diff"],
  ["检测项目技术栈", "检测项目技术栈"],
  ["查找符号", "查找符号"],
  ["正则搜索", "正则搜索"],
  ["读取 package.json", "读取 package.json"],
  ["扫描 TODO/FIXME", "扫描 TODO/FIXME"],
  ["写入文件", "写入文件"],
  ["写入二进制文件", "写入二进制"],
  ["上传附件直传电脑", "附件直传"],
  ["手机传到电脑", "文件直传"],
  ["电脑传到手机", "文件直传"],
  ["发送电脑文件给用户", "发送文件"],
  ["修改文件", "修改文件"],
  ["删除路径", "删除路径"],
];

function getCommandName(line: string) {
  return line.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

function isRunnableCommandLine(line: string) {
  const trimmedLine = line.trim();
  if (!trimmedLine || trimmedLine.startsWith("#") || trimmedLine.startsWith("//")) return false;
  return executableCommandNames.has(getCommandName(trimmedLine));
}

function getExecutableLines(content: string) {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"));
}

function isExecutableCommandBlock(content: string) {
  const lines = getExecutableLines(content);
  return lines.length > 0 && lines.every(isRunnableCommandLine);
}

function isStandaloneCodeLine(line: string) {
  const trimmedLine = line.trim();
  if (!trimmedLine || trimmedLine.length > 180) return false;
  if (isRunnableCommandLine(trimmedLine)) return true;

  return (
    /^(const|let|var|function|async function|return|await|import|export|if|for|while|switch)\b/.test(trimmedLine) ||
    /^[A-Za-z_$][\w$]*\([^)]*\);?$/.test(trimmedLine) ||
    /^[\w$.]+\([^)]*\);?$/.test(trimmedLine) ||
    /^[\w$.]+\([^)]*$/.test(trimmedLine)
  );
}

function appendTextPart(parts: ChatContentPart[], content: string) {
  if (!content) return;
  const previousPart = parts[parts.length - 1];
  if (previousPart?.type === "text") {
    previousPart.content += content;
    return;
  }
  parts.push({ type: "text", content });
}

function parseMarkdownLinks(content: string) {
  const links: ChatToolProgressLink[] = [];
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(content))) {
    links.push({
      label: match[1],
      href: match[2],
    });
  }

  return links;
}

function stripMarkdownLinks(content: string) {
  return content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

function uniqueToolLinks(links: ChatToolProgressLink[]) {
  const seenLinks = new Set<string>();
  return links.filter((link) => {
    const key = `${link.label}\n${link.href ?? ""}`;
    if (seenLinks.has(key)) return false;
    seenLinks.add(key);
    return true;
  });
}

function isLikelyToolPath(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue || trimmedValue.length > 180) return false;
  if (trimmedValue === ".") return true;
  return /[\\/]/.test(trimmedValue) || /\.[A-Za-z0-9]{1,12}$/.test(trimmedValue);
}

function parseToolPathFromLine(line: string) {
  const normalizedLine = stripMarkdownLinks(line).trim();
  const colonValue = normalizedLine.includes("：")
    ? normalizedLine.slice(normalizedLine.indexOf("：") + 1).trim()
    : "";
  const candidates = [
    colonValue,
    normalizedLine.replace(/^已修改\s+/, "").split(/[，(（]/)[0]?.trim() ?? "",
    normalizedLine.replace(/^已删除路径：/, "").trim(),
    normalizedLine.replace(/^已创建目录：/, "").trim(),
    normalizedLine.replace(/^已写入文件：/, "").trim(),
    normalizedLine.replace(/^已写入二进制文件：/, "").split(/[，(（]/)[0]?.trim() ?? "",
    normalizedLine.replace(/^已读取二进制文件：/, "").split(/[，(（]/)[0]?.trim() ?? "",
    normalizedLine.replace(/^已生成图片预览：/, "").split(/[，(（]/)[0]?.trim() ?? "",
    normalizedLine.replace(/^已读取文件：/, "").split(/[，(（]/)[0]?.trim() ?? "",
  ];
  return candidates.find(isLikelyToolPath) ?? "";
}

function parseToolProgressContent(content: string): ChatToolProgressBlock | null {
  const lines = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const firstLine = lines[0];
  const links = uniqueToolLinks(parseMarkdownLinks(content));
  const details = lines
    .map(stripMarkdownLinks)
    .map((line) => line.trim())
    .filter(Boolean);

  if (firstLine.startsWith("执行 MCP 工具：")) {
    const toolLabel = firstLine.replace("执行 MCP 工具：", "").trim();
    return {
      variant: "action",
      title: "MCP 工具",
      badge: "执行中",
      links: toolLabel ? [{ label: toolLabel }] : links,
      details: details.slice(1),
    };
  }

  if (firstLine.startsWith("MCP 工具失败：")) {
    const toolLabel = firstLine.replace("MCP 工具失败：", "").trim();
    return {
      variant: "error",
      title: "MCP 工具失败",
      badge: "失败",
      links: toolLabel ? [{ label: toolLabel }] : links,
      details: details.slice(1),
    };
  }

  if (firstLine.startsWith("操作失败：")) {
    return {
      variant: "error",
      title: firstLine.replace("操作失败：", "操作失败"),
      badge: "失败",
      links,
      details: details.slice(1),
    };
  }

  const actionTitle = toolActionTitleMap.find(([prefix]) => firstLine.startsWith(prefix))?.[1];
  if (actionTitle) {
    const inlineDetail = firstLine.includes("：")
      ? stripMarkdownLinks(firstLine.slice(firstLine.indexOf("：") + 1)).trim()
      : "";
    const actionDetails = [
      inlineDetail && inlineDetail !== actionTitle ? inlineDetail : "",
      ...details.slice(1),
    ].filter(Boolean);

    return {
      variant: "action",
      title: actionTitle,
      badge: "执行中",
      links,
      details: actionDetails,
    };
  }

  let title = "";
  if (/^列出 \d+ 个条目。?$/.test(firstLine)) title = "列出文件";
  else if (/^找到 \d+ 条结果。?$/.test(firstLine)) title = "搜索结果";
  else if (firstLine.startsWith("已生成图片预览：")) title = "预览图片";
  else if (firstLine.startsWith("已读取二进制文件：")) title = "读取二进制";
  else if (firstLine.startsWith("已写入二进制文件：")) title = "写入二进制";
  else if (firstLine.startsWith("附件直传完成：")) title = "附件直传";
  else if (firstLine.startsWith("文件直传完成：")) title = "文件直传";
  else if (firstLine.startsWith("已读取文件：") || /^已读取 .+ 第 /.test(firstLine)) title = "读取文件";
  else if (firstLine.startsWith("已查看路径信息：")) title = "查看路径信息";
  else if (firstLine.startsWith("已创建目录：")) title = "创建目录";
  else if (firstLine.startsWith("已重命名/移动：")) title = "重命名/移动";
  else if (firstLine.startsWith("已写入文件：")) title = "写入文件";
  else if (firstLine.startsWith("编辑了 ")) title = "修改文件";
  else if (firstLine.startsWith("已删除路径：")) title = "删除路径";
  else if (firstLine.startsWith("脚本执行完成：")) title = "运行脚本";
  else if (firstLine.startsWith("命令执行完成：")) title = "运行命令";
  else if (firstLine.startsWith("命令执行失败")) title = "运行命令";
  else if (firstLine.startsWith("用户取消授权")) title = "运行命令";
  else if (firstLine.startsWith("Git 状态读取完成")) title = "Git 状态";
  else if (firstLine.startsWith("Git diff 读取完成")) title = "Git diff";
  else if (firstLine.startsWith("技术栈检测完成：")) title = "技术栈检测";
  else if (firstLine.startsWith("已读取 package.json")) title = "读取 package.json";
  else if (firstLine.startsWith("MCP 工具执行完成")) title = "MCP 工具";

  if (!title) return null;

  const inferredLinks = lines
    .map(parseToolPathFromLine)
    .filter(Boolean)
    .map((label) => ({ label }));

  return {
    variant: firstLine.startsWith("命令执行失败") || firstLine.startsWith("用户取消授权")
      ? "error"
      : "success",
    title,
    badge: firstLine.startsWith("命令执行失败") ? "失败" : "完成",
    links: uniqueToolLinks([...links, ...inferredLinks]),
    details,
  };
}

function formatProcessingDuration(startedAt: string, endedAt: string) {
  const startedTime = new Date(startedAt).getTime();
  const endedTime = new Date(endedAt).getTime();
  const totalSeconds = Math.max(0, Math.round((endedTime - startedTime) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function getRenderedChatItems(
  messages: ChatMessage[],
  multiBubbleEnabled: boolean,
): RenderedChatItem[] {
  const segments = getRenderedChatSegments(messages, multiBubbleEnabled);
  const items: RenderedChatItem[] = [];
  let toolGroup:
    | Extract<RenderedChatItem, { kind: "toolGroup" }>
    | null = null;

  const flushToolGroup = () => {
    if (!toolGroup) return;
    items.push(toolGroup);
    toolGroup = null;
  };

  for (const segment of segments) {
    const toolBlock =
      segment.message.role === "assistant" ? parseToolProgressContent(segment.segment) : null;

    if (!toolBlock) {
      flushToolGroup();
      items.push({ kind: "segment", ...segment });
      continue;
    }

    if (!toolGroup) {
      toolGroup = {
        kind: "toolGroup",
        id: `tool-group-${segment.id}`,
        message: segment.message,
        segments: [segment],
        blocks: [toolBlock],
        showTime: segment.showTime,
        startedAt: segment.message.createdAt,
        endedAt: segment.message.createdAt,
      };
      continue;
    }

    toolGroup.segments.push(segment);
    toolGroup.blocks.push(toolBlock);
    toolGroup.endedAt = segment.message.createdAt;
  }

  flushToolGroup();
  return items;
}

function stripHiddenImageAnnotations(content: string) {
  return content.replace(/\n*<!--\s*(?:local-image-path|source-url)\s*:[\s\S]*?-->\s*/gi, "\n");
}

type PlainChatHtmlSegment = { type: "text" | "html"; content: string };

const htmlBlockRootTags = new Set([
  "html",
  "head",
  "body",
  "style",
  "script",
  "div",
  "section",
  "article",
  "main",
  "aside",
  "header",
  "footer",
  "nav",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "ul",
  "ol",
  "pre",
  "blockquote",
  "form",
  "figure",
  "details",
  "summary",
  "dialog",
  "svg",
  "canvas",
]);
const htmlVoidTags = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const htmlRawTextTags = new Set(["script", "style", "textarea", "title"]);

type HtmlTagToken = {
  end: number;
  tagName: string | null;
  closing: boolean;
  selfClosing: boolean;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findHtmlTagTokenEnd(content: string, start: number) {
  let quote: '"' | "'" | null = null;

  for (let index = start + 1; index < content.length; index += 1) {
    const char = content[index];
    if (quote) {
      if (char === quote && content[index - 1] !== "\\") quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === ">") return index + 1;
  }

  return -1;
}

function readHtmlTagToken(content: string, start: number): HtmlTagToken | null {
  if (content[start] !== "<") return null;

  if (content.startsWith("<!--", start)) {
    const commentEnd = content.indexOf("-->", start + 4);
    return {
      end: commentEnd >= 0 ? commentEnd + 3 : content.length,
      tagName: null,
      closing: false,
      selfClosing: true,
    };
  }

  const end = findHtmlTagTokenEnd(content, start);
  if (end < 0) return null;

  const rawTag = content.slice(start, end);
  const tagMatch = /^<\s*\/?\s*([A-Za-z][\w:-]*)/.exec(rawTag);
  const tagName = tagMatch?.[1]?.toLowerCase() ?? null;
  const closing = /^<\s*\//.test(rawTag);
  const selfClosing =
    !closing && ((!!tagName && htmlVoidTags.has(tagName)) || /\/\s*>$/.test(rawTag));

  return {
    end,
    tagName,
    closing,
    selfClosing,
  };
}

function findHtmlClosingTagEnd(content: string, start: number, tagName: string) {
  const closePattern = new RegExp(`</\\s*${escapeRegExp(tagName)}\\s*>`, "i");
  const match = closePattern.exec(content.slice(start));
  return match ? start + match.index + match[0].length : -1;
}

function findMatchingHtmlBlockEnd(content: string, start: number, rootTagName: string) {
  if (htmlRawTextTags.has(rootTagName)) {
    const rawTextEnd = findHtmlClosingTagEnd(content, start, rootTagName);
    return rawTextEnd >= 0 ? rawTextEnd : -1;
  }

  let depth = 0;
  let cursor = start;

  while (cursor < content.length) {
    const nextTagStart = content.indexOf("<", cursor);
    if (nextTagStart < 0) return -1;

    const token = readHtmlTagToken(content, nextTagStart);
    if (!token) {
      cursor = nextTagStart + 1;
      continue;
    }

    const tokenTagName = token.tagName;
    if (tokenTagName === rootTagName) {
      if (token.closing) {
        depth -= 1;
        if (depth <= 0) return token.end;
      } else if (!token.selfClosing) {
        depth += 1;
      }
    } else if (tokenTagName && htmlRawTextTags.has(tokenTagName) && !token.closing) {
      const rawTextEnd = findHtmlClosingTagEnd(content, token.end, tokenTagName);
      if (rawTextEnd >= 0) {
        cursor = rawTextEnd;
        continue;
      }
    }

    cursor = token.end;
  }

  return -1;
}

function findHtmlDocumentEnd(content: string, start: number) {
  const htmlClosePattern = /<\/\s*html\s*>/i;
  const htmlCloseMatch = htmlClosePattern.exec(content.slice(start));
  if (htmlCloseMatch) return start + htmlCloseMatch.index + htmlCloseMatch[0].length;

  const bodyClosePattern = /<\/\s*body\s*>/i;
  const bodyCloseMatch = bodyClosePattern.exec(content.slice(start));
  if (bodyCloseMatch) return start + bodyCloseMatch.index + bodyCloseMatch[0].length;

  return content.length;
}

function pushPlainChatHtmlSegment(
  segments: PlainChatHtmlSegment[],
  type: PlainChatHtmlSegment["type"],
  content: string,
) {
  if (!content) return;
  const previousSegment = segments[segments.length - 1];
  if (previousSegment?.type === type) {
    previousSegment.content += content;
    return;
  }
  segments.push({ type, content });
}

function splitEmbeddedHtmlBlocks(content: string): PlainChatHtmlSegment[] {
  const segments: PlainChatHtmlSegment[] = [];
  const htmlStartPattern =
    /(^|\n|(?=<!doctype\s+html\b)|(?=<html(?=[\s>/])))([ \t]*)(<!doctype\s+html\b|<([A-Za-z][\w:-]*)(?=[\s>/]))/gi;
  let cursor = 0;
  let searchCursor = 0;

  while (searchCursor < content.length) {
    htmlStartPattern.lastIndex = searchCursor;
    const match = htmlStartPattern.exec(content);

    if (!match) {
      pushPlainChatHtmlSegment(segments, "text", content.slice(cursor));
      break;
    }

    const blockStart = match.index + match[1].length + match[2].length;
    const marker = match[3].toLowerCase();
    const rootTagName = match[4]?.toLowerCase() ?? null;
    let blockEnd = -1;

    if (marker.startsWith("<!doctype")) {
      blockEnd = findHtmlDocumentEnd(content, blockStart);
    } else if (rootTagName && htmlBlockRootTags.has(rootTagName)) {
      blockEnd = findMatchingHtmlBlockEnd(content, blockStart, rootTagName);
    }

    if (blockEnd <= blockStart) {
      searchCursor = blockStart + 1;
      continue;
    }

    let trailingCursor = blockEnd;
    while (trailingCursor < content.length) {
      const whitespace = /^\s*/.exec(content.slice(trailingCursor))?.[0] ?? "";
      const trailingTagStart = trailingCursor + whitespace.length;
      const trailingToken = readHtmlTagToken(content, trailingTagStart);
      if (
        !trailingToken?.tagName ||
        trailingToken.closing ||
        !htmlRawTextTags.has(trailingToken.tagName)
      ) {
        break;
      }
      const trailingBlockEnd = findMatchingHtmlBlockEnd(
        content,
        trailingTagStart,
        trailingToken.tagName,
      );
      if (trailingBlockEnd <= trailingTagStart) break;
      blockEnd = trailingBlockEnd;
      trailingCursor = trailingBlockEnd;
    }

    const htmlBlock = content.slice(blockStart, blockEnd);
    if (!looksLikeRenderableHtml(htmlBlock)) {
      searchCursor = blockStart + 1;
      continue;
    }

    if (blockStart > cursor) {
      pushPlainChatHtmlSegment(segments, "text", content.slice(cursor, blockStart));
    }
    pushPlainChatHtmlSegment(segments, "html", htmlBlock);
    cursor = blockEnd;
    searchCursor = blockEnd;
  }

  return segments.length > 0 ? segments : [{ type: "text", content }];
}

function parsePlainChatContent(content: string): ChatContentPart[] {
  const parts: ChatContentPart[] = [];
  // 修复 LLM 偶尔把 ![alt](url) 写错的几种情况：
  //   1. ![alt]\n  (url)        → ![alt](url)
  //   2. alt](url) 缺前导 ![    → ![alt](url)
  //   3. alt](\n url \n)         → ![alt](url)
  let normalized = content.replace(/\r\n/g, "\n");
  // 隐藏服务端为识图 MCP 注入的本地路径注释（不影响发回模型的 message.content 原文）
  normalized = stripHiddenImageAnnotations(normalized);
  // 合并 \"]\" 与 \"(\" 之间的换行与空白
  normalized = normalized.replace(/\](\s*\n\s*)+\(/g, "](");
  // 合并 \"(\" 与 url 之间的空白/换行
  normalized = normalized.replace(/\(\s*\n\s*(https?:\/\/|data:image\/)/g, "($1");
  // 合并 url 与 \")\" 之间的空白/换行
  normalized = normalized.replace(/((?:https?:\/\/|data:image\/)\S+?)\s*\n\s*\)/g, "$1)");
  // 给独立的 \"alt](image-url)\" 自动补上前导 \"![\"
  normalized = normalized.replace(
    /(^|[\s\u3000])([^\s!\[\]\n][^\[\]\n]*?)\]\((https?:\/\/\S+?\.(?:png|jpe?g|webp|gif)(?:\?\S*)?|data:image\/[^)]+)\)/g,
    "$1![$2]($3)",
  );

  const plainSegments = splitEmbeddedHtmlBlocks(normalized);
  if (plainSegments.some((segment) => segment.type === "html")) {
    for (const segment of plainSegments) {
      if (segment.type === "html") {
        parts.push({
          type: "code",
          content: segment.content.trim(),
          language: "html",
          executable: false,
        });
        continue;
      }

      parts.push(...parsePlainChatContent(segment.content));
    }
    return parts;
  }

  const lines = normalized.split("\n");
  let textBuffer: string[] = [];
  let codeBuffer: string[] = [];
  let codeMode: "command" | "code" | null = null;

  const flushText = () => {
    if (textBuffer.length === 0) return;
    appendTextPart(parts, textBuffer.join("\n"));
    textBuffer = [];
  };

  const flushCode = () => {
    if (codeBuffer.length === 0 || !codeMode) return;
    parts.push({
      type: "code",
      content: codeBuffer.join("\n"),
      language: codeMode === "command" ? "shell" : "text",
      executable: codeMode === "command" && isExecutableCommandBlock(codeBuffer.join("\n")),
    });
    codeBuffer = [];
    codeMode = null;
  };

  for (const line of lines) {
    const trimmedLine = line.trim();
    const nextMode = isRunnableCommandLine(trimmedLine)
      ? "command"
      : isStandaloneCodeLine(trimmedLine)
        ? "code"
        : null;

    if (nextMode) {
      flushText();
      if (codeMode && codeMode !== nextMode) flushCode();
      codeMode = nextMode;
      codeBuffer.push(trimmedLine);
      continue;
    }

    flushCode();
    textBuffer.push(line);
  }

  flushCode();
  flushText();
  return parts;
}

function parseChatContentParts(content: string): ChatContentPart[] {
  const parts: ChatContentPart[] = [];
  const fencePattern = /```([A-Za-z0-9_-]*)[ \t]*\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(content))) {
    const plainContent = content.slice(cursor, match.index);
    parts.push(...parsePlainChatContent(plainContent));

    const language = (match[1] || "text").toLowerCase();
    const codeContent = match[2].replace(/^\n|\n$/g, "");
    const executable = shellLanguages.has(language) && isExecutableCommandBlock(codeContent);
    parts.push({
      type: "code",
      content: codeContent,
      language,
      executable,
    });
    cursor = match.index + match[0].length;
  }

  parts.push(...parsePlainChatContent(content.slice(cursor)));
  return parts.filter((part) => part.content.length > 0);
}

function looksLikeRenderableHtml(content: string) {
  const trimmedContent = content.trim();
  if (!trimmedContent) return false;
  if (/<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<style[\s>]/i.test(trimmedContent)) {
    return true;
  }
  return /<[a-z][\w:-]*(?:\s[^>]*)?>[\s\S]*<\/[a-z][\w:-]*>/i.test(trimmedContent);
}

function looksLikeStandaloneRenderableHtml(content: string) {
  const trimmedContent = content.trim();
  if (!looksLikeRenderableHtml(trimmedContent)) return false;
  if (/^(?:<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<style[\s>])/i.test(trimmedContent)) {
    return true;
  }
  return (
    /^<[a-z][\w:-]*(?:\s[^>]*)?>/i.test(trimmedContent) &&
    /<\/[a-z][\w:-]*>\s*$/i.test(trimmedContent)
  );
}

function shouldRenderHtmlCodePart(part: Extract<ChatContentPart, { type: "code" }>) {
  return (
    htmlLanguages.has(part.language) ||
    (part.language === "text" && looksLikeRenderableHtml(part.content))
  );
}

function buildHtmlPreviewScript(previewId: string) {
  const previewIdLiteral = JSON.stringify(previewId);
  const messageTypeLiteral = JSON.stringify(HTML_PREVIEW_RESIZE_MESSAGE);

  return [
    '<script data-renge-html-preview="true">',
    "(() => {",
    `const previewId = ${previewIdLiteral};`,
    `const messageType = ${messageTypeLiteral};`,
    `const maxHeight = ${HTML_PREVIEW_MAX_HEIGHT};`,
    "const defaultHeight = 420;",
    "const minHeight = 220;",
    "const padding = 12;",
    "let rafId = 0;",
    "let lastHeight = 0;",
    "let lastMeasuredContentHeight = 0;",
    "let lastMeasuredViewportHeight = 0;",
    "let currentScale = 1;",
    "let naturalLayout = null;",
    "let naturalLayoutDirty = true;",
    "let lastViewportWidth = 0;",
    "const clampHeight = (height) => {",
    "  const numericHeight = Number(height);",
    "  if (!Number.isFinite(numericHeight)) return defaultHeight;",
    "  return Math.max(minHeight, Math.min(Math.ceil(numericHeight), maxHeight));",
    "};",
    "const setScale = (scale) => {",
    "  if (Math.abs(currentScale - scale) < 0.001) return;",
    "  currentScale = scale;",
    "  if (document.body) document.body.style.zoom = scale < 0.999 ? String(scale) : \"\";",
    "};",
    "const numberFromStyle = (style, property) => {",
    "  const value = Number.parseFloat(style.getPropertyValue(property));",
    "  return Number.isFinite(value) ? value : 0;",
    "};",
    "const getNaturalBounds = () => {",
    "  const root = document.documentElement;",
    "  const body = document.body;",
    "  const scrollX = window.scrollX || window.pageXOffset || 0;",
    "  const scrollY = window.scrollY || window.pageYOffset || 0;",
    "  const viewportHeight = window.innerHeight || root?.clientHeight || 0;",
    "  let minLeft = 0;",
    "  let minTop = 0;",
    "  let maxRight = 0;",
    "  let maxBottom = 0;",
    "  let hasIntrinsicElement = false;",
    "  document.querySelectorAll(\"body *\").forEach((element) => {",
    "    const rect = element.getBoundingClientRect();",
    "    if (!Number.isFinite(rect.right) || !Number.isFinite(rect.bottom)) return;",
    "    if (rect.width === 0 && rect.height === 0) return;",
    "    const left = rect.left + scrollX;",
    "    const top = rect.top + scrollY;",
    "    let visualWidth = rect.width;",
    "    let visualHeight = rect.height;",
    "    const canvasWidth = element instanceof HTMLCanvasElement ? element.width : 0;",
    "    const canvasHeight = element instanceof HTMLCanvasElement ? element.height : 0;",
    "    const imageWidth = element instanceof HTMLImageElement ? element.naturalWidth : 0;",
    "    const imageHeight = element instanceof HTMLImageElement ? element.naturalHeight : 0;",
    "    const videoWidth = element instanceof HTMLVideoElement ? element.videoWidth : 0;",
    "    const videoHeight = element instanceof HTMLVideoElement ? element.videoHeight : 0;",
    "    const intrinsicWidth = canvasWidth || imageWidth || videoWidth;",
    "    const intrinsicHeight = canvasHeight || imageHeight || videoHeight;",
    "    if (intrinsicWidth > 0 && intrinsicHeight > 0) {",
    "      hasIntrinsicElement = true;",
    "      const aspectHeight = rect.width > 0 ? rect.width * intrinsicHeight / intrinsicWidth : 0;",
    "      const tracksViewportHeight = Math.abs(rect.height - viewportHeight) <= 2;",
    "      if (aspectHeight > 0) {",
    "        visualHeight = tracksViewportHeight ? aspectHeight : Math.max(visualHeight, aspectHeight);",
    "      }",
    "      if (rect.height > 0 && !tracksViewportHeight) {",
    "        visualWidth = Math.max(visualWidth, rect.height * intrinsicWidth / intrinsicHeight);",
    "      }",
    "    }",
    "    if (element instanceof SVGSVGElement && element.viewBox?.baseVal?.width > 0 && element.viewBox.baseVal.height > 0) {",
    "      hasIntrinsicElement = true;",
    "      const viewBox = element.viewBox.baseVal;",
    "      const aspectHeight = rect.width > 0 ? rect.width * viewBox.height / viewBox.width : 0;",
    "      const tracksViewportHeight = Math.abs(rect.height - viewportHeight) <= 2;",
    "      if (aspectHeight > 0) {",
    "        visualHeight = tracksViewportHeight ? aspectHeight : Math.max(visualHeight, aspectHeight);",
    "      }",
    "      if (rect.height > 0 && !tracksViewportHeight) {",
    "        visualWidth = Math.max(visualWidth, rect.height * viewBox.width / viewBox.height);",
    "      }",
    "    }",
    "    const right = left + visualWidth;",
    "    const bottom = top + visualHeight;",
    "    minLeft = Math.min(minLeft, left);",
    "    minTop = Math.min(minTop, top);",
    "    maxRight = Math.max(maxRight, right);",
    "    maxBottom = Math.max(maxBottom, bottom);",
    "  });",
    "  const contentWidth = Math.max(",
    "    root?.scrollWidth || 0,",
    "    body?.scrollWidth || 0,",
    "    maxRight - Math.min(0, minLeft),",
    "    maxRight,",
    "  );",
    "  const contentHeight = maxBottom - Math.min(0, minTop);",
    "  return { width: contentWidth, height: contentHeight, hasIntrinsicElement };",
    "};",
    "const measure = () => {",
    "  const body = document.body;",
    "  if (!body) return { height: defaultHeight, hasIntrinsicElement: false };",
    "  const bodyStyle = window.getComputedStyle(body);",
    "  const horizontalMargin =",
    '    numberFromStyle(bodyStyle, "margin-left") + numberFromStyle(bodyStyle, "margin-right");',
    "  const verticalMargin =",
    '    numberFromStyle(bodyStyle, "margin-top") + numberFromStyle(bodyStyle, "margin-bottom");',
    "  const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || defaultHeight);",
    "  const viewportHeight = window.innerHeight || defaultHeight;",
    "  const availableWidth = Math.max(1, viewportWidth - horizontalMargin);",
    "  if (Math.abs(viewportWidth - lastViewportWidth) > 1) naturalLayoutDirty = true;",
    "  lastViewportWidth = viewportWidth;",
    "  if (!naturalLayout || naturalLayoutDirty) {",
    "    setScale(1);",
    "    naturalLayout = {",
    "      bounds: getNaturalBounds(),",
    "      structuralHeight: Math.max(body.scrollHeight || 0, body.offsetHeight || 0, body.getBoundingClientRect().height || 0),",
    "    };",
    "    naturalLayoutDirty = false;",
    "  }",
    "  const bounds = naturalLayout.bounds;",
    "  const structuralHeight = naturalLayout.structuralHeight;",
    "  const nextScale = bounds.width > availableWidth ? Math.max(0.1, availableWidth / bounds.width) : 1;",
    "  setScale(nextScale);",
    "  const structuralTracksViewport = Math.abs(structuralHeight - viewportHeight) <= 2;",
    "  if (structuralHeight > 0 && !structuralTracksViewport) {",
    "    return {",
    "      height: clampHeight((structuralHeight + verticalMargin) * nextScale + padding),",
    "      hasIntrinsicElement: bounds.hasIntrinsicElement,",
    "    };",
    "  }",
    "  const contentHeight = Math.max(0, bounds.height);",
    "  const contentDelta = contentHeight - lastMeasuredContentHeight;",
    "  const viewportDelta = viewportHeight - lastMeasuredViewportHeight;",
    "  const tracksRecentViewport =",
    "    lastMeasuredContentHeight > 0 &&",
    "    Math.abs(contentDelta - viewportDelta) <= 2 &&",
    "    contentHeight >= viewportHeight - 2 &&",
    "    contentHeight <= viewportHeight + 64;",
    "  lastMeasuredContentHeight = contentHeight;",
    "  lastMeasuredViewportHeight = viewportHeight;",
    "  const tracksViewport = Math.abs(contentHeight - viewportHeight) <= 2;",
    "  if (!contentHeight || (!bounds.hasIntrinsicElement && (tracksViewport || tracksRecentViewport))) {",
    "    return { height: clampHeight(defaultHeight), hasIntrinsicElement: bounds.hasIntrinsicElement };",
    "  }",
    "  return {",
    "    height: clampHeight(contentHeight * nextScale + verticalMargin + padding),",
    "    hasIntrinsicElement: bounds.hasIntrinsicElement,",
    "  };",
    "};",
    "const postHeight = () => {",
    "  rafId = 0;",
    "  const measurement = measure();",
    "  const height = measurement.height;",
    "  if (Math.abs(height - lastHeight) < 1) return;",
    "  lastHeight = height;",
    "  try {",
    '    parent.postMessage({ type: messageType, id: previewId, height, intrinsic: measurement.hasIntrinsicElement === true }, "*");',
    "  } catch {}",
    "};",
    "const schedulePost = () => {",
    "  if (rafId) return;",
    "  rafId = requestAnimationFrame(postHeight);",
    "};",
    'window.addEventListener("load", () => { naturalLayoutDirty = true; schedulePost(); });',
    'window.addEventListener("resize", schedulePost);',
    'window.addEventListener("orientationchange", schedulePost);',
    "try {",
    "  const resizeObserver = new ResizeObserver(schedulePost);",
    "  resizeObserver.observe(document.documentElement);",
    "  if (document.body) resizeObserver.observe(document.body);",
    "  document.addEventListener(\"DOMContentLoaded\", () => {",
    "    if (document.body) resizeObserver.observe(document.body);",
    "    schedulePost();",
    "  }, { once: true });",
    "  window.addEventListener(\"unload\", () => resizeObserver.disconnect(), { once: true });",
    "} catch {}",
    "try {",
    "  const mutationObserver = new MutationObserver((mutations) => {",
    "    const hasMeaningfulMutation = mutations.some((mutation) => !(mutation.type === \"attributes\" && mutation.attributeName === \"style\" && mutation.target === document.body));",
    "    if (hasMeaningfulMutation) naturalLayoutDirty = true;",
    "    schedulePost();",
    "  });",
    "  mutationObserver.observe(document.documentElement, {",
    "    attributes: true,",
    "    childList: true,",
    "    subtree: true,",
    "    characterData: true,",
    "  });",
    "  window.addEventListener(\"unload\", () => mutationObserver.disconnect(), { once: true });",
    "} catch {}",
    "document.addEventListener(\"DOMContentLoaded\", () => { naturalLayoutDirty = true; schedulePost(); }, { once: true });",
    "schedulePost();",
    "[80, 240, 600, 1200, 2400, 4000].forEach((delay) => setTimeout(() => { naturalLayoutDirty = true; schedulePost(); }, delay));",
    "const intervalId = setInterval(schedulePost, 500);",
    "setTimeout(() => clearInterval(intervalId), 6000);",
    "})();",
    "</script>",
  ].join("");
}

function appendHtmlPreviewScript(documentContent: string, previewId: string) {
  const previewScript = buildHtmlPreviewScript(previewId);
  if (/<\/body>/i.test(documentContent)) {
    return documentContent.replace(/<\/body>/i, `${previewScript}</body>`);
  }
  if (/<\/html>/i.test(documentContent)) {
    return documentContent.replace(/<\/html>/i, `${previewScript}</html>`);
  }
  return `${documentContent}${previewScript}`;
}

function injectHtmlPreviewHead(documentContent: string, headInjection: string) {
  if (/<head[\s>]/i.test(documentContent)) {
    return documentContent.replace(/<head([^>]*)>/i, `<head$1>${headInjection}`);
  }
  if (/<html[\s>]/i.test(documentContent)) {
    return documentContent.replace(/<html([^>]*)>/i, `<html$1><head>${headInjection}</head>`);
  }
  return `<head>${headInjection}</head>${documentContent}`;
}

function buildHtmlPreviewDocument(
  content: string,
  previewId: string,
  context: HtmlPreviewContext,
) {
  const trimmedContent = content.trim();
  const headInjection = `${htmlPreviewStyle}${htmlPreviewJqueryScript}${htmlPreviewBootstrapScript}${buildHtmlPreviewVariablesScript(previewId, context)}`;
  if (/<!doctype\s+html|<html[\s>]/i.test(trimmedContent)) {
    return appendHtmlPreviewScript(injectHtmlPreviewHead(trimmedContent, headInjection), previewId);
  }
  if (/<head[\s>]|<body[\s>]/i.test(trimmedContent)) {
    return appendHtmlPreviewScript(
      `<!doctype html><html lang="zh-CN">${injectHtmlPreviewHead(trimmedContent, headInjection)}</html>`,
      previewId,
    );
  }

  return appendHtmlPreviewScript(
    [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    "<style>html,body{min-height:100%;}body{margin:0;}</style>",
    headInjection,
    "</head>",
    "<body>",
    trimmedContent,
    "</body>",
    "</html>",
    ].join(""),
    previewId,
  );
}

type ChatHtmlPreviewProps = {
  content: string;
  context: HtmlPreviewContext;
  messageId: string;
  previewId: string;
  frameRegistry: { current: Map<string, HTMLIFrameElement> };
};

function ChatHtmlPreview({
  content,
  context,
  messageId,
  previewId,
  frameRegistry,
}: ChatHtmlPreviewProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const sourceDocumentRef = useRef<{
    content: string;
    previewId: string;
    value: string;
  } | null>(null);

  if (
    !sourceDocumentRef.current ||
    sourceDocumentRef.current.content !== content ||
    sourceDocumentRef.current.previewId !== previewId
  ) {
    sourceDocumentRef.current = {
      content,
      previewId,
      value: buildHtmlPreviewDocument(content, previewId, context),
    };
  }

  const sendContextUpdate = useCallback(() => {
    const frameWindow = frameRef.current?.contentWindow;
    if (!frameWindow) return;
    frameWindow.postMessage(
      {
        type: HTML_PREVIEW_CONTEXT_UPDATE_MESSAGE,
        id: previewId,
        context,
      },
      "*",
    );
  }, [context, previewId]);

  useEffect(() => {
    sendContextUpdate();
  }, [sendContextUpdate]);

  const registerFrame = useCallback(
    (frame: HTMLIFrameElement | null) => {
      frameRef.current = frame;
      if (frame) frameRegistry.current.set(previewId, frame);
      else frameRegistry.current.delete(previewId);
    },
    [frameRegistry, previewId],
  );

  const handleLoad = useCallback(
    (event: SyntheticEvent<HTMLIFrameElement>) => {
      resizeHtmlPreviewFrame(event);
      window.requestAnimationFrame(sendContextUpdate);
    },
    [sendContextUpdate],
  );

  return (
    <div className="chat-html-preview">
      <iframe
        className="chat-html-frame"
        allow="autoplay; fullscreen; gamepad"
        allowFullScreen
        data-message-id={messageId}
        loading="eager"
        onLoad={handleLoad}
        ref={registerFrame}
        referrerPolicy="no-referrer"
        srcDoc={sourceDocumentRef.current.value}
        tabIndex={0}
        title="HTML 预览"
      />
    </div>
  );
}

function measureHtmlPreviewHeight(frame: HTMLIFrameElement) {
  const doc = frame.contentDocument;
  if (!doc) return 0;

  const root = doc.documentElement;
  const body = doc.body;
  const baseHeight = Math.max(
    root.scrollHeight,
    root.offsetHeight,
    root.clientHeight,
    body?.scrollHeight ?? 0,
    body?.offsetHeight ?? 0,
    body?.clientHeight ?? 0,
  );
  const scrollY = frame.contentWindow?.scrollY ?? 0;
  const elementBottom = Array.from(doc.body?.querySelectorAll("*") ?? []).reduce(
    (maxBottom, element) => {
      const rect = element.getBoundingClientRect();
      if (!Number.isFinite(rect.bottom) || (rect.width === 0 && rect.height === 0)) {
        return maxBottom;
      }
      return Math.max(maxBottom, rect.bottom + scrollY);
    },
    0,
  );

  return Math.max(baseHeight, elementBottom);
}

function fitHtmlPreviewFrame(frame: HTMLIFrameElement) {
  try {
    const height = Math.ceil(measureHtmlPreviewHeight(frame) + 12);
    if (height > 0) frame.style.height = `${Math.max(220, height)}px`;
  } catch {
    // Preview internals should not break chat rendering.
  }
}

function resizeHtmlPreviewFrame(event: SyntheticEvent<HTMLIFrameElement>) {
  const frame = event.currentTarget;
  const frameWidth = frame.getBoundingClientRect().width || frame.clientWidth || 0;
  if (frameWidth > 0) {
    const measuringHeight = Math.max(420, Math.min(960, Math.round(frameWidth * 0.72)));
    frame.style.height = `${measuringHeight}px`;
  }
  fitHtmlPreviewFrame(frame);
  [80, 240, 600].forEach((delay) => {
    window.setTimeout(() => fitHtmlPreviewFrame(frame), delay);
  });
}

function renderInlineText(content: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const normalizedContent = stripHiddenImageAnnotations(content);
  // 个性化引用覆盖半角/全角双引号、中文弯引号、书名式引号和半角角括号。
  const inlinePattern =
    /`(?<code>[^`]+)`|(?<bareImage>https?:\/\/\S+?\.(?:png|jpe?g|webp|gif)(?:\?\S*)?|data:image\/[a-zA-Z+.-]+;base64,[A-Za-z0-9+/=]+)|!\[(?<imageAlt>[^\]]*)\]\s*\(\s*(?<imageUrl>[^)\s]+)\s*\)|\[(?<linkText>[^\]]+)\]\s*\(\s*(?<linkUrl>[^)\s]+)\s*\)|(?<personalizedQuote>"[^"\n]+"|＂[^＂\n]+＂|“[^”\n]+”|〝[^〞\n]+〞|「[^」\n]+」|｢[^｣\n]+｣|『[^』\n]+』)|\*\*(?<doubleAsterisk>[^*]+)\*\*|__(?<doubleUnderscore>[^_]+)__|~~(?<deleted>[^~]+)~~|\*(?<asteriskEm>[^*\n]+)\*|_(?<underscoreEm>[^_\n]+)_/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(normalizedContent))) {
    if (match.index > cursor) nodes.push(normalizedContent.slice(cursor, match.index));
    const groups = match.groups ?? {};

    if (groups.code !== undefined) {
      nodes.push(<code key={`code-${match.index}`}>{groups.code}</code>);
    } else if (groups.bareImage !== undefined) {
      // 裸图片 URL（http(s) 直链或 data:image/...）
      nodes.push(
        <img
          key={`bare-img-${match.index}`}
          src={groups.bareImage}
          alt="生成的图片"
          className="chat-inline-image"
          loading="lazy"
        />,
      );
    } else if (groups.imageAlt !== undefined && groups.imageUrl !== undefined) {
      nodes.push(
        <img
          key={`img-${match.index}`}
          src={groups.imageUrl}
          alt={groups.imageAlt || "生成的图片"}
          className="chat-inline-image"
          loading="lazy"
        />,
      );
    } else if (groups.linkText !== undefined && groups.linkUrl !== undefined) {
      nodes.push(
        <a
          className="chat-inline-link"
          href={groups.linkUrl}
          key={`link-${match.index}`}
          rel="noreferrer"
          target="_blank"
          title={groups.linkUrl}
        >
          {groups.linkText}
        </a>,
      );
    } else if (groups.personalizedQuote !== undefined) {
      const quote = groups.personalizedQuote;
      nodes.push(
        <span className="chat-personalized-quote" key={`quote-${match.index}`}>
          {quote.slice(0, 1)}
          {renderInlineText(quote.slice(1, -1))}
          {quote.slice(-1)}
        </span>,
      );
    } else if (groups.doubleAsterisk !== undefined) {
      nodes.push(
        <strong key={`strong-${match.index}`}>
          {renderInlineText(groups.doubleAsterisk)}
        </strong>,
      );
    } else if (groups.doubleUnderscore !== undefined) {
      nodes.push(
        <strong key={`strong-${match.index}`}>
          {renderInlineText(groups.doubleUnderscore)}
        </strong>,
      );
    } else if (groups.deleted !== undefined) {
      nodes.push(<del key={`del-${match.index}`}>{groups.deleted}</del>);
    } else if (groups.asteriskEm !== undefined) {
      nodes.push(
        <em className="chat-personalized-italic" key={`em-${match.index}`}>
          {renderInlineText(groups.asteriskEm)}
        </em>,
      );
    } else if (groups.underscoreEm !== undefined) {
      nodes.push(<em key={`em-${match.index}`}>{groups.underscoreEm}</em>);
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < normalizedContent.length) nodes.push(normalizedContent.slice(cursor));
  return nodes;
}

function splitMarkdownTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line: string) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderMarkdownParagraph(lines: string[], key: string) {
  return (
    <p className="chat-text-part" key={key}>
      {renderInlineText(lines.join("\n"))}
    </p>
  );
}

function renderMarkdownList(
  lines: string[],
  ordered: boolean,
  key: string,
) {
  const listItems = lines.map((line) => {
    const match = ordered
      ? /^\s*\d+\.\s+(.*)$/.exec(line)
      : /^\s*[-*+]\s+(\[[ xX]\]\s+)?(.*)$/.exec(line);
    const taskMarker = !ordered ? match?.[1] : undefined;
    const content = ordered ? match?.[1] ?? line : match?.[2] ?? line;
    const checked = taskMarker ? /\[[xX]\]/.test(taskMarker) : null;

    return { content, checked };
  });
  const Tag = ordered ? "ol" : "ul";

  return (
    <Tag className="chat-markdown-list" key={key}>
      {listItems.map((item, index) => (
        <li key={`${key}-item-${index}`}>
          {item.checked !== null && (
            <input checked={item.checked} readOnly tabIndex={-1} type="checkbox" />
          )}
          <span>{renderInlineText(item.content)}</span>
        </li>
      ))}
    </Tag>
  );
}

function renderMarkdownTable(lines: string[], key: string) {
  const headerCells = splitMarkdownTableRow(lines[0]);
  const bodyRows = lines.slice(2).map(splitMarkdownTableRow);

  return (
    <div className="chat-markdown-table-wrap" key={key}>
      <table className="chat-markdown-table">
        <thead>
          <tr>
            {headerCells.map((cell, index) => (
              <th key={`${key}-head-${index}`}>{renderInlineText(cell)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, rowIndex) => (
            <tr key={`${key}-row-${rowIndex}`}>
              {headerCells.map((_, cellIndex) => (
                <td key={`${key}-cell-${rowIndex}-${cellIndex}`}>
                  {renderInlineText(row[cellIndex] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderMarkdownHeading(level: number, content: string, key: string) {
  const className = "chat-markdown-heading";
  const children = renderInlineText(content);

  switch (level) {
    case 1:
      return <h1 className={className} key={key}>{children}</h1>;
    case 2:
      return <h2 className={className} key={key}>{children}</h2>;
    case 3:
      return <h3 className={className} key={key}>{children}</h3>;
    case 4:
      return <h4 className={className} key={key}>{children}</h4>;
    case 5:
      return <h5 className={className} key={key}>{children}</h5>;
    default:
      return <h6 className={className} key={key}>{children}</h6>;
  }
}

function renderMarkdownBlocks(content: string, keyPrefix: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmedLine = line.trim();
    const key = `${keyPrefix}-md-${index}`;

    if (!trimmedLine) {
      index += 1;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmedLine);
    if (headingMatch) {
      const level = Math.min(6, headingMatch[1].length);
      nodes.push(renderMarkdownHeading(level, headingMatch[2], key));
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmedLine)) {
      nodes.push(<hr className="chat-markdown-hr" key={key} />);
      index += 1;
      continue;
    }

    if (trimmedLine.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      nodes.push(
        <blockquote className="chat-markdown-quote" key={key}>
          {renderMarkdownBlocks(quoteLines.join("\n"), `${key}-quote`)}
        </blockquote>,
      );
      continue;
    }

    if (
      index + 1 < lines.length &&
      trimmedLine.includes("|") &&
      isMarkdownTableSeparator(lines[index + 1])
    ) {
      const tableLines = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        tableLines.push(lines[index]);
        index += 1;
      }
      nodes.push(renderMarkdownTable(tableLines, key));
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const listLines: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        listLines.push(lines[index]);
        index += 1;
      }
      nodes.push(renderMarkdownList(listLines, false, key));
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const listLines: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        listLines.push(lines[index]);
        index += 1;
      }
      nodes.push(renderMarkdownList(listLines, true, key));
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index].trim()) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[index].trim()) &&
      !lines[index].trim().startsWith(">") &&
      !/^\s*[-*+]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index])
    ) {
      if (
        index + 1 < lines.length &&
        lines[index].includes("|") &&
        isMarkdownTableSeparator(lines[index + 1])
      ) {
        break;
      }
      paragraphLines.push(lines[index]);
      index += 1;
    }
    nodes.push(renderMarkdownParagraph(paragraphLines, key));
  }

  return nodes;
}

function getWorkspaceInfo(
  handle: LocalDirectoryHandle | ElectronWorkspaceHandle | AndroidWorkspaceHandle | PcWorkspaceHandle | null,
) {
  if (!handle) {
    return {
      key: DEFAULT_WORKSPACE_KEY,
      name: DEFAULT_WORKSPACE_NAME,
    };
  }

  if (handle.kind === "electron") {
    return {
      key: handle.path,
      name: handle.name,
      path: handle.path,
    };
  }

  if (handle.kind === "android") {
    return {
      key: `android:${handle.uri}`,
      name: handle.name,
      path: handle.uri,
    };
  }

  if (handle.kind === "pc") {
    return {
      key: `pc:${handle.baseUrl}:${handle.path}`,
      name: handle.name,
      path: handle.path,
    };
  }

  return {
    key: `browser:${handle.name}`,
    name: handle.name,
  };
}

function getChatSenderPersona(
  sender: ChatSenderIdentity | undefined,
  personas: AgentPersona[],
) {
  if (sender?.kind !== "persona" || !sender.personaId) return null;
  return personas.find((persona) => persona.id === sender.personaId) ?? null;
}

function getAssistantMessagePersona(
  message: ChatMessage,
  personas: AgentPersona[],
  fallbackPersona?: AgentPersona,
) {
  return getChatSenderPersona(message.sender, personas) ?? fallbackPersona ?? null;
}

function getChatSenderName(
  sender: ChatSenderIdentity | undefined,
  personas: AgentPersona[],
  userProfile: UserProfile,
) {
  if (sender?.kind === "system") return "系统提示词";

  const senderPersona = getChatSenderPersona(sender, personas);
  if (senderPersona) return senderPersona.name;

  return userProfile.nickname || "User";
}

function getChatSenderAvatarImage(
  sender: ChatSenderIdentity | undefined,
  personas: AgentPersona[],
  userProfile: UserProfile,
) {
  const senderPersona = getChatSenderPersona(sender, personas);
  return senderPersona?.avatarImage || (sender?.kind === "user" ? userProfile.avatarImage : "");
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function isTextLikeFile(fileName: string, mimeType: string) {
  const lowerName = fileName.toLowerCase();
  if (mimeType.startsWith("text/")) return true;
  if (
    [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/typescript",
      "application/x-javascript",
      "application/x-typescript",
      "application/x-sh",
      "application/sql",
      "image/svg+xml",
    ].includes(mimeType)
  ) {
    return true;
  }
  return /\.(txt|md|markdown|json|jsonl|csv|tsv|xml|html|htm|css|js|jsx|ts|tsx|mjs|cjs|vue|svelte|py|java|kt|kts|c|cc|cpp|h|hpp|cs|go|rs|php|rb|swift|sh|bat|cmd|ps1|sql|yaml|yml|toml|ini|env|log|svg)$/i.test(
    lowerName,
  );
}

function getDataUrlBase64(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",");
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
}

function canProviderReceiveImageUrl(
  provider: ModelProviderChannel | null | undefined,
  modelId: string,
) {
  const target = `${provider?.name ?? ""} ${provider?.apiBaseUrl ?? ""} ${modelId}`.toLowerCase();
  return /\b(vl|vision|visual|qwen.*vl|qwen3-vl|gpt-4o|gpt-5|gemini|claude|pixtral|llava|internvl|minicpm-v|glm-4v|yi-vl)\b/i.test(
    target,
  );
}

function shouldUseImageRecognitionMcpForAttachments(
  attachments: ChatAttachment[],
  imageRecognitionMcpTool: McpToolDefinition | undefined,
) {
  return Boolean(
    imageRecognitionMcpTool &&
      attachments.some((attachment) => attachment.type.startsWith("image/") && attachment.dataUrl),
  );
}

function isImageRecognitionMcpTool(tool: McpToolDefinition) {
  const target = `${tool.originalName} ${tool.function.name}`.toLowerCase();
  return (
    target.includes("describe-image") ||
    target.includes("analyze_image") ||
    target.includes("analyze-image") ||
    target.includes("describe_image")
  );
}

function findImageRecognitionMcpTool(tools: McpToolDefinition[]) {
  return (
    tools.find((tool) => /^(describe_image|describe-image)$/i.test(tool.originalName)) ??
    tools.find(isImageRecognitionMcpTool)
  );
}

function extractImageRecognitionText(result: unknown) {
  const text = getMcpTextContentItems(result)
    .map((item) => String(item.text ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
  if (!text) return "";

  try {
    const parsed = JSON.parse(text) as unknown;
    if (isObjectRecord(parsed) && typeof parsed.text === "string") {
      return parsed.text.trim() || text;
    }
  } catch {
    // Keep plain text results as-is.
  }

  return text;
}

function buildAttachmentTextBlock(
  attachment: ChatAttachment,
  index: number,
  options: {
    sendImageAttachmentsToProvider?: boolean;
    hasImageRecognitionMcp?: boolean;
  } = {},
) {
  const header = [
    `附件 ${index + 1}: ${attachment.name}`,
    `附件ID: ${attachment.id}`,
    `类型: ${attachment.type || "application/octet-stream"}`,
    `大小: ${attachment.size} bytes (${formatFileSize(attachment.size)})`,
  ].join("\n");

  if (attachment.textContent !== undefined) {
    return `${header}\n内容:\n${attachment.textContent}`;
  }

  if (attachment.type.startsWith("image/")) {
    if (options.sendImageAttachmentsToProvider) {
      return `${header}\n图片已作为 image_url 随消息发送。`;
    }
    if (options.hasImageRecognitionMcp) {
      return `${header}\n当前聊天模型不直接接收 image_url；图片应通过已启用的图像识别 MCP 工具分析。调用图像识别 MCP 时可以用附件ID或文件名作为 image/imageUrl，客户端会映射到图片数据。不要为了识别图片而调用 local_preview_pc_image 或 local_transfer_attachment_file；这些工具只用于用户明确要求查看电脑工作区文件、保存或传输附件。`;
    }
    return `${header}\n当前聊天模型不直接接收 image_url，图片内容没有发送给模型。请切换到视觉模型，或启用图像识别 MCP 后重试。`;
  }

  return `${header}\n这是二进制或未知格式附件，内容没有发送给模型。只有当用户明确要求保存或传输这个附件时，才调用 local_transfer_attachment_file；不要把附件传输当作图片识别或内容分析方式。`;
}

function formatAttachmentPrompt(
  attachments: ChatAttachment[],
  options: {
    sendImageAttachmentsToProvider?: boolean;
    hasImageRecognitionMcp?: boolean;
  } = {},
) {
  if (attachments.length === 0) return "";
  const imageGuidance = options.sendImageAttachmentsToProvider
    ? "图片可按 image_url 分析"
    : options.hasImageRecognitionMcp
      ? "图片应通过已启用的图像识别 MCP 工具分析"
      : "图片不会直接发送给当前文本模型";
  return [
    `用户随消息上传了以下文件。文本附件可直接结合内容回答；${imageGuidance}；二进制或未知格式附件不会把内容发送给模型，保存或传输时必须调用附件/文件传输工具，不要要求用户提供 Base64。`,
    ...attachments.map((attachment, index) => buildAttachmentTextBlock(attachment, index, options)),
  ].join("\n\n");
}

async function maybeAttachReferenceImageForImageModel(
  apiMessages: ChatApiMessage[],
  modelId: string,
): Promise<ChatApiMessage[]> {
  // 图片模型的历史文字和历史图片由服务端统一收集并转成 edits/generations 请求。
  // 这里保留函数入口，避免旧调用点变动，但不再只把“最近一张图”挂到最后用户消息上。
  void modelId;
  return apiMessages;
}

function isImageGenerationModelId(modelId: string): boolean {
  const m = (modelId || "").toLowerCase();
  return (
    m.includes("dall-e") ||
    m.includes("image") ||
    m.includes("gpt-image") ||
    m.includes("stable-diffusion") ||
    m.includes("sd-") ||
    m.includes("midjourney") ||
    m.includes("mj-") ||
    m.includes("flux") ||
    m.includes("civitai")
  );
}

// 从一段 markdown 文本里抽出第一张图片 URL（http(s) / data: / 相对路径 /api/session-images/...）
function extractFirstImageUrlFromMarkdown(textBody: string): string {
  if (!textBody) return "";
  const m = textBody.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+|data:image\/[^)\s]+|\/api\/session-images\/[^)\s]+)\)/i);
  return m ? m[1] : "";
}

function getImageUrlMimeType(url: string) {
  const cleanUrl = url.split("?")[0]?.toLowerCase() ?? "";
  if (/\.jpe?g$/.test(cleanUrl)) return "image/jpeg";
  if (/\.webp$/.test(cleanUrl)) return "image/webp";
  if (/\.gif$/.test(cleanUrl)) return "image/gif";
  if (/\.svg$/.test(cleanUrl)) return "image/svg+xml";
  return "image/png";
}

function getImageUrlExtension(url: string) {
  const mimeType = getImageUrlMimeType(url);
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/svg+xml") return "svg";
  return "png";
}

function getGeneratedImageAttachmentsFromMessages(messages: ChatMessage[]) {
  const attachments: ChatAttachment[] = [];
  const seen = new Set<string>();
  messages.forEach((message) => {
    if (message.role !== "assistant") return;
    const matches = [...message.content.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+|data:image\/[^)\s]+|\/api\/session-images\/[^)\s]+)\)/gi)];
    matches.forEach((match, index) => {
      const url = match[1]?.trim();
      if (!url || seen.has(url)) return;
      seen.add(url);
      const mimeType = url.startsWith("data:")
        ? (url.match(/^data:([^;,]+)[;,]/i)?.[1] ?? "image/png")
        : getImageUrlMimeType(url);
      const extension = getMimeExtension(mimeType);
      const id = `generated-image-${attachments.length + 1}`;
      attachments.push({
        id,
        name: `generated-image-${attachments.length + 1}.${extension}`,
        type: mimeType,
        size: url.startsWith("data:") ? estimateBase64Bytes(url) : 0,
        ...(url.startsWith("data:") ? { dataUrl: url } : { downloadUrl: url }),
        createdAt: message.createdAt,
      });
    });
  });
  return attachments;
}

// 把图片 URL 解析成可以传给上游的 image_url（http/data 直接返；相对路径 fetch 到 data URL）
async function resolveImageUrlForUpstream(url: string): Promise<string> {
  if (!url) return "";
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  // 相对路径：fetch 到本地服务，再转 data URL
  if (url.startsWith("/")) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return "";
      const blob = await resp.blob();
      return await new Promise<string>((resolveReader, rejectReader) => {
        const reader = new FileReader();
        reader.onload = () => resolveReader(typeof reader.result === "string" ? reader.result : "");
        reader.onerror = () => rejectReader(reader.error ?? new Error("读取参考图失败"));
        reader.readAsDataURL(blob);
      });
    } catch {
      return "";
    }
  }
  // 本地绝对路径由后端按会话请求上下文读取并转成 data URL。
  return url;
}

function formatChatMessageForApi(
  message: ChatMessage,
  personas: AgentPersona[],
  userProfile: UserProfile,
  activeChatPersona?: AgentPersona,
  options: {
    sendImageAttachmentsToProvider?: boolean;
    hasImageRecognitionMcp?: boolean;
  } = {},
) {
  if (message.role !== "user") {
    return message.content;
  }

  const sender = message.sender ?? { kind: "user" as const };
  let textContent = message.content;
  if (sender.kind === "system") {
    textContent = `【系统提示词】：${message.content}`;
  } else if (sender.kind === "persona") {
    const senderPersona = getChatSenderPersona(sender, personas);
    if (senderPersona) {
      const identityLabel =
        activeChatPersona && senderPersona.id === activeChatPersona.id
          ? `${senderPersona.name}（你自己）`
          : senderPersona.name;
      textContent = `【${identityLabel}】：${message.content}`;
    }
  }

  const attachments = message.attachments ?? [];
  if (attachments.length === 0) return textContent;

  const textWithAttachments = [textContent, formatAttachmentPrompt(attachments, options)]
    .filter(Boolean)
    .join("\n\n");
  if (!options.sendImageAttachmentsToProvider) return textWithAttachments;

  const imageAttachments = attachments.filter((attachment) =>
    attachment.type.startsWith("image/") && attachment.dataUrl,
  );

  if (imageAttachments.length === 0) return textWithAttachments;

  return [
    { type: "text" as const, text: textWithAttachments || "请分析随消息上传的文件。" },
    ...imageAttachments.map((attachment) => ({
      type: "image_url" as const,
      image_url: { url: attachment.dataUrl ?? "" },
    })),
  ];
}

function getAgentApiName(personaId: string) {
  const normalizedId = personaId
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "persona";
  return `agent_${normalizedId}`.slice(0, 64);
}

function buildChatMessageForApi(
  message: ChatMessage,
  personas: AgentPersona[],
  userProfile: UserProfile,
  activeChatPersona: AgentPersona | undefined,
  options: {
    sendImageAttachmentsToProvider?: boolean;
    hasImageRecognitionMcp?: boolean;
  } = {},
): ChatApiMessage {
  const senderPersona =
    message.role === "assistant"
      ? getChatSenderPersona(message.sender, personas)
      : null;
  return {
    role: message.role,
    ...(senderPersona ? { name: getAgentApiName(senderPersona.id) } : {}),
    content: formatChatMessageForApi(
      message,
      personas,
      userProfile,
      activeChatPersona,
      options,
    ),
  };
}

function getChatApiMessageText(message?: ChatApiMessage) {
  if (!message?.content) return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part): part is Extract<ChatApiContentPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function getReasoningTextFromValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => getReasoningTextFromValue(item))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  return [
    record.text,
    record.content,
    record.reasoning,
    record.reasoning_content,
    record.summary,
  ]
    .map(getReasoningTextFromValue)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function getChatApiMessageReasoning(message?: ChatApiMessage) {
  if (!message) return "";
  const directReasoning = [
    message.reasoning,
    message.reasoning_content,
    message.reasoning_details,
    message.thinking,
    message.thinking_content,
  ]
    .map(getReasoningTextFromValue)
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (directReasoning) return directReasoning;

  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part.type !== "text" && part.type !== "image_url")
    .map(getReasoningTextFromValue)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function getChatCompletionPayloadReasoning(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const choiceRecord =
    choices[0] && typeof choices[0] === "object" && !Array.isArray(choices[0])
      ? (choices[0] as Record<string, unknown>)
      : {};
  const messageReasoning =
    choiceRecord.message && typeof choiceRecord.message === "object"
      ? getChatApiMessageReasoning(choiceRecord.message as ChatApiMessage)
      : "";
  return [
    messageReasoning,
    choiceRecord.reasoning,
    choiceRecord.reasoning_content,
    record.reasoning,
    record.reasoning_content,
    record.output_reasoning,
  ]
    .map(getReasoningTextFromValue)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

async function createChatAttachmentFromFile(file: File): Promise<ChatAttachment> {
  const type = file.type || "application/octet-stream";
  const shouldReadDataUrl = type.startsWith("image/");
  const dataUrl = shouldReadDataUrl ? await readFileAsDataUrl(file) : undefined;
  const textContent = isTextLikeFile(file.name, type) ? await file.text() : undefined;

  return {
    id: crypto.randomUUID(),
    name: file.name || "未命名文件",
    type,
    size: file.size,
    ...(dataUrl ? { dataUrl } : {}),
    ...(textContent !== undefined ? { textContent } : {}),
    createdAt: new Date().toISOString(),
  };
}

function stripBase64Prefix(value: string) {
  const trimmedValue = value.trim();
  const commaIndex = trimmedValue.indexOf(",");
  return trimmedValue.startsWith("data:") && commaIndex >= 0
    ? trimmedValue.slice(commaIndex + 1)
    : trimmedValue;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64Value: string) {
  const cleanBase64 = stripBase64Prefix(base64Value).replace(/\s+/g, "");
  const binary = atob(cleanBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function createImagePreviewDataUrl(blob: Blob, maxSide = 768) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("图片预览加载失败"));
      nextImage.src = objectUrl;
    });
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建图片预览画布");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.78),
      width,
      height,
      originalWidth: image.naturalWidth,
      originalHeight: image.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function buildChatSenderContextPrompt(
  messages: ChatMessage[],
  personas: AgentPersona[],
  activeChatPersona?: AgentPersona,
) {
  const personaSenderMessages = messages.filter(
    (message) => message.role === "user" && message.sender?.kind === "persona",
  );
  const hasSystemSender = messages.some(
    (message) => message.role === "user" && message.sender?.kind === "system",
  );

  if (personaSenderMessages.length === 0 && !hasSystemSender) return "";

  const hasSelfSender =
    Boolean(activeChatPersona) &&
    personaSenderMessages.some((message) => message.sender?.personaId === activeChatPersona?.id);
  const personaSenderNames = Array.from(
    new Set(
      personaSenderMessages
        .map((message) => getChatSenderPersona(message.sender, personas)?.name)
        .filter((name): name is string => Boolean(name)),
    ),
  );

  return [
    "发言身份规则：",
    personaSenderNames.length > 0
      ? `- 用户消息中出现的【${personaSenderNames.join("】、【")}】前缀表示该条消息由对应人格 Agent 发出。`
      : "",
    hasSelfSender && activeChatPersona
      ? `- 当消息前缀是【${activeChatPersona.name}（你自己）】时，它表示当前对话人格本人的发言、想法或自我指令；不要把它理解为另一个同名用户。`
      : "",
    hasSystemSender
      ? "- 【系统提示词】前缀表示用户正在以系统指令方式要求当前人格 Agent 调整回复。"
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatMemoryMessage(
  message: ChatMessage,
  personas: AgentPersona[],
  userProfile: UserProfile,
  activeChatPersona?: AgentPersona,
) {
  const assistantPersona = getAssistantMessagePersona(
    message,
    personas,
    activeChatPersona,
  );
  const speaker =
    message.role === "assistant"
      ? assistantPersona?.name ?? "AI"
      : getChatSenderName(message.sender, personas, userProfile);
  return `${speaker}：${message.content.trim()}`;
}

function buildPersonaMemoryPrompt(
  sessions: ChatSession[],
  activeSessionId: string,
  persona: AgentPersona | undefined,
  personas: AgentPersona[],
  userProfile: UserProfile,
) {
  if (!persona) return "";

  const memorySessions = sessions.filter(
    (session) =>
      session.id !== activeSessionId &&
      session.memoryPersonaIds.includes(persona.id) &&
      session.messages.some((message) => message.content.trim()),
  );

  if (memorySessions.length === 0) return "";

  return [
    `以下是你可参考的长期会话记忆，仅用于延续与「${persona.name}」相关的人格、关系和上下文；不要逐字复述，除非用户要求：`,
    ...memorySessions.map((session) =>
      [
        `## ${session.title || "未命名会话"} / ${session.workspaceName}`,
        ...session.messages
          .filter((message) => message.content.trim())
          .map((message) => `- ${formatMemoryMessage(message, personas, userProfile, persona)}`),
      ].join("\n"),
    ),
  ].join("\n\n");
}

function getAvailableLocalToolDefinitions(
  handle: LocalDirectoryHandle | ElectronWorkspaceHandle | AndroidWorkspaceHandle | PcWorkspaceHandle | null,
) {
  if (!handle) return [];
  if (handle.kind === "electron") {
    return localFileToolDefinitions.filter(
      (tool) =>
        tool.function.name !== "local_transfer_file" &&
        tool.function.name !== "local_send_pc_file",
    );
  }

  if (handle.kind === "android") {
    const androidUnsupportedTools = new Set([
      "local_rename_path",
      "local_run_script",
      "local_run_command",
      "local_git_status",
      "local_git_diff",
      "project_detect_stack",
      "project_find_symbols",
      "project_search_regex",
      "project_read_package_json",
      "project_todo_scan",
    ]);
    return localFileToolDefinitions.filter(
      (tool) => !androidUnsupportedTools.has(tool.function.name),
    );
  }

  if (handle.kind === "pc") {
    const pcUnsupportedTools = new Set([
      "local_rename_path",
      "local_run_script",
      "local_run_command",
      "local_git_status",
      "local_git_diff",
      "project_detect_stack",
      "project_find_symbols",
      "project_search_regex",
      "project_read_package_json",
      "project_todo_scan",
    ]);
    return localFileToolDefinitions.filter(
      (tool) => !pcUnsupportedTools.has(tool.function.name),
    );
  }

  const browserUnsupportedTools = new Set([
    "local_rename_path",
    "local_run_script",
    "local_run_command",
    "local_git_status",
    "local_git_diff",
    "local_transfer_file",
    "local_send_pc_file",
  ]);
  return localFileToolDefinitions.filter(
    (tool) => !browserUnsupportedTools.has(tool.function.name),
  );
}

const heartbeatToolDefinitions: ChatToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "chat_update_heartbeat",
      description: "更新当前会话的心跳机制设置。可开启/关闭心跳、修改间隔分钟数、待执行事件、有限/无限循环次数，并可重置已执行次数。",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean", description: "是否开启当前会话心跳。" },
          intervalMinutes: {
            type: "number",
            description: "心跳间隔分钟数，范围 1 到 1440。",
          },
          event: {
            type: "string",
            description: "每次心跳时需要 AI 检查或执行的事件/任务描述。",
          },
          loopLimit: {
            type: ["number", "null"],
            description: "循环次数上限；传 null 表示无限循环直到程序关闭或心跳关闭。",
          },
          resetRunCount: {
            type: "boolean",
            description: "是否把已执行次数重置为 0。修改任务或循环次数时建议传 true。",
          },
        },
      },
    },
  },
];

const multiAgentControlToolDefinitions: ChatToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "multi_agent_end_rounds",
      description:
        "当用户设置的多 Agent 提前结束条件已经明确满足时，结束当前回复之后的所有 Agent 和所有剩余轮次。未满足条件时禁止调用。",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "为什么判断用户设置的提前结束条件已经满足。",
          },
          evidence: {
            type: "string",
            description: "可选，列出对话中支持结束判断的简短依据。",
          },
        },
        required: ["reason"],
      },
    },
  },
];

function isSilentChatControlTool(toolName: string) {
  return toolName === "multi_agent_end_rounds";
}

function shouldExposeHeartbeatTools(content: string) {
  return /心跳|heartbeat|定时|循环|每隔|每过|分钟|自动检查|自动执行|开启心跳|关闭心跳/.test(
    content,
  );
}

function buildHeartbeatSystemPrompt(heartbeat: ChatHeartbeatConfig | undefined) {
  const config = heartbeat ?? createDefaultHeartbeatConfig();
  return [
    "你拥有修改当前会话心跳机制的权限。",
    "当用户要求开启、关闭、调整心跳间隔、待执行事件或循环次数时，必须调用 chat_update_heartbeat 工具保存设置。",
    "心跳触发时，请先完成本轮待执行事件并说明结果；如果需要关闭或调整心跳，把 chat_update_heartbeat 工具调用放在本轮任务完成之后。",
    `当前心跳：${config.enabled ? "开启" : "关闭"}；间隔 ${config.intervalMinutes} 分钟；已执行 ${config.runCount} 次；循环 ${
      config.loopLimit === null ? "无限" : `${config.loopLimit} 次`
    }；事件：${config.event.trim() || "未设置"}`,
  ].join("\n");
}

function buildLocalToolsSystemPrompt(
  handle: LocalDirectoryHandle | ElectronWorkspaceHandle | AndroidWorkspaceHandle | PcWorkspaceHandle | null,
) {
  if (!handle) return "";

  const commonTools = [
    "- local_list_files：列出工作区文件和目录。",
    "- local_read_file：读取完整文本文件。",
    "- local_preview_pc_image：读取已连接电脑工作区内图片的压缩预览图，用于视觉筛选；不会读取原图 Base64。",
    "- local_read_binary_file：读取任意文件并返回 Base64，仅在用户明确需要 Base64 或小文件二进制内容时使用，不要用于查看/筛选图片。",
    "- local_read_file_range：按行读取大文件片段。",
    "- local_file_info：查看文件或目录元信息。",
    "- local_search_files：按文件名或文本内容搜索。",
    "- local_create_directory：创建目录。",
    "- local_write_file：新建或覆盖写入文本文件。",
    "- local_write_binary_file：把 Base64 写成任意文件，适合保存 ZIP、图片、音频、视频、APK 等二进制文件。",
    "- local_transfer_attachment_file：把聊天里的附件或 AI 生成图片直接保存到当前授权工作区，适合保存图片、ZIP、APK、音频、视频等；生成图片可用 generated-image-1.png、generated-image-2.png 这样的名称或附件ID；不会把附件内容交给 AI 分析。",
    "- local_transfer_file：在手机工作区和已连接电脑工作区之间直接流式传输文件，适合大文件；不会把文件内容读入模型上下文或 JS 内存。",
    "- local_send_pc_file：把已连接电脑工作区里的文件作为可下载附件发给用户；不会读取文件内容给 AI。",
    "- local_edit_file：查找替换编辑文本文件。",
    "- local_delete_path：删除文件或目录。",
  ];
  const browserProjectTools =
    handle.kind === "android"
      || handle.kind === "pc"
      ? []
      : [
          "- project_detect_stack：检测项目技术栈、脚本和关键配置。",
          "- project_find_symbols：查找函数、类、接口、类型、枚举、变量等符号定义。",
          "- project_search_regex：使用正则搜索工作区文本文件。",
          "- project_read_package_json：读取并解析 package.json。",
          "- project_todo_scan：扫描 TODO/FIXME/BUG/HACK。",
        ];
  const electronTools =
    handle.kind === "electron"
      ? [
          "- local_rename_path：重命名或移动文件/目录。",
          "- local_run_script：运行 package.json 中已存在的 npm script。",
          "- local_run_command：运行安全白名单命令；高风险 git 子命令会弹窗请求用户授权，用户授权后可以执行。",
          "- local_git_status：查看 Git 状态。",
          "- local_git_diff：查看 Git diff。",
        ]
      : [
          "- 当前是浏览器/Android 目录授权环境，不支持 local_rename_path、local_run_script、local_run_command、local_git_status、local_git_diff；不要声称已经重命名/运行命令/运行脚本/读取 Git 状态。",
        ];

  return [
    `你可以使用本地文件工具操作用户授权的工作区「${handle.name}」。`,
    "所有 path/from/to 必须是相对工作区根目录的路径；不要使用绝对路径或 ..。",
    "当用户已经明确要求执行文件操作时，不要二次确认，必须直接调用对应工具；不要只描述将要操作。",
    "当用户提出安装、部署、创建启动脚本、构建验证等多步骤任务时，必须连续调用工具推进，直到任务完成、遇到真实阻塞或用户中断；不要在中途只汇报计划并要求用户继续。",
    "如果用户要求重命名或移动文件/目录，并且 local_rename_path 可用，必须调用 local_rename_path。",
    "如果用户要求创建目录，并且 local_create_directory 可用，必须调用 local_create_directory。",
    "如果用户要求保存、存入、放进、传输、还原、复制已有 Base64 内容为文件，必须调用 local_write_binary_file；不要把 ZIP/APK/图片等二进制文件保存为 .txt 或 .base64，除非用户明确要求。",
    "如果用户以任何自然语言表达要求把刚上传到聊天里的附件保存、放入、移动、传送、复制或加入当前工作区/文件夹/项目，并且 local_transfer_attachment_file 可用，必须只调用 local_transfer_attachment_file；你需要按语义自行判断，不要依赖固定关键词；不要再调用 local_write_binary_file 覆盖同名文件，不要自己编造或截断 Base64。",
    "如果用户要求阅读、查看、筛选、比较电脑工作区里的图片，必须先用 local_list_files 找候选，再对少量候选调用 local_preview_pc_image 观看压缩预览；不要调用 local_read_binary_file 读取原图 Base64。",
    "如果用户要求把工作区文件传给另一端、导出为附件或读取二进制文件，必须调用 local_read_binary_file 获取 Base64。",
    "如果用户要求在手机和电脑之间传输大文件，并且 local_transfer_file 可用，必须优先调用 local_transfer_file；不要先读取文件内容，不要 Base64 编码。",
    "如果用户要求把电脑工作区里的文件发给我、下载给我、给我一个附件或让我保存，必须调用 local_send_pc_file；不要读取文件内容，不要 Base64 编码。",
    "如果用户要求读取大文件局部内容，优先调用 local_read_file_range。",
    "只有删除、覆盖写入、目标路径已存在会被覆盖、或用户意图含糊时才需要先确认；普通重命名/移动/创建目录/读取/搜索不需要确认。",
    "禁止在未收到工具成功结果前声称已经执行完成。",
    "当你需要把用户可复制或可执行的命令展示出来时，使用 ```shell 代码块；普通代码使用对应语言代码块。",
    "当前可用工具：",
    ...commonTools,
    ...browserProjectTools,
    ...electronTools,
  ].join("\n");
}

function buildMcpToolsSystemPrompt(tools: McpToolDefinition[]) {
  if (tools.length === 0) return "";

  return [
    "你可以使用用户在设置中启用的 MCP 服务器工具。",
    "MCP 工具可能访问外部服务、本机进程或用户配置的资源；只有当工具能力与用户请求相关时才调用。",
    "禁止在未收到 MCP 工具成功结果前声称已经完成外部操作。",
    "如果存在 describe-image、image-recognition、qwen-vl-image 等图像识别 MCP 工具，并且用户要求分析图片、识别图片文字、说明图片内容或当前聊天模型不能直接接收 image_url，必须优先使用图像识别 MCP 的结果回答，不要假装已经直接看见图片。",
    "图像识别 MCP 只负责按用户问题提取和回传图片中的视觉信息，不负责文件保存或附件传输。",
    "用户上传聊天图片并询问图片相关问题时，不要调用 local_preview_pc_image 或 local_transfer_attachment_file；这些工具只用于用户明确要求查看电脑工作区文件、保存或传输附件。",
    "如果使用 Chrome DevTools MCP 控制浏览器，必须原样使用快照中的 uid 字符串，不要拆分、补下划线或改写 uid；例如快照显示 uid=2204 时，参数必须传 \"2204\"。",
    "如果使用 Chrome DevTools MCP 执行点击、填写、导航、提交、发帖、回复等会改变页面状态的操作，工具返回成功只表示动作已发出；在告诉用户完成前，必须再次调用 take_snapshot 或等价观察工具确认页面状态，尤其要确认用户要求发送的文本已经出现在页面或页面明确显示提交成功。",
    "如果用户要求你在网页里回复、发帖或发送消息，必须按完整闭环执行：观察当前页面，找到回复/发送入口，必要时点击入口打开编辑器，观察编辑器，填写用户给定的原文，点击发送/回复按钮，等待页面变化，再观察确认文本已经发布。不要只滚动页面或只打开编辑器后就结束。",
    "在论坛类页面中，如果底部没有可填写的回复框，先点击页面上的「回复」按钮或同等入口打开编辑器；如果填写工具返回成功，仍必须点击真正的提交按钮并再次观察确认。",
    "在 Discourse/LINUX DO 这类话题页中，普通滚动可能不会直接加载底部编辑器；如果快照里有「跳转到最后一条回复」或话题内「回复」按钮，优先点击这些可访问元素，再重新 take_snapshot 查找编辑器。",
    "当前可用 MCP 工具：",
    ...tools.map((tool) => `- ${tool.function.name}：${tool.serverName}/${tool.originalName}`),
  ].join("\n");
}

function getMcpToolInfo(tools: McpToolDefinition[], toolName: string) {
  return tools.find((tool) => tool.function.name === toolName);
}

function isMcpToolName(toolName: string) {
  return toolName.startsWith("mcp_");
}

const CHROME_DEVTOOLS_MUTATION_TOOL_NAMES = new Set([
  "click",
  "close_page",
  "drag",
  "evaluate_script",
  "fill",
  "fill_form",
  "handle_dialog",
  "navigate_page",
  "navigate_page_history",
  "new_page",
  "press_key",
  "resize_page",
  "select_page",
  "upload_file",
]);

const CHROME_DEVTOOLS_OBSERVATION_TOOL_NAMES = new Set([
  "take_snapshot",
  "take_screenshot",
  "wait_for",
]);

function isChromeDevtoolsMcpTool(tool: McpToolDefinition | undefined): tool is McpToolDefinition {
  if (!tool) return false;
  const serverName = tool.serverName.toLowerCase();
  return serverName.includes("chrome") && serverName.includes("devtools");
}

function needsChromeDevtoolsObservation(toolCall: ChatToolCall, tools: McpToolDefinition[]) {
  const tool = getMcpToolInfo(tools, toolCall.function.name);
  if (!isChromeDevtoolsMcpTool(tool)) return false;
  return CHROME_DEVTOOLS_MUTATION_TOOL_NAMES.has(tool.originalName);
}

function isChromeDevtoolsObservation(toolCall: ChatToolCall, tools: McpToolDefinition[]) {
  const tool = getMcpToolInfo(tools, toolCall.function.name);
  if (!isChromeDevtoolsMcpTool(tool)) return false;
  return CHROME_DEVTOOLS_OBSERVATION_TOOL_NAMES.has(tool.originalName);
}

function getChromeDevtoolsSnapshotToolName(tools: McpToolDefinition[]) {
  return tools.find(
    (tool) => isChromeDevtoolsMcpTool(tool) && tool.originalName === "take_snapshot",
  )?.function.name;
}

function buildChromeDevtoolsObservationPrompt(tools: McpToolDefinition[]) {
  const snapshotToolName = getChromeDevtoolsSnapshotToolName(tools);
  const preferredToolText = snapshotToolName
    ? `优先调用 ${snapshotToolName}`
    : "优先调用 Chrome DevTools MCP 的 take_snapshot";

  return [
    "刚才已经执行过 Chrome DevTools MCP 的浏览器写操作，但还没有观察页面确认结果。",
    `${preferredToolText} 或等价观察工具读取当前页面状态。`,
    "如果用户的任务还没有完成，例如只是滚动页面、打开了编辑器或填了文字但还没点击提交，请继续执行下一步工具调用，不要回复用户已经完成。",
    "如果这是回复、发帖、提交表单或发送消息任务，必须确认用户要求发送的文本已经出现在页面、输入框已清空并提交成功，或页面明确显示成功状态。",
    "如果无法确认，不要告诉用户已经完成；继续用工具排查或说明真实阻塞。",
  ].join("\n");
}

function shouldRequireLocalToolCall(
  messages: ChatMessage[],
  handle: LocalDirectoryHandle | ElectronWorkspaceHandle | AndroidWorkspaceHandle | PcWorkspaceHandle | null,
) {
  if (!handle) return false;

  const recentText = messages
    .slice(-4)
    .map((message) =>
      [
        message.content,
        ...(message.attachments ?? []).map((attachment) => attachment.name),
      ].join("\n"),
    )
    .join("\n")
    .toLowerCase();

  if (!recentText.trim()) return false;

  const operationPattern =
    /(安装|部署|启动|运行|构建|打包|验证|检查|创建|新建|写入|生成|保存|存进|存入|存到|放到|放进|放入|放至|加到|拷贝|传输|上传|下载|发给我|发送|复制|还原|导出|导入|重命名|改名|名字改|文件夹名|移动|挪到|mkdir|删除|删掉|移除|读取|阅读|预览|查看|搜索|查找|筛选|比较|覆盖|编辑|替换|执行|npm run|build|test|lint|install|deploy|setup|start|serve|rename|move|create|delete|remove|read|preview|search|write|edit|replace|save|transfer|upload|download|send|copy|export|import)/i;
  const fileContextPattern =
    /(项目|依赖|脚本|附件|二进制|base64|zip|apk|图片|音频|视频|bat|cmd|文件|文件夹|目录|工作区|路径|package\.json|\.tsx|\.ts|\.js|\.json|\.md|\.txt|\.zip|\.apk|\.png|\.jpg|\.jpeg|\.webp|folder|directory|file|path|script|project|attachment|binary)/i;
  const shortExecutionPattern = /^(执行|执行吧|开始|开始吧|可以|确认|继续|run|go|ok|yes)$/i;
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const latestText = latestUserMessage?.content.trim().toLowerCase() ?? "";

  return (
    (operationPattern.test(recentText) && fileContextPattern.test(recentText)) ||
    (shortExecutionPattern.test(latestText) && operationPattern.test(recentText))
  );
}

function shouldAutoContinueLocalTask(content: string) {
  const normalizedContent = content.trim();
  if (!normalizedContent) return false;

  return /(还没有完成|尚未完成|需要继续|继续执行|下一步|还需要|待完成|未完成|没有完成|需要安装|需要创建|需要构建|need to continue|not complete|next step|still need)/i.test(
    normalizedContent,
  );
}

function appendAssistantTimelineMessage(
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  content: string,
  attachments: ChatAttachment[] = [],
  reasoning = "",
  sender?: ChatSenderIdentity,
) {
  const trimmedContent = content.trim();
  const trimmedReasoning = reasoning.trim();
  if (!trimmedContent && attachments.length === 0) return;

  setChatMessages((current) => [
    ...current,
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content: trimmedContent,
      ...(trimmedReasoning ? { reasoning: trimmedReasoning } : {}),
      ...(sender ? { sender } : {}),
      createdAt: new Date().toISOString(),
      ...(attachments.length > 0 ? { attachments } : {}),
    },
  ]);
}

function parseToolCallArgs(toolCall: ChatToolCall) {
  try {
    const parsed = JSON.parse(toolCall.function.arguments) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function resolveCharacterWorldBook(
  card: CharacterCard,
  availableWorldBooks: WorldBook[],
) {
  if (card.characterBook?.entries.length) return card.characterBook;
  const linkedName =
    (typeof card.extensions.world === "string" ? card.extensions.world.trim() : "") ||
    card.characterBook?.name.trim() ||
    "";
  if (!linkedName) return card.characterBook;
  return (
    availableWorldBooks.find((book) => book.name.trim() === linkedName) ??
    card.characterBook
  );
}

function stringArg(args: Record<string, unknown>, key: string, fallback = "") {
  const value = args[key];
  return value === undefined || value === null ? fallback : String(value);
}

function compactOneLine(value: string, limit = 120) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
}

function trimBlock(value: string, limit = 900) {
  const trimmed = value.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}\n...` : trimmed;
}

function normalizeWorkspaceRelativePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/g, "");
}

function formatWorkspacePathReference(
  handle: LocalDirectoryHandle | ElectronWorkspaceHandle | AndroidWorkspaceHandle | PcWorkspaceHandle | null,
  path: string,
) {
  const relativePath = normalizeWorkspaceRelativePath(path) || ".";
  if (handle?.kind !== "electron") return relativePath;

  const rootPath = handle.path.replace(/\\/g, "/").replace(/\/+$/g, "");
  const absolutePath = relativePath === "." ? rootPath : `${rootPath}/${relativePath}`;
  return `${absolutePath}`;
}

function formatToolActionMessage(
  toolCall: ChatToolCall,
  handle: LocalDirectoryHandle | ElectronWorkspaceHandle | AndroidWorkspaceHandle | PcWorkspaceHandle | null,
  mcpTools: McpToolDefinition[] = [],
) {
  const args = parseToolCallArgs(toolCall);
  const mcpTool = getMcpToolInfo(mcpTools, toolCall.function.name);
  if (mcpTool) {
    return `执行 MCP 工具：${mcpTool.serverName}/${mcpTool.originalName}\n参数：${compactOneLine(JSON.stringify(args), 220)}`;
  }
  const path = stringArg(args, "path");
  const from = stringArg(args, "from");
  const to = stringArg(args, "to");
  const query = stringArg(args, "query");
  const pattern = stringArg(args, "pattern");
  const script = stringArg(args, "script");
  const command = stringArg(args, "command");
  const argList = Array.isArray(args.args) ? args.args.map(String) : [];
  const pathRef = path ? formatWorkspacePathReference(handle, path) : "";

  switch (toolCall.function.name) {
    case "local_list_files":
      return `列出文件：\n${formatWorkspacePathReference(handle, path)}${args.recursive === false ? "\n仅当前目录" : "\n递归扫描"}`;
    case "local_read_file":
      return `读取文件：\n${pathRef}`;
    case "local_preview_pc_image":
      return `预览电脑图片：\n${String(args.path ?? "")}`;
    case "local_read_binary_file":
      return `读取二进制文件：\n${pathRef}`;
    case "local_read_file_range":
      return [
        "读取文件片段：",
        pathRef,
        `第 ${Number(args.startLine ?? 1)}-${Number(args.endLine ?? Number(args.startLine ?? 1) + 120)} 行`,
      ].join("\n");
    case "local_file_info":
      return `查看路径信息：\n${formatWorkspacePathReference(handle, path)}`;
    case "local_search_files":
      return [`搜索文件：${query || "未指定关键词"}`, path ? `范围：${pathRef}` : ""]
        .filter(Boolean)
        .join("\n");
    case "local_create_directory":
      return `创建目录：\n${pathRef}`;
    case "local_rename_path":
      return `重命名/移动：\n${formatWorkspacePathReference(handle, from)}\n-> ${formatWorkspacePathReference(handle, to)}`;
    case "local_run_script":
      return `运行脚本：\nnpm run ${script}${argList.length ? ` -- ${argList.join(" ")}` : ""}`;
    case "local_run_command":
      return `运行命令：\n${[command, ...argList].filter(Boolean).join(" ")}`;
    case "local_git_status":
      return "查看 Git 状态。";
    case "local_git_diff":
      return `查看 Git diff${args.staged ? "（暂存区）" : ""}${path ? `：\n${pathRef}` : "。"}`;
    case "project_detect_stack":
      return "检测项目技术栈。";
    case "project_find_symbols":
      return [
        `查找符号：${query || "全部"}`,
        path ? `范围：${pathRef}` : "",
      ].filter(Boolean).join("\n");
    case "project_search_regex":
      return [
        `正则搜索：${pattern || "未指定表达式"}`,
        path ? `范围：${pathRef}` : "",
      ].filter(Boolean).join("\n");
    case "project_read_package_json":
      return "读取 package.json。";
    case "project_todo_scan":
      return `扫描 TODO/FIXME：\n${formatWorkspacePathReference(handle, path)}`;
    case "local_write_file":
      return `写入文件：\n${pathRef}`;
    case "local_write_binary_file":
      return `写入二进制文件：\n${pathRef}`;
    case "local_transfer_attachment_file":
      return [
        "上传附件直传电脑：",
        `附件ID：${String(args.attachmentId ?? "")}`,
        `目标：${String(args.targetPath ?? "")}`,
      ].join("\n");
    case "local_transfer_file":
      return [
        String(args.direction ?? "") === "pc_to_phone" ? "电脑传到手机：" : "手机传到电脑：",
        `源：${formatWorkspacePathReference(handle, String(args.sourcePath ?? ""))}`,
        `目标：${String(args.targetPath ?? "")}`,
      ].join("\n");
    case "local_send_pc_file":
      return `发送电脑文件给用户：\n${String(args.path ?? "")}`;
    case "local_edit_file":
      return `修改文件：\n${pathRef}`;
    case "local_delete_path":
      return `删除路径：\n${pathRef}${args.recursive ? "\n包含子目录" : ""}`;
    case "chat_update_heartbeat":
      return "更新当前会话心跳设置。";
    case "multi_agent_end_rounds":
      return "";
    default:
      return `执行本地工具：${toolCall.function.name}`;
  }
}

function formatResultListPreview(items: unknown[], limit = 6) {
  return items
    .slice(0, limit)
    .map((item) => {
      if (isObjectRecord(item)) {
        const path = typeof item.path === "string" ? item.path : "";
        const line = typeof item.line === "number" ? `:${item.line}` : "";
        const name = typeof item.name === "string" ? ` ${item.name}` : "";
        const kind = typeof item.kind === "string" ? ` ${item.kind}` : "";
        const text = typeof item.text === "string"
          ? ` ${compactOneLine(item.text, 96)}`
          : typeof item.preview === "string"
            ? ` ${compactOneLine(item.preview, 96)}`
            : "";
        if (path) return `- ${path}${line}${name || kind}${text}`;
      }
      return `- ${compactOneLine(String(item), 120)}`;
    })
    .join("\n");
}

function formatCommandResult(result: Record<string, unknown>, successTitle: string) {
  const ok = result.ok !== false;
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  const exitCode = result.exitCode === undefined || result.exitCode === null
    ? ""
    : `，退出码 ${String(result.exitCode)}`;
  const title = ok ? successTitle : result.canceled ? "用户取消授权，命令未执行。" : `命令执行失败${exitCode}。`;
  const output = [
    stdout ? `输出：\n${trimBlock(stdout, 700)}` : "",
    stderr ? `错误输出：\n${trimBlock(stderr, 500)}` : "",
  ].filter(Boolean).join("\n\n");
  return output ? `${title}\n${output}` : title;
}

function getMcpResultPayload(result: unknown) {
  if (!isObjectRecord(result)) return null;
  return isObjectRecord(result.result) ? result.result : result;
}

function getMcpContentItems(result: unknown) {
  const payload = getMcpResultPayload(result);
  if (!payload || !Array.isArray(payload.content)) return [];
  return payload.content.filter((item): item is Record<string, unknown> => isObjectRecord(item));
}

function getMcpTextContentItems(result: unknown) {
  return getMcpContentItems(result).filter(
    (item) => item.type === "text" && typeof item.text === "string",
  );
}

function getMcpImageContentItems(result: unknown) {
  return getMcpContentItems(result).filter(
    (item) => item.type === "image" && typeof item.data === "string" && item.data.trim(),
  );
}

function getMcpImageMimeType(item: Record<string, unknown>) {
  const data = typeof item.data === "string" ? item.data.trim() : "";
  const dataUrlMatch = data.match(/^data:([^;,]+)[;,]/i);
  if (dataUrlMatch?.[1]) return dataUrlMatch[1];

  const mimeType = item.mimeType ?? item.mime_type;
  const normalized = typeof mimeType === "string" ? mimeType.trim() : "";
  return normalized || "image/png";
}

function getMcpImageDataUrl(item: Record<string, unknown>) {
  const data = typeof item.data === "string" ? item.data.trim() : "";
  if (data.startsWith("data:")) return data;
  return `data:${getMcpImageMimeType(item)};base64,${stripBase64Prefix(data).replace(/\s+/g, "")}`;
}

function getBase64Length(value: string) {
  return stripBase64Prefix(value).replace(/\s+/g, "").length;
}

function estimateBase64Bytes(value: string) {
  const base64 = stripBase64Prefix(value).replace(/\s+/g, "");
  if (!base64) return 0;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function getMimeExtension(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/bmp":
      return "bmp";
    case "image/svg+xml":
      return "svg";
    default:
      return "png";
  }
}

function getMcpImageAttachments(result: unknown): ChatAttachment[] {
  return getMcpImageContentItems(result).map((item, index) => {
    const mimeType = getMcpImageMimeType(item);
    const rawName = typeof item.name === "string" ? item.name.trim() : "";
    const extension = getMimeExtension(mimeType);
    const data = typeof item.data === "string" ? item.data : "";
    return {
      id: crypto.randomUUID(),
      name: rawName || `mcp-image-${index + 1}.${extension}`,
      type: mimeType,
      size: estimateBase64Bytes(data),
      dataUrl: getMcpImageDataUrl(item),
      createdAt: new Date().toISOString(),
    };
  });
}

function sanitizeToolResultForApiValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeToolResultForApiValue(item));
  if (!isObjectRecord(value)) return value;

  const output: Record<string, unknown> = {};
  const isImageContent = value.type === "image";
  for (const [key, itemValue] of Object.entries(value)) {
    if (key === "previewDataUrl") continue;
    if (isImageContent && key === "data" && typeof itemValue === "string") {
      output.data = `[base64 image omitted: ${getBase64Length(itemValue)} chars]`;
      continue;
    }
    if (key === "dataUrl" && typeof itemValue === "string" && itemValue.startsWith("data:")) {
      output.dataUrl = `[data URL omitted: ${getBase64Length(itemValue)} chars]`;
      continue;
    }
    output[key] = sanitizeToolResultForApiValue(itemValue);
  }
  return output;
}

function formatMcpToolResultSummary(result: unknown) {
  const contentItems = getMcpContentItems(result);
  const textItems = getMcpTextContentItems(result);
  const imageItems = getMcpImageContentItems(result);

  if (contentItems.length === 0) {
    const raw = JSON.stringify(sanitizeToolResultForApiValue(result), null, 2);
    return raw ? trimBlock(raw, 700) : "";
  }

  const lines = [
    textItems.length > 0
      ? `文本：\n${trimBlock(textItems.map((item) => String(item.text ?? "")).join("\n\n"), 600)}`
      : "",
    imageItems.length > 0
      ? [
          `返回 ${imageItems.length} 张图片，已在消息中展示，并会作为视觉输入发送给模型。`,
          ...imageItems.map((item, index) => {
            const mimeType = getMcpImageMimeType(item);
            const data = typeof item.data === "string" ? item.data : "";
            return `- 图片 ${index + 1}: ${mimeType}，约 ${formatFileSize(estimateBase64Bytes(data))}，base64 ${getBase64Length(data)} 字符`;
          }),
        ].join("\n")
      : "",
  ].filter(Boolean);

  const otherTypes = contentItems
    .filter((item) => item.type !== "text" && item.type !== "image")
    .map((item) => String(item.type ?? "unknown"));
  if (otherTypes.length > 0) {
    lines.push(`另有 ${otherTypes.length} 个非文本/图片内容：${otherTypes.join("、")}`);
  }

  return lines.join("\n\n");
}

function formatToolResultMessage(toolCall: ChatToolCall, result: unknown) {
  const args = parseToolCallArgs(toolCall);
  const path = stringArg(args, "path");

  if (Array.isArray(result)) {
    const preview = formatResultListPreview(result);
    const title =
      toolCall.function.name === "local_list_files"
        ? `列出 ${result.length} 个条目。`
        : `找到 ${result.length} 条结果。`;
    return preview ? `${title}\n${preview}` : title;
  }

  if (!isObjectRecord(result)) {
    return compactOneLine(String(result || "已完成。"), 260);
  }

  switch (toolCall.function.name) {
    case "local_read_file": {
      const content = typeof result.content === "string" ? result.content : "";
      return `已读取文件：${String(result.path ?? path)}${content ? `（${content.length} 字符）` : ""}`;
    }
    case "local_read_binary_file":
      return `已读取二进制文件：${String(result.path ?? path)}${result.size !== undefined ? `（${String(result.size)} bytes）` : ""}`;
    case "local_preview_pc_image":
      return `已生成图片预览：${String(result.path ?? args.path ?? "")}${result.originalBytes !== undefined ? `（原图 ${String(result.originalBytes)} bytes）` : ""}`;
    case "local_read_file_range": {
      const content = typeof result.content === "string" ? result.content : "";
      return [
        `已读取 ${String(result.path ?? path)} 第 ${String(result.startLine ?? "?")}-${String(result.endLine ?? "?")} 行。`,
        result.totalLines ? `共 ${String(result.totalLines)} 行。` : "",
        content ? `预览：\n${trimBlock(content, 500)}` : "",
      ].filter(Boolean).join("\n");
    }
    case "local_file_info":
      return `已查看路径信息：${String(result.path ?? (path || "."))}（${String(result.kind ?? "unknown")}${result.size !== undefined ? `，${String(result.size)} bytes` : ""}）`;
    case "local_create_directory":
      return `已创建目录：${String(result.path ?? path)}`;
    case "local_rename_path":
      return `已重命名/移动：${String(result.from ?? args.from ?? "")} -> ${String(result.to ?? args.to ?? "")}`;
    case "local_write_file":
      return `已写入文件：${String(result.path ?? path)}`;
    case "local_write_binary_file":
      return `已写入二进制文件：${String(result.path ?? path)}${result.bytes !== undefined ? `（${String(result.bytes)} bytes）` : ""}`;
    case "local_transfer_attachment_file":
      if (result.skipped) {
        return `未执行附件直传：${String(result.message ?? "当前请求不需要传输附件。")}`;
      }
      return `附件已保存到工作区：${String(result.name ?? result.attachmentId ?? args.attachmentId ?? "")} -> ${String(result.targetPath ?? args.targetPath ?? "")}${result.bytes !== undefined ? `（${String(result.bytes)} bytes）` : ""}`;
    case "local_transfer_file":
      return `文件直传完成：${String(result.sourcePath ?? args.sourcePath ?? "")} -> ${String(result.targetPath ?? args.targetPath ?? "")}${result.bytes !== undefined ? `（${String(result.bytes)} bytes）` : ""}`;
    case "local_send_pc_file":
      return `已生成可下载附件：${String(result.name ?? result.path ?? args.path ?? "")}${result.size !== undefined ? `（${String(result.size)} bytes）` : ""}`;
    case "local_edit_file":
      return `编辑了 1 个文件\n已修改 ${String(result.path ?? path)}${result.replacements !== undefined ? `，替换 ${String(result.replacements)} 处` : ""}${result.bytes !== undefined ? `，${String(result.bytes)} bytes` : ""}`;
    case "local_delete_path":
      return `已删除路径：${String(result.path ?? path)}`;
    case "chat_update_heartbeat":
      return `心跳${result.pending ? "将在本轮心跳完成后更新" : "已更新"}：${result.enabled ? "开启" : "关闭"}，每 ${String(result.intervalMinutes ?? DEFAULT_HEARTBEAT_INTERVAL_MINUTES)} 分钟，${
        result.loopLimit === null || result.loopLimit === undefined ? "无限循环" : `循环 ${String(result.loopLimit)} 次`
      }，已执行 ${String(result.runCount ?? 0)} 次。`;
    case "multi_agent_end_rounds":
      return "";
    case "local_run_script":
      return formatCommandResult(result, `脚本执行完成：npm run ${String(result.script ?? args.script ?? "")}`);
    case "local_run_command": {
      const command = [result.command, ...(Array.isArray(result.args) ? result.args : [])]
        .filter(Boolean)
        .map(String)
        .join(" ");
      return formatCommandResult(result, `命令执行完成：${command || stringArg(args, "command")}`);
    }
    case "local_git_status":
      return formatCommandResult(result, "Git 状态读取完成。");
    case "local_git_diff":
      return formatCommandResult(result, "Git diff 读取完成。");
    case "project_detect_stack": {
      const frameworks = Array.isArray(result.frameworks) ? result.frameworks.map(String).join("、") : "";
      const scripts = isObjectRecord(result.scripts) ? Object.keys(result.scripts).join("、") : "";
      return [
        `技术栈检测完成：${String(result.packageManager ?? "unknown")}${frameworks ? ` / ${frameworks}` : ""}`,
        scripts ? `脚本：${compactOneLine(scripts, 180)}` : "",
      ].filter(Boolean).join("\n");
    }
    case "project_read_package_json": {
      const scripts = isObjectRecord(result.scripts) ? Object.keys(result.scripts).join("、") : "";
      return [
        `已读取 package.json${result.name ? `：${String(result.name)}` : "。"}`,
        scripts ? `脚本：${compactOneLine(scripts, 180)}` : "",
      ].filter(Boolean).join("\n");
    }
    default: {
      if (isMcpToolName(toolCall.function.name)) {
        const summary = formatMcpToolResultSummary(result);
        return summary ? `MCP 工具执行完成。\n${summary}` : "MCP 工具执行完成。";
      }
      const raw = JSON.stringify(result, null, 2);
      return raw ? trimBlock(raw, 600) : "已完成。";
    }
  }
}

function getToolResultAttachments(result: unknown): ChatAttachment[] {
  const attachments: ChatAttachment[] = [];
  if (isObjectRecord(result) && isObjectRecord(result.attachment)) {
    const attachment = normalizeChatAttachment(result.attachment as Partial<ChatAttachment>);
    if (attachment) attachments.push(attachment);
  }
  attachments.push(...getMcpImageAttachments(result));
  return attachments;
}

function formatToolResultForApi(result: unknown, toolName?: string) {
  if (toolName && isSilentChatControlTool(toolName)) {
    return JSON.stringify({
      ended: true,
      instruction:
        "这是静默内部控制。继续完成当前正常回复，不要向用户提及工具、权限、提前结束、停止轮次、原因或依据。",
    });
  }
  return JSON.stringify(sanitizeToolResultForApiValue(result));
}

function getToolResultVisionMessage(toolCall: ChatToolCall, result: unknown): ChatApiMessage | null {
  if (isObjectRecord(result) && typeof result.previewDataUrl === "string") {
    const args = parseToolCallArgs(toolCall);
    const path = String(result.path ?? args.path ?? "");
    return {
      role: "user",
      content: [
        {
          type: "text",
          text: `这是电脑工作区图片「${path}」的压缩预览图。请根据这张图进行视觉判断；如果最终要发给用户，请调用 local_send_pc_file 发送原图。`,
        },
        {
          type: "image_url",
          image_url: { url: result.previewDataUrl },
        },
      ],
    };
  }

  const mcpImages = getMcpImageContentItems(result);
  if (mcpImages.length === 0) return null;

  return {
    role: "user",
    content: [
      {
        type: "text",
        text: `这是 MCP 工具「${toolCall.function.name}」返回的图片结果。请直接根据图片继续完成用户任务；不要因为工具结果是图片而报告没有可显示内容。`,
      },
      ...mcpImages.slice(0, 4).map((item) => ({
        type: "image_url" as const,
        image_url: { url: getMcpImageDataUrl(item) },
      })),
    ],
  };
}

function formatToolErrorMessage(toolCall: ChatToolCall, error: unknown) {
  const message = error instanceof Error ? error.message : "工具执行失败";
  return `${isMcpToolName(toolCall.function.name) ? "MCP 工具失败" : "操作失败"}：${toolCall.function.name}\n${message}`;
}

function trimTrailingSlash(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function parseToolArguments(rawArguments: string) {
  if (!rawArguments) return {};

  try {
    const parsedArguments = JSON.parse(rawArguments) as unknown;
    if (!parsedArguments || typeof parsedArguments !== "object" || Array.isArray(parsedArguments)) {
      throw new Error("工具参数必须是 JSON object");
    }
    return parsedArguments as Record<string, unknown>;
  } catch {
    const preview = rawArguments.slice(0, 180).replace(/\s+/g, " ");
    throw new Error(`工具参数不是合法 JSON：${preview}`);
  }
}

function extractStreamContent(payload: unknown) {
  const streamPayload = payload as {
    choices?: Array<{
      delta?: {
        content?: string;
        reasoning?: unknown;
        reasoning_content?: unknown;
        thinking?: unknown;
        thinking_content?: unknown;
      };
      message?: ChatApiMessage;
    }>;
    output_text?: string;
  };

  const deltaContent = streamPayload.choices?.[0]?.delta?.content;
  const deltaReasoning = [
    streamPayload.choices?.[0]?.delta?.reasoning,
    streamPayload.choices?.[0]?.delta?.reasoning_content,
    streamPayload.choices?.[0]?.delta?.thinking,
    streamPayload.choices?.[0]?.delta?.thinking_content,
  ]
    .map(getReasoningTextFromValue)
    .filter(Boolean)
    .join("\n")
    .trim();
  if (deltaContent !== undefined) {
    return { content: deltaContent, reasoning: deltaReasoning, mode: "delta" as const };
  }
  if (deltaReasoning) return { content: "", reasoning: deltaReasoning, mode: "delta" as const };

  const message = streamPayload.choices?.[0]?.message;
  const cumulativeReasoning = message ? getChatApiMessageReasoning(message) : "";
  const cumulativeContent =
    (message ? getChatApiMessageText(message) : "") || streamPayload.output_text;
  if (cumulativeContent !== undefined) {
    return {
      content: cumulativeContent,
      reasoning: cumulativeReasoning,
      mode: "cumulative" as const,
    };
  }
  if (cumulativeReasoning) {
    return { content: "", reasoning: cumulativeReasoning, mode: "cumulative" as const };
  }

  return { content: "", reasoning: "", mode: "delta" as const };
}

function createChatAbortError() {
  return new DOMException("AI 输出已停止。", "AbortError");
}

function isChatAbortError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return error instanceof Error && error.name === "AbortError";
}

function throwIfChatAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw createChatAbortError();
}

async function readChatStream(
  response: Response,
  onDelta: (delta: string) => void,
  onReasoningDelta: (delta: string) => void = () => undefined,
  signal?: AbortSignal,
) {
  throwIfChatAborted(signal);

  if (!response.ok) {
    const errorText = await response.text();
    try {
      const payload = JSON.parse(errorText) as { error?: string | { message?: string } };
      const errorMessage =
        typeof payload.error === "string" ? payload.error : payload.error?.message;
      throw new Error(errorMessage ? `请求失败：${response.status} ${errorMessage}` : `请求失败：${response.status}`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`请求失败：${response.status} ${errorText}`);
      }
      throw error;
    }
  }

  const contentType = response.headers.get("content-type") || "";
  if (!/text\/event-stream/i.test(contentType)) {
    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("收到的不是有效的流式响应。");
    }
    const streamContent = extractStreamContent(payload);
    if (streamContent.content) onDelta(streamContent.content);
    if (streamContent.reasoning) onReasoningDelta(streamContent.reasoning);
    return { content: streamContent.content, reasoning: streamContent.reasoning };
  }

  if (!response.body) throw new Error("流式响应为空");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let fullReasoning = "";

  while (true) {
    throwIfChatAborted(signal);
    const { done, value } = await reader.read();
    throwIfChatAborted(signal);
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const dataLines = chunk
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());

      for (const data of dataLines) {
        if (!data || data === "[DONE]") continue;

        try {
          const streamContent = extractStreamContent(JSON.parse(data));
          if (streamContent.reasoning) {
            if (streamContent.mode === "delta") {
              fullReasoning += streamContent.reasoning;
              onReasoningDelta(streamContent.reasoning);
            } else if (streamContent.reasoning.startsWith(fullReasoning)) {
              const reasoningDelta = streamContent.reasoning.slice(fullReasoning.length);
              fullReasoning = streamContent.reasoning;
              if (reasoningDelta) onReasoningDelta(reasoningDelta);
            } else {
              fullReasoning = streamContent.reasoning;
            }
          }
          if (!streamContent.content) continue;

          if (streamContent.mode === "delta") {
            fullContent += streamContent.content;
            onDelta(streamContent.content);
            continue;
          }

          if (streamContent.content.startsWith(fullContent)) {
            const delta = streamContent.content.slice(fullContent.length);
            fullContent = streamContent.content;
            if (delta) onDelta(delta);
          } else {
            fullContent = streamContent.content;
          }
        } catch {
          // Ignore malformed event frames from non-standard providers.
        }
      }
    }
  }

  return { content: fullContent, reasoning: fullReasoning };
}

function splitLocalPath(path = "") {
  const normalizedPath = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalizedPath.split("/").filter(Boolean);

  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("路径不能包含 . 或 ..");
  }

  return parts;
}

async function getLocalDirectory(
  root: LocalDirectoryHandle,
  parts: string[],
  create = false,
) {
  let currentDirectory = root;

  for (const part of parts) {
    currentDirectory = await currentDirectory.getDirectoryHandle(part, { create });
  }

  return currentDirectory;
}

async function getLocalParentDirectory(
  root: LocalDirectoryHandle,
  path: string,
  create = false,
) {
  const parts = splitLocalPath(path);
  const name = parts.pop();
  if (!name) throw new Error("缺少文件或目录名称");

  return {
    directory: await getLocalDirectory(root, parts, create),
    name,
  };
}

async function listLocalFiles(
  root: LocalDirectoryHandle,
  path = "",
  recursive = true,
  limit = 240,
) {
  const startDirectory = await getLocalDirectory(root, splitLocalPath(path));
  const results: Array<{ path: string; kind: "file" | "directory" }> = [];

  async function visit(directory: LocalDirectoryHandle, basePath: string) {
    if (results.length >= limit) return;

    for await (const entry of directory.values()) {
      const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
      results.push({ path: entryPath, kind: entry.kind });

      if (entry.kind === "directory" && recursive && results.length < limit) {
        await visit(entry, entryPath);
      }

      if (results.length >= limit) return;
    }
  }

  await visit(startDirectory, path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));
  return results;
}

async function readLocalTextFile(root: LocalDirectoryHandle, path: string) {
  const { directory, name } = await getLocalParentDirectory(root, path);
  const fileHandle = await directory.getFileHandle(name);
  const file = await fileHandle.getFile();
  return file.text();
}

async function readLocalBinaryFile(root: LocalDirectoryHandle, path: string) {
  const { directory, name } = await getLocalParentDirectory(root, path);
  const fileHandle = await directory.getFileHandle(name);
  const file = await fileHandle.getFile();
  return {
    path,
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    base64: arrayBufferToBase64(await file.arrayBuffer()),
  };
}

async function readLocalTextFileRange(
  root: LocalDirectoryHandle,
  path: string,
  startLine = 1,
  endLine = startLine + 120,
) {
  const content = await readLocalTextFile(root, path);
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const safeStartLine = Math.max(1, Math.floor(startLine));
  const safeEndLine = Math.min(lines.length, Math.max(safeStartLine, Math.floor(endLine)));

  return {
    path,
    startLine: safeStartLine,
    endLine: safeEndLine,
    totalLines: lines.length,
    content: lines.slice(safeStartLine - 1, safeEndLine).join("\n"),
  };
}

async function getLocalFileInfo(root: LocalDirectoryHandle, path: string) {
  const parts = splitLocalPath(path);

  if (parts.length === 0) {
    return {
      path: "",
      kind: "directory",
      name: root.name,
    };
  }

  const { directory, name } = await getLocalParentDirectory(root, path);

  try {
    const fileHandle = await directory.getFileHandle(name);
    const file = await fileHandle.getFile();
    return {
      path,
      kind: "file",
      name,
      size: file.size,
      type: file.type,
      modifiedAt: new Date(file.lastModified).toISOString(),
    };
  } catch {
    const directoryHandle = await directory.getDirectoryHandle(name);
    return {
      path,
      kind: "directory",
      name: directoryHandle.name,
    };
  }
}

async function writeLocalTextFile(root: LocalDirectoryHandle, path: string, content: string) {
  const { directory, name } = await getLocalParentDirectory(root, path, true);
  const fileHandle = await directory.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function writeLocalBinaryFile(root: LocalDirectoryHandle, path: string, base64: string) {
  const bytes = base64ToArrayBuffer(base64);
  const { directory, name } = await getLocalParentDirectory(root, path, true);
  const fileHandle = await directory.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(bytes);
  await writable.close();
  return bytes.byteLength;
}

async function createLocalDirectory(root: LocalDirectoryHandle, path: string) {
  await getLocalDirectory(root, splitLocalPath(path), true);
  return { ok: true, path, operation: "mkdir" };
}

async function editLocalTextFile(
  root: LocalDirectoryHandle,
  path: string,
  findText: string,
  replaceText: string,
) {
  if (!findText) throw new Error("find 不能为空");
  const originalContent = await readLocalTextFile(root, path);
  if (!originalContent.includes(findText)) {
    throw new Error("没有找到要替换的文本");
  }

  const nextContent = originalContent.split(findText).join(replaceText);
  await writeLocalTextFile(root, path, nextContent);
  return {
    replacements: originalContent.split(findText).length - 1,
    bytes: new Blob([nextContent]).size,
  };
}

async function searchLocalFiles(
  root: LocalDirectoryHandle,
  query: string,
  path = "",
  includeContent = true,
) {
  if (!query.trim()) throw new Error("query 不能为空");

  const entries = await listLocalFiles(root, path, true, 320);
  const normalizedQuery = query.toLowerCase();
  const matches: Array<{ path: string; match: "name" | "content"; preview?: string }> = [];

  for (const entry of entries) {
    if (entry.kind !== "file") continue;

    if (entry.path.toLowerCase().includes(normalizedQuery)) {
      matches.push({ path: entry.path, match: "name" });
      continue;
    }

    if (!includeContent) continue;

    try {
      const content = await readLocalTextFile(root, entry.path);
      const matchIndex = content.toLowerCase().indexOf(normalizedQuery);
      if (matchIndex >= 0) {
        matches.push({
          path: entry.path,
          match: "content",
          preview: content.slice(Math.max(0, matchIndex - 60), matchIndex + query.length + 120),
        });
      }
    } catch {
      // Binary or unreadable files are skipped for content search.
    }

    if (matches.length >= 80) break;
  }

  return matches;
}

function isLikelyTextPath(path: string) {
  return /\.(cjs|css|csv|env|html|js|json|jsx|md|mjs|scss|ts|tsx|txt|xml|yaml|yml)$/i.test(path);
}

async function readLocalPackageJson(root: LocalDirectoryHandle) {
  const content = await readLocalTextFile(root, "package.json");
  return JSON.parse(content) as {
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

async function detectLocalProjectStack(root: LocalDirectoryHandle) {
  const files = await listLocalFiles(root, "", true, 900);
  const filePaths = new Set(files.map((entry) => entry.path));
  let packageJson: Awaited<ReturnType<typeof readLocalPackageJson>> | null = null;

  try {
    packageJson = await readLocalPackageJson(root);
  } catch {
    packageJson = null;
  }

  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };
  const dependencyNames = new Set(Object.keys(dependencies));
  const frameworks = [
    dependencyNames.has("react") ? "React" : "",
    dependencyNames.has("vite") ? "Vite" : "",
    dependencyNames.has("electron") ? "Electron" : "",
    dependencyNames.has("next") ? "Next.js" : "",
    dependencyNames.has("vue") ? "Vue" : "",
    dependencyNames.has("svelte") ? "Svelte" : "",
    dependencyNames.has("typescript") || filePaths.has("tsconfig.json") ? "TypeScript" : "",
  ].filter(Boolean);
  const packageManager = filePaths.has("pnpm-lock.yaml")
    ? "pnpm"
    : filePaths.has("yarn.lock")
      ? "yarn"
      : filePaths.has("package-lock.json")
        ? "npm"
        : "unknown";

  return {
    packageManager,
    frameworks,
    scripts: packageJson?.scripts ?? {},
    configFiles: Array.from(filePaths).filter((path) =>
      /^(package\.json|tsconfig.*\.json|vite\.config\.[cm]?[jt]s|next\.config\.[cm]?[jt]s|electron\/|src\/)/.test(path),
    ).slice(0, 120),
  };
}

async function searchLocalRegex(
  root: LocalDirectoryHandle,
  pattern: string,
  path = "",
  flags = "",
  maxMatches = 80,
) {
  if (!pattern.trim()) throw new Error("pattern 不能为空");
  const safeFlags = Array.from(new Set(`${flags.replace(/[^imsu]/g, "")}g`)).join("");
  const regex = new RegExp(pattern, safeFlags);
  const entries = await listLocalFiles(root, path, true, 700);
  const matches: Array<{ path: string; line: number; column: number; text: string }> = [];

  for (const entry of entries) {
    if (entry.kind !== "file" || !isLikelyTextPath(entry.path)) continue;

    try {
      const content = await readLocalTextFile(root, entry.path);
      const lines = content.replace(/\r\n/g, "\n").split("\n");
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        regex.lastIndex = 0;
        const match = regex.exec(lines[lineIndex]);
        if (!match) continue;
        matches.push({
          path: entry.path,
          line: lineIndex + 1,
          column: match.index + 1,
          text: lines[lineIndex].slice(0, 240),
        });
        if (matches.length >= maxMatches) return matches;
      }
    } catch {
      // Skip binary or unreadable files.
    }
  }

  return matches;
}

async function scanLocalTodos(
  root: LocalDirectoryHandle,
  path = "",
  maxMatches = 120,
) {
  return searchLocalRegex(root, "\\b(TODO|FIXME|BUG|HACK)\\b[:：]?.*", path, "i", maxMatches);
}

async function findLocalSymbols(
  root: LocalDirectoryHandle,
  query = "",
  path = "",
  maxMatches = 120,
) {
  const entries = await listLocalFiles(root, path, true, 900);
  const normalizedQuery = query.trim().toLowerCase();
  const symbolPattern =
    /^\s*(?:export\s+)?(?:default\s+)?(?:(async)\s+)?(?:(function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)|(const|let|var)\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:function\s*)?\()/;
  const symbols: Array<{ path: string; line: number; kind: string; name: string; text: string }> = [];

  for (const entry of entries) {
    if (entry.kind !== "file" || !isLikelyTextPath(entry.path)) continue;

    try {
      const content = await readLocalTextFile(root, entry.path);
      const lines = content.replace(/\r\n/g, "\n").split("\n");

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        const match = symbolPattern.exec(line);
        if (!match) continue;

        const kind = match[2] ?? match[4] ?? "function";
        const name = match[3] ?? match[5] ?? match[6] ?? "";
        if (!name) continue;

        if (
          normalizedQuery &&
          !name.toLowerCase().includes(normalizedQuery) &&
          !line.toLowerCase().includes(normalizedQuery)
        ) {
          continue;
        }

        symbols.push({
          path: entry.path,
          line: lineIndex + 1,
          kind,
          name,
          text: line.trim().slice(0, 240),
        });
        if (symbols.length >= maxMatches) return symbols;
      }
    } catch {
      // Skip binary or unreadable files.
    }
  }

  return symbols;
}

const localFileToolDefinitions = [
  {
    type: "function",
    function: {
      name: "local_list_files",
      description: "列出用户授权工作区内的文件和目录。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作区根目录的路径，默认根目录。" },
          recursive: { type: "boolean", description: "是否递归列出，默认 true。" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_read_file",
      description: "读取用户授权工作区内的文本文件。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作区根目录的文件路径。" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_read_binary_file",
      description: "读取用户授权工作区内的任意文件，返回 Base64 内容。用于传输 ZIP、APK、图片、音频、视频等二进制文件。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作区根目录的文件路径。" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_preview_pc_image",
      description: "读取已连接电脑工作区内图片的压缩预览图，让视觉模型查看和筛选图片。不会读取原图 Base64，也不会把原始大图塞进上下文。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "电脑工作区内图片文件路径，相对电脑工作区根目录。" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_read_file_range",
      description: "按行号读取用户授权工作区内文本文件的一部分，适合查看大文件片段。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作区根目录的文件路径。" },
          startLine: { type: "number", description: "起始行号，从 1 开始，默认 1。" },
          endLine: { type: "number", description: "结束行号，包含该行。" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_file_info",
      description: "查看用户授权工作区内文件或目录的元信息，例如类型、大小、修改时间。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作区根目录的文件或目录路径，根目录可传空字符串。" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_search_files",
      description: "按文件名或文本内容搜索用户授权工作区。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词。" },
          path: { type: "string", description: "可选，相对工作区根目录的搜索起点。" },
          includeContent: { type: "boolean", description: "是否搜索文本内容，默认 true。" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_create_directory",
      description: "在用户授权工作区内创建目录，可递归创建父目录。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作区根目录的目录路径。" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_rename_path",
      description: "在用户授权工作区内重命名或移动文件/目录。仅 Electron 桌面版支持。",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "原始相对路径。" },
          to: { type: "string", description: "目标相对路径。" },
        },
        required: ["from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_run_script",
      description: "运行工作区 package.json 中已定义的 npm 脚本，例如 build/test/lint。仅 Electron 桌面版支持。",
      parameters: {
        type: "object",
        properties: {
          script: { type: "string", description: "package.json scripts 中的脚本名。" },
          args: {
            type: "array",
            items: { type: "string" },
            description: "传给 npm run 的额外参数。",
          },
        },
        required: ["script"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_run_command",
      description: "在当前工作区运行安全白名单命令。仅 Electron 桌面版支持；不会通过 shell 执行。",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "命令名或完整命令行。只允许 npm/pnpm/yarn/node/git 等白名单命令；高风险 git 子命令会弹窗请求用户授权。",
          },
          args: {
            type: "array",
            items: { type: "string" },
            description: "可选参数数组；提供 args 时 command 应只填命令名。",
          },
          timeoutMs: { type: "number", description: "超时时间，默认 60000，最大 120000。" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_git_status",
      description: "查看当前工作区 Git 状态，包括分支、暂存/未暂存/未跟踪文件。仅 Electron 桌面版支持。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "local_git_diff",
      description: "查看当前工作区 Git diff。仅 Electron 桌面版支持。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "可选，相对工作区根目录的文件或目录路径。" },
          staged: { type: "boolean", description: "是否查看 staged diff，默认 false。" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "project_find_symbols",
      description: "在当前工作区代码文件中查找函数、类、接口、类型、枚举、变量等符号定义。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "可选，符号名或定义行关键词。" },
          path: { type: "string", description: "可选，相对工作区根目录的搜索起点。" },
          maxMatches: { type: "number", description: "最大返回条数，默认 120。" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "project_detect_stack",
      description: "检测当前工作区技术栈、包管理器、脚本和关键配置文件。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "project_search_regex",
      description: "在当前工作区文本文件中使用正则表达式搜索。",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "正则表达式。" },
          path: { type: "string", description: "可选，相对工作区根目录的搜索起点。" },
          flags: { type: "string", description: "可选正则 flags，仅支持 i/m/s/u。" },
          maxMatches: { type: "number", description: "最大返回条数，默认 80。" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "project_read_package_json",
      description: "读取并解析当前工作区 package.json，返回 name、scripts、dependencies、devDependencies。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "project_todo_scan",
      description: "扫描当前工作区文本文件中的 TODO/FIXME/BUG/HACK 注释。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "可选，相对工作区根目录的扫描起点。" },
          maxMatches: { type: "number", description: "最大返回条数，默认 120。" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_write_file",
      description: "新建或覆盖写入用户授权工作区内的文本文件。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作区根目录的文件路径。" },
          content: { type: "string", description: "完整文件内容。" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_write_binary_file",
      description: "把已有的完整 Base64 内容写成用户授权工作区内的任意文件。用于保存明确提供的 ZIP、APK、图片、音频、视频等二进制内容；保存用户刚上传的聊天附件时应使用 local_transfer_attachment_file，不要在附件直传后再调用本工具覆盖同名文件。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作区根目录的目标文件路径。" },
          base64: { type: "string", description: "完整 Base64 内容；可带 data: 前缀，也可只传纯 Base64。" },
          mimeType: { type: "string", description: "可选 MIME 类型，例如 application/zip、image/png。" },
        },
        required: ["path", "base64"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_transfer_file",
      description: "在手机工作区和已连接的电脑工作区之间直接流式传输文件。适合大文件，不读取文件内容给 AI，不使用 Base64。",
      parameters: {
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["phone_to_pc", "pc_to_phone"],
            description: "传输方向：phone_to_pc 表示手机到电脑，pc_to_phone 表示电脑到手机。",
          },
          sourcePath: {
            type: "string",
            description: "源文件相对源工作区根目录的路径。",
          },
          targetPath: {
            type: "string",
            description: "目标文件相对目标工作区根目录的路径。",
          },
        },
        required: ["direction", "sourcePath", "targetPath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_transfer_attachment_file",
      description: "把聊天中的附件或 AI 生成图片直接保存到当前授权工作区。适合保存图片、ZIP、APK、音频、视频等；不让模型读取或改写内容，不使用模型生成的 Base64。",
      parameters: {
        type: "object",
        properties: {
          attachmentId: {
            type: "string",
            description: "聊天消息中显示的附件ID；AI 生成图片也可用 generated-image-1.png、generated-image-2.png 等名称。",
          },
          targetPath: {
            type: "string",
            description: "目标文件相对电脑工作区根目录的路径。通常应保留原扩展名。",
          },
        },
        required: ["attachmentId", "targetPath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_send_pc_file",
      description: "把已连接电脑工作区里的文件作为可下载附件发给用户。适合大文件，不读取文件内容给 AI，不使用 Base64。",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "电脑工作区内要发送的文件路径，相对电脑工作区根目录。",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_edit_file",
      description: "在用户授权工作区内对文本文件执行查找替换。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作区根目录的文件路径。" },
          find: { type: "string", description: "要查找的原文本。" },
          replace: { type: "string", description: "替换后的文本。" },
        },
        required: ["path", "find", "replace"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "local_delete_path",
      description: "删除用户授权工作区内的文件或目录。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作区根目录的文件或目录路径。" },
          recursive: { type: "boolean", description: "删除目录时是否递归，默认 false。" },
        },
        required: ["path"],
      },
    },
  },
];

function getVerticalDropPlacement(event: DragEvent<HTMLElement>): DragPlacement {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function getHorizontalDropPlacement(event: DragEvent<HTMLElement>): DragPlacement {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientX < rect.left + rect.width / 2 ? "before" : "after";
}

export function App() {
  const [view, setView] = useState<AppView>("home");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobilePromptPreviewOpen, setMobilePromptPreviewOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("providers");
  const [providers, setProviders] = useState<ModelProviderChannel[]>(loadProviderChannels);
  const [activeProviderId, setActiveProviderId] = useState(() => {
    const storedProviderId = localStorage.getItem(ACTIVE_PROVIDER_STORAGE_KEY);
    return providers.some((provider) => provider.id === storedProviderId)
      ? storedProviderId ?? ""
      : providers[0]?.id ?? "";
  });
  const [systemPrompts, setSystemPrompts] = useState<SystemPromptProfile[]>(loadSystemPrompts);
  const [activeSystemPromptId, setActiveSystemPromptId] = useState(
    () => localStorage.getItem(ACTIVE_SYSTEM_PROMPT_STORAGE_KEY) ?? systemPrompts[0]?.id ?? "",
  );
  const [activeSystemPromptIds, setActiveSystemPromptIds] = useState(() =>
    normalizeActiveSystemPromptIds(getStoredActiveSystemPromptIds() ?? [], systemPrompts),
  );
  const [chatPresets, setChatPresets] = useState<ChatPreset[]>(() =>
    loadChatPresetsFromStorage(CHAT_PRESETS_STORAGE_KEY),
  );
  const [activeChatPresetId, setActiveChatPresetId] = useState(() => {
    const storedPresetId = localStorage.getItem(ACTIVE_CHAT_PRESET_STORAGE_KEY);
    return chatPresets.some((preset) => preset.id === storedPresetId)
      ? storedPresetId ?? ""
      : chatPresets[0]?.id ?? "";
  });
  const [chatPresetEnabled, setChatPresetEnabled] = useState(
    () => localStorage.getItem(CHAT_PRESET_ENABLED_STORAGE_KEY) === "true",
  );
  const [selectedChatPresetPromptId, setSelectedChatPresetPromptId] = useState("");
  const [presetImportState, setPresetImportState] = useState<{
    status: ProviderPullState;
    message: string;
  }>({ status: "idle", message: "" });
  const [worldBooks, setWorldBooks] = useState<WorldBook[]>(() =>
    loadWorldBooksFromStorage(WORLD_BOOKS_STORAGE_KEY),
  );
  const [activeWorldBookIds, setActiveWorldBookIds] = useState<string[]>(() => {
    try {
      return normalizeActiveWorldBookIds(
        JSON.parse(localStorage.getItem(ACTIVE_WORLD_BOOKS_STORAGE_KEY) ?? "[]"),
        worldBooks,
      );
    } catch {
      return [];
    }
  });
  const [selectedWorldBookId, setSelectedWorldBookId] = useState(
    () => worldBooks[0]?.id ?? "",
  );
  const [selectedWorldBookEntryId, setSelectedWorldBookEntryId] = useState("");
  const [worldBookImportState, setWorldBookImportState] = useState<{
    status: ProviderPullState;
    message: string;
  }>({ status: "idle", message: "" });
  const [regexScripts, setRegexScripts] = useState<RegexScript[]>(() =>
    loadRegexScriptsFromStorage(REGEX_SCRIPTS_STORAGE_KEY),
  );
  const [selectedRegexTargetKey, setSelectedRegexTargetKey] = useState("");
  const [regexImportState, setRegexImportState] = useState<{
    status: ProviderPullState;
    message: string;
  }>({ status: "idle", message: "" });
  const [tavernScripts, setTavernScripts] = useState<TavernScript[]>(() =>
    loadTavernScriptsFromStorage(TAVERN_SCRIPTS_STORAGE_KEY),
  );
  const [selectedTavernScriptKey, setSelectedTavernScriptKey] = useState("");
  const [tavernScriptImportState, setTavernScriptImportState] = useState<{
    status: ProviderPullState;
    message: string;
  }>({ status: "idle", message: "" });
  const [tavernScriptDataDraft, setTavernScriptDataDraft] = useState("{}");
  const [tavernGlobalVariables, setTavernGlobalVariables] = useState<
    Record<string, unknown>
  >(() => {
    try {
      return normalizeTavernVariables(
        JSON.parse(localStorage.getItem(TAVERN_GLOBAL_VARIABLES_STORAGE_KEY) ?? "{}"),
      );
    } catch {
      return {};
    }
  });
  const [tavernRuntimeStatus, setTavernRuntimeStatus] =
    useState<TavernRuntimeStatus>({ state: "idle", message: "" });
  const [tavernRuntimeButtons, setTavernRuntimeButtons] = useState<
    TavernRuntimeButton[]
  >([]);
  const [tavernRuntimeLogs, setTavernRuntimeLogs] = useState<TavernRuntimeLog[]>([]);
  const [characterCards, setCharacterCards] = useState<CharacterCard[]>(() =>
    loadCharacterCardsFromStorage(CHARACTER_CARDS_STORAGE_KEY),
  );
  const [activeCharacterCardId, setActiveCharacterCardId] = useState(
    () => localStorage.getItem(ACTIVE_CHARACTER_CARD_STORAGE_KEY) ?? "",
  );
  const [editingCharacterCardId, setEditingCharacterCardId] = useState("");
  const [characterEditorTab, setCharacterEditorTab] = useState<
    "basic" | "advanced" | "greetings" | "worldbook" | "regex" | "scripts"
  >("basic");
  const [characterSearch, setCharacterSearch] = useState("");
  const [characterImportState, setCharacterImportState] = useState<{
    status: ProviderPullState;
    message: string;
  }>({ status: "idle", message: "" });
  const [characterTranslationState, setCharacterTranslationState] = useState<{
    status: ProviderPullState;
    message: string;
  }>({ status: "idle", message: "" });
  const [characterTranslationPreview, setCharacterTranslationPreview] = useState<{
    cardId: string;
    items: Array<{
      key: string;
      label: string;
      source: string;
      translated: string;
      selected: boolean;
    }>;
  } | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile>(loadUserProfile);
  const [providerPullState, setProviderPullState] = useState<{
    status: ProviderPullState;
    message: string;
  }>({ status: "idle", message: "" });
  const [providerApiKeyVisible, setProviderApiKeyVisible] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>(loadChatMode);
  const [multiAgentPersonaIds, setMultiAgentPersonaIds] = useState<string[]>(
    loadMultiAgentPersonaIds,
  );
  const [multiAgentRounds, setMultiAgentRounds] = useState(loadMultiAgentRounds);
  const [multiAgentModelConfigs, setMultiAgentModelConfigs] =
    useState<MultiAgentModelConfigs>(loadMultiAgentModelConfigs);
  const [multiAgentAutoStopEnabled, setMultiAgentAutoStopEnabled] = useState(
    loadMultiAgentAutoStopEnabled,
  );
  const [multiAgentStopCondition, setMultiAgentStopCondition] = useState(
    loadMultiAgentStopCondition,
  );
  const [chatStreamEnabled, setChatStreamEnabled] = useState(true);
  const [chatMultiBubbleEnabled, setChatMultiBubbleEnabled] = useState(
    () => localStorage.getItem(CHAT_MULTI_BUBBLE_STORAGE_KEY) === "true",
  );
  const [chatHtmlRenderEnabled, setChatHtmlRenderEnabled] = useState(
    () => localStorage.getItem(CHAT_HTML_RENDER_STORAGE_KEY) === "true",
  );
  const [chatReasoningVisible, setChatReasoningVisible] = useState(
    () => localStorage.getItem(CHAT_REASONING_VISIBLE_STORAGE_KEY) === "true",
  );
  const [chatHeartbeatReminderVisible, setChatHeartbeatReminderVisible] = useState(
    () => localStorage.getItem(CHAT_HEARTBEAT_REMINDER_VISIBLE_STORAGE_KEY) !== "false",
  );
  const [chatPersonalization, setChatPersonalization] =
    useState<ChatPersonalizationSettings>(loadChatPersonalization);
  const [chatSender, setChatSender] = useState<ChatSenderIdentity>(loadChatSender);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>(loadMcpServers);
  const [mcpTools, setMcpTools] = useState<McpToolDefinition[]>([]);
  const [activeMcpServerId, setActiveMcpServerId] = useState(() => mcpServers[0]?.id ?? "");
  const [mcpImportText, setMcpImportText] = useState("");
  const [mcpJsonViewEnabled, setMcpJsonViewEnabled] = useState(false);
  const [mcpStatus, setMcpStatus] = useState<{
    status: ProviderPullState;
    message: string;
  }>({ status: "idle", message: "" });
  const [skills, setSkills] = useState<SkillProfile[]>(loadSkills);
  const [activeSkillId, setActiveSkillId] = useState(() => skills[0]?.id ?? "");
  const [skillFolderPath, setSkillFolderPath] = useState("");
  const [skillStatus, setSkillStatus] = useState<{
    status: ProviderPullState;
    message: string;
  }>({ status: "idle", message: "" });
  const [chatInput, setChatInput] = useState("");
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [chatMessageMenu, setChatMessageMenu] = useState<{
    messageId: string;
    x: number;
    y: number;
  } | null>(null);
  const [editingChatMessage, setEditingChatMessage] = useState<{
    messageId: string;
    content: string;
  } | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>(loadChatSessions);
  const [activeChatSessionId, setActiveChatSessionId] = useState("");
  const [appDataLoaded, setAppDataLoaded] = useState(false);
  const [chatStatus, setChatStatus] = useState<{
    status: ProviderPullState;
    message: string;
  }>({ status: "idle", message: "" });
  const [chatGenerationState, setChatGenerationState] =
    useState<ChatGenerationState>("idle");
  const [pcBrowserOpen, setPcBrowserOpen] = useState(false);
  const [pcServerUrl, setPcServerUrl] = useState(
    () => localStorage.getItem(PC_SERVER_URL_STORAGE_KEY) ?? "",
  );
  const [pcTransferWorkspace, setPcTransferWorkspace] = useState<PcWorkspaceHandle | null>(() =>
    normalizePcWorkspaceHandle(getStoredPcConnection()),
  );
  const [pcCurrentPath, setPcCurrentPath] = useState("");
  const [pcEntries, setPcEntries] = useState<PcFileEntry[]>([]);
  const [pcBrowserStatus, setPcBrowserStatus] = useState<{
    status: ProviderPullState;
    message: string;
  }>({ status: "idle", message: "" });
  const [rootAccessState, setRootAccessState] = useState<{
    status: ProviderPullState;
    message: string;
    details?: string;
    granted?: boolean;
  }>({ status: "idle", message: "" });
  const [rootWorkspacePath, setRootWorkspacePath] = useState("/");
  const [localWorkspaceHandle, setLocalWorkspaceHandle] = useState<
    LocalDirectoryHandle | ElectronWorkspaceHandle | AndroidWorkspaceHandle | PcWorkspaceHandle | null
  >(null);
  const [localToolsEnabled, setLocalToolsEnabled] = useState(false);
  const [personas, setPersonas] = useState<AgentPersona[]>([]);
  const [activePersonaId, setActivePersonaId] = useState<string>(
    () => localStorage.getItem(ACTIVE_PERSONA_STORAGE_KEY) ?? "",
  );
  const [selectedTypeId, setSelectedTypeId] = useState<string | "all">("all");
  const [newTypeName, setNewTypeName] = useState("");
  const [avatarCrop, setAvatarCrop] = useState<AvatarCropState | null>(null);
  const [draggedEntry, setDraggedEntry] = useState<{ typeId: string; entryId: string } | null>(
    null,
  );
  const [dragOverEntry, setDragOverEntry] = useState<EntryDragTarget | null>(null);
  const [draggedTypeId, setDraggedTypeId] = useState<string | null>(null);
  const [dragOverType, setDragOverType] = useState<TypeDragTarget | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const userAvatarInputRef = useRef<HTMLInputElement>(null);
  const presetImportInputRef = useRef<HTMLInputElement>(null);
  const worldBookImportInputRef = useRef<HTMLInputElement>(null);
  const regexImportInputRef = useRef<HTMLInputElement>(null);
  const tavernScriptImportInputRef = useRef<HTMLInputElement>(null);
  const characterImportInputRef = useRef<HTMLInputElement>(null);
  const characterAvatarInputRef = useRef<HTMLInputElement>(null);
  const mcpImportInputRef = useRef<HTMLInputElement>(null);
  const skillZipInputRef = useRef<HTMLInputElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const chatSendButtonRef = useRef<HTMLButtonElement>(null);
  const sendChatMessageRef = useRef<
    (contentOverride?: string, attachmentsOverride?: ChatAttachment[]) => Promise<void>
  >(async () => {});
  const chatAttachmentInputRef = useRef<HTMLInputElement>(null);
  const chatAttachmentFilesRef = useRef<Map<string, File>>(new Map());
  const chatAttachmentMetadataRef = useRef<Map<string, ChatAttachment>>(new Map());
  const htmlPreviewFrameRefs = useRef<Map<string, HTMLIFrameElement>>(new Map());
  const activeUserRequestTextRef = useRef("");
  const activeChatAbortControllerRef = useRef<AbortController | null>(null);
  const restoredWorkspacePathRef = useRef("");
  const restoredPcWorkspaceRef = useRef(false);
  const workspaceAutoRestoreDisabledRef = useRef(false);
  const heartbeatRunningRef = useRef(false);
  const pendingHeartbeatUpdateRef = useRef<{
    sessionId: string;
    patch: ChatHeartbeatPatch;
  } | null>(null);
  const pendingMultiAgentEndRef = useRef<{
    reason: string;
    evidence: string;
  } | null>(null);
  const activeChatSessionIdRef = useRef("");
  const tavernScriptRuntimeRef = useRef<TavernScriptRuntime | null>(null);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const chatSessionsRef = useRef<ChatSession[]>([]);
  const characterCardsRef = useRef<CharacterCard[]>([]);
  const worldBooksRef = useRef<WorldBook[]>([]);
  const activeWorldBookIdsRef = useRef<string[]>([]);
  const userProfileRef = useRef<UserProfile>(userProfile);
  const tavernScriptsRef = useRef<TavernScript[]>(tavernScripts);
  const tavernGlobalVariablesRef = useRef<Record<string, unknown>>(tavernGlobalVariables);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [view]);

  useEffect(() => {
    activeChatSessionIdRef.current = activeChatSessionId;
  }, [activeChatSessionId]);

  useEffect(() => {
    chatMessagesRef.current = chatMessages;
    chatSessionsRef.current = chatSessions;
    characterCardsRef.current = characterCards;
    worldBooksRef.current = worldBooks;
    activeWorldBookIdsRef.current = activeWorldBookIds;
    userProfileRef.current = userProfile;
    tavernScriptsRef.current = tavernScripts;
    tavernGlobalVariablesRef.current = tavernGlobalVariables;
  }, [activeWorldBookIds, characterCards, chatMessages, chatSessions, tavernGlobalVariables, tavernScripts, userProfile, worldBooks]);

  useEffect(() => {
    const focusChatInput = () => {
      window.requestAnimationFrame(() => {
        const input = chatInputRef.current;
        if (input) {
          input.focus();
          input.scrollIntoView({ behavior: "smooth", block: "center" });
          input.setSelectionRange(input.value.length, input.value.length);
        }
      });
    };

    const writeChatInput = (text: string, append: boolean, submit: boolean) => {
      let nextInput = text;
      setChatInput((current) => {
        nextInput = append ? `${current}${text}` : text;
        return nextInput;
      });
      setChatStatus({
        status: "success",
        message: submit ? "角色卡已写入输入框并请求发送。" : "角色卡已写入会话输入框。",
      });
      focusChatInput();
      if (submit) {
        window.requestAnimationFrame(() => {
          void sendChatMessageRef.current(nextInput, []);
        });
      }
      return true;
    };

    const appendSendAsMessage = (text: string, name: string) => {
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: text,
        createdAt: new Date().toISOString(),
        ...(name ? { extra: { sendAsName: name } } : {}),
      };
      const nextMessages = [...chatMessagesRef.current, message];
      chatMessagesRef.current = nextMessages;
      setChatMessages(nextMessages);
      window.setTimeout(() => {
        const index = chatMessagesRef.current.findIndex((candidate) => candidate.id === message.id);
        if (index < 0) return;
        void tavernScriptRuntimeRef.current?.emit(TAVERN_EVENTS.MESSAGE_RECEIVED, index);
        void tavernScriptRuntimeRef.current?.emit(TAVERN_EVENTS.MESSAGE_RENDERED, index);
        void tavernScriptRuntimeRef.current?.emit(TAVERN_EVENTS.CHARACTER_MESSAGE_RENDERED, index);
      }, 0);
      return { messageId: message.id };
    };

    const executeSlashCommand = (command: string) => {
      const parsed = parseTavernSlashCommand(command);
      if (!parsed) throw new Error(`暂不支持该酒馆命令：${command.trim() || "空命令"}`);
      if (parsed.type === "send-as") {
        return appendSendAsMessage(parsed.text, parsed.name);
      }
      if (parsed.type === "trigger") {
        const input = chatInputRef.current?.value ?? "";
        focusChatInput();
        window.requestAnimationFrame(() => {
          void sendChatMessageRef.current(input, []);
        });
        return true;
      }
      return writeChatInput(parsed.text, parsed.append, parsed.submit);
    };

    const respondToHtmlCommand = (
      frame: HTMLIFrameElement,
      id: string,
      requestId: unknown,
      result?: unknown,
      error?: unknown,
    ) => {
      if (typeof requestId !== "string") return;
      frame.contentWindow?.postMessage(
        {
          type: HTML_PREVIEW_COMMAND_RESULT_MESSAGE,
          id,
          requestId,
          ...(error ? { error: error instanceof Error ? error.message : String(error) } : { result }),
        },
        "*",
      );
    };

    function handleHtmlPreviewMessage(event: MessageEvent) {
      const data = event.data;
      if (!data || typeof data !== "object") return;

      const payload = data as {
        type?: unknown;
        id?: unknown;
        height?: unknown;
        intrinsic?: unknown;
        operation?: unknown;
        option?: unknown;
        variables?: unknown;
        updates?: unknown;
        block?: unknown;
        command?: unknown;
        text?: unknown;
        requestId?: unknown;
      };

      if (payload.type === HYPNOOS_APPEND_OPERATION_MESSAGE) {
        const sourceFrame = Array.from(htmlPreviewFrameRefs.current.values()).find(
          (frame) => frame.contentWindow === event.source,
        );
        if (!sourceFrame || typeof payload.block !== "string") return;
        const operationBlock = payload.block.trim();
        if (!operationBlock) return;
        setChatInput((current) => {
          const base = current.replace(/\s*$/, "");
          return base ? `${base}\n${operationBlock}` : operationBlock;
        });
        setChatStatus({ status: "success", message: "已将角色卡 APP 操作写入输入框。" });
        window.requestAnimationFrame(() => {
          const input = chatInputRef.current;
          if (!input) return;
          input.focus();
          input.scrollIntoView({ behavior: "smooth", block: "center" });
          input.setSelectionRange(input.value.length, input.value.length);
        });
        return;
      }

      if (payload.type === "TH_TRIGGER_SLASH") {
        const sourceFrameEntry = Array.from(htmlPreviewFrameRefs.current.entries()).find(
          ([, frame]) => frame.contentWindow === event.source,
        );
        if (!sourceFrameEntry || typeof payload.command !== "string") return;
        const [, frame] = sourceFrameEntry;
        try {
          const result = executeSlashCommand(payload.command);
          frame.contentWindow?.postMessage(
            { type: "TH_TRIGGER_SLASH_RESPONSE", requestId: payload.requestId, result },
            "*",
          );
        } catch (error) {
          frame.contentWindow?.postMessage(
            {
              type: "TH_TRIGGER_SLASH_RESPONSE",
              requestId: payload.requestId,
              error: error instanceof Error ? error.message : String(error),
            },
            "*",
          );
        }
        return;
      }

      if (typeof payload.id !== "string") {
        return;
      }

      const frame = htmlPreviewFrameRefs.current.get(payload.id);
      if (!frame || frame.contentWindow !== event.source) return;

      if (payload.type === HTML_PREVIEW_COMMAND_MESSAGE) {
        try {
          let result: unknown;
          if (payload.operation === "triggerSlash") {
            if (typeof payload.command !== "string") throw new Error("酒馆命令内容为空。");
            result = executeSlashCommand(payload.command);
          } else if (payload.operation === "setInput") {
            result = writeChatInput(typeof payload.text === "string" ? payload.text : "", false, false);
          } else if (payload.operation === "appendInput") {
            result = writeChatInput(typeof payload.text === "string" ? payload.text : "", true, false);
          } else if (payload.operation === "send") {
            result = writeChatInput(typeof payload.text === "string" ? payload.text : "", false, true);
          } else {
            throw new Error(`未知的角色卡命令：${String(payload.operation ?? "")}`);
          }
          respondToHtmlCommand(frame, payload.id, payload.requestId, result);
        } catch (error) {
          setChatStatus({
            status: "error",
            message: error instanceof Error ? error.message : "角色卡命令执行失败。",
          });
          respondToHtmlCommand(frame, payload.id, payload.requestId, undefined, error);
        }
        return;
      }

      if (payload.type === HTML_PREVIEW_VARIABLES_UPDATE_MESSAGE) {
        const messages = chatMessagesRef.current;
        const valuesEqual = (left: unknown, right: unknown) =>
          JSON.stringify(left) === JSON.stringify(right);
        const currentMessageIndex = messages.findIndex(
          (message) => message.id === frame.dataset.messageId,
        );
        const normalizeMessageIndex = (value: unknown, defaultToCurrent: boolean) => {
          if (value == null || value === "current") {
            return defaultToCurrent ? currentMessageIndex : messages.length - 1;
          }
          if (value === "latest") return messages.length - 1;
          const parsed = Number(value);
          if (!Number.isInteger(parsed)) {
            return defaultToCurrent ? currentMessageIndex : messages.length - 1;
          }
          return parsed < 0 ? messages.length + parsed : parsed;
        };

        if (payload.operation === "replaceVariables") {
          const normalizedOption = isObjectRecord(payload.option)
            ? payload.option
            : typeof payload.option === "number" || typeof payload.option === "string"
              ? { type: "message", message_id: payload.option }
              : { type: "message", message_id: currentMessageIndex };
          const variableType = String(normalizedOption.type ?? "message").toLowerCase();
          const nextVariables = normalizeTavernVariables(payload.variables);

          if (variableType === "global") {
            if (valuesEqual(tavernGlobalVariablesRef.current, nextVariables)) return;
            tavernGlobalVariablesRef.current = nextVariables;
            setTavernGlobalVariables(nextVariables);
            return;
          }
          if (variableType === "chat") {
            const sessionId = activeChatSessionIdRef.current;
            const currentSession = chatSessionsRef.current.find(
              (session) => session.id === sessionId,
            );
            if (valuesEqual(currentSession?.scriptVariables ?? {}, nextVariables)) return;
            const nextSessions = chatSessionsRef.current.map((session) =>
              session.id === sessionId
                ? {
                    ...session,
                    scriptVariables: nextVariables,
                    updatedAt: new Date().toISOString(),
                  }
                : session,
            );
            chatSessionsRef.current = nextSessions;
            setChatSessions(nextSessions);
            return;
          }
          if (variableType === "character" || variableType === "char") {
            const session = chatSessionsRef.current.find(
              (candidate) => candidate.id === activeChatSessionIdRef.current,
            );
            if (!session?.roleplayCharacterCardId) return;
            const currentCard = characterCardsRef.current.find(
              (card) => card.id === session.roleplayCharacterCardId,
            );
            if (valuesEqual(currentCard?.tavernVariables ?? {}, nextVariables)) return;
            const updatedAt = new Date().toISOString();
            const nextCards = characterCardsRef.current.map((card) =>
              card.id === session.roleplayCharacterCardId
                ? { ...card, tavernVariables: nextVariables, updatedAt }
                : card,
            );
            characterCardsRef.current = nextCards;
            setCharacterCards(nextCards);
            return;
          }

          const messageIndex = normalizeMessageIndex(
            normalizedOption.message_id,
            true,
          );
          if (!messages[messageIndex]) return;
          if (valuesEqual(messages[messageIndex].variables ?? {}, nextVariables)) return;
          const nextMessages = messages.map((message, index) =>
            index === messageIndex ? { ...message, variables: nextVariables } : message,
          );
          chatMessagesRef.current = nextMessages;
          setChatMessages(nextMessages);
          return;
        }

        if (payload.operation === "setChatMessages" && Array.isArray(payload.updates)) {
          const nextMessages = messages.map((message) => ({ ...message }));
          payload.updates.forEach((rawUpdate) => {
            if (!isObjectRecord(rawUpdate)) return;
            const messageIndex = normalizeMessageIndex(rawUpdate.message_id, false);
            const message = nextMessages[messageIndex];
            if (!message) return;
            if (typeof rawUpdate.message === "string") message.content = rawUpdate.message;
            else if (typeof rawUpdate.content === "string") message.content = rawUpdate.content;
            const swipeIndex = Number.isInteger(Number(rawUpdate.swipe_id))
              ? Math.max(0, Number(rawUpdate.swipe_id))
              : 0;
            if (
              Array.isArray(rawUpdate.swipes) &&
              typeof rawUpdate.swipes[swipeIndex] === "string"
            ) {
              message.content = rawUpdate.swipes[swipeIndex];
            }
            if (rawUpdate.role === "user" || rawUpdate.role === "assistant") {
              message.role = rawUpdate.role;
            }
            if (isObjectRecord(rawUpdate.data)) {
              message.variables = normalizeTavernVariables(rawUpdate.data);
            } else if (
              Array.isArray(rawUpdate.swipes_data) &&
              isObjectRecord(rawUpdate.swipes_data[swipeIndex])
            ) {
              message.variables = normalizeTavernVariables(rawUpdate.swipes_data[swipeIndex]);
            } else if (
              Array.isArray(rawUpdate.variables) &&
              isObjectRecord(rawUpdate.variables[swipeIndex])
            ) {
              message.variables = normalizeTavernVariables(rawUpdate.variables[swipeIndex]);
            } else if (isObjectRecord(rawUpdate.variables)) {
              message.variables = normalizeTavernVariables(rawUpdate.variables);
            }
            if (isObjectRecord(rawUpdate.extra)) {
              message.extra = normalizeTavernVariables(rawUpdate.extra);
            } else if (
              Array.isArray(rawUpdate.swipes_info) &&
              isObjectRecord(rawUpdate.swipes_info[swipeIndex])
            ) {
              message.extra = normalizeTavernVariables(rawUpdate.swipes_info[swipeIndex]);
            }
          });
          if (valuesEqual(messages, nextMessages)) return;
          chatMessagesRef.current = nextMessages;
          setChatMessages(nextMessages);
        }
        return;
      }

      if (payload.type !== HTML_PREVIEW_RESIZE_MESSAGE) return;

      const nextHeight = Number(payload.height);
      if (!Number.isFinite(nextHeight)) return;

      const frameWidth = frame.getBoundingClientRect().width || frame.clientWidth || 0;
      const intrinsicMinHeight =
        payload.intrinsic === true && frameWidth > 0
          ? Math.max(220, Math.min(960, Math.round(frameWidth * 0.72)))
          : 220;
      const clampedHeight = Math.max(
        intrinsicMinHeight,
        Math.min(Math.ceil(nextHeight), HTML_PREVIEW_MAX_HEIGHT),
      );
      frame.style.height = `${clampedHeight}px`;
    }

    window.addEventListener("message", handleHtmlPreviewMessage);
    return () => window.removeEventListener("message", handleHtmlPreviewMessage);
  }, []);

  useEffect(() => {
    if (!mobilePromptPreviewOpen) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobilePromptPreviewOpen(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobilePromptPreviewOpen]);

  function openMobileSidebar() {
    setMobilePromptPreviewOpen(false);
    setMobileSidebarOpen(true);
  }

  function closeMobileSidebar() {
    setMobileSidebarOpen(false);
  }

  const beginChatGeneration = () => {
    const controller = new AbortController();
    activeChatAbortControllerRef.current = controller;
    setChatGenerationState("running");
    void tavernScriptRuntimeRef.current?.emit(TAVERN_EVENTS.GENERATION_STARTED);
    return controller;
  };

  const finishChatGeneration = (controller: AbortController) => {
    if (activeChatAbortControllerRef.current !== controller) return;
    activeChatAbortControllerRef.current = null;
    setChatGenerationState("idle");
    void tavernScriptRuntimeRef.current?.emit(TAVERN_EVENTS.GENERATION_ENDED);
  };

  const stopChatGeneration = () => {
    const controller = activeChatAbortControllerRef.current;
    if (!controller) return;

    setChatGenerationState("stopping");
    setChatStatus({ status: "loading", message: "正在停止输出..." });
    if (!controller.signal.aborted) {
      controller.abort(createChatAbortError());
    }
  };

  useEffect(() => {
    return () => {
      activeChatAbortControllerRef.current?.abort(createChatAbortError());
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialAppData() {
      const [persistentData, localPersonas, databaseCharacterCards] = await Promise.all([
        loadPersistentAppData(),
        personaStore.list(),
        loadCharacterCardsFromDatabase(),
      ]);
      if (cancelled) return;

      const normalizedPersonas = mergeBuiltInPersonas(
        persistentData?.personas && persistentData.personas.length > 0
          ? persistentData.personas.map(normalizePersona)
          : localPersonas.map(normalizePersona),
      );
      const normalizedProviders =
        persistentData?.providers && persistentData.providers.length > 0
          ? persistentData.providers.map(normalizeProviderChannel)
          : loadProviderChannels();
      const normalizedChatSessions =
        persistentData?.chatSessions && persistentData.chatSessions.length > 0
          ? persistentData.chatSessions.map(normalizeChatSession)
          : loadChatSessions();
      const normalizedSystemPrompts =
        persistentData?.systemPrompts && persistentData.systemPrompts.length > 0
          ? persistentData.systemPrompts.map(normalizeSystemPromptProfile)
          : loadSystemPrompts();
      const normalizedChatPresets =
        persistentData?.chatPresets && persistentData.chatPresets.length > 0
          ? persistentData.chatPresets.map((preset, index) => normalizeChatPreset(preset, index))
          : loadChatPresetsFromStorage(CHAT_PRESETS_STORAGE_KEY);
      const normalizedWorldBooks = Array.isArray(persistentData?.worldBooks)
        ? persistentData.worldBooks.map(normalizeWorldBook)
        : loadWorldBooksFromStorage(WORLD_BOOKS_STORAGE_KEY);
      const normalizedRegexScripts = Array.isArray(persistentData?.regexScripts)
        ? persistentData.regexScripts.map((script, index) =>
            normalizeRegexScript(script, index),
          )
        : loadRegexScriptsFromStorage(REGEX_SCRIPTS_STORAGE_KEY);
      const normalizedTavernScripts = Array.isArray(persistentData?.tavernScripts)
        ? persistentData.tavernScripts.map((script, index) =>
            normalizeTavernScript(script, index),
          )
        : loadTavernScriptsFromStorage(TAVERN_SCRIPTS_STORAGE_KEY);
      const nextTavernGlobalVariables = normalizeTavernVariables(
        persistentData?.tavernGlobalVariables ?? (() => {
          try {
            return JSON.parse(
              localStorage.getItem(TAVERN_GLOBAL_VARIABLES_STORAGE_KEY) ?? "{}",
            ) as unknown;
          } catch {
            return {};
          }
        })(),
      );
      const normalizedCharacterCards =
        Array.isArray(persistentData?.characterCards) && persistentData.characterCards.length > 0
        ? persistentData.characterCards.map((card, index) =>
            normalizeCharacterCard(card, index),
          )
        : databaseCharacterCards.length > 0
          ? databaseCharacterCards
          : loadCharacterCardsFromStorage(CHARACTER_CARDS_STORAGE_KEY);
      const normalizedUserProfile = persistentData?.userProfile
        ? normalizeUserProfile(persistentData.userProfile)
        : loadUserProfile();
      const nextChatSender = normalizeChatSenderIdentity(
        persistentData?.chatSender ?? loadChatSender(),
        normalizedPersonas,
      );
      const nextChatMode = normalizeChatMode(persistentData?.chatMode ?? loadChatMode());
      const storedActiveCharacterCardId =
        persistentData?.activeCharacterCardId ??
        localStorage.getItem(ACTIVE_CHARACTER_CARD_STORAGE_KEY) ??
        "";
      const nextActiveCharacterCardId = normalizedCharacterCards.some(
        (card) => card.id === storedActiveCharacterCardId,
      )
        ? storedActiveCharacterCardId
        : normalizedCharacterCards[0]?.id ?? "";
      const storedMultiAgentPersonaIds = normalizeMultiAgentPersonaIds(
        persistentData?.multiAgentPersonaIds ?? loadMultiAgentPersonaIds(),
        normalizedPersonas,
      );
      const nextMultiAgentPersonaIds =
        storedMultiAgentPersonaIds.length > 0
          ? storedMultiAgentPersonaIds
          : normalizedPersonas.slice(0, 2).map((persona) => persona.id);
      const nextMultiAgentRounds = normalizeMultiAgentRounds(
        persistentData?.multiAgentRounds ?? loadMultiAgentRounds(),
      );
      const nextMultiAgentStopCondition = String(
        persistentData?.multiAgentStopCondition ?? loadMultiAgentStopCondition(),
      );
      const nextMultiAgentAutoStopEnabled =
        typeof persistentData?.multiAgentAutoStopEnabled === "boolean"
          ? persistentData.multiAgentAutoStopEnabled
          : loadMultiAgentAutoStopEnabled();
      const nextChatMultiBubbleEnabled =
        typeof persistentData?.chatMultiBubbleEnabled === "boolean"
          ? persistentData.chatMultiBubbleEnabled
          : localStorage.getItem(CHAT_MULTI_BUBBLE_STORAGE_KEY) === "true";
      const nextChatHtmlRenderEnabled =
        typeof persistentData?.chatHtmlRenderEnabled === "boolean"
          ? persistentData.chatHtmlRenderEnabled
          : localStorage.getItem(CHAT_HTML_RENDER_STORAGE_KEY) === "true";
      const nextChatReasoningVisible =
        typeof persistentData?.chatReasoningVisible === "boolean"
          ? persistentData.chatReasoningVisible
          : localStorage.getItem(CHAT_REASONING_VISIBLE_STORAGE_KEY) === "true";
      const nextChatHeartbeatReminderVisible =
        typeof persistentData?.chatHeartbeatReminderVisible === "boolean"
          ? persistentData.chatHeartbeatReminderVisible
          : localStorage.getItem(CHAT_HEARTBEAT_REMINDER_VISIBLE_STORAGE_KEY) !== "false";
      const nextChatPersonalization = persistentData?.chatPersonalization
        ? normalizeChatPersonalization(persistentData.chatPersonalization)
        : loadChatPersonalization();
      const nextMcpServers = Array.isArray(persistentData?.mcpServers)
        ? persistentData.mcpServers.map((server, index) =>
            normalizeMcpServerConfig(server as Partial<McpServerConfig> & Record<string, unknown>, `MCP Server ${index + 1}`),
          )
        : loadMcpServers();
      const nextSkills = Array.isArray(persistentData?.skills)
        ? persistentData.skills.map((skill) =>
            normalizeSkillProfile(skill as Partial<SkillProfile> & Record<string, unknown>),
          )
        : loadSkills();
      const storedPcConnection = getStoredPcConnection();
      const persistentPcConnection = persistentData?.pcConnection;
      const nextPcConnection =
        persistentPcConnection &&
        (typeof persistentPcConnection.baseUrl === "string" ||
          typeof persistentPcConnection.workspacePath === "string")
          ? persistentPcConnection
          : storedPcConnection;
      const nextPcWorkspace = normalizePcWorkspaceHandle(nextPcConnection);
      const nextPcServerUrl =
        typeof nextPcConnection.baseUrl === "string"
          ? nextPcConnection.baseUrl
          : nextPcWorkspace?.baseUrl ?? "";
      const localActiveProviderId = localStorage.getItem(ACTIVE_PROVIDER_STORAGE_KEY);
      const nextActiveProviderId =
        persistentData?.activeProviderId &&
        normalizedProviders.some((provider) => provider.id === persistentData.activeProviderId)
          ? persistentData.activeProviderId
          : localActiveProviderId &&
              normalizedProviders.some((provider) => provider.id === localActiveProviderId)
            ? localActiveProviderId
            : normalizedProviders[0]?.id ?? "";
      const nextMultiAgentModelConfigs = normalizeMultiAgentModelConfigs(
        persistentData?.multiAgentModelConfigs ?? loadMultiAgentModelConfigs(),
        normalizedPersonas,
        normalizedProviders,
        nextActiveProviderId,
      );
      const localActivePersonaId = localStorage.getItem(ACTIVE_PERSONA_STORAGE_KEY);
      const nextActivePersonaId =
        persistentData?.activePersonaId &&
        normalizedPersonas.some((persona) => persona.id === persistentData.activePersonaId)
          ? persistentData.activePersonaId
          : localActivePersonaId &&
              normalizedPersonas.some((persona) => persona.id === localActivePersonaId)
            ? localActivePersonaId
            : normalizedPersonas[0]?.id ?? "";
      const localActiveSystemPromptId = localStorage.getItem(ACTIVE_SYSTEM_PROMPT_STORAGE_KEY);
      const nextActiveSystemPromptId =
        persistentData?.activeSystemPromptId &&
        normalizedSystemPrompts.some((prompt) => prompt.id === persistentData.activeSystemPromptId)
          ? persistentData.activeSystemPromptId
          : localActiveSystemPromptId &&
              normalizedSystemPrompts.some((prompt) => prompt.id === localActiveSystemPromptId)
            ? localActiveSystemPromptId
            : normalizedSystemPrompts[0]?.id ?? "";
      const persistentActiveSystemPromptIds = Array.isArray(persistentData?.activeSystemPromptIds)
        ? normalizeActiveSystemPromptIds(persistentData.activeSystemPromptIds, normalizedSystemPrompts)
        : null;
      const storedActiveSystemPromptIds = getStoredActiveSystemPromptIds();
      const nextActiveSystemPromptIds =
        persistentActiveSystemPromptIds
          ? persistentActiveSystemPromptIds
          : storedActiveSystemPromptIds
            ? normalizeActiveSystemPromptIds(storedActiveSystemPromptIds, normalizedSystemPrompts)
            : nextActiveSystemPromptId
              ? [nextActiveSystemPromptId]
              : [];
      const localActiveChatPresetId = localStorage.getItem(ACTIVE_CHAT_PRESET_STORAGE_KEY);
      const nextActiveChatPresetId =
        persistentData?.activeChatPresetId &&
        normalizedChatPresets.some((preset) => preset.id === persistentData.activeChatPresetId)
          ? persistentData.activeChatPresetId
          : localActiveChatPresetId &&
              normalizedChatPresets.some((preset) => preset.id === localActiveChatPresetId)
            ? localActiveChatPresetId
            : normalizedChatPresets[0]?.id ?? "";
      const nextChatPresetEnabled =
        typeof persistentData?.chatPresetEnabled === "boolean"
          ? persistentData.chatPresetEnabled
          : localStorage.getItem(CHAT_PRESET_ENABLED_STORAGE_KEY) === "true";
      let storedActiveWorldBookIds: unknown = [];
      try {
        storedActiveWorldBookIds = JSON.parse(
          localStorage.getItem(ACTIVE_WORLD_BOOKS_STORAGE_KEY) ?? "[]",
        );
      } catch {
        storedActiveWorldBookIds = [];
      }
      const nextActiveWorldBookIds = normalizeActiveWorldBookIds(
        Array.isArray(persistentData?.activeWorldBookIds)
          ? persistentData.activeWorldBookIds
          : storedActiveWorldBookIds,
        normalizedWorldBooks,
      );

      setPersonas(normalizedPersonas);
      setActivePersonaId(nextActivePersonaId);
      setProviders(normalizedProviders);
      setActiveProviderId(nextActiveProviderId);
      setSystemPrompts(normalizedSystemPrompts);
      setActiveSystemPromptId(nextActiveSystemPromptId);
      setActiveSystemPromptIds(nextActiveSystemPromptIds);
      setChatPresets(normalizedChatPresets);
      setActiveChatPresetId(nextActiveChatPresetId);
      setChatPresetEnabled(nextChatPresetEnabled);
      setWorldBooks(normalizedWorldBooks);
      setActiveWorldBookIds(nextActiveWorldBookIds);
      setSelectedWorldBookId(normalizedWorldBooks[0]?.id ?? "");
      setSelectedWorldBookEntryId(normalizedWorldBooks[0]?.entries[0]?.id ?? "");
      setRegexScripts(normalizedRegexScripts);
      setSelectedRegexTargetKey(
        normalizedRegexScripts[0] ? `global:${normalizedRegexScripts[0].id}` : "",
      );
      setTavernScripts(normalizedTavernScripts);
      setSelectedTavernScriptKey(
        normalizedTavernScripts[0] ? `global:${normalizedTavernScripts[0].id}` : "",
      );
      setTavernGlobalVariables(nextTavernGlobalVariables);
      setCharacterCards(normalizedCharacterCards);
      setActiveCharacterCardId(nextActiveCharacterCardId);
      setUserProfile(normalizedUserProfile);
      setChatSender(nextChatSender);
      setChatMode(nextChatMode);
      setMultiAgentPersonaIds(nextMultiAgentPersonaIds);
      setMultiAgentRounds(nextMultiAgentRounds);
      setMultiAgentModelConfigs(nextMultiAgentModelConfigs);
      setMultiAgentAutoStopEnabled(nextMultiAgentAutoStopEnabled);
      setMultiAgentStopCondition(nextMultiAgentStopCondition);
      setChatMultiBubbleEnabled(nextChatMultiBubbleEnabled);
      setChatHtmlRenderEnabled(nextChatHtmlRenderEnabled);
      setChatReasoningVisible(nextChatReasoningVisible);
      setChatHeartbeatReminderVisible(nextChatHeartbeatReminderVisible);
      setChatPersonalization(nextChatPersonalization);
      setMcpServers(nextMcpServers);
      setActiveMcpServerId(nextMcpServers[0]?.id ?? "");
      setSkills(nextSkills);
      setActiveSkillId(nextSkills[0]?.id ?? "");
      setChatSessions(normalizedChatSessions);
      setActiveChatSessionId(normalizedChatSessions[0]?.id ?? "");
      setChatMessages(normalizedChatSessions[0]?.messages ?? []);
      setPcServerUrl(nextPcServerUrl);
      setPcTransferWorkspace(nextPcWorkspace);
      setAppDataLoaded(true);
    }

    void loadInitialAppData();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!appDataLoaded) return;

    if (personas.length > 0) {
      void personaStore.save(personas);
    }
    localStorage.setItem(PROVIDER_STORAGE_KEY, JSON.stringify(providers));
    localStorage.setItem(ACTIVE_PROVIDER_STORAGE_KEY, activeProviderId);
    localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, JSON.stringify(chatSessions));
    localStorage.setItem(CHAT_MODE_STORAGE_KEY, chatMode);
    localStorage.setItem(
      MULTI_AGENT_PERSONAS_STORAGE_KEY,
      JSON.stringify(multiAgentPersonaIds),
    );
    localStorage.setItem(
      MULTI_AGENT_ROUNDS_STORAGE_KEY,
      String(multiAgentRounds),
    );
    localStorage.setItem(
      MULTI_AGENT_MODELS_STORAGE_KEY,
      JSON.stringify(multiAgentModelConfigs),
    );
    localStorage.setItem(
      MULTI_AGENT_AUTO_STOP_STORAGE_KEY,
      String(multiAgentAutoStopEnabled),
    );
    localStorage.setItem(
      MULTI_AGENT_STOP_CONDITION_STORAGE_KEY,
      multiAgentStopCondition,
    );
    localStorage.setItem(ACTIVE_PERSONA_STORAGE_KEY, activePersonaId);
    localStorage.setItem(SYSTEM_PROMPTS_STORAGE_KEY, JSON.stringify(systemPrompts));
    localStorage.setItem(ACTIVE_SYSTEM_PROMPT_STORAGE_KEY, activeSystemPromptId);
    localStorage.setItem(ACTIVE_SYSTEM_PROMPTS_STORAGE_KEY, JSON.stringify(activeSystemPromptIds));
    localStorage.setItem(CHAT_PRESETS_STORAGE_KEY, JSON.stringify(chatPresets));
    localStorage.setItem(ACTIVE_CHAT_PRESET_STORAGE_KEY, activeChatPresetId);
    localStorage.setItem(CHAT_PRESET_ENABLED_STORAGE_KEY, String(chatPresetEnabled));
    localStorage.setItem(WORLD_BOOKS_STORAGE_KEY, JSON.stringify(worldBooks));
    localStorage.setItem(ACTIVE_WORLD_BOOKS_STORAGE_KEY, JSON.stringify(activeWorldBookIds));
    localStorage.setItem(REGEX_SCRIPTS_STORAGE_KEY, JSON.stringify(regexScripts));
    localStorage.setItem(TAVERN_SCRIPTS_STORAGE_KEY, JSON.stringify(tavernScripts));
    localStorage.setItem(
      TAVERN_GLOBAL_VARIABLES_STORAGE_KEY,
      JSON.stringify(tavernGlobalVariables),
    );
    void saveCharacterCardsToDatabase(characterCards);
    try {
      localStorage.setItem(
        CHARACTER_CARDS_STORAGE_KEY,
        JSON.stringify(characterCards.map((card) => ({ ...card, avatarDataUrl: "" }))),
      );
    } catch {
      localStorage.removeItem(CHARACTER_CARDS_STORAGE_KEY);
    }
    localStorage.setItem(ACTIVE_CHARACTER_CARD_STORAGE_KEY, activeCharacterCardId);
    localStorage.setItem(USER_PROFILE_STORAGE_KEY, JSON.stringify(userProfile));
    localStorage.setItem(CHAT_SENDER_STORAGE_KEY, JSON.stringify(chatSender));
    localStorage.setItem(CHAT_MULTI_BUBBLE_STORAGE_KEY, String(chatMultiBubbleEnabled));
    localStorage.setItem(CHAT_HTML_RENDER_STORAGE_KEY, String(chatHtmlRenderEnabled));
    localStorage.setItem(CHAT_REASONING_VISIBLE_STORAGE_KEY, String(chatReasoningVisible));
    localStorage.setItem(
      CHAT_HEARTBEAT_REMINDER_VISIBLE_STORAGE_KEY,
      String(chatHeartbeatReminderVisible),
    );
    localStorage.setItem(
      CHAT_PERSONALIZATION_STORAGE_KEY,
      JSON.stringify(chatPersonalization),
    );
    localStorage.setItem(MCP_SERVERS_STORAGE_KEY, JSON.stringify(mcpServers));
    localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(skills));
    const pcConnection: PcConnectionData = {
      baseUrl: pcTransferWorkspace?.baseUrl ?? pcServerUrl.trim(),
      ...(pcTransferWorkspace
        ? {
            workspacePath: pcTransferWorkspace.path,
            workspaceName: pcTransferWorkspace.name,
          }
        : {}),
    };
    void savePersistentAppData({
      version: 1,
      personas,
      activePersonaId,
      providers,
      activeProviderId,
      chatSessions,
      chatMode,
      multiAgentPersonaIds,
      multiAgentRounds,
      multiAgentModelConfigs,
      multiAgentAutoStopEnabled,
      multiAgentStopCondition,
      systemPrompts,
      activeSystemPromptId,
      activeSystemPromptIds,
      chatPresets,
      activeChatPresetId,
      chatPresetEnabled,
      worldBooks,
      activeWorldBookIds,
      regexScripts,
      tavernScripts,
      tavernGlobalVariables,
      characterCards,
      activeCharacterCardId,
      userProfile,
      chatSender,
      chatMultiBubbleEnabled,
      chatHtmlRenderEnabled,
      chatReasoningVisible,
      chatHeartbeatReminderVisible,
      chatPersonalization,
      mcpServers,
      skills,
      ...(pcConnection.baseUrl || pcConnection.workspacePath ? { pcConnection } : {}),
      updatedAt: new Date().toISOString(),
    });
  }, [activeCharacterCardId, activeChatPresetId, activePersonaId, activeProviderId, activeSystemPromptId, activeSystemPromptIds, activeWorldBookIds, appDataLoaded, characterCards, chatHeartbeatReminderVisible, chatHtmlRenderEnabled, chatMode, chatMultiBubbleEnabled, chatPersonalization, chatPresetEnabled, chatPresets, chatReasoningVisible, chatSender, mcpServers, multiAgentAutoStopEnabled, multiAgentModelConfigs, multiAgentPersonaIds, multiAgentRounds, multiAgentStopCondition, personas, pcServerUrl, pcTransferWorkspace, providers, chatSessions, regexScripts, skills, systemPrompts, tavernGlobalVariables, tavernScripts, userProfile, worldBooks]);

  useEffect(() => {
    if (!appDataLoaded) return;
    syncPcConnectionToLocalStorage(pcServerUrl, pcTransferWorkspace);
  }, [appDataLoaded, pcServerUrl, pcTransferWorkspace]);

  useEffect(() => {
    if (!appDataLoaded || restoredPcWorkspaceRef.current || localWorkspaceHandle || !pcTransferWorkspace) return;
    restoredPcWorkspaceRef.current = true;
    setLocalWorkspaceHandle(pcTransferWorkspace);
    setLocalToolsEnabled(true);
    restoredWorkspacePathRef.current = pcTransferWorkspace.path;
    activateWorkspaceSessions(pcTransferWorkspace);
  }, [appDataLoaded, localWorkspaceHandle, pcTransferWorkspace]);

  useEffect(() => {
    if (!appDataLoaded || !window.rengeAndroid?.isAndroid) return;
    let cancelled = false;

    void window.rengeAndroid
      .getRootAccessStatus()
      .then((result) => {
        if (cancelled || !result.granted) return;
        setRootAccessState({
          status: "success",
          message: result.message || "ROOT 权限已授权。",
          granted: true,
        });
      })
      .catch(() => {
        // Cached root status is a convenience hint; failures should not block app startup.
      });

    return () => {
      cancelled = true;
    };
  }, [appDataLoaded]);

  useEffect(() => {
    if (
      !appDataLoaded ||
      workspaceAutoRestoreDisabledRef.current ||
      !window.rengeAndroid?.isAndroid ||
      localWorkspaceHandle
    ) return;
    let cancelled = false;

    void restoreAndroidWorkspace()
      .then((handle) => {
        if (cancelled || !handle) return;
        const info = getWorkspaceInfo(handle);
        setChatStatus((current) =>
          current.status === "idle"
            ? { status: "success", message: `已恢复手机工作区：${info.name}` }
            : current,
        );
      })
      .catch(() => {
        // Android workspace restoration is best-effort; users can still choose a workspace manually.
      });

    return () => {
      cancelled = true;
    };
  }, [appDataLoaded, localWorkspaceHandle]);

  useEffect(() => {
    setChatSender((current) => normalizeChatSenderIdentity(current, personas));
  }, [personas]);

  useEffect(() => {
    setMultiAgentPersonaIds((current) =>
      normalizeMultiAgentPersonaIds(current, personas),
    );
  }, [personas]);

  useEffect(() => {
    if (characterCards.some((card) => card.id === activeCharacterCardId)) return;
    setActiveCharacterCardId(characterCards[0]?.id ?? "");
  }, [activeCharacterCardId, characterCards]);

  useEffect(() => {
    setMultiAgentModelConfigs((current) =>
      normalizeMultiAgentModelConfigs(
        current,
        personas,
        providers,
        activeProviderId,
      ),
    );
  }, [activeProviderId, personas, providers]);

  useEffect(() => {
    if (!chatMessageMenu) return;

    const closeMenu = () => setChatMessageMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [chatMessageMenu]);

  useEffect(() => {
    if (!appDataLoaded) return;
    if (activeChatSessionId || chatSessions.length === 0) return;

    setActiveChatSessionId(chatSessions[0].id);
    setChatMessages(chatSessions[0].messages);
  }, [activeChatSessionId, appDataLoaded, chatSessions]);

  useEffect(() => {
    if (!appDataLoaded) return;
    if (!activeChatSessionId) return;

    setChatSessions((current) =>
      current.map((session) =>
        session.id === activeChatSessionId
          ? {
              ...session,
              title: session.roleplayCharacterCardId
                ? session.title
                : inferChatSessionTitle(chatMessages),
              messages: chatMessages,
              updatedAt: new Date().toISOString(),
            }
          : session,
      ),
    );
  }, [activeChatSessionId, appDataLoaded, chatMessages]);

  const activePersona = useMemo(
    () => personas.find((persona) => persona.id === activePersonaId) ?? personas[0],
    [personas, activePersonaId],
  );
  const activeRoleplayCard = useMemo(
    () =>
      characterCards.find((card) => card.id === activeCharacterCardId) ??
      characterCards[0],
    [activeCharacterCardId, characterCards],
  );
  const scopedRoleplayCard = useMemo(() => {
    if (chatMode !== "roleplay") return undefined;
    const session =
      chatSessions.find((item) => item.id === activeChatSessionId) ?? chatSessions[0];
    if (!session?.roleplayCharacterCardId) return undefined;
    return characterCards.find((card) => card.id === session.roleplayCharacterCardId);
  }, [activeChatSessionId, characterCards, chatMode, chatSessions]);
  const editingCharacterCard = useMemo(
    () => characterCards.find((card) => card.id === editingCharacterCardId),
    [characterCards, editingCharacterCardId],
  );
  const filteredCharacterCards = useMemo(() => {
    const query = characterSearch.trim().toLocaleLowerCase();
    if (!query) return characterCards;
    return characterCards.filter((card) =>
      [card.name, card.description, card.creator, ...card.tags]
        .join("\n")
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [characterCards, characterSearch]);
  const roleplayPickerCards = useMemo(
    () =>
      [...characterCards].sort(
        (left, right) =>
          (Date.parse(right.updatedAt) || 0) -
            (Date.parse(left.updatedAt) || 0) ||
          left.name.localeCompare(right.name, "zh-CN"),
      ),
    [characterCards],
  );
  const multiAgentPersonas = useMemo(
    () =>
      multiAgentPersonaIds
        .map((personaId) => personas.find((persona) => persona.id === personaId))
        .filter((persona): persona is AgentPersona => Boolean(persona)),
    [multiAgentPersonaIds, personas],
  );
  const toggleMultiAgentPersona = (personaId: string) => {
    setMultiAgentPersonaIds((current) =>
      current.includes(personaId)
        ? current.filter((currentPersonaId) => currentPersonaId !== personaId)
        : [...current, personaId],
    );
  };
  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === activeProviderId) ?? providers[0],
    [providers, activeProviderId],
  );
  const getMultiAgentRequestConfig = (personaId: string) => {
    const storedConfig = multiAgentModelConfigs[personaId];
    const provider =
      providers.find((item) => item.id === storedConfig?.providerId) ?? activeProvider;
    return {
      provider,
      modelId: storedConfig?.modelId || getEffectiveProviderModelId(provider),
    };
  };
  const updateMultiAgentProvider = (personaId: string, providerId: string) => {
    const provider = providers.find((item) => item.id === providerId);
    setMultiAgentModelConfigs((current) => ({
      ...current,
      [personaId]: {
        providerId,
        modelId: getEffectiveProviderModelId(provider),
      },
    }));
  };
  const updateMultiAgentModel = (personaId: string, modelId: string) => {
    setMultiAgentModelConfigs((current) => {
      const currentConfig = current[personaId];
      return {
        ...current,
        [personaId]: {
          providerId: currentConfig?.providerId || activeProvider?.id || "",
          modelId,
        },
      };
    });
  };

  useEffect(() => {
    setProviderApiKeyVisible(false);
  }, [activeProviderId]);

  const activeMcpServer = useMemo(
    () => mcpServers.find((server) => server.id === activeMcpServerId) ?? mcpServers[0],
    [activeMcpServerId, mcpServers],
  );
  const mcpExportJson = useMemo(
    () => buildMcpServerExportJson(mcpServers),
    [mcpServers],
  );
  const enabledMcpServers = useMemo(
    () => mcpServers.filter((server) => server.enabled),
    [mcpServers],
  );
  const enabledMcpToolCount = mcpTools.filter((tool) =>
    enabledMcpServers.some((server) => server.id === tool.serverId),
  ).length;
  const activeSkill = useMemo(
    () => skills.find((skill) => skill.id === activeSkillId) ?? skills[0],
    [activeSkillId, skills],
  );
  const enabledSkills = useMemo(
    () => skills.filter((skill) => skill.enabled),
    [skills],
  );
  const activeSystemPrompt = useMemo(
    () =>
      systemPrompts.find((promptProfile) => promptProfile.id === activeSystemPromptId) ??
      systemPrompts[0],
    [activeSystemPromptId, systemPrompts],
  );
  const selectedSystemPrompts = useMemo(
    () =>
      activeSystemPromptIds
        .map((promptId) =>
          systemPrompts.find((promptProfile) => promptProfile.id === promptId),
        )
        .filter((promptProfile): promptProfile is SystemPromptProfile => Boolean(promptProfile)),
    [activeSystemPromptIds, systemPrompts],
  );
  const activeChatPreset = useMemo(
    () =>
      chatPresets.find((preset) => preset.id === activeChatPresetId) ?? chatPresets[0],
    [activeChatPresetId, chatPresets],
  );
  const selectedChatPresetPrompt = useMemo(
    () =>
      activeChatPreset?.prompts.find(
        (prompt) => prompt.identifier === selectedChatPresetPromptId,
      ) ?? activeChatPreset?.prompts[0],
    [activeChatPreset, selectedChatPresetPromptId],
  );

  useEffect(() => {
    if (!activeChatPreset) {
      setSelectedChatPresetPromptId("");
      return;
    }
    if (
      !activeChatPreset.prompts.some(
        (prompt) => prompt.identifier === selectedChatPresetPromptId,
      )
    ) {
      setSelectedChatPresetPromptId(activeChatPreset.prompts[0]?.identifier ?? "");
    }
  }, [activeChatPreset, selectedChatPresetPromptId]);

  const selectedWorldBook = useMemo(
    () =>
      worldBooks.find((worldBook) => worldBook.id === selectedWorldBookId) ??
      worldBooks[0],
    [selectedWorldBookId, worldBooks],
  );
  const selectedWorldBookEntry = useMemo(
    () =>
      selectedWorldBook?.entries.find((entry) => entry.id === selectedWorldBookEntryId) ??
      selectedWorldBook?.entries[0],
    [selectedWorldBook, selectedWorldBookEntryId],
  );
  const enabledWorldBookEntryCount = useMemo(
    () =>
      worldBooks
        .filter((worldBook) => activeWorldBookIds.includes(worldBook.id))
        .reduce(
          (total, worldBook) =>
            total + worldBook.entries.filter((entry) => entry.enabled).length,
          0,
        ),
    [activeWorldBookIds, worldBooks],
  );

  useEffect(() => {
    if (!selectedWorldBook) {
      setSelectedWorldBookId("");
      setSelectedWorldBookEntryId("");
      return;
    }
    if (selectedWorldBook.id !== selectedWorldBookId) {
      setSelectedWorldBookId(selectedWorldBook.id);
    }
    if (!selectedWorldBook.entries.some((entry) => entry.id === selectedWorldBookEntryId)) {
      setSelectedWorldBookEntryId(selectedWorldBook.entries[0]?.id ?? "");
    }
  }, [selectedWorldBook, selectedWorldBookEntryId, selectedWorldBookId]);

  const updateSelectedWorldBook = (patch: Partial<WorldBook>) => {
    if (!selectedWorldBook) return;
    setWorldBooks((current) =>
      current.map((worldBook) =>
        worldBook.id === selectedWorldBook.id
          ? { ...worldBook, ...patch, updatedAt: new Date().toISOString() }
          : worldBook,
      ),
    );
  };

  const addWorldBook = () => {
    const worldBook = createWorldBook(`新世界书 ${worldBooks.length + 1}`);
    setWorldBooks((current) => [...current, worldBook]);
    setSelectedWorldBookId(worldBook.id);
    setSelectedWorldBookEntryId("");
    setWorldBookImportState({ status: "idle", message: "" });
  };

  const deleteSelectedWorldBook = () => {
    if (!selectedWorldBook) return;
    const remaining = worldBooks.filter((worldBook) => worldBook.id !== selectedWorldBook.id);
    setWorldBooks(remaining);
    setActiveWorldBookIds((current) =>
      current.filter((worldBookId) => worldBookId !== selectedWorldBook.id),
    );
    setSelectedWorldBookId(remaining[0]?.id ?? "");
    setSelectedWorldBookEntryId(remaining[0]?.entries[0]?.id ?? "");
  };

  const toggleWorldBook = (worldBookId: string) => {
    setActiveWorldBookIds((current) =>
      current.includes(worldBookId)
        ? current.filter((currentId) => currentId !== worldBookId)
        : [...current, worldBookId],
    );
  };

  const importWorldBookFile = async (file?: File) => {
    if (!file) return;
    setWorldBookImportState({ status: "loading", message: "正在解析酒馆原生世界书..." });
    try {
      const importedWorldBook = importSillyTavernWorldBook(
        JSON.parse(await file.text()) as unknown,
        file.name,
      );
      setWorldBooks((current) => [...current, importedWorldBook]);
      setActiveWorldBookIds((current) => [...current, importedWorldBook.id]);
      setSelectedWorldBookId(importedWorldBook.id);
      setSelectedWorldBookEntryId(importedWorldBook.entries[0]?.id ?? "");
      setWorldBookImportState({ status: "idle", message: "" });
    } catch (error) {
      setWorldBookImportState({
        status: "error",
        message:
          error instanceof Error
            ? `导入失败：${error.message}`
            : "导入失败：世界书格式无效。",
      });
    } finally {
      if (worldBookImportInputRef.current) worldBookImportInputRef.current.value = "";
    }
  };

  const addWorldBookEntry = () => {
    if (!selectedWorldBook) return;
    const entry = createWorldBookEntry(selectedWorldBook.entries.length);
    updateSelectedWorldBook({ entries: [...selectedWorldBook.entries, entry] });
    setSelectedWorldBookEntryId(entry.id);
  };

  const updateWorldBookEntry = (entryId: string, patch: Partial<WorldBookEntry>) => {
    if (!selectedWorldBook) return;
    updateSelectedWorldBook({
      entries: selectedWorldBook.entries.map((entry) =>
        entry.id === entryId ? { ...entry, ...patch } : entry,
      ),
    });
  };

  const deleteWorldBookEntry = (entryId: string) => {
    if (!selectedWorldBook) return;
    const entries = selectedWorldBook.entries.filter((entry) => entry.id !== entryId);
    updateSelectedWorldBook({ entries });
    setSelectedWorldBookEntryId(entries[0]?.id ?? "");
  };

  const moveWorldBookEntry = (entryId: string, direction: -1 | 1) => {
    if (!selectedWorldBook) return;
    const index = selectedWorldBook.entries.findIndex((entry) => entry.id === entryId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= selectedWorldBook.entries.length) return;
    const entries = [...selectedWorldBook.entries];
    [entries[index], entries[targetIndex]] = [entries[targetIndex], entries[index]];
    updateSelectedWorldBook({ entries });
  };

  const regexScriptTargets = useMemo<RegexScriptTarget[]>(
    () => [
      ...regexScripts.map((script, index) => ({
        key: `global:${script.id}`,
        scope: "global" as const,
        script,
        index,
        total: regexScripts.length,
      })),
      ...chatPresets.flatMap((preset) =>
        preset.regexScripts.map((script, index) => ({
          key: `preset:${preset.id}:${script.id}`,
          scope: "preset" as const,
          script,
          index,
          total: preset.regexScripts.length,
          presetId: preset.id,
          presetName: preset.name,
        })),
      ),
    ],
    [chatPresets, regexScripts],
  );
  const selectedRegexTarget = useMemo(
    () =>
      regexScriptTargets.find((target) => target.key === selectedRegexTargetKey) ??
      regexScriptTargets[0],
    [regexScriptTargets, selectedRegexTargetKey],
  );
  const effectiveRegexScripts = useMemo(
    () => [
      ...regexScripts,
      ...(chatPresetEnabled && activeChatPreset ? activeChatPreset.regexScripts : []),
      ...(scopedRoleplayCard
        ? scopedRoleplayCard.regexScripts
        : []),
    ],
    [activeChatPreset, chatPresetEnabled, regexScripts, scopedRoleplayCard],
  );
  const selectedRegexError = selectedRegexTarget
    ? getRegexScriptError(selectedRegexTarget.script)
    : "";

  useEffect(() => {
    if (!selectedRegexTarget) {
      setSelectedRegexTargetKey("");
      return;
    }
    if (selectedRegexTarget.key !== selectedRegexTargetKey) {
      setSelectedRegexTargetKey(selectedRegexTarget.key);
    }
  }, [selectedRegexTarget, selectedRegexTargetKey]);

  const updateRegexScriptTarget = (
    target: RegexScriptTarget,
    patch: Partial<RegexScript>,
  ) => {
    const updatedAt = new Date().toISOString();
    if (target.scope === "global") {
      setRegexScripts((current) =>
        current.map((script) =>
          script.id === target.script.id ? { ...script, ...patch, updatedAt } : script,
        ),
      );
      return;
    }
    setChatPresets((current) =>
      current.map((preset) =>
        preset.id === target.presetId
          ? {
              ...preset,
              regexScripts: preset.regexScripts.map((script) =>
                script.id === target.script.id
                  ? { ...script, ...patch, updatedAt }
                  : script,
              ),
              updatedAt,
            }
          : preset,
      ),
    );
  };

  const addRegexScript = () => {
    const script = createRegexScript(`新正则规则 ${regexScripts.length + 1}`);
    setRegexScripts((current) => [...current, script]);
    setSelectedRegexTargetKey(`global:${script.id}`);
    setRegexImportState({ status: "idle", message: "" });
  };

  const importRegexScriptFile = async (file?: File) => {
    if (!file) return;
    setRegexImportState({ status: "loading", message: "正在解析酒馆原生正则..." });
    try {
      const scripts = importSillyTavernRegexFile(
        JSON.parse(await file.text()) as unknown,
        file.name,
      );
      setRegexScripts((current) => [...current, ...scripts]);
      setSelectedRegexTargetKey(`global:${scripts[0].id}`);
      setRegexImportState({ status: "idle", message: "" });
    } catch (error) {
      setRegexImportState({
        status: "error",
        message:
          error instanceof Error
            ? `导入失败：${error.message}`
            : "导入失败：正则格式无效。",
      });
    } finally {
      if (regexImportInputRef.current) regexImportInputRef.current.value = "";
    }
  };

  const deleteRegexScriptTarget = (target: RegexScriptTarget) => {
    if (target.scope === "global") {
      setRegexScripts((current) =>
        current.filter((script) => script.id !== target.script.id),
      );
    } else {
      setChatPresets((current) =>
        current.map((preset) =>
          preset.id === target.presetId
            ? {
                ...preset,
                regexScripts: preset.regexScripts.filter(
                  (script) => script.id !== target.script.id,
                ),
                updatedAt: new Date().toISOString(),
              }
            : preset,
        ),
      );
    }
    setSelectedRegexTargetKey(
      regexScriptTargets.find((candidate) => candidate.key !== target.key)?.key ?? "",
    );
  };

  const moveRegexScriptTarget = (target: RegexScriptTarget, direction: -1 | 1) => {
    const targetIndex = target.index + direction;
    if (targetIndex < 0 || targetIndex >= target.total) return;
    const move = (scripts: RegexScript[]) => {
      const next = [...scripts];
      [next[target.index], next[targetIndex]] = [next[targetIndex], next[target.index]];
      return next;
    };
    if (target.scope === "global") {
      setRegexScripts(move);
      return;
    }
    setChatPresets((current) =>
      current.map((preset) =>
        preset.id === target.presetId
          ? { ...preset, regexScripts: move(preset.regexScripts), updatedAt: new Date().toISOString() }
          : preset,
      ),
    );
  };

  const toggleRegexPlacement = (target: RegexScriptTarget, placement: number) => {
    const current = target.script.placement;
    updateRegexScriptTarget(target, {
      placement: current.includes(placement)
        ? current.filter((value) => value !== placement)
        : [...current, placement].sort((left, right) => left - right),
    });
  };

  const tavernScriptTargets = useMemo<TavernScriptTarget[]>(
    () => [
      ...tavernScripts.map((script, index) => ({
        key: `global:${script.id}`,
        scope: "global" as const,
        script,
        index,
        total: tavernScripts.length,
      })),
      ...characterCards.flatMap((card) =>
        card.tavernScripts.map((script, index) => ({
          key: `character:${card.id}:${script.id}`,
          scope: "character" as const,
          script,
          index,
          total: card.tavernScripts.length,
          characterId: card.id,
          characterName: card.name,
        })),
      ),
    ],
    [characterCards, tavernScripts],
  );
  const selectedTavernScriptTarget = useMemo(
    () =>
      tavernScriptTargets.find((target) => target.key === selectedTavernScriptKey) ??
      tavernScriptTargets[0],
    [selectedTavernScriptKey, tavernScriptTargets],
  );

  useEffect(() => {
    if (!selectedTavernScriptTarget) {
      setSelectedTavernScriptKey("");
      setTavernScriptDataDraft("{}");
      return;
    }
    if (selectedTavernScriptTarget.key !== selectedTavernScriptKey) {
      setSelectedTavernScriptKey(selectedTavernScriptTarget.key);
    }
    setTavernScriptDataDraft(
      JSON.stringify(selectedTavernScriptTarget.script.data, null, 2),
    );
  }, [selectedTavernScriptKey, selectedTavernScriptTarget]);

  const updateTavernScriptTarget = (
    target: TavernScriptTarget,
    patch: Partial<TavernScript>,
  ) => {
    const updatedAt = new Date().toISOString();
    if (target.scope === "global") {
      setTavernScripts((current) =>
        current.map((script) =>
          script.id === target.script.id ? { ...script, ...patch, updatedAt } : script,
        ),
      );
      return;
    }
    setCharacterCards((current) =>
      current.map((card) =>
        card.id === target.characterId
          ? {
              ...card,
              tavernScripts: card.tavernScripts.map((script) =>
                script.id === target.script.id
                  ? { ...script, ...patch, updatedAt }
                  : script,
              ),
              updatedAt,
            }
          : card,
      ),
    );
  };

  const addTavernScript = () => {
    const script = createTavernScript(`新酒馆脚本 ${tavernScripts.length + 1}`);
    setTavernScripts((current) => [...current, script]);
    setSelectedTavernScriptKey(`global:${script.id}`);
    setTavernScriptImportState({ status: "idle", message: "" });
  };

  const importTavernScriptFiles = async (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length === 0) return;
    setTavernScriptImportState({
      status: "loading",
      message: `正在解析 ${fileList.length} 个酒馆脚本文件...`,
    });
    const imported: TavernScript[] = [];
    const errors: string[] = [];
    for (const file of fileList) {
      try {
        imported.push(...(await importSillyTavernScriptFile(file)));
      } catch (error) {
        errors.push(`${file.name}：${error instanceof Error ? error.message : "格式无效"}`);
      }
    }
    if (imported.length > 0) {
      setTavernScripts((current) => [...current, ...imported]);
      setSelectedTavernScriptKey(`global:${imported[0].id}`);
    }
    setTavernScriptImportState(
      errors.length > 0
        ? { status: "error", message: `部分文件导入失败：${errors.join("；")}` }
        : { status: "idle", message: "" },
    );
    if (tavernScriptImportInputRef.current) {
      tavernScriptImportInputRef.current.value = "";
    }
  };

  const deleteTavernScriptTarget = (target: TavernScriptTarget) => {
    if (target.scope === "global") {
      setTavernScripts((current) =>
        current.filter((script) => script.id !== target.script.id),
      );
    } else {
      setCharacterCards((current) =>
        current.map((card) =>
          card.id === target.characterId
            ? {
                ...card,
                tavernScripts: card.tavernScripts.filter(
                  (script) => script.id !== target.script.id,
                ),
                updatedAt: new Date().toISOString(),
              }
            : card,
        ),
      );
    }
    setSelectedTavernScriptKey(
      tavernScriptTargets.find((candidate) => candidate.key !== target.key)?.key ?? "",
    );
  };

  const moveTavernScriptTarget = (target: TavernScriptTarget, direction: -1 | 1) => {
    const targetIndex = target.index + direction;
    if (targetIndex < 0 || targetIndex >= target.total) return;
    const move = (scripts: TavernScript[]) => {
      const next = [...scripts];
      [next[target.index], next[targetIndex]] = [next[targetIndex], next[target.index]];
      return next;
    };
    if (target.scope === "global") {
      setTavernScripts(move);
      return;
    }
    setCharacterCards((current) =>
      current.map((card) =>
        card.id === target.characterId
          ? {
              ...card,
              tavernScripts: move(card.tavernScripts),
              updatedAt: new Date().toISOString(),
            }
          : card,
      ),
    );
  };

  const saveTavernScriptData = () => {
    if (!selectedTavernScriptTarget) return;
    try {
      const parsed = JSON.parse(tavernScriptDataDraft) as unknown;
      if (!isObjectRecord(parsed)) throw new Error("脚本数据必须是 JSON 对象。");
      updateTavernScriptTarget(selectedTavernScriptTarget, {
        data: normalizeTavernVariables(parsed),
      });
      setTavernScriptImportState({ status: "idle", message: "" });
    } catch (error) {
      setTavernScriptImportState({
        status: "error",
        message: error instanceof Error ? `脚本数据无效：${error.message}` : "脚本数据无效。",
      });
    }
  };

  const downloadTavernScriptJson = (content: string, name: string) => {
    const safeName = (name.trim() || "tavern-script").replace(/[\\/:*?"<>|]/g, "_");
    const url = URL.createObjectURL(
      new Blob([content], { type: "application/json;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeName}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const runSelectedTavernScript = async () => {
    if (!selectedTavernScriptTarget) return;
    const isActive =
      selectedTavernScriptTarget.scope === "global" ||
      selectedTavernScriptTarget.characterId === scopedRoleplayCard?.id;
    if (!isActive) {
      setTavernScriptImportState({
        status: "error",
        message: "角色内置脚本只能在绑定该角色卡的会话中运行。",
      });
      return;
    }
    const runtime = tavernScriptRuntimeRef.current;
    if (!runtime?.isReady()) {
      setTavernScriptImportState({
        status: "error",
        message: "请先打开一个会话，等待酒馆脚本运行环境就绪。",
      });
      return;
    }
    setTavernScriptImportState({ status: "loading", message: "正在运行脚本..." });
    try {
      await runtime.executeScript(selectedTavernScriptTarget.script.id);
      setTavernScriptImportState({ status: "idle", message: "" });
    } catch (error) {
      setTavernScriptImportState({
        status: "error",
        message: error instanceof Error ? error.message : "脚本运行失败。",
      });
    }
  };

  const updateActiveChatPreset = (patch: Partial<ChatPreset>) => {
    if (!activeChatPreset) return;
    setChatPresets((current) =>
      current.map((preset) =>
        preset.id === activeChatPreset.id
          ? { ...preset, ...patch, updatedAt: new Date().toISOString() }
          : preset,
      ),
    );
  };

  const addChatPreset = () => {
    const preset = createDefaultChatPreset(`新预设 ${chatPresets.length + 1}`);
    setChatPresets((current) => [...current, preset]);
    setActiveChatPresetId(preset.id);
    setSelectedChatPresetPromptId("");
    setPresetImportState({ status: "idle", message: "" });
  };

  const duplicateChatPreset = () => {
    if (!activeChatPreset) return;
    const timestamp = new Date().toISOString();
    const duplicate: ChatPreset = {
      ...activeChatPreset,
      id: crypto.randomUUID(),
      name: `${activeChatPreset.name} 副本`,
      prompts: activeChatPreset.prompts.map((prompt) => ({ ...prompt })),
      backupPrompts: activeChatPreset.backupPrompts.map((prompt) => ({ ...prompt })),
      regexScripts: activeChatPreset.regexScripts.map((script) => ({
        ...script,
        id: crypto.randomUUID(),
        trimStrings: [...script.trimStrings],
        placement: [...script.placement],
      })),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    setChatPresets((current) => [...current, duplicate]);
    setActiveChatPresetId(duplicate.id);
    setSelectedChatPresetPromptId(duplicate.prompts[0]?.identifier ?? "");
    setPresetImportState({ status: "idle", message: "" });
  };

  const deleteChatPreset = () => {
    if (!activeChatPreset) return;
    const remaining = chatPresets.filter((preset) => preset.id !== activeChatPreset.id);
    if (remaining.length === 0) remaining.push(createDefaultChatPreset());
    setChatPresets(remaining);
    setActiveChatPresetId(remaining[0].id);
    setSelectedChatPresetPromptId(remaining[0].prompts[0]?.identifier ?? "");
    setPresetImportState({ status: "idle", message: "" });
  };

  const importChatPresetFile = async (file?: File) => {
    if (!file) return;
    setPresetImportState({ status: "loading", message: "正在解析酒馆原生预设..." });
    try {
      const rawPreset = JSON.parse(await file.text()) as unknown;
      const importedPreset = importSillyTavernPreset(rawPreset, file.name);
      setChatPresets((current) => [...current, importedPreset]);
      setActiveChatPresetId(importedPreset.id);
      setSelectedChatPresetPromptId(importedPreset.prompts[0]?.identifier ?? "");
      setChatPresetEnabled(true);
      setPresetImportState({ status: "idle", message: "" });
    } catch (error) {
      setPresetImportState({
        status: "error",
        message: error instanceof Error ? `导入失败：${error.message}` : "导入失败：预设格式无效。",
      });
    } finally {
      if (presetImportInputRef.current) presetImportInputRef.current.value = "";
    }
  };

  const updateChatPresetPrompt = (
    identifier: string,
    patch: Partial<ChatPresetPrompt>,
  ) => {
    if (!activeChatPreset) return;
    updateActiveChatPreset({
      prompts: activeChatPreset.prompts.map((prompt) =>
        prompt.identifier === identifier ? { ...prompt, ...patch } : prompt,
      ),
    });
  };

  const addChatPresetPrompt = () => {
    if (!activeChatPreset) return;
    const identifier = crypto.randomUUID();
    const prompt: ChatPresetPrompt = {
      identifier,
      name: `提示词模块 ${activeChatPreset.prompts.length + 1}`,
      role: "system",
      content: "",
      enabled: true,
      marker: false,
      systemPrompt: false,
      injectionPosition: 0,
      injectionDepth: 0,
      injectionOrder: activeChatPreset.prompts.length,
    };
    updateActiveChatPreset({ prompts: [...activeChatPreset.prompts, prompt] });
    setSelectedChatPresetPromptId(identifier);
  };

  const moveChatPresetPrompt = (identifier: string, direction: -1 | 1) => {
    if (!activeChatPreset) return;
    const currentIndex = activeChatPreset.prompts.findIndex(
      (prompt) => prompt.identifier === identifier,
    );
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= activeChatPreset.prompts.length) return;
    const prompts = [...activeChatPreset.prompts];
    [prompts[currentIndex], prompts[targetIndex]] = [prompts[targetIndex], prompts[currentIndex]];
    updateActiveChatPreset({ prompts });
  };

  const deleteChatPresetPrompt = (identifier: string) => {
    if (!activeChatPreset) return;
    const prompts = activeChatPreset.prompts.filter(
      (prompt) => prompt.identifier !== identifier,
    );
    updateActiveChatPreset({ prompts });
    setSelectedChatPresetPromptId(prompts[0]?.identifier ?? "");
  };

  const activateBackupPresetPrompt = (identifier: string) => {
    if (!activeChatPreset) return;
    const backupPrompt = activeChatPreset.backupPrompts.find(
      (prompt) => prompt.identifier === identifier,
    );
    if (!backupPrompt) return;
    const prompt = { ...backupPrompt, enabled: true };
    updateActiveChatPreset({
      prompts: [...activeChatPreset.prompts, prompt],
      backupPrompts: activeChatPreset.backupPrompts.filter(
        (candidate) => candidate.identifier !== identifier,
      ),
    });
    setSelectedChatPresetPromptId(prompt.identifier);
  };
  const currentChatSender = useMemo(
    () => normalizeChatSenderIdentity(chatSender, personas),
    [chatSender, personas],
  );
  const currentChatSenderName = useMemo(
    () => getChatSenderName(currentChatSender, personas, userProfile),
    [currentChatSender, personas, userProfile],
  );
  const currentChatSenderAvatarImage = useMemo(
    () => getChatSenderAvatarImage(currentChatSender, personas, userProfile),
    [currentChatSender, personas, userProfile],
  );
  const chatPersona = activePersona;
  const chatProvider = activeProvider;
  const updateCharacterCard = (cardId: string, patch: Partial<CharacterCard>) => {
    setCharacterCards((current) =>
      current.map((card) =>
        card.id === cardId
          ? { ...card, ...patch, id: card.id, updatedAt: new Date().toISOString() }
          : card,
      ),
    );
  };
  const addCharacterCard = () => {
    const card = createCharacterCard(`新角色 ${characterCards.length + 1}`);
    setCharacterCards((current) => [...current, card]);
    setActiveCharacterCardId(card.id);
    setEditingCharacterCardId(card.id);
    setCharacterEditorTab("basic");
    setCharacterImportState({ status: "idle", message: "" });
  };
  const importCharacterCardFiles = async (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length === 0) return;
    setCharacterImportState({
      status: "loading",
      message: `正在解析 ${fileList.length} 张角色卡...`,
    });
    const imported: CharacterCard[] = [];
    const errors: string[] = [];
    for (const file of fileList) {
      try {
        imported.push(await importCharacterCardFile(file));
      } catch (error) {
        errors.push(`${file.name}：${error instanceof Error ? error.message : "格式无效"}`);
      }
    }
    if (imported.length > 0) {
      setCharacterCards((current) => [...current, ...imported]);
      setActiveCharacterCardId(imported[0].id);
    }
    setCharacterImportState(
      errors.length > 0
        ? { status: "error", message: `部分文件导入失败：${errors.join("；")}` }
        : { status: "idle", message: "" },
    );
    if (characterImportInputRef.current) characterImportInputRef.current.value = "";
  };
  const downloadCharacterFile = (data: BlobPart, fileName: string, type: string) => {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const safeCharacterFileName = (card: CharacterCard) =>
    (card.name.trim() || "character").replace(/[\\/:*?"<>|]/g, "_");
  const exportCharacterJson = (card: CharacterCard) => {
    downloadCharacterFile(
      exportCharacterCardJson(card),
      `${safeCharacterFileName(card)}.json`,
      "application/json;charset=utf-8",
    );
  };
  const exportCharacterPng = async (card: CharacterCard) => {
    try {
      const bytes = await exportCharacterCardPng(card);
      downloadCharacterFile(bytes, `${safeCharacterFileName(card)}.png`, "image/png");
      setCharacterImportState({ status: "idle", message: "" });
    } catch (error) {
      setCharacterImportState({
        status: "error",
        message: error instanceof Error ? `PNG 导出失败：${error.message}` : "PNG 导出失败。",
      });
    }
  };
  const deleteCharacterCard = (card: CharacterCard) => {
    if (!window.confirm(`删除角色卡「${card.name}」？已产生的会话消息会保留。`)) return;
    const remaining = characterCards.filter((item) => item.id !== card.id);
    setCharacterCards(remaining);
    if (activeCharacterCardId === card.id) setActiveCharacterCardId(remaining[0]?.id ?? "");
    if (editingCharacterCardId === card.id) setEditingCharacterCardId("");
  };
  const replaceCharacterAvatar = async (file?: File) => {
    if (!file || !editingCharacterCard) return;
    try {
      updateCharacterCard(editingCharacterCard.id, {
        avatarDataUrl: await readFileAsDataUrl(file),
      });
    } finally {
      if (characterAvatarInputRef.current) characterAvatarInputRef.current.value = "";
    }
  };
  const translateCharacterCard = async (card: CharacterCard) => {
    const modelId = getEffectiveProviderModelId(chatProvider);
    if (!chatProvider?.apiBaseUrl || !modelId) {
      setCharacterTranslationState({
        status: "error",
        message: "翻译前请先在设置中配置可用的供应商和模型。",
      });
      return;
    }
    const fields = collectCharacterTranslationFields(card);
    if (fields.length === 0) {
      setCharacterTranslationState({ status: "error", message: "角色卡没有可翻译的文本。" });
      return;
    }
    setCharacterTranslationState({ status: "loading", message: "正在翻译角色卡..." });
    try {
      const groups: typeof fields[] = [];
      fields.forEach((field) => {
        const current = groups[groups.length - 1];
        const currentLength = current?.reduce((total, item) => total + item.value.length, 0) ?? 0;
        if (!current || currentLength + field.value.length > 7000) groups.push([field]);
        else current.push(field);
      });
      const translations: Record<string, string> = {};
      for (const group of groups) {
        const source = Object.fromEntries(group.map((field) => [field.key, field.value]));
        const response = await fetch("/api/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiBaseUrl: trimTrailingSlash(chatProvider.apiBaseUrl),
            apiKey: chatProvider.apiKey,
            request: {
              model: modelId,
              messages: [
                {
                  role: "system",
                  content:
                    "你是专业的创作内容翻译。把输入 JSON 对象的每个字符串值翻译成自然、准确、符合角色语气的简体中文；保留键名、Markdown、HTML、变量、{{user}}、{{char}} 和专有格式。只输出一个合法 JSON 对象，不要解释。",
                },
                { role: "user", content: JSON.stringify(source) },
              ],
              temperature: 0.2,
              stream: false,
            },
          }),
        });
        const payload = (await response.json()) as {
          error?: string | { message?: string };
          choices?: Array<{ message?: ChatApiMessage }>;
          output_text?: string;
        };
        if (!response.ok) {
          const errorMessage =
            typeof payload.error === "string" ? payload.error : payload.error?.message;
          throw new Error(errorMessage || `翻译请求失败：${response.status}`);
        }
        const rawContent =
          getChatApiMessageText(payload.choices?.[0]?.message).trim() ||
          payload.output_text?.trim() ||
          "";
        const jsonText = rawContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
        const translatedGroup = JSON.parse(jsonText) as Record<string, unknown>;
        group.forEach((field) => {
          if (typeof translatedGroup[field.key] === "string") {
            translations[field.key] = translatedGroup[field.key] as string;
          }
        });
      }
      setCharacterTranslationPreview({
        cardId: card.id,
        items: fields.map((field) => ({
          key: field.key,
          label: field.label,
          source: field.value,
          translated: translations[field.key] ?? field.value,
          selected: true,
        })),
      });
      setCharacterTranslationState({ status: "idle", message: "" });
    } catch (error) {
      setCharacterTranslationState({
        status: "error",
        message: error instanceof Error ? `翻译失败：${error.message}` : "翻译失败。",
      });
    }
  };
  const applySelectedCharacterTranslations = () => {
    if (!characterTranslationPreview) return;
    const card = characterCards.find((item) => item.id === characterTranslationPreview.cardId);
    if (!card) return;
    const selectedTranslations = Object.fromEntries(
      characterTranslationPreview.items
        .filter((item) => item.selected)
        .map((item) => [item.key, item.translated]),
    );
    setCharacterCards((current) =>
      current.map((item) =>
        item.id === card.id ? applyCharacterTranslations(item, selectedTranslations) : item,
      ),
    );
    setCharacterTranslationPreview(null);
  };
  const composeChatApiMessages = (
    systemPrompt: string,
    history: ChatApiMessage[],
    responderPersona?: AgentPersona,
    responderContext?: { name: string; description: string },
  ): ChatApiMessage[] => {
    if (!chatPresetEnabled || !activeChatPreset) {
      return [
        ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
        ...history,
      ];
    }

    const lastUserMessage = [...history]
      .reverse()
      .find((message) => message.role === "user");
    return applyChatPresetToMessages(activeChatPreset, systemPrompt, history, {
      user: userProfile.nickname.trim() || "User",
      char: responderContext?.name ?? responderPersona?.name ?? "AI",
      description:
        responderContext?.description ??
        (responderPersona ? buildPersonaPrompt(responderPersona) : ""),
      persona: userProfile.bio.trim(),
      lastUserMessage: getChatApiMessageText(lastUserMessage),
    }) as ChatApiMessage[];
  };
  const applyPromptRegexToApiMessages = (
    messages: ChatApiMessage[],
    characterName: string,
  ) =>
    messages.map((message, index) => {
      if (message.role !== "user" && message.role !== "assistant") return message;
      const applyContent = (content: string) =>
        applyRegexScripts(content, effectiveRegexScripts, {
          placement: message.role === "user" ? 1 : 2,
          destination: "prompt",
          depth: messages.length - index - 1,
          userName: userProfile.nickname,
          characterName,
        });
      if (typeof message.content === "string") {
        const content = applyContent(message.content);
        return content === message.content ? message : { ...message, content };
      }
      if (Array.isArray(message.content)) {
        return {
          ...message,
          content: message.content.map((part) =>
            part.type === "text" && typeof part.text === "string"
              ? { ...part, text: applyContent(part.text) }
              : part,
          ),
        };
      }
      return message;
    });
  const activeChatPresetRequestParameters =
    chatPresetEnabled && activeChatPreset
      ? buildChatPresetRequestParameters(activeChatPreset)
      : null;
  const effectiveChatModelId = getEffectiveProviderModelId(chatProvider);
  const multiAgentModelsReady =
    multiAgentPersonas.length >= 2 &&
    multiAgentPersonas.every((persona) => {
      const { provider, modelId } = getMultiAgentRequestConfig(persona.id);
      return Boolean(provider?.apiBaseUrl && modelId);
    });
  const chatModelReady =
    chatMode === "multi"
      ? multiAgentModelsReady
      : chatMode === "roleplay"
        ? Boolean(effectiveChatModelId && scopedRoleplayCard)
        : Boolean(effectiveChatModelId);
  const chatModelLabel =
    chatMode === "multi"
      ? multiAgentModelsReady
        ? `${multiAgentPersonas.length} 个 Agent 独立模型`
        : "Agent 模型待配置"
      : chatMode === "roleplay"
        ? scopedRoleplayCard
          ? `${scopedRoleplayCard.name} · ${effectiveChatModelId || "模型待配置"}`
          : "角色卡待选择"
      : effectiveChatModelId || "模型待配置";
  const chatStarterPrompts =
    chatMode === "persona"
      ? ["介绍一下你自己", "从你的长期目标开始聊", "用你的表达习惯回应我"]
      : chatMode === "multi"
        ? ["请依次给出你们各自的观点", "从不同角度分析这个问题", "先讨论，再各自给出下一步建议"]
        : chatMode === "roleplay"
          ? ["继续当前场景", "说说你现在的想法", "推进接下来的剧情"]
        : ["梳理当前任务并给出下一步", "检查工作区中的潜在问题", "总结当前目标和待办事项"];
  const workspaceInfo = getWorkspaceInfo(localWorkspaceHandle);
  const activeChatSession = useMemo(
    () => chatSessions.find((session) => session.id === activeChatSessionId) ?? chatSessions[0],
    [activeChatSessionId, chatSessions],
  );
  const activeSessionRoleplayCard = useMemo(
    () => scopedRoleplayCard,
    [scopedRoleplayCard],
  );
  const activeTavernScripts = useMemo(
    () => [
      ...tavernScripts,
      ...(activeSessionRoleplayCard?.tavernScripts ?? []),
    ],
    [activeSessionRoleplayCard?.tavernScripts, tavernScripts],
  );
  const tavernRuntimeConfigurationKey = useMemo(
    () =>
      JSON.stringify(
        activeTavernScripts.map((script) => ({
          id: script.id,
          name: script.name,
          content: script.content,
          enabled: script.enabled,
          autoRun: script.autoRun,
          runOn: script.runOn,
          buttonEnabled: script.buttonEnabled,
          buttons: script.buttons,
        })),
      ),
    [activeTavernScripts],
  );

  useEffect(() => {
    if (!appDataLoaded || !activeChatSessionId) return;
    tavernScriptRuntimeRef.current?.destroy();
    tavernScriptRuntimeRef.current = null;
    setTavernRuntimeButtons([]);
    if (activeTavernScripts.length === 0) {
      setTavernRuntimeStatus({ state: "idle", message: "" });
      return;
    }

    let runtime: TavernScriptRuntime;
    const updateSessions = (updater: (sessions: ChatSession[]) => ChatSession[]) => {
      const next = updater(chatSessionsRef.current);
      chatSessionsRef.current = next;
      setChatSessions(next);
    };
    const updateGlobalScripts = (updater: (scripts: TavernScript[]) => TavernScript[]) => {
      const next = updater(tavernScriptsRef.current);
      tavernScriptsRef.current = next;
      setTavernScripts(next);
    };
    const updateCards = (updater: (cards: CharacterCard[]) => CharacterCard[]) => {
      const next = updater(characterCardsRef.current);
      characterCardsRef.current = next;
      setCharacterCards(next);
    };

    runtime = new TavernScriptRuntime(activeTavernScripts, {
      getMessages: () => chatMessagesRef.current as TavernRuntimeMessage[],
      setMessages: (messages) => {
        const normalized = messages.map((message) =>
          normalizeChatMessage(message as Partial<ChatMessage>),
        );
        chatMessagesRef.current = normalized;
        setChatMessages(normalized);
      },
      getChatVariables: () => {
        const session = chatSessionsRef.current.find(
          (candidate) => candidate.id === activeChatSessionIdRef.current,
        );
        return normalizeTavernVariables(session?.scriptVariables);
      },
      setChatVariables: (variables) => {
        const sessionId = activeChatSessionIdRef.current;
        updateSessions((sessions) =>
          sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  scriptVariables: normalizeTavernVariables(variables),
                  updatedAt: new Date().toISOString(),
                }
              : session,
          ),
        );
      },
      getCharacterVariables: () => {
        const session = chatSessionsRef.current.find(
          (candidate) => candidate.id === activeChatSessionIdRef.current,
        );
        const card = characterCardsRef.current.find(
          (candidate) => candidate.id === session?.roleplayCharacterCardId,
        );
        return normalizeTavernVariables(card?.tavernVariables);
      },
      setCharacterVariables: (variables) => {
        const session = chatSessionsRef.current.find(
          (candidate) => candidate.id === activeChatSessionIdRef.current,
        );
        if (!session?.roleplayCharacterCardId) return;
        const updatedAt = new Date().toISOString();
        updateCards((cards) =>
          cards.map((card) =>
            card.id === session.roleplayCharacterCardId
              ? {
                  ...card,
                  tavernVariables: normalizeTavernVariables(variables),
                  updatedAt,
                }
              : card,
          ),
        );
      },
      getGlobalVariables: () => normalizeTavernVariables(tavernGlobalVariablesRef.current),
      setGlobalVariables: (variables) => {
        const next = normalizeTavernVariables(variables);
        tavernGlobalVariablesRef.current = next;
        setTavernGlobalVariables(next);
      },
      getScriptData: (scriptId) => {
        const globalScript = tavernScriptsRef.current.find((script) => script.id === scriptId);
        if (globalScript) return normalizeTavernVariables(globalScript.data);
        for (const card of characterCardsRef.current) {
          const script = card.tavernScripts.find((candidate) => candidate.id === scriptId);
          if (script) return normalizeTavernVariables(script.data);
        }
        return {};
      },
      setScriptData: (scriptId, data) => {
        const timestamp = new Date().toISOString();
        if (tavernScriptsRef.current.some((script) => script.id === scriptId)) {
          updateGlobalScripts((scripts) =>
            scripts.map((script) =>
              script.id === scriptId
                ? { ...script, data: normalizeTavernVariables(data), updatedAt: timestamp }
                : script,
            ),
          );
          return;
        }
        updateCards((cards) =>
          cards.map((card) =>
            card.tavernScripts.some((script) => script.id === scriptId)
              ? {
                  ...card,
                  tavernScripts: card.tavernScripts.map((script) =>
                    script.id === scriptId
                      ? { ...script, data: normalizeTavernVariables(data), updatedAt: timestamp }
                      : script,
                  ),
                  updatedAt: timestamp,
                }
              : card,
          ),
        );
      },
      getCharacter: () => {
        const session = chatSessionsRef.current.find(
          (candidate) => candidate.id === activeChatSessionIdRef.current,
        );
        const card = characterCardsRef.current.find(
          (candidate) => candidate.id === session?.roleplayCharacterCardId,
        );
        if (!card) return null;
        const characterWorldBook = resolveCharacterWorldBook(
          card,
          worldBooksRef.current,
        );
        return {
          id: card.id,
          name: card.name,
          description: card.description,
          personality: card.personality,
          scenario: card.scenario,
          firstMessage: card.firstMessage,
          messageExample: card.messageExample,
          avatarDataUrl: card.avatarDataUrl,
          extensions: card.extensions,
          worldBook: characterWorldBook
            ? {
                id: characterWorldBook.id,
                name: characterWorldBook.name,
                entries: characterWorldBook.entries.map((entry) => ({
                  id: entry.id,
                  comment: entry.comment,
                  content: entry.content,
                  enabled: entry.enabled,
                  keys: entry.keys,
                })),
              }
            : null,
        };
      },
      getWorldBooks: () =>
        worldBooksRef.current
          .filter((book) => activeWorldBookIdsRef.current.includes(book.id))
          .map((book) => ({
            id: book.id,
            name: book.name,
            entries: book.entries.map((entry) => ({
              id: entry.id,
              comment: entry.comment,
              content: entry.content,
              enabled: entry.enabled,
              keys: entry.keys,
            })),
          })),
      getUserName: () => userProfileRef.current.nickname.trim() || "用户",
      getChatId: () => activeChatSessionIdRef.current,
      getModelId: () => getEffectiveProviderModelId(chatProvider),
      onButtonsChange: (buttons) => {
        if (tavernScriptRuntimeRef.current === runtime) setTavernRuntimeButtons(buttons);
      },
      onLog: (log) => {
        if (tavernScriptRuntimeRef.current !== runtime) return;
        setTavernRuntimeLogs((current) => [...current.slice(-119), log]);
      },
      onStatus: (status) => {
        if (tavernScriptRuntimeRef.current === runtime) setTavernRuntimeStatus(status);
      },
      onNotice: (level, message, title) => {
        if (tavernScriptRuntimeRef.current !== runtime) return;
        const logLevel =
          level === "warning" ? "warn" : level === "success" ? "info" : level;
        setTavernRuntimeLogs((current) => [
          ...current.slice(-119),
          {
            id: crypto.randomUUID(),
            level: logLevel,
            scriptId: "runtime",
            scriptName: title || "脚本通知",
            message,
            createdAt: new Date().toISOString(),
          },
        ]);
        setChatStatus({
          status: level === "error" || level === "warning" ? "error" : "success",
          message: title ? `${title}：${message}` : message,
        });
      },
    });
    tavernScriptRuntimeRef.current = runtime;
    void runtime.initialize().catch((error) => {
      if (tavernScriptRuntimeRef.current !== runtime) return;
      setTavernRuntimeStatus({
        state: "error",
        message: error instanceof Error ? error.message : "酒馆脚本运行环境初始化失败。",
      });
    });

    return () => {
      if (tavernScriptRuntimeRef.current === runtime) {
        tavernScriptRuntimeRef.current = null;
      }
      runtime.destroy();
    };
  }, [activeChatSessionId, appDataLoaded, tavernRuntimeConfigurationKey]);

  const emitTavernMessageEvent = (
    eventName: typeof TAVERN_EVENTS.MESSAGE_SENT | typeof TAVERN_EVENTS.MESSAGE_RECEIVED,
    messageId: string,
  ) => {
    window.setTimeout(() => {
      const index = chatMessagesRef.current.findIndex((message) => message.id === messageId);
      if (index < 0) return;
      void tavernScriptRuntimeRef.current?.emit(eventName, index);
      void tavernScriptRuntimeRef.current?.emit(TAVERN_EVENTS.MESSAGE_RENDERED, index);
      void tavernScriptRuntimeRef.current?.emit(
        eventName === TAVERN_EVENTS.MESSAGE_SENT
          ? TAVERN_EVENTS.USER_MESSAGE_RENDERED
          : TAVERN_EVENTS.CHARACTER_MESSAGE_RENDERED,
        index,
      );
    }, 0);
  };

  const triggerTavernScriptButton = async (button: TavernRuntimeButton) => {
    const runtime = tavernScriptRuntimeRef.current;
    if (!runtime?.isReady()) {
      setChatStatus({ status: "error", message: "酒馆脚本运行环境尚未就绪。" });
      return;
    }
    const pendingMessage = `正在执行酒馆脚本按钮「${button.name}」...`;
    setChatStatus({ status: "loading", message: pendingMessage });
    try {
      await runtime.triggerButton(button);
      setChatStatus((current) =>
        current.status === "loading" && current.message === pendingMessage
          ? {
              status: "success",
              message: `酒馆脚本按钮「${button.name}」已执行。`,
            }
          : current,
      );
    } catch (error) {
      setChatStatus({
        status: "error",
        message: error instanceof Error ? error.message : "脚本按钮执行失败。",
      });
    }
  };

  const buildRoleplaySession = (
    session: ChatSession,
    card: CharacterCard,
    greetingIndex = 0,
  ) => {
    const greeting = createRoleplayGreetingMessage(
      card,
      userProfile.nickname.trim() || "用户",
      greetingIndex,
    );
    return {
      ...session,
      title: `角色：${card.name}`,
      messages: greeting ? [greeting] : [],
      scriptVariables: normalizeTavernVariables(card.tavernVariables),
      roleplayCharacterCardId: card.id,
      roleplayGreetingIndex: greetingIndex,
      updatedAt: new Date().toISOString(),
    };
  };
  const markCharacterCardUsed = (cardId: string) => {
    setCharacterCards((current) =>
      current.map((item) =>
        item.id === cardId ? { ...item, updatedAt: new Date().toISOString() } : item,
      ),
    );
  };
  const activateRoleplaySession = (session: ChatSession) => {
    setActiveCharacterCardId(session.roleplayCharacterCardId ?? "");
    setChatMode("roleplay");
    setActiveChatSessionId(session.id);
    setChatMessages(session.messages);
    setEditingChatMessage(null);
    setChatMessageMenu(null);
    setChatStatus({ status: "idle", message: "" });
    setView("chat");
  };
  const startRoleplayInCurrentWorkspace = (card: CharacterCard, greetingIndex = 0) => {
    const canBindCurrentSession = Boolean(
      activeChatSession &&
      activeChatSession.id === activeChatSessionId &&
      chatMessages.length === 0 &&
      (!activeChatSession.roleplayCharacterCardId ||
        activeChatSession.roleplayCharacterCardId === card.id),
    );
    const baseSession = canBindCurrentSession && activeChatSession
      ? activeChatSession
      : createChatSession(
          activeChatSession?.workspaceKey ?? workspaceInfo.key,
          activeChatSession?.workspaceName ?? workspaceInfo.name,
          activeChatSession?.workspacePath ?? workspaceInfo.path,
          { characterCardId: card.id, greetingIndex },
        );
    const session = buildRoleplaySession(baseSession, card, greetingIndex);

    markCharacterCardUsed(card.id);
    setChatSessions((current) =>
      canBindCurrentSession
        ? current.map((item) => (item.id === session.id ? session : item))
        : [...current, session],
    );
    activateRoleplaySession(session);
  };
  const openOrCreateCharacterRoleplay = (card: CharacterCard) => {
    const existingSession = chatSessions
      .filter((session) => session.roleplayCharacterCardId === card.id)
      .sort(
        (left, right) =>
          (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0),
      )[0];
    markCharacterCardUsed(card.id);
    setView("chat");

    if (existingSession) {
      void openChatSession(existingSession.id);
      return;
    }

    const session = buildRoleplaySession(
      createChatSession(
        DEFAULT_WORKSPACE_KEY,
        DEFAULT_WORKSPACE_NAME,
        undefined,
        { characterCardId: card.id, greetingIndex: 0 },
      ),
      card,
      0,
    );
    workspaceAutoRestoreDisabledRef.current = true;
    setLocalWorkspaceHandle(null);
    setLocalToolsEnabled(false);
    restoredWorkspacePathRef.current = "";
    setChatSessions((current) => [...current, session]);
    activateRoleplaySession(session);
  };
  const cycleRoleplayGreeting = () => {
    if (!activeChatSession || !activeSessionRoleplayCard) return;
    const greetings = getCharacterCardGreetings(
      activeSessionRoleplayCard,
      userProfile.nickname.trim() || "用户",
    );
    if (greetings.length < 2) return;
    const nextIndex = ((activeChatSession.roleplayGreetingIndex ?? 0) + 1) % greetings.length;
    const greeting = createRoleplayGreetingMessage(
      activeSessionRoleplayCard,
      userProfile.nickname.trim() || "用户",
      nextIndex,
    );
    if (!greeting) return;
    const nextMessages = chatMessages.some((message) => message.source === "roleplay-greeting")
      ? chatMessages.map((message) =>
          message.source === "roleplay-greeting" ? { ...greeting, id: message.id } : message,
        )
      : [greeting, ...chatMessages];
    setChatMessages(nextMessages);
    setChatSessions((current) =>
      current.map((session) =>
        session.id === activeChatSession.id
          ? { ...session, roleplayGreetingIndex: nextIndex, messages: nextMessages }
          : session,
      ),
    );
  };
  const recentChatSessions = useMemo(
    () =>
      [...chatSessions]
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .slice(0, 3),
    [chatSessions],
  );
  const activeHeartbeat = activeChatSession?.heartbeat ?? createDefaultHeartbeatConfig();
  const visibleChatMessages = useMemo(
    () =>
      chatHeartbeatReminderVisible
        ? chatMessages
        : chatMessages.filter((message) => !isHeartbeatUiReminderMessage(message)),
    [chatHeartbeatReminderVisible, chatMessages],
  );
  const regexProcessedChatMessages = useMemo(
    () =>
      visibleChatMessages.map((message, index) => {
        if (message.role !== "assistant" || !message.content) return message;
        const assistantPersona = getAssistantMessagePersona(
          message,
          personas,
          chatMode === "persona" ? activePersona : undefined,
        );
        const depth = visibleChatMessages.length - index - 1;
        const regexOptions = {
          placement: 2,
          destination: "display" as const,
          depth,
          userName: userProfile.nickname,
          characterName:
            chatMode === "roleplay" && activeSessionRoleplayCard
              ? activeSessionRoleplayCard.name
              : assistantPersona?.name ?? activePersona?.name ?? "AI",
        };
        const displaySource =
          message.source === "roleplay-greeting" && activeSessionRoleplayCard
            ? appendSillyTavernStatusPlaceholderToGreeting(
                message.content,
                activeSessionRoleplayCard.regexScripts,
                regexOptions,
              )
            : message.content;
        const content = applyRegexScripts(displaySource, effectiveRegexScripts, regexOptions);
        return content === message.content ? message : { ...message, content };
      }),
    [activePersona, activeSessionRoleplayCard, chatMode, effectiveRegexScripts, personas, userProfile.nickname, visibleChatMessages],
  );
  const chatMessageMenuMessage = useMemo(
    () => chatMessages.find((message) => message.id === chatMessageMenu?.messageId),
    [chatMessageMenu?.messageId, chatMessages],
  );
  const activeSessionMemoryEnabled = Boolean(
    activePersona && activeChatSession?.memoryPersonaIds.includes(activePersona.id),
  );
  const workspaceGroups = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; sessions: ChatSession[] }>();

    for (const session of chatSessions) {
      const group = groups.get(session.workspaceKey) ?? {
        key: session.workspaceKey,
        name: session.workspaceName,
        sessions: [],
      };
      group.sessions.push(session);
      groups.set(session.workspaceKey, group);
    }

    return Array.from(groups.values());
  }, [chatSessions]);

  const updateHeartbeatForSession = (sessionId: string, patch: ChatHeartbeatPatch) => {
    const targetSession = chatSessions.find((session) => session.id === sessionId);
    if (!targetSession) return null;

    const timestamp = new Date().toISOString();
    const updatedConfig = applyHeartbeatPatch(
      normalizeHeartbeatConfig(targetSession.heartbeat),
      patch,
      timestamp,
    );

    setChatSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) return session;
        return {
          ...session,
          heartbeat: applyHeartbeatPatch(
            normalizeHeartbeatConfig(session.heartbeat),
            patch,
            timestamp,
          ),
          updatedAt: timestamp,
        };
      }),
    );

    return updatedConfig;
  };

  const updateActiveHeartbeat = (patch: ChatHeartbeatPatch) => {
    const sessionId = activeChatSession?.id ?? activeChatSessionIdRef.current;
    return sessionId ? updateHeartbeatForSession(sessionId, patch) : null;
  };

  const modelOptions = useMemo(
    () => {
      if (!chatProvider) return [];
      const hasCustomModel =
        Boolean(chatProvider.modelId) && !chatProvider.models.includes(chatProvider.modelId);
      const models = hasCustomModel
        ? [chatProvider.modelId]
        : chatProvider.models.length > 0
          ? chatProvider.models
          : chatProvider.modelId
            ? [chatProvider.modelId]
            : [];

      return models.map((modelId) => ({
        value: modelId,
        providerName: chatProvider.name || "未命名供应商",
        modelId,
      }));
    },
    [chatProvider],
  );
  const selectedModelValue = getEffectiveProviderModelId(chatProvider);
  const selectedModelOption = modelOptions.find((option) => option.value === selectedModelValue);

  const activeTypes = activePersona?.entryTypes ?? [];
  const prompt = useMemo(
    () => (activePersona ? buildPersonaPrompt(activePersona) : ""),
    [activePersona],
  );
  const cropMetrics = avatarCrop ? getCropMetrics(avatarCrop) : null;

  const visibleEntryRows = useMemo(() => {
    if (!activePersona) return [];
    const visibleTypes =
      selectedTypeId === "all"
        ? activePersona.entryTypes
        : activePersona.entryTypes.filter((type) => type.id === selectedTypeId);

    return visibleTypes.flatMap((type) =>
      type.entries.map((entry) => ({
        type,
        entry,
      })),
    );
  }, [activePersona, selectedTypeId]);

  const updatePersona = (updater: (persona: AgentPersona) => AgentPersona) => {
    if (!activePersona) return;
    setPersonas((current) =>
      current.map((persona) =>
        persona.id === activePersona.id ? stampPersona(updater(persona)) : persona,
      ),
    );
  };

  const updateProvider = (providerId: string, patch: Partial<ModelProviderChannel>) => {
    setProviders((current) =>
      current.map((provider) =>
        provider.id === providerId
          ? { ...provider, ...patch, updatedAt: new Date().toISOString() }
          : provider,
      ),
    );
    setProviderPullState({ status: "idle", message: "" });
  };

  const addProvider = () => {
    const provider = createProviderChannel(`供应商 ${providers.length + 1}`);
    setProviders((current) => [...current, provider]);
    setActiveProviderId(provider.id);
    setSettingsTab("providers");
    setView("settings");
    setProviderPullState({ status: "idle", message: "" });
  };

  const addVolcengineCodingPlanProvider = () => {
    const presetProvider = createVolcengineCodingPlanProviderChannel();
    const existingProvider = providers.find(
      (provider) =>
        provider.name === VOLCENGINE_CODING_PLAN_NAME ||
        trimTrailingSlash(provider.apiBaseUrl) === VOLCENGINE_CODING_PLAN_API_BASE_URL,
    );

    if (existingProvider) {
      setActiveProviderId(existingProvider.id);
      setSettingsTab("providers");
      setView("settings");
      setProviderPullState({ status: "idle", message: "" });
      return;
    }

    setProviders((current) => [...current, presetProvider]);
    setActiveProviderId(presetProvider.id);
    setSettingsTab("providers");
    setView("settings");
    setProviderPullState({ status: "idle", message: "" });
  };

  const deleteProvider = () => {
    if (!activeProvider || providers.length <= 1) return;
    const remainingProviders = providers.filter((provider) => provider.id !== activeProvider.id);
    setProviders(remainingProviders);
    setActiveProviderId(remainingProviders[0]?.id ?? "");
    setProviderPullState({ status: "idle", message: "" });
  };

  const updateMcpServer = (serverId: string, patch: Partial<McpServerConfig>) => {
    setMcpServers((current) =>
      current.map((server) =>
        server.id === serverId
          ? { ...server, ...patch, updatedAt: new Date().toISOString() }
          : server,
      ),
    );
    setMcpStatus({ status: "idle", message: "配置已更新，发送消息时会自动重新发现工具。" });
  };

  const addMcpServer = () => {
    const server = createMcpServerConfig(`MCP Server ${mcpServers.length + 1}`);
    setMcpServers((current) => [...current, server]);
    setActiveMcpServerId(server.id);
    setSettingsTab("mcp");
    setView("settings");
    setMcpStatus({ status: "idle", message: "" });
  };

  const deleteMcpServer = () => {
    if (!activeMcpServer) return;
    const remainingServers = mcpServers.filter((server) => server.id !== activeMcpServer.id);
    setMcpServers(remainingServers);
    setActiveMcpServerId(remainingServers[0]?.id ?? "");
    setMcpTools((current) => current.filter((tool) => tool.serverId !== activeMcpServer.id));
    setMcpStatus({ status: "idle", message: "MCP 服务器已删除。" });
  };

  const applyImportedMcpServers = (servers: McpServerConfig[]) => {
    if (servers.length === 0) {
      setMcpStatus({ status: "error", message: "没有识别到 MCP 服务器配置。" });
      return;
    }

    setMcpServers((current) => {
      const existingNames = new Set(current.map((server) => server.name));
      const importedServers = servers.map((server) => ({
        ...server,
        id: crypto.randomUUID(),
        name: existingNames.has(server.name) ? `${server.name} ${current.length + 1}` : server.name,
        updatedAt: new Date().toISOString(),
      }));
      setActiveMcpServerId(importedServers[0]?.id ?? current[0]?.id ?? "");
      return [...current, ...importedServers];
    });
    setMcpImportText("");
    setMcpStatus({ status: "success", message: `已导入 ${servers.length} 个 MCP 服务器。` });
  };

  const importMcpJsonText = () => {
    try {
      applyImportedMcpServers(parseMcpServersFromJson(mcpImportText));
    } catch (error) {
      setMcpStatus({
        status: "error",
        message: error instanceof Error ? error.message : "MCP JSON 导入失败。",
      });
    }
  };

  const importMcpJsonFile = async (file?: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      applyImportedMcpServers(parseMcpServersFromJson(text));
    } catch (error) {
      setMcpStatus({
        status: "error",
        message: error instanceof Error ? error.message : "MCP JSON 导入失败。",
      });
    } finally {
      if (mcpImportInputRef.current) mcpImportInputRef.current.value = "";
    }
  };

  const copyMcpExportJson = async () => {
    await navigator.clipboard.writeText(mcpExportJson);
    setMcpStatus({ status: "success", message: "MCP JSON 已复制。" });
  };

  const refreshMcpTools = async (options: { silent?: boolean } = {}) => {
    const enabledServers = mcpServers.filter((server) => server.enabled);
    if (enabledServers.length === 0) {
      setMcpTools([]);
      if (!options.silent) setMcpStatus({ status: "idle", message: "没有启用的 MCP 服务器。" });
      return [];
    }

    if (!options.silent) {
      setMcpStatus({ status: "loading", message: "正在发现 MCP 工具..." });
    }

    try {
      const response = await fetch("/api/mcp/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ servers: enabledServers }),
      });
      const payload = (await response.json()) as {
        tools?: McpToolDefinition[];
        errors?: Array<{ serverName?: string; error?: string }>;
        error?: string;
      };
      if (!response.ok || payload.error) {
        throw new Error(payload.error || `MCP 工具发现失败：${response.status}`);
      }

      const tools = Array.isArray(payload.tools) ? payload.tools : [];
      setMcpTools(tools);
      const errorText = (payload.errors ?? [])
        .map((item) => `${item.serverName ?? "MCP"}：${item.error ?? "连接失败"}`)
        .join("；");
      setMcpStatus({
        status: payload.errors?.length ? "error" : "success",
        message: `已发现 ${tools.length} 个 MCP 工具。${errorText ? ` ${errorText}` : ""}`,
      });
      return tools;
    } catch (error) {
      setMcpTools([]);
      setMcpStatus({
        status: "error",
        message: error instanceof Error ? error.message : "MCP 工具发现失败。",
      });
      return [];
    }
  };

  const updateSkill = (skillId: string, patch: Partial<SkillProfile>) => {
    setSkills((current) =>
      current.map((skill) =>
        skill.id === skillId
          ? { ...skill, ...patch, updatedAt: new Date().toISOString() }
          : skill,
      ),
    );
    setSkillStatus({ status: "idle", message: "技能配置已更新，下一次发送消息时生效。" });
  };

  const applyImportedSkill = (skill: SkillProfile) => {
    const normalizedSkill = normalizeSkillProfile(skill as Partial<SkillProfile> & Record<string, unknown>);
    setSkills((current) => {
      const existingNames = new Set(current.map((item) => item.name));
      const nextSkill = {
        ...normalizedSkill,
        id: normalizedSkill.id || crypto.randomUUID(),
        name: existingNames.has(normalizedSkill.name)
          ? `${normalizedSkill.name} ${current.length + 1}`
          : normalizedSkill.name,
        enabled: true,
        updatedAt: new Date().toISOString(),
      };
      setActiveSkillId(nextSkill.id);
      return [...current, nextSkill];
    });
    setSkillFolderPath("");
    setSettingsTab("skills");
    setView("settings");
  };

  const importSkillFolder = async (path?: string) => {
    const sourcePath = (path ?? skillFolderPath).trim();
    if (!sourcePath) {
      setSkillStatus({ status: "error", message: "请先选择或填写 Skill 文件夹路径。" });
      return;
    }

    setSkillStatus({ status: "loading", message: "正在导入 Skill 文件夹..." });
    try {
      const response = await fetch("/api/skills/import-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: sourcePath }),
      });
      const payload = (await response.json()) as { skill?: SkillProfile; error?: string };
      if (!response.ok || payload.error || !payload.skill) {
        throw new Error(payload.error || `Skill 导入失败：${response.status}`);
      }
      applyImportedSkill(payload.skill);
      setSkillStatus({ status: "success", message: `已导入技能：${payload.skill.name}` });
    } catch (error) {
      setSkillStatus({
        status: "error",
        message: error instanceof Error ? error.message : "Skill 文件夹导入失败。",
      });
    }
  };

  const selectAndImportSkillFolder = async () => {
    if (!window.rengeDesktop?.selectSkillFolder) {
      setSkillStatus({ status: "error", message: "当前环境不支持文件夹选择，请手动填写本机路径导入。" });
      return;
    }

    try {
      const result = await window.rengeDesktop.selectSkillFolder();
      if (!result?.path) return;
      setSkillFolderPath(result.path);
      await importSkillFolder(result.path);
    } catch (error) {
      setSkillStatus({
        status: "error",
        message: error instanceof Error ? error.message : "选择 Skill 文件夹失败。",
      });
    }
  };

  const importSkillZipFile = async (file?: File | null) => {
    if (!file) return;
    setSkillStatus({ status: "loading", message: "正在导入 Skill ZIP..." });
    try {
      const response = await fetch("/api/skills/import-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          base64: await readFileAsBase64(file),
        }),
      });
      const payload = (await response.json()) as { skill?: SkillProfile; error?: string };
      if (!response.ok || payload.error || !payload.skill) {
        throw new Error(payload.error || `Skill ZIP 导入失败：${response.status}`);
      }
      applyImportedSkill(payload.skill);
      setSkillStatus({ status: "success", message: `已导入技能：${payload.skill.name}` });
    } catch (error) {
      setSkillStatus({
        status: "error",
        message: error instanceof Error ? error.message : "Skill ZIP 导入失败。",
      });
    } finally {
      if (skillZipInputRef.current) skillZipInputRef.current.value = "";
    }
  };

  const deleteSkill = () => {
    if (!activeSkill) return;
    const remainingSkills = skills.filter((skill) => skill.id !== activeSkill.id);
    setSkills(remainingSkills);
    setActiveSkillId(remainingSkills[0]?.id ?? "");
    setSkillStatus({ status: "idle", message: "技能已从设置中移除，已导入文件会保留在数据目录。" });
  };

  const loadEnabledSkillPrompt = async () => {
    const requestSkills = skills.filter((skill) => skill.enabled);
    if (requestSkills.length === 0) return "";

    try {
      const response = await fetch("/api/skills/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skills: requestSkills }),
      });
      const payload = (await response.json()) as { prompt?: string; error?: string };
      if (!response.ok || payload.error) {
        throw new Error(payload.error || `Skill 读取失败：${response.status}`);
      }
      return payload.prompt ?? "";
    } catch (error) {
      setSkillStatus({
        status: "error",
        message: error instanceof Error ? error.message : "读取启用技能失败。",
      });
      return "";
    }
  };

  const addSystemPrompt = () => {
    const promptProfile = createSystemPromptProfile(`提示词 ${systemPrompts.length + 1}`);
    setSystemPrompts((current) => [...current, promptProfile]);
    setActiveSystemPromptId(promptProfile.id);
    setActiveSystemPromptIds((current) => [...current, promptProfile.id]);
    setSettingsTab("prompts");
    setView("settings");
  };

  const toggleSystemPromptSelection = (promptId: string) => {
    setActiveSystemPromptIds((current) =>
      current.includes(promptId)
        ? current.filter((selectedPromptId) => selectedPromptId !== promptId)
        : [...current, promptId],
    );
  };

  const updateSystemPrompt = (promptId: string, patch: Partial<SystemPromptProfile>) => {
    setSystemPrompts((current) =>
      current.map((promptProfile) =>
        promptProfile.id === promptId
          ? { ...promptProfile, ...patch, updatedAt: new Date().toISOString() }
          : promptProfile,
      ),
    );
  };

  const deleteSystemPrompt = () => {
    if (!activeSystemPrompt || systemPrompts.length <= 1) return;
    const remainingPrompts = systemPrompts.filter(
      (promptProfile) => promptProfile.id !== activeSystemPrompt.id,
    );
    setSystemPrompts(remainingPrompts);
    setActiveSystemPromptId(remainingPrompts[0]?.id ?? "");
    setActiveSystemPromptIds((current) =>
      current.filter((promptId) => promptId !== activeSystemPrompt.id),
    );
  };

  const toggleActiveSessionMemory = () => {
    if (!activePersona || !activeChatSession) return;

    setChatSessions((current) =>
      current.map((session) => {
        if (session.id !== activeChatSession.id) return session;

        const memoryPersonaIds = session.memoryPersonaIds.includes(activePersona.id)
          ? session.memoryPersonaIds.filter((personaId) => personaId !== activePersona.id)
          : [...session.memoryPersonaIds, activePersona.id];

        return {
          ...session,
          memoryPersonaIds,
          updatedAt: new Date().toISOString(),
        };
      }),
    );
  };

  const openChatMessageMenu = (messageId: string, event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();

    setChatMessageMenu({
      messageId,
      x: clamp(event.clientX, 8, window.innerWidth - 180),
      y: clamp(event.clientY, 8, window.innerHeight - 92),
    });
  };

  const deleteChatMessage = (messageId: string) => {
    if (chatStatus.status === "loading") return;

    setChatMessages((current) => current.filter((message) => message.id !== messageId));
    if (editingChatMessage?.messageId === messageId) {
      setEditingChatMessage(null);
    }
    setChatMessageMenu(null);
    setChatStatus({ status: "idle", message: "消息已删除。" });
  };

  const startEditingChatMessage = (messageId: string) => {
    if (chatStatus.status === "loading") return;

    const message = chatMessages.find((item) => item.id === messageId);
    if (!message) return;

    setEditingChatMessage({ messageId, content: message.content });
    setChatMessageMenu(null);
    setChatStatus({ status: "idle", message: "正在编辑消息，可取消或保存。" });
  };

  const restoreElectronWorkspaceFromSession = async (session: ChatSession) => {
    if (!session.workspacePath || !window.rengeDesktop?.isElectron) return false;

    const handle = await window.rengeDesktop.restoreWorkspace({ path: session.workspacePath });
    workspaceAutoRestoreDisabledRef.current = false;
    setLocalWorkspaceHandle(handle);
    setLocalToolsEnabled(true);
    restoredWorkspacePathRef.current = handle.path;
    return true;
  };

  const getSavedAndroidWorkspace = async () => {
    if (!window.rengeAndroid?.isAndroid) return null;
    const status = await window.rengeAndroid.getWorkspaceStatus();
    if (!status.available || !status.uri) return null;
    return {
      kind: "android" as const,
      name: status.name || (status.root ? `ROOT ${status.path || "/"}` : "手机工作区"),
      uri: status.uri,
    };
  };

  const restoreAndroidWorkspace = async () => {
    const handle = await getSavedAndroidWorkspace();
    if (!handle) return null;
    workspaceAutoRestoreDisabledRef.current = false;
    setLocalWorkspaceHandle(handle);
    setLocalToolsEnabled(true);
    restoredWorkspacePathRef.current = handle.uri;
    if (handle.uri.startsWith("root:")) {
      setRootWorkspacePath(handle.uri.replace(/^root:/, "") || "/");
      setRootAccessState((current) => ({
        status: current.status === "error" ? current.status : "success",
        message: current.status === "error" ? current.message : "ROOT 工作区已恢复。",
        details: current.details,
        granted: true,
      }));
    }
    return handle;
  };

  const restoreAndroidWorkspaceByUri = async (uri: string, name?: string) => {
    if (!window.rengeAndroid?.isAndroid || !uri) return null;
    const handle = await window.rengeAndroid.restoreWorkspace({ uri, name });
    workspaceAutoRestoreDisabledRef.current = false;
    setLocalWorkspaceHandle(handle);
    setLocalToolsEnabled(true);
    restoredWorkspacePathRef.current = handle.uri;
    if (handle.uri.startsWith("root:")) {
      setRootWorkspacePath(handle.uri.replace(/^root:/, "") || "/");
      setRootAccessState((current) => ({
        status: current.status === "error" ? current.status : "success",
        message: current.status === "error" ? current.message : "ROOT 工作区已恢复。",
        details: current.details,
        granted: true,
      }));
    }
    return handle;
  };

  const openChatSession = async (sessionId: string) => {
    const session = chatSessions.find((item) => item.id === sessionId);
    if (!session) return;

    workspaceAutoRestoreDisabledRef.current = false;
    setActiveChatSessionId(session.id);
    setChatMessages(session.messages);
    setEditingChatMessage(null);
    setChatMessageMenu(null);
    if (session.roleplayCharacterCardId) {
      setChatMode("roleplay");
      setActiveCharacterCardId(session.roleplayCharacterCardId);
    }

    if (session.workspacePath && window.rengeDesktop?.isElectron) {
      setChatStatus({ status: "loading", message: `正在恢复工作区：${session.workspaceName}` });
      try {
        const restored = await restoreElectronWorkspaceFromSession(session);
        setChatStatus({
          status: restored ? "success" : "error",
          message: restored
            ? `已恢复工作区：${session.workspaceName}`
            : "无法恢复工作区，请重新选择文件夹。",
        });
      } catch (error) {
        setLocalWorkspaceHandle(null);
        setLocalToolsEnabled(false);
        restoredWorkspacePathRef.current = "";
        setChatStatus({
          status: "error",
          message: error instanceof Error ? error.message : "工作区恢复失败，请重新选择文件夹。",
        });
      }
      return;
    }

    if (session.workspaceKey === DEFAULT_WORKSPACE_KEY) {
      setLocalWorkspaceHandle(null);
      setLocalToolsEnabled(false);
      restoredWorkspacePathRef.current = "";
      setChatStatus({ status: "idle", message: "" });
      return;
    }

    if (workspaceInfo.key === session.workspaceKey) {
      setChatStatus({ status: "idle", message: "" });
      return;
    }

    if (session.workspaceKey.startsWith("pc:")) {
      const pcWorkspace =
        pcTransferWorkspace && getWorkspaceInfo(pcTransferWorkspace).key === session.workspaceKey
          ? pcTransferWorkspace
          : null;
      if (pcWorkspace) {
        setLocalWorkspaceHandle(pcWorkspace);
        setLocalToolsEnabled(true);
        restoredWorkspacePathRef.current = pcWorkspace.path;
        setChatStatus({ status: "idle", message: "" });
        return;
      }

      setLocalWorkspaceHandle(null);
      setLocalToolsEnabled(false);
      restoredWorkspacePathRef.current = "";
      setChatStatus({
        status: "error",
        message: "这个会话属于电脑工作区，请重新连接电脑并选择对应文件夹。",
      });
      return;
    }

    if (session.workspaceKey.startsWith("android:") || session.workspaceKey.startsWith("browser:")) {
      try {
        setChatStatus({ status: "loading", message: "正在恢复手机工作区..." });
        const sessionAndroidUri = session.workspaceKey.startsWith("android:")
          ? session.workspacePath ?? session.workspaceKey.replace(/^android:/, "")
          : "";
        const androidWorkspace = sessionAndroidUri
          ? await restoreAndroidWorkspaceByUri(sessionAndroidUri, session.workspaceName)
          : await restoreAndroidWorkspace();
        if (androidWorkspace) {
          const androidWorkspaceInfo = getWorkspaceInfo(androidWorkspace);
          if (session.workspaceKey.startsWith("browser:")) {
            setChatSessions((current) =>
              current.map((item) =>
                item.id === session.id
                  ? {
                      ...item,
                      workspaceKey: androidWorkspaceInfo.key,
                      workspaceName: androidWorkspaceInfo.name,
                      workspacePath: androidWorkspaceInfo.path,
                      updatedAt: new Date().toISOString(),
                    }
                  : item,
              ),
            );
          } else if (session.workspaceKey !== androidWorkspaceInfo.key || session.workspacePath !== androidWorkspaceInfo.path) {
            setChatSessions((current) =>
              current.map((item) =>
                item.id === session.id
                  ? {
                      ...item,
                      workspaceKey: androidWorkspaceInfo.key,
                      workspaceName: androidWorkspaceInfo.name,
                      workspacePath: androidWorkspaceInfo.path,
                      updatedAt: new Date().toISOString(),
                    }
                  : item,
              ),
            );
          }

          setChatStatus({
            status: "success",
            message: `已恢复手机工作区：${androidWorkspaceInfo.name}`,
          });
          return;
        }
      } catch (error) {
        setLocalWorkspaceHandle(null);
        setLocalToolsEnabled(false);
        restoredWorkspacePathRef.current = "";
        setChatStatus({
          status: "error",
          message: error instanceof Error ? error.message : "手机工作区恢复失败。",
        });
        return;
      }
    }

    setLocalWorkspaceHandle(null);
    setLocalToolsEnabled(false);
    restoredWorkspacePathRef.current = "";
    setChatStatus({
      status: "error",
      message: "这个会话属于浏览器授权工作区，无法自动恢复文件夹，请重新选择文件夹。",
    });
  };

  useEffect(() => {
    if (!appDataLoaded) return;
    if (!activeChatSession?.workspacePath || !window.rengeDesktop?.isElectron) return;
    if (restoredWorkspacePathRef.current === activeChatSession.workspacePath) return;

    let cancelled = false;
    setChatStatus({ status: "loading", message: `正在恢复工作区：${activeChatSession.workspaceName}` });

    void restoreElectronWorkspaceFromSession(activeChatSession)
      .then((restored) => {
        if (cancelled) return;
        setChatStatus({
          status: restored ? "success" : "error",
          message: restored
            ? `已恢复工作区：${activeChatSession.workspaceName}`
            : "无法恢复工作区，请重新选择文件夹。",
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setLocalWorkspaceHandle(null);
        setLocalToolsEnabled(false);
        restoredWorkspacePathRef.current = "";
        setChatStatus({
          status: "error",
          message: error instanceof Error ? error.message : "工作区恢复失败，请重新选择文件夹。",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activeChatSession, appDataLoaded]);

  const addChatSession = (
    workspaceKey = workspaceInfo.key,
    workspaceName = workspaceInfo.name,
  ) => {
    const knownWorkspacePath = chatSessions.find(
      (session) => session.workspaceKey === workspaceKey && session.workspacePath,
    )?.workspacePath;
    const session = createChatSession(
      workspaceKey,
      workspaceName,
      workspaceKey === workspaceInfo.key ? workspaceInfo.path : knownWorkspacePath,
    );
    setChatSessions((current) => [...current, session]);
    setActiveChatSessionId(session.id);
    setChatMessages([]);
    setChatStatus({ status: "idle", message: "" });
  };

  const deleteChatSession = (sessionId: string) => {
    const deletedSession = chatSessions.find((session) => session.id === sessionId);
    // 后端清理该会话目录下持久化的生成图片，fire-and-forget
    void fetch(`/api/session-images/${encodeURIComponent(sessionId)}`, { method: "DELETE" }).catch(() => undefined);
    const remaining = deleteChatSessionsWithMemoryCleanup(
      chatSessions,
      (session) => session.id === sessionId,
    );
    const safeRemaining = remaining.length > 0 ? remaining : [createChatSession()];

    setChatSessions(safeRemaining);

    if (sessionId === activeChatSessionId) {
      const fallback =
        safeRemaining.find((session) => session.workspaceKey === deletedSession?.workspaceKey) ??
        safeRemaining[0];
      setActiveChatSessionId(fallback.id);
      setChatMessages(fallback.messages);
    }
    setChatStatus({ status: "idle", message: "会话已删除，相关记忆已取消。" });
  };

  const clearLocalWorkspace = () => {
    workspaceAutoRestoreDisabledRef.current = true;
    if (localWorkspaceHandle?.kind === "pc") {
      setPcTransferWorkspace(null);
      localStorage.removeItem(PC_WORKSPACE_PATH_STORAGE_KEY);
      localStorage.removeItem(PC_WORKSPACE_NAME_STORAGE_KEY);
    }
    setLocalWorkspaceHandle(null);
    setLocalToolsEnabled(false);
    restoredWorkspacePathRef.current = "";
    restoredPcWorkspaceRef.current = true;
    setChatStatus({ status: "idle", message: "" });

    const fallbackSession =
      chatSessions.find((session) => session.workspaceKey === DEFAULT_WORKSPACE_KEY) ??
      createChatSession();

    if (!chatSessions.some((session) => session.id === fallbackSession.id)) {
      setChatSessions((current) => [...current, fallbackSession]);
    }
    setActiveChatSessionId(fallbackSession.id);
    setChatMessages(fallbackSession.messages);
  };

  const deleteWorkspaceSessions = (workspaceKey: string, workspaceName: string) => {
    const workspaceSessionCount = chatSessions.filter(
      (session) => session.workspaceKey === workspaceKey,
    ).length;
    if (workspaceSessionCount === 0) return;

    const workspaceMemoryCount = chatSessions.filter(
      (session) => session.workspaceKey === workspaceKey && session.memoryPersonaIds.length > 0,
    ).length;
    const confirmed = window.confirm(
      `删除「${workspaceName}」下的 ${workspaceSessionCount} 个会话？\n只会删除会话记录，不会删除工作区文件。${
        workspaceMemoryCount > 0 ? `\n其中 ${workspaceMemoryCount} 个会话的记忆也会取消。` : ""
      }`,
    );
    if (!confirmed) return;

    // 后端清理该工作区下所有会话目录的生成图片
    for (const session of chatSessions) {
      if (session.workspaceKey === workspaceKey) {
        void fetch(`/api/session-images/${encodeURIComponent(session.id)}`, { method: "DELETE" }).catch(() => undefined);
      }
    }
    const remaining = deleteChatSessionsWithMemoryCleanup(
      chatSessions,
      (session) => session.workspaceKey === workspaceKey,
    );
    const safeRemaining = remaining.length > 0 ? remaining : [createChatSession()];
    const activeWasDeleted = chatSessions.some(
      (session) => session.workspaceKey === workspaceKey && session.id === activeChatSessionId,
    );

    setChatSessions(safeRemaining);

    if (workspaceInfo.key === workspaceKey) {
      setLocalWorkspaceHandle(null);
      setLocalToolsEnabled(false);
      restoredWorkspacePathRef.current = "";
    }

    if (activeWasDeleted) {
      const fallback =
        safeRemaining.find((session) => session.workspaceKey === DEFAULT_WORKSPACE_KEY) ??
        safeRemaining[0];
      setActiveChatSessionId(fallback.id);
      setChatMessages(fallback.messages);
    }
    setChatStatus({ status: "idle", message: "工作区会话已删除，相关记忆已取消。" });
  };

  const activateWorkspaceSessions = (
    handle: LocalDirectoryHandle | ElectronWorkspaceHandle | AndroidWorkspaceHandle | PcWorkspaceHandle,
  ) => {
    const nextWorkspaceInfo = getWorkspaceInfo(handle);
    const existingSession = chatSessions.find(
      (session) => session.workspaceKey === nextWorkspaceInfo.key,
    );

    if (existingSession) {
      if (nextWorkspaceInfo.path && existingSession.workspacePath !== nextWorkspaceInfo.path) {
        setChatSessions((current) =>
          current.map((session) =>
            session.id === existingSession.id
              ? {
                  ...session,
                  workspacePath: nextWorkspaceInfo.path,
                  updatedAt: new Date().toISOString(),
                }
              : session,
          ),
        );
      }
      setActiveChatSessionId(existingSession.id);
      setChatMessages(existingSession.messages);
      return;
    }

    const session = createChatSession(
      nextWorkspaceInfo.key,
      nextWorkspaceInfo.name,
      nextWorkspaceInfo.path,
    );
    setChatSessions((current) => [...current, session]);
    setActiveChatSessionId(session.id);
    setChatMessages([]);
  };

  const pullProviderModels = async () => {
    if (!activeProvider) return;
    const apiBaseUrl = trimTrailingSlash(activeProvider.apiBaseUrl);
    if (!apiBaseUrl) {
      setProviderPullState({ status: "error", message: "先填写 API 地址。" });
      return;
    }

    setProviderPullState({ status: "loading", message: "正在拉取模型列表..." });

    try {
      const response = await fetch("/api/providers/models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiBaseUrl,
          apiKey: activeProvider.apiKey,
        }),
      });

      if (!response.ok) {
        throw new Error(`请求失败：${response.status}`);
      }

      const payload = (await response.json()) as {
        data?: Array<{ id?: string }>;
        models?: Array<{ id?: string; name?: string } | string>;
        _pagination?: {
          pages?: number;
          truncated?: boolean;
        };
      };
      const pulledModels = [
        ...(payload.data ?? []).map((model) => model.id),
        ...(payload.models ?? []).map((model) =>
          typeof model === "string" ? model : model.id ?? model.name,
        ),
      ].filter((modelId): modelId is string => Boolean(modelId));
      const models = Array.from(new Set(pulledModels))
        .sort((first, second) => first.localeCompare(second));

      if (models.length === 0) {
        setProviderPullState({ status: "error", message: "未从响应中识别到模型 ID。" });
        return;
      }

      setProviders((current) =>
        current.map((provider) =>
          provider.id === activeProvider.id
            ? {
                ...provider,
                models,
                modelId: provider.modelId || models[0],
                updatedAt: new Date().toISOString(),
              }
            : provider,
        ),
      );
      const pageText =
        payload._pagination?.pages && payload._pagination.pages > 1
          ? `，分页 ${payload._pagination.pages} 页`
          : "";
      const truncatedText = payload._pagination?.truncated ? "，已达到本地上限" : "";
      setProviderPullState({
        status: "success",
        message: `已拉取 ${models.length} 个模型${pageText}${truncatedText}。`,
      });
    } catch (error) {
      setProviderPullState({
        status: "error",
        message: error instanceof Error ? error.message : "模型列表拉取失败。",
      });
    }
  };

  function normalizePcServerUrl(value: string) {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (!trimmed) throw new Error("请输入电脑地址，例如 192.168.1.20:5190 或 [240e:xxxx::1]:5190");
    let withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const protocolMatch = withProtocol.match(/^(https?:\/\/)(.+)$/i);
    if (protocolMatch) {
      const protocol = protocolMatch[1];
      const rest = protocolMatch[2];
      const slashIndex = rest.indexOf("/");
      const authority = slashIndex >= 0 ? rest.slice(0, slashIndex) : rest;
      const suffix = slashIndex >= 0 ? rest.slice(slashIndex) : "";
      const looksLikeBareIpv6 =
        authority.includes(":") &&
        !authority.startsWith("[") &&
        authority.split(":").length > 2;
      if (looksLikeBareIpv6) {
        const lastColonIndex = authority.lastIndexOf(":");
        const possiblePort = authority.slice(lastColonIndex + 1);
        const hasPort = /^\d+$/.test(possiblePort);
        const host = hasPort ? authority.slice(0, lastColonIndex) : authority;
        const port = hasPort ? `:${possiblePort}` : "";
        withProtocol = `${protocol}[${host}]${port}${suffix}`;
      }
    }
    const url = new URL(withProtocol);
    if (!url.port) url.port = "5190";
    return url.toString().replace(/\/+$/, "");
  }

  async function fetchPcApi<T>(pathname: string, body?: Record<string, unknown>, method = "POST") {
    const baseUrl = normalizePcServerUrl(pcServerUrl);
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
    const payload = (await response.json()) as T & { error?: string };
    if (!response.ok || payload.error) {
      throw new Error(payload.error || `电脑文件服务请求失败：${response.status}`);
    }
    return payload as T;
  }

  async function loadPcDirectory(path = "") {
    setPcBrowserStatus({ status: "loading", message: "正在读取电脑目录..." });
    try {
      const baseUrl = normalizePcServerUrl(pcServerUrl);
      localStorage.setItem(PC_SERVER_URL_STORAGE_KEY, baseUrl);
      setPcServerUrl(baseUrl);

      if (!path) {
        const payload = await fetchPcApi<{ roots: PcFileEntry[] }>("/api/pc/roots", undefined, "GET");
        setPcCurrentPath("");
        setPcEntries(payload.roots);
      } else {
        const payload = await fetchPcApi<{ path: string; entries: PcFileEntry[] }>("/api/pc/browse", { path });
        setPcCurrentPath(payload.path);
        setPcEntries(payload.entries);
      }
      setPcBrowserStatus({ status: "success", message: "已连接电脑文件服务。" });
    } catch (error) {
      setPcBrowserStatus({
        status: "error",
        message: error instanceof Error ? error.message : "电脑文件服务连接失败。",
      });
    }
  }

  function openPcBrowser() {
    setPcBrowserOpen(true);
    if (pcServerUrl.trim()) {
      void loadPcDirectory(pcCurrentPath);
    }
  }

  function getPcParentPath(path: string) {
    if (!path) return "";
    const normalized = path.replace(/[\\/]+$/g, "");
    if (/^[A-Za-z]:$/.test(normalized)) return "";
    const separatorIndex = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
    if (separatorIndex < 0) return "";
    const parent = normalized.slice(0, separatorIndex);
    if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
    return parent;
  }

  function selectPcWorkspace(path = pcCurrentPath) {
    if (!path) {
      setPcBrowserStatus({ status: "error", message: "请先进入一个电脑文件夹。" });
      return;
    }
    const baseUrl = normalizePcServerUrl(pcServerUrl);
    const name = path.replace(/[\\/]+$/g, "").split(/[\\/]/).filter(Boolean).at(-1) || path;
    const handle: PcWorkspaceHandle = {
      kind: "pc",
      name,
      baseUrl,
      path,
    };
    workspaceAutoRestoreDisabledRef.current = false;
    localStorage.setItem(PC_SERVER_URL_STORAGE_KEY, baseUrl);
    localStorage.setItem(PC_WORKSPACE_PATH_STORAGE_KEY, path);
    localStorage.setItem(PC_WORKSPACE_NAME_STORAGE_KEY, name);
    setPcServerUrl(baseUrl);
    setPcTransferWorkspace(handle);
    setLocalWorkspaceHandle(handle);
    setLocalToolsEnabled(true);
    restoredWorkspacePathRef.current = path;
    restoredPcWorkspaceRef.current = true;
    activateWorkspaceSessions(handle);
    setPcBrowserOpen(false);
    setChatStatus({ status: "success", message: `已连接电脑工作区：${name}` });
  }

  const requestAndroidRootAccess = async () => {
    if (!window.rengeAndroid?.isAndroid) {
      setRootAccessState({
        status: "error",
        message: "ROOT 权限请求只在 Android App 内可用。",
        granted: false,
      });
      return;
    }

    setRootAccessState({ status: "loading", message: "正在请求 ROOT 权限..." });
    try {
      const result = await window.rengeAndroid.requestRootAccess({ timeoutSeconds: 15 });
      const details = [result.output, result.errorOutput].filter(Boolean).join("\n");
      setRootAccessState({
        status: result.granted ? "success" : "error",
        message: result.message || (result.granted ? "ROOT 权限已授予。" : "ROOT 权限未授予。"),
        details,
        granted: result.granted,
      });
    } catch (error) {
      setRootAccessState({
        status: "error",
        message: error instanceof Error ? error.message : "ROOT 权限请求失败。",
        granted: false,
      });
    }
  };

  const selectAndroidRootWorkspace = async () => {
    if (!window.rengeAndroid?.isAndroid) {
      setRootAccessState({
        status: "error",
        message: "ROOT 工作区只在 Android App 内可用。",
        granted: false,
      });
      return;
    }

    setRootAccessState({ status: "loading", message: "正在设置 ROOT 工作区..." });
    try {
      const handle = await window.rengeAndroid.selectRootWorkspace({
        path: rootWorkspacePath.trim() || "/",
      });
      workspaceAutoRestoreDisabledRef.current = false;
      setLocalWorkspaceHandle(handle);
      setLocalToolsEnabled(true);
      restoredWorkspacePathRef.current = handle.uri;
      activateWorkspaceSessions(handle);
      setRootAccessState({
        status: "success",
        message: `已设置 ROOT 工作区：${rootWorkspacePath.trim() || "/"}`,
        granted: true,
      });
      setChatStatus({ status: "success", message: `已授权工作区：${handle.name}` });
    } catch (error) {
      setRootAccessState({
        status: "error",
        message: error instanceof Error ? error.message : "ROOT 工作区设置失败。",
        granted: false,
      });
    }
  };

  const authorizeLocalWorkspace = async () => {
    if (window.rengeAndroid?.isAndroid) {
      try {
        const handle = await window.rengeAndroid.selectWorkspace();
        if (!handle) return;

        workspaceAutoRestoreDisabledRef.current = false;
        setLocalWorkspaceHandle(handle);
        setLocalToolsEnabled(true);
        restoredWorkspacePathRef.current = handle.uri;
        activateWorkspaceSessions(handle);
        setChatStatus({
          status: "success",
          message: `已授权手机工作区：${handle.name}`,
        });
      } catch (error) {
        setChatStatus({
          status: "error",
          message: error instanceof Error ? error.message : "手机工作区授权失败。",
        });
      }
      return;
    }

    if (window.rengeDesktop?.isElectron) {
      try {
        const handle = await window.rengeDesktop.selectWorkspace();
        if (!handle) return;

        workspaceAutoRestoreDisabledRef.current = false;
        setLocalWorkspaceHandle(handle);
        setLocalToolsEnabled(true);
        restoredWorkspacePathRef.current = handle.path;
        activateWorkspaceSessions(handle);
        setChatStatus({
          status: "success",
          message: `已授权工作区：${handle.name}`,
        });
      } catch (error) {
        setChatStatus({
          status: "error",
          message: error instanceof Error ? error.message : "工作区授权失败。",
        });
      }
      return;
    }

    const directoryPicker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
    if (!directoryPicker) {
      setChatStatus({
        status: "error",
        message: "当前浏览器不支持目录授权。请使用支持 File System Access API 的 Chromium 浏览器。",
      });
      return;
    }

    try {
      const handle = await directoryPicker();
      const permission =
        (await handle.queryPermission?.({ mode: "readwrite" })) ??
        (await handle.requestPermission?.({ mode: "readwrite" }));
      const nextPermission =
        permission === "granted"
          ? permission
          : await handle.requestPermission?.({ mode: "readwrite" });

      if (nextPermission !== "granted") {
        setChatStatus({ status: "error", message: "未获得读写权限。" });
        return;
      }

      workspaceAutoRestoreDisabledRef.current = false;
      setLocalWorkspaceHandle(handle);
      setLocalToolsEnabled(true);
      restoredWorkspacePathRef.current = "";
      activateWorkspaceSessions(handle);
      setChatStatus({
        status: "success",
        message: `已授权工作区：${handle.name}`,
      });
    } catch (error) {
      setChatStatus({
        status: "error",
        message: error instanceof Error ? error.message : "工作区授权失败。",
      });
    }
  };

  const executeLocalFileTool = async (toolName: string, rawArguments: string) => {
    if (!localWorkspaceHandle || !localToolsEnabled) {
      throw new Error("本地文件工具未启用或未授权工作区");
    }

    const args = parseToolArguments(rawArguments);
    const getSelectedPcTransferWorkspace = () => {
      if (localWorkspaceHandle.kind === "pc") return localWorkspaceHandle;
      return pcTransferWorkspace;
    };
    const getPcDownloadUrl = (pcWorkspace: PcWorkspaceHandle, path: string) => {
      const fileName = path.split(/[\\/]/).filter(Boolean).at(-1) || "download";
      const query = new URLSearchParams({
        workspacePath: pcWorkspace.path,
        path,
        downloadName: fileName,
      });
      return `${pcWorkspace.baseUrl}/api/pc/download-file?${query.toString()}`;
    };
    const previewPcImage = async () => {
      const pcWorkspace = getSelectedPcTransferWorkspace();
      const path = String(args.path ?? "");
      if (!path) throw new Error("path 不能为空");
      const attachment = findImageAttachmentReference(path);
      if (!pcWorkspace && attachment) {
        return {
          ok: true,
          skipped: true,
          path,
          message:
            "这是聊天上传的图片附件，不是电脑工作区文件。图片识别请使用图像识别 MCP；无需连接电脑端工作区。",
        };
      }
      if (!pcWorkspace) throw new Error("请先连接电脑并选择电脑端工作区");
      const response = await fetch(getPcDownloadUrl(pcWorkspace, path));
      if (!response.ok) throw new Error(`图片预览读取失败：${response.status}`);
      const blob = await response.blob();
      const preview = await createImagePreviewDataUrl(blob);
      return {
        ok: true,
        path,
        originalBytes: blob.size,
        previewWidth: preview.width,
        previewHeight: preview.height,
        originalWidth: preview.originalWidth,
        originalHeight: preview.originalHeight,
        previewMimeType: "image/jpeg",
        previewDataUrl: preview.dataUrl,
      };
    };
    const sendPcFileToUser = async () => {
      const pcWorkspace = getSelectedPcTransferWorkspace();
      if (!pcWorkspace) throw new Error("请先连接电脑并选择电脑端工作区");
      const path = String(args.path ?? "");
      if (!path) throw new Error("path 不能为空");
      const infoResponse = await fetch(`${pcWorkspace.baseUrl}/api/pc/file-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspacePath: pcWorkspace.path,
          path,
        }),
      });
      const info = (await infoResponse.json()) as {
        error?: string;
        name?: string;
        size?: number;
        kind?: string;
      };
      if (!infoResponse.ok || info.error) {
        throw new Error(info.error || `电脑文件信息读取失败：${infoResponse.status}`);
      }
      if (info.kind === "directory") {
        throw new Error("不能直接发送目录，请先选择具体文件");
      }
      const downloadUrl = getPcDownloadUrl(pcWorkspace, path);
      const name = info.name || path.split(/[\\/]/).filter(Boolean).at(-1) || path;
      const attachment: ChatAttachment = {
        id: crypto.randomUUID(),
        name,
        type: "application/octet-stream",
        size: Number(info.size ?? 0),
        downloadUrl,
        createdAt: new Date().toISOString(),
      };
      return {
        ok: true,
        path,
        name,
        size: attachment.size,
        downloadUrl,
        attachment,
      };
    };
    const uploadAttachmentToPc = async () => {
      const attachmentId = String(args.attachmentId ?? "");
      const attachment = getKnownAttachmentMetadata(attachmentId);
      const file = chatAttachmentFilesRef.current.get(attachmentId);
      if (!attachment && !file) {
        throw new Error("找不到这个聊天附件或生成图片。请确认附件ID、文件名或重新选择该文件后再发送请求。");
      }
      const readAttachmentBlob = async () => {
        if (file) return new Blob([file], { type: file.type || attachment?.type || "application/octet-stream" });
        if (attachment?.dataUrl) {
          const response = await fetch(attachment.dataUrl);
          if (!response.ok) throw new Error(`附件 data URL 读取失败：${response.status}`);
          return response.blob();
        }
        if (attachment?.downloadUrl) {
          const response = await fetch(attachment.downloadUrl);
          if (!response.ok) throw new Error(`生成图片读取失败：${response.status}`);
          return response.blob();
        }
        throw new Error("这个附件没有可保存的文件内容。");
      };
      const attachmentBlob = await readAttachmentBlob();
      const attachmentName = file?.name ?? attachment?.name ?? "attachment.bin";
      const attachmentType = file?.type || attachment?.type || attachmentBlob.type || "application/octet-stream";
      const targetPath = String(args.targetPath ?? attachmentName);
      if (!targetPath) throw new Error("targetPath 不能为空");

      if (localWorkspaceHandle.kind === "electron") {
        const desktopApi = window.rengeDesktop;
        if (!desktopApi) throw new Error("Electron 文件工具不可用");
        const result = await desktopApi.writeBinaryFile({
          path: targetPath,
          base64: await blobToBase64(attachmentBlob),
          mimeType: attachmentType,
        }) as { bytes?: number };
        return {
          ok: true,
          attachmentId,
          name: attachmentName,
          targetPath,
          bytes: result.bytes ?? attachmentBlob.size,
          workspace: localWorkspaceHandle.name,
          workspaceKind: localWorkspaceHandle.kind,
        };
      }

      if (localWorkspaceHandle.kind === "android") {
        const androidApi = window.rengeAndroid;
        if (!androidApi) throw new Error("Android 文件工具不可用");
        const result = await androidApi.writeBinaryFile({
          path: targetPath,
          base64: await blobToBase64(attachmentBlob),
          mimeType: attachmentType,
        }) as { bytes?: number };
        return {
          ok: true,
          attachmentId,
          name: attachmentName,
          targetPath,
          bytes: result.bytes ?? attachmentBlob.size,
          workspace: localWorkspaceHandle.name,
          workspaceKind: localWorkspaceHandle.kind,
        };
      }

      if (localWorkspaceHandle.kind === "pc") {
        const query = new URLSearchParams({
          workspacePath: localWorkspaceHandle.path,
          path: targetPath,
        });
        const response = await fetch(`${localWorkspaceHandle.baseUrl}/api/pc/upload-file?${query.toString()}`, {
          method: "PUT",
          body: attachmentBlob,
        });
        const payload = await response.json() as { error?: string; bytes?: number };
        if (!response.ok || payload.error) {
          throw new Error(payload.error || `附件上传失败：${response.status}`);
        }
        return {
          ...payload,
          attachmentId,
          name: attachmentName,
          targetPath,
          bytes: payload.bytes ?? attachmentBlob.size,
          workspace: localWorkspaceHandle.name,
          workspaceKind: localWorkspaceHandle.kind,
        };
      }

      const bytes = await writeLocalBinaryFile(
        localWorkspaceHandle,
        targetPath,
        await blobToBase64(attachmentBlob),
      );
      return {
        ok: true,
        attachmentId,
        name: attachmentName,
        targetPath,
        bytes,
        workspace: localWorkspaceHandle.name,
        workspaceKind: "browser",
      };
    };
    const getPathFileName = (path: string) =>
      path.replace(/[\\/]+$/g, "").split(/[\\/]/).filter(Boolean).at(-1) ?? path;
    const getKnownAttachmentByFileName = (fileName: string) => {
      const normalizedName = fileName.trim().toLowerCase();
      if (!normalizedName) return null;
      const candidates: ChatAttachment[] = [];
      const add = (attachment: ChatAttachment) => {
        if (!candidates.some((candidate) => candidate.id === attachment.id)) {
          candidates.push(attachment);
        }
      };
      chatAttachmentMetadataRef.current.forEach(add);
      chatAttachments.forEach(add);
      chatMessages.forEach((message) => (message.attachments ?? []).forEach(add));
      getGeneratedImageAttachmentsFromMessages(chatMessages).forEach(add);
      return (
        candidates.find((attachment) => attachment.name.trim().toLowerCase() === normalizedName) ??
        null
      );
    };
    const getAttachmentOriginalBase64 = async (attachment: ChatAttachment) => {
      const file = chatAttachmentFilesRef.current.get(attachment.id);
      if (file) return readFileAsBase64(file);
      if (attachment.dataUrl) return getDataUrlBase64(attachment.dataUrl);
      if (attachment.downloadUrl) {
        const response = await fetch(attachment.downloadUrl);
        if (!response.ok) return "";
        return blobToBase64(await response.blob());
      }
      return "";
    };
    const getBinaryWritePayload = async () => {
      const path = String(args.path ?? "");
      const mimeType = String(args.mimeType ?? "");
      const requestedBase64 = String(args.base64 ?? "");
      const targetAttachment = getKnownAttachmentByFileName(getPathFileName(path));
      if (!targetAttachment) {
        return { path, base64: requestedBase64, mimeType };
      }

      const requestedBytes = estimateBase64Bytes(requestedBase64);
      const expectedBytes = targetAttachment.size;
      const sizeDiffersClearly =
        expectedBytes > 0 &&
        (requestedBytes < Math.max(1024, expectedBytes * 0.9) ||
          requestedBytes > expectedBytes * 1.1);
      if (!sizeDiffersClearly) {
        return { path, base64: requestedBase64, mimeType };
      }

      const originalBase64 = await getAttachmentOriginalBase64(targetAttachment);
      if (!originalBase64) {
        return { path, base64: requestedBase64, mimeType };
      }

      return {
        path,
        base64: originalBase64,
        mimeType: targetAttachment.type || mimeType,
      };
    };
    const executeAndroidPcTransfer = async () => {
      const androidApi = window.rengeAndroid;
      if (!androidApi) throw new Error("手机电脑直传需要在 Android App 内使用");
      const pcWorkspace = getSelectedPcTransferWorkspace();
      if (!pcWorkspace) throw new Error("请先连接电脑并选择电脑端目标工作区");
      const direction = String(args.direction ?? "");
      const options = {
        sourcePath: String(args.sourcePath ?? ""),
        targetPath: String(args.targetPath ?? ""),
        pcBaseUrl: pcWorkspace.baseUrl,
        pcWorkspacePath: pcWorkspace.path,
      };
      if (!options.sourcePath || !options.targetPath) {
        throw new Error("sourcePath 和 targetPath 不能为空");
      }
      if (direction === "phone_to_pc") {
        return androidApi.transferFileToPc(options);
      }
      if (direction === "pc_to_phone") {
        return androidApi.transferFileFromPc(options);
      }
      throw new Error("direction 必须是 phone_to_pc 或 pc_to_phone");
    };

    if (localWorkspaceHandle.kind === "electron") {
      const desktopApi = window.rengeDesktop;
      if (!desktopApi) throw new Error("Electron 文件工具不可用");

      switch (toolName) {
        case "local_list_files":
          return desktopApi.listFiles({
            path: String(args.path ?? ""),
            recursive: args.recursive === undefined ? true : Boolean(args.recursive),
          });
        case "local_read_file":
          return desktopApi.readFile({ path: String(args.path ?? "") });
        case "local_preview_pc_image":
          return previewPcImage();
        case "local_read_binary_file":
          return desktopApi.readBinaryFile({ path: String(args.path ?? "") });
        case "local_read_file_range":
          return desktopApi.readFileRange({
            path: String(args.path ?? ""),
            startLine: Number(args.startLine ?? 1),
            endLine: Number(args.endLine ?? Number(args.startLine ?? 1) + 120),
          });
        case "local_file_info":
          return desktopApi.fileInfo({ path: String(args.path ?? "") });
        case "local_search_files":
          return desktopApi.searchFiles({
            query: String(args.query ?? ""),
            path: String(args.path ?? ""),
            includeContent: args.includeContent === undefined ? true : Boolean(args.includeContent),
          });
        case "local_create_directory":
          return desktopApi.createDirectory({ path: String(args.path ?? "") });
        case "local_rename_path":
          return desktopApi.renamePath({
            from: String(args.from ?? ""),
            to: String(args.to ?? ""),
          });
        case "local_run_script":
          return desktopApi.runScript({
            script: String(args.script ?? ""),
            args: Array.isArray(args.args) ? args.args.map(String) : [],
          });
        case "local_run_command":
          return desktopApi.runCommand({
            command: String(args.command ?? ""),
            args: Array.isArray(args.args) ? args.args.map(String) : [],
            timeoutMs: Number(args.timeoutMs ?? 60000),
          });
        case "local_git_status":
          return desktopApi.gitStatus();
        case "local_git_diff":
          return desktopApi.gitDiff({
            path: String(args.path ?? ""),
            staged: Boolean(args.staged),
          });
        case "project_detect_stack":
          return desktopApi.detectStack();
        case "project_search_regex":
          return desktopApi.searchRegex({
            pattern: String(args.pattern ?? ""),
            path: String(args.path ?? ""),
            flags: String(args.flags ?? ""),
            maxMatches: Number(args.maxMatches ?? 80),
          });
        case "project_find_symbols":
          return desktopApi.findSymbols({
            query: String(args.query ?? ""),
            path: String(args.path ?? ""),
            maxMatches: Number(args.maxMatches ?? 120),
          });
        case "project_read_package_json":
          return desktopApi.readPackageJson();
        case "project_todo_scan":
          return desktopApi.scanTodos({
            path: String(args.path ?? ""),
            maxMatches: Number(args.maxMatches ?? 120),
          });
        case "local_write_file":
          return desktopApi.writeFile({
            path: String(args.path ?? ""),
            content: String(args.content ?? ""),
          });
        case "local_write_binary_file":
          const desktopBinaryPayload = await getBinaryWritePayload();
          return desktopApi.writeBinaryFile({
            path: desktopBinaryPayload.path,
            base64: desktopBinaryPayload.base64,
            mimeType: desktopBinaryPayload.mimeType,
          });
        case "local_transfer_file":
          throw new Error("local_transfer_file 仅支持 Android App 与电脑网络工作区直传");
        case "local_transfer_attachment_file":
          return uploadAttachmentToPc();
        case "local_send_pc_file":
          return sendPcFileToUser();
        case "local_edit_file":
          return desktopApi.editFile({
            path: String(args.path ?? ""),
            find: String(args.find ?? ""),
            replace: String(args.replace ?? ""),
          });
        case "local_delete_path":
          return desktopApi.deletePath({
            path: String(args.path ?? ""),
            recursive: Boolean(args.recursive),
          });
        default:
          throw new Error(`未知工具：${toolName}`);
      }
    }

    if (localWorkspaceHandle.kind === "android") {
      const androidApi = window.rengeAndroid;
      if (!androidApi) throw new Error("Android 文件工具不可用");

      switch (toolName) {
        case "local_list_files":
          return androidApi.listFiles({
            path: String(args.path ?? ""),
            recursive: args.recursive === undefined ? true : Boolean(args.recursive),
          });
        case "local_read_file":
          return androidApi.readFile({ path: String(args.path ?? "") });
        case "local_preview_pc_image":
          return previewPcImage();
        case "local_read_binary_file":
          return androidApi.readBinaryFile({ path: String(args.path ?? "") });
        case "local_read_file_range":
          return androidApi.readFileRange({
            path: String(args.path ?? ""),
            startLine: Number(args.startLine ?? 1),
            endLine: Number(args.endLine ?? Number(args.startLine ?? 1) + 120),
          });
        case "local_file_info":
          return androidApi.fileInfo({ path: String(args.path ?? "") });
        case "local_search_files":
          return androidApi.searchFiles({
            query: String(args.query ?? ""),
            path: String(args.path ?? ""),
            includeContent: args.includeContent === undefined ? true : Boolean(args.includeContent),
          });
        case "local_create_directory":
          return androidApi.createDirectory({ path: String(args.path ?? "") });
        case "local_write_file":
          return androidApi.writeFile({
            path: String(args.path ?? ""),
            content: String(args.content ?? ""),
          });
        case "local_write_binary_file":
          const androidBinaryPayload = await getBinaryWritePayload();
          return androidApi.writeBinaryFile({
            path: androidBinaryPayload.path,
            base64: androidBinaryPayload.base64,
            mimeType: androidBinaryPayload.mimeType,
          });
        case "local_transfer_file":
          return executeAndroidPcTransfer();
        case "local_transfer_attachment_file":
          return uploadAttachmentToPc();
        case "local_send_pc_file":
          return sendPcFileToUser();
        case "local_delete_path":
          return androidApi.deletePath({
            path: String(args.path ?? ""),
            recursive: Boolean(args.recursive),
          });
        case "local_rename_path":
        case "local_run_script":
        case "local_run_command":
        case "local_git_status":
        case "local_git_diff":
          throw new Error(`${toolName} 仅支持 Electron 桌面版`);
        case "project_search_regex":
        case "project_detect_stack":
        case "project_find_symbols":
        case "project_read_package_json":
        case "project_todo_scan":
          throw new Error(`${toolName} 暂不支持 Android 工作区`);
        default:
          throw new Error(`未知工具：${toolName}`);
      }
    }

    if (localWorkspaceHandle.kind === "pc") {
      const request = (pathname: string, extra: Record<string, unknown> = {}) =>
        fetch(`${localWorkspaceHandle.baseUrl}${pathname}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspacePath: localWorkspaceHandle.path,
            ...extra,
          }),
        }).then(async (response) => {
          const payload = (await response.json()) as { error?: string };
          if (!response.ok || payload.error) {
            throw new Error(payload.error || `电脑文件服务请求失败：${response.status}`);
          }
          return payload;
        });

      switch (toolName) {
        case "local_list_files":
          return request("/api/pc/list-files", {
            path: String(args.path ?? ""),
            recursive: args.recursive === undefined ? true : Boolean(args.recursive),
          });
        case "local_read_file":
          return request("/api/pc/read-file", { path: String(args.path ?? "") });
        case "local_preview_pc_image":
          return previewPcImage();
        case "local_read_binary_file":
          return request("/api/pc/read-binary-file", { path: String(args.path ?? "") });
        case "local_read_file_range":
          return request("/api/pc/read-file-range", {
            path: String(args.path ?? ""),
            startLine: Number(args.startLine ?? 1),
            endLine: Number(args.endLine ?? Number(args.startLine ?? 1) + 120),
          });
        case "local_file_info":
          return request("/api/pc/file-info", { path: String(args.path ?? "") });
        case "local_search_files":
          return request("/api/pc/search-files", {
            query: String(args.query ?? ""),
            path: String(args.path ?? ""),
            includeContent: args.includeContent === undefined ? true : Boolean(args.includeContent),
          });
        case "local_create_directory":
          return request("/api/pc/create-directory", { path: String(args.path ?? "") });
        case "local_write_file":
          return request("/api/pc/write-file", {
            path: String(args.path ?? ""),
            content: String(args.content ?? ""),
          });
        case "local_write_binary_file":
          const pcBinaryPayload = await getBinaryWritePayload();
          return request("/api/pc/write-binary-file", {
            path: pcBinaryPayload.path,
            base64: pcBinaryPayload.base64,
            mimeType: pcBinaryPayload.mimeType,
          });
        case "local_transfer_file":
          return executeAndroidPcTransfer();
        case "local_transfer_attachment_file":
          return uploadAttachmentToPc();
        case "local_send_pc_file":
          return sendPcFileToUser();
        case "local_delete_path":
          return request("/api/pc/delete-path", {
            path: String(args.path ?? ""),
            recursive: Boolean(args.recursive),
          });
        case "local_rename_path":
        case "local_run_script":
        case "local_run_command":
        case "local_git_status":
        case "local_git_diff":
        case "project_search_regex":
        case "project_detect_stack":
        case "project_find_symbols":
        case "project_read_package_json":
        case "project_todo_scan":
          throw new Error(`${toolName} 暂不支持电脑网络工作区`);
        default:
          throw new Error(`未知工具：${toolName}`);
      }
    }

    switch (toolName) {
      case "local_list_files":
        return listLocalFiles(
          localWorkspaceHandle,
          String(args.path ?? ""),
          args.recursive === undefined ? true : Boolean(args.recursive),
        );
      case "local_read_file":
        return {
          path: String(args.path ?? ""),
          content: await readLocalTextFile(localWorkspaceHandle, String(args.path ?? "")),
        };
      case "local_preview_pc_image":
        return previewPcImage();
      case "local_read_binary_file":
        return readLocalBinaryFile(localWorkspaceHandle, String(args.path ?? ""));
      case "local_read_file_range":
        return readLocalTextFileRange(
          localWorkspaceHandle,
          String(args.path ?? ""),
          Number(args.startLine ?? 1),
          Number(args.endLine ?? Number(args.startLine ?? 1) + 120),
        );
      case "local_file_info":
        return getLocalFileInfo(localWorkspaceHandle, String(args.path ?? ""));
      case "local_search_files":
        return searchLocalFiles(
          localWorkspaceHandle,
          String(args.query ?? ""),
          String(args.path ?? ""),
          args.includeContent === undefined ? true : Boolean(args.includeContent),
        );
      case "local_create_directory":
        return createLocalDirectory(localWorkspaceHandle, String(args.path ?? ""));
      case "local_rename_path":
      case "local_run_script":
      case "local_run_command":
      case "local_git_status":
      case "local_git_diff":
        throw new Error(`${toolName} 仅支持 Electron 桌面版`);
      case "project_detect_stack":
        return detectLocalProjectStack(localWorkspaceHandle);
      case "project_search_regex":
        return searchLocalRegex(
          localWorkspaceHandle,
          String(args.pattern ?? ""),
          String(args.path ?? ""),
          String(args.flags ?? ""),
          Number(args.maxMatches ?? 80),
        );
      case "project_find_symbols":
        return findLocalSymbols(
          localWorkspaceHandle,
          String(args.query ?? ""),
          String(args.path ?? ""),
          Number(args.maxMatches ?? 120),
        );
      case "project_read_package_json":
        return readLocalPackageJson(localWorkspaceHandle);
      case "project_todo_scan":
        return scanLocalTodos(
          localWorkspaceHandle,
          String(args.path ?? ""),
          Number(args.maxMatches ?? 120),
        );
      case "local_write_file":
        await writeLocalTextFile(
          localWorkspaceHandle,
          String(args.path ?? ""),
          String(args.content ?? ""),
        );
        return { ok: true, path: String(args.path ?? ""), operation: "write" };
      case "local_write_binary_file": {
        const localBinaryPayload = await getBinaryWritePayload();
        const bytes = await writeLocalBinaryFile(
          localWorkspaceHandle,
          localBinaryPayload.path,
          localBinaryPayload.base64,
        );
        return { ok: true, path: localBinaryPayload.path, operation: "writeBinary", bytes };
      }
      case "local_transfer_file":
        return executeAndroidPcTransfer();
      case "local_transfer_attachment_file":
        return uploadAttachmentToPc();
      case "local_send_pc_file":
        return sendPcFileToUser();
      case "local_edit_file":
        return {
          ok: true,
          path: String(args.path ?? ""),
          operation: "edit",
          ...(await editLocalTextFile(
            localWorkspaceHandle,
            String(args.path ?? ""),
            String(args.find ?? ""),
            String(args.replace ?? ""),
          )),
        };
      case "local_delete_path": {
        const { directory, name } = await getLocalParentDirectory(
          localWorkspaceHandle,
          String(args.path ?? ""),
        );
        await directory.removeEntry(name, { recursive: Boolean(args.recursive) });
        return { ok: true, path: String(args.path ?? ""), operation: "delete" };
      }
      default:
        throw new Error(`未知工具：${toolName}`);
    }
  };

  const copyChatCodeBlock = async (content: string) => {
    await navigator.clipboard.writeText(content);
    setChatStatus({ status: "success", message: "已复制代码块。" });
  };

  const executeMcpTool = async (toolName: string, rawArguments: string) => {
    const args = normalizeImageRecognitionToolArguments(
      toolName,
      parseToolArguments(rawArguments),
    );
    const enabledServers = mcpServers.filter((server) => server.enabled);
    if (enabledServers.length === 0) {
      throw new Error("没有启用的 MCP 服务器");
    }

    const response = await fetch("/api/mcp/call-tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        servers: enabledServers,
        toolName,
        arguments: args,
      }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok || payload.error) {
      throw new Error(payload.error || `MCP 工具调用失败：${response.status}`);
    }
    return payload;
  };

  const executeHeartbeatTool = async (rawArguments: string) => {
    const args = parseToolArguments(rawArguments);
    const shouldResetRunCount =
      args.resetRunCount === undefined
        ? !heartbeatRunningRef.current &&
          (args.intervalMinutes !== undefined ||
            args.event !== undefined ||
            args.loopLimit !== undefined)
        : Boolean(args.resetRunCount);
    const patch: ChatHeartbeatPatch = {
      ...(typeof args.enabled === "boolean" ? { enabled: args.enabled } : {}),
      ...(args.intervalMinutes !== undefined
        ? { intervalMinutes: Number(args.intervalMinutes) }
        : {}),
      ...(args.event !== undefined ? { event: String(args.event) } : {}),
      ...(args.loopLimit !== undefined
        ? {
            loopLimit:
              args.loopLimit === null
                ? null
                : typeof args.loopLimit === "number" || typeof args.loopLimit === "string"
                  ? Number(args.loopLimit)
                  : null,
          }
        : {}),
      resetRunCount: shouldResetRunCount,
    };
    const sessionId = activeChatSession?.id ?? activeChatSessionIdRef.current;

    if (heartbeatRunningRef.current && sessionId) {
      const targetSession = chatSessions.find((session) => session.id === sessionId);
      if (!targetSession) throw new Error("没有可更新的当前会话。");
      pendingHeartbeatUpdateRef.current = { sessionId, patch };
      return {
        ...applyHeartbeatPatch(
          normalizeHeartbeatConfig(targetSession.heartbeat),
          patch,
          new Date().toISOString(),
        ),
        pending: true,
        appliedAfterCurrentRun: true,
      };
    }

    const nextConfig = updateActiveHeartbeat(patch);

    if (!nextConfig) {
      throw new Error("没有可更新的当前会话。");
    }

    return nextConfig;
  };

  const executeMultiAgentEndTool = async (rawArguments: string) => {
    if (chatMode !== "multi" || !multiAgentAutoStopEnabled) {
      throw new Error("当前没有授予 Agent 提前结束多 Agent 轮次的权限。");
    }
    const args = parseToolArguments(rawArguments);
    const reason = String(args.reason ?? "").trim();
    const evidence = String(args.evidence ?? "").trim();
    if (!reason) throw new Error("提前结束必须说明原因。");

    pendingMultiAgentEndRef.current = { reason, evidence };
    return {
      ended: true,
      silent: true,
    };
  };

  const executeChatTool = async (toolName: string, rawArguments: string) => {
    if (isMcpToolName(toolName)) {
      return executeMcpTool(toolName, rawArguments);
    }
    if (toolName === "chat_update_heartbeat") {
      return executeHeartbeatTool(rawArguments);
    }
    if (toolName === "multi_agent_end_rounds") {
      return executeMultiAgentEndTool(rawArguments);
    }
    return executeLocalFileTool(toolName, rawArguments);
  };

  const getKnownImageAttachments = () => {
    const byId = new Map<string, ChatAttachment>();
    const add = (attachment: ChatAttachment) => {
      if (attachment.type.startsWith("image/") && attachment.dataUrl) {
        byId.set(attachment.id, attachment);
      }
    };
    chatAttachmentMetadataRef.current.forEach(add);
    chatAttachments.forEach(add);
    chatMessages.forEach((message) => (message.attachments ?? []).forEach(add));
    return Array.from(byId.values());
  };

  const getKnownAttachmentMetadata = (attachmentId: string) =>
    chatAttachmentMetadataRef.current.get(attachmentId) ??
    chatAttachments.find((attachment) => attachment.id === attachmentId) ??
    chatMessages
      .flatMap((message) => message.attachments ?? [])
      .find((attachment) => attachment.id === attachmentId) ??
    getGeneratedImageAttachmentsFromMessages(chatMessages).find(
      (attachment) =>
        attachment.id === attachmentId ||
        attachment.name.trim().toLowerCase() === attachmentId.trim().toLowerCase() ||
        attachment.downloadUrl === attachmentId,
    );

  const findImageAttachmentReference = (value: unknown) => {
    if (typeof value !== "string") return null;
    const normalizedValue = value.trim().replace(/^["']|["']$/g, "");
    if (!normalizedValue) return null;

    const normalizeName = (name: string) => name.trim().toLowerCase();
    const attachments = getKnownImageAttachments();
    return (
      attachments.find((attachment) => attachment.id === normalizedValue) ??
      attachments.find((attachment) => normalizeName(attachment.name) === normalizeName(normalizedValue)) ??
      attachments.find((attachment) =>
        normalizeName(attachment.name).startsWith(normalizeName(normalizedValue)),
      ) ??
      attachments.find((attachment) =>
        normalizeName(normalizedValue).startsWith(normalizeName(attachment.name)),
      ) ??
      null
    );
  };

  const normalizeImageRecognitionToolArguments = (
    toolName: string,
    args: Record<string, unknown>,
  ) => {
    const tool = mcpTools.find((candidate) => candidate.function.name === toolName);
    if (!tool || !isImageRecognitionMcpTool(tool)) return args;

    const nextArgs = { ...args };
    const imageKeys = ["image", "imageUrl", "image_url", "mcp_result"];
    for (const key of imageKeys) {
      const attachment = findImageAttachmentReference(nextArgs[key]);
      if (!attachment?.dataUrl) continue;
      nextArgs[key] = attachment.dataUrl;
      if (key !== "image" && tool.originalName === "describe_image") {
        nextArgs.image = attachment.dataUrl;
        delete nextArgs.imageUrl;
        delete nextArgs.image_url;
      }
      return nextArgs;
    }

    if (
      tool.originalName === "describe_image" &&
      nextArgs.image === undefined &&
      (nextArgs.imageUrl !== undefined || nextArgs.image_url !== undefined)
    ) {
      nextArgs.image = nextArgs.imageUrl ?? nextArgs.image_url;
      delete nextArgs.imageUrl;
      delete nextArgs.image_url;
    }

    return nextArgs;
  };

  const describeImageAttachmentsWithMcp = async (
    imageTool: McpToolDefinition,
    attachments: ChatAttachment[],
    prompt: string,
  ) => {
    const imageAttachments = attachments.filter((attachment) =>
      attachment.type.startsWith("image/") && attachment.dataUrl,
    );
    if (imageAttachments.length === 0) return "";

    const results: string[] = [];
    const visualObservationPrompt = [
      "请按用户问题提取图片中的视觉信息，并尽量客观描述可见内容。",
      prompt ? `用户问题：${prompt}` : "",
    ].filter(Boolean).join("\n");

    for (let index = 0; index < imageAttachments.length; index += 1) {
      const attachment = imageAttachments[index];
      if (!attachment.dataUrl) continue;

      try {
        setChatStatus({
          status: "loading",
          message: `正在用图像识别 MCP 分析图片 ${index + 1}/${imageAttachments.length}...`,
        });
        const toolArguments = {
          [imageTool.originalName === "describe_image" ? "image" : "imageUrl"]: attachment.id,
          prompt: visualObservationPrompt,
        };
        appendAssistantTimelineMessage(
          setChatMessages,
          [
            `执行 MCP 工具：${imageTool.serverName}/${imageTool.originalName}`,
            `参数：${compactOneLine(JSON.stringify({
              ...toolArguments,
              image: toolArguments.image ? attachment.name : undefined,
              imageUrl: toolArguments.imageUrl ? attachment.name : undefined,
            }), 220)}`,
          ].join("\n"),
        );
        const imageArgumentKey = imageTool.originalName === "describe_image" ? "image" : "imageUrl";
        const result = await executeMcpTool(
          imageTool.function.name,
          JSON.stringify({
            [imageArgumentKey]: attachment.dataUrl,
            prompt: visualObservationPrompt,
          }),
        );
        const text = extractImageRecognitionText(result);
        appendAssistantTimelineMessage(
          setChatMessages,
          [
            "MCP 工具执行完成。",
            `图片：${attachment.name}`,
            text ? `识别结果：\n${trimBlock(text, 900)}` : "识别结果：图像识别 MCP 没有返回文本结果。",
          ].join("\n"),
        );
        const failed = /^error describing the image:/i.test(text);
        results.push(
          [
            `图片 ${index + 1}: ${attachment.name}`,
            text || "图像识别 MCP 没有返回文本结果。",
            failed
              ? "处理要求：图像识别服务连接失败。请直接向用户说明需要检查 LM Studio Local Server、端口和模型配置；不要调用 local_transfer_attachment_file 或其他文件传输工具作为替代。"
              : "",
          ].join("\n"),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "图像识别 MCP 调用失败";
        appendAssistantTimelineMessage(
          setChatMessages,
          [
            `MCP 工具失败：${imageTool.serverName}/${imageTool.originalName}`,
            `图片：${attachment.name}`,
            message,
          ].join("\n"),
        );
        results.push(
          [
            `图片 ${index + 1}: ${attachment.name}`,
            `识别失败：${message}`,
            "处理要求：请直接向用户说明图像识别 MCP 调用失败；不要调用 local_transfer_attachment_file 或其他文件传输工具作为替代。",
          ].join("\n"),
        );
      }
    }

    if (results.length === 0) return "";
    return ["【图像识别 MCP 结果】", ...results].join("\n\n");
  };

  const getAvailableChatToolDefinitions = (
    mcpToolsForRequest: McpToolDefinition[],
    includeHeartbeatTools = false,
    suppressAttachmentTransferTool = false,
    includeMultiAgentControlTools = false,
  ) => {
    const localToolsBase =
      localToolsEnabled && localWorkspaceHandle
        ? getAvailableLocalToolDefinitions(localWorkspaceHandle)
        : [];
    const localTools = suppressAttachmentTransferTool
      ? localToolsBase.filter((tool) => tool.function.name !== "local_transfer_attachment_file")
      : localToolsBase;
    const externalTools = mcpToolsForRequest.map((tool) => ({
      type: "function" as const,
      function: tool.function,
    }));
    return [
      ...localTools,
      ...externalTools,
      ...(includeHeartbeatTools ? heartbeatToolDefinitions : []),
      ...(includeMultiAgentControlTools ? multiAgentControlToolDefinitions : []),
    ];
  };

  const executeChatCommandBlock = async (content: string) => {
    if (!localWorkspaceHandle || !localToolsEnabled) {
      setChatStatus({ status: "error", message: "请先选择工作区，才能执行命令。" });
      return;
    }

    if (localWorkspaceHandle.kind !== "electron") {
      setChatStatus({ status: "error", message: "命令执行只支持 Electron 桌面版。" });
      return;
    }

    const commands = getExecutableLines(content);
    if (commands.length === 0 || commands.some((command) => !isRunnableCommandLine(command))) {
      setChatStatus({ status: "error", message: "该代码块包含不可执行或非白名单命令。" });
      return;
    }

    setChatStatus({ status: "loading", message: `正在执行 ${commands.length} 条命令...` });

    for (const command of commands) {
      const toolCall: ChatToolCall = {
        id: crypto.randomUUID(),
        type: "function",
        function: {
          name: "local_run_command",
          arguments: JSON.stringify({ command, timeoutMs: 120000 }),
        },
      };

      appendAssistantTimelineMessage(
        setChatMessages,
        formatToolActionMessage(toolCall, localWorkspaceHandle),
      );

      try {
              const toolResult = await executeLocalFileTool(
                toolCall.function.name,
                toolCall.function.arguments,
              );
              const toolResultAttachments = getToolResultAttachments(toolResult);
              appendAssistantTimelineMessage(
                setChatMessages,
                formatToolResultMessage(toolCall, toolResult),
                toolResultAttachments,
              );
      } catch (error) {
        appendAssistantTimelineMessage(
          setChatMessages,
          formatToolErrorMessage(toolCall, error),
        );
      }
    }

    setChatStatus({ status: "success", message: "命令块执行完成。" });
  };

  const renderToolProgressBlock = (block: ChatToolProgressBlock, messageId: string) => {
    const linkLabels = new Set(block.links.map((link) => stripMarkdownLinks(link.label).trim()));
    const summaryPath = block.links[0]?.label;
    const visibleDetails = block.details.filter((detail) => {
      const normalizedDetail = stripMarkdownLinks(detail).trim();
      if (!normalizedDetail) return false;
      if (linkLabels.has(normalizedDetail)) return false;
      if (normalizedDetail.startsWith("-> ") && linkLabels.has(normalizedDetail.slice(3).trim())) {
        return false;
      }
      return true;
    });

    return (
      <details className={`chat-tool-card ${block.variant}`}>
        <summary className="chat-tool-card-header">
          <span className="chat-tool-icon">
            {block.variant === "success" ? (
              <Check size={14} />
            ) : block.variant === "error" ? (
              <X size={14} />
            ) : (
              <Wrench size={14} />
            )}
          </span>
          <strong>{block.title}</strong>
          {summaryPath && <span className="chat-tool-summary-path">{summaryPath}</span>}
          <span className="chat-tool-badge">{block.badge}</span>
          <ChevronDown className="chat-tool-chevron" size={15} />
        </summary>

        {block.links.length > 0 && (
          <div className="chat-tool-paths">
            {block.links.map((link, index) => {
              const copyValue = link.href ?? link.label;
              return (
                <span className="chat-tool-path" key={`${messageId}-tool-link-${index}`}>
                  {link.href ? (
                    <a href={link.href} rel="noreferrer" target="_blank" title={link.href}>
                      {link.label}
                    </a>
                  ) : (
                    <span title={link.label}>{link.label}</span>
                  )}
                  <button
                    type="button"
                    title="复制路径"
                    onClick={() => void copyChatCodeBlock(copyValue)}
                  >
                    <Copy size={12} />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {visibleDetails.length > 0 && (
          <div className="chat-tool-details">
            {visibleDetails.map((detail, index) => (
              <p key={`${messageId}-tool-detail-${index}`}>{renderInlineText(detail)}</p>
            ))}
          </div>
        )}
      </details>
    );
  };

  const renderToolRunGroup = (
    item: Extract<RenderedChatItem, { kind: "toolGroup" }>,
    messageId: string,
  ) => {
    const firstPath = item.blocks.find((block) => block.links.length > 0)?.links[0]?.label ?? "";
    const hasError = item.blocks.some((block) => block.variant === "error");
    const duration = formatProcessingDuration(item.startedAt, item.endedAt);
    const groupedAttachments = item.segments.flatMap(
      (segment) => segment.message.attachments ?? [],
    );

    return (
      <details className={`chat-tool-run ${hasError ? "error" : ""}`}>
        <summary className="chat-tool-run-header">
          <span className="chat-tool-run-icon">
            {hasError ? <X size={15} /> : <Wrench size={15} />}
          </span>
          <strong>已处理 {duration}</strong>
          {firstPath && <span className="chat-tool-run-path">{firstPath}</span>}
          <span className="chat-tool-run-badge">{item.blocks.length} 步</span>
          <ChevronDown className="chat-tool-run-chevron" size={16} />
        </summary>
        <div className="chat-tool-run-body">
          {item.blocks.map((block, index) =>
            renderToolProgressBlock(block, `${messageId}-tool-run-${index}`),
          )}
          {groupedAttachments.length > 0 && renderChatAttachments(groupedAttachments)}
        </div>
      </details>
    );
  };

  const renderChatReasoning = (reasoning: string | undefined, keyPrefix: string) => {
    const trimmedReasoning = reasoning?.trim();
    if (!chatReasoningVisible || !trimmedReasoning) return null;

    return (
      <details className="chat-reasoning" open>
        <summary className="chat-reasoning-header">
          <Sparkles size={14} />
          <strong>思维链</strong>
        </summary>
        <div className="chat-reasoning-body">
          {renderMarkdownBlocks(trimmedReasoning, `${keyPrefix}-reasoning`)}
        </div>
      </details>
    );
  };

  const renderChatContent = (
    content: string,
    messageId: string,
    sourceMessageId = messageId,
  ) => {
    const toolProgressBlock = parseToolProgressContent(content);
    if (toolProgressBlock) {
      return (
        <div className="chat-rendered-content">
          {renderToolProgressBlock(toolProgressBlock, messageId)}
        </div>
      );
    }

    const parts = parseChatContentParts(content);
    let htmlPreviewContext: HtmlPreviewContext | null = null;
    const getHtmlPreviewContext = () => {
      if (htmlPreviewContext) return htmlPreviewContext;
      const currentMessageIndex = chatMessages.findIndex(
        (message) => message.id === sourceMessageId,
      );
      htmlPreviewContext = {
        currentMessageIndex:
          currentMessageIndex >= 0 ? currentMessageIndex : Math.max(0, chatMessages.length - 1),
        messages: chatMessages.map((message) => ({
          role: message.role,
          content: message.content,
          variables: message.variables ?? {},
          extra: message.extra ?? {},
        })),
        chatVariables: activeChatSession?.scriptVariables ?? {},
        characterVariables: activeSessionRoleplayCard?.tavernVariables ?? {},
        globalVariables: tavernGlobalVariables,
        userName: userProfile.nickname.trim() || "用户",
        characterName: activeSessionRoleplayCard?.name || "Assistant",
        chatId: activeChatSession?.id ?? activeChatSessionId,
        chatInput,
      };
      return htmlPreviewContext;
    };

    return (
      <div className="chat-rendered-content">
        {parts.map((part, partIndex) => {
          if (part.type === "text") {
            if (chatHtmlRenderEnabled && looksLikeStandaloneRenderableHtml(part.content)) {
              const previewId = `${messageId}-html-text-${partIndex}`;
              return (
                <ChatHtmlPreview
                  content={part.content}
                  context={getHtmlPreviewContext()}
                  frameRegistry={htmlPreviewFrameRefs}
                  key={previewId}
                  messageId={sourceMessageId}
                  previewId={previewId}
                />
              );
            }

            return (
              <div className="chat-markdown" key={`${messageId}-text-${partIndex}`}>
                {renderMarkdownBlocks(part.content, `${messageId}-text-${partIndex}`)}
              </div>
            );
          }

          if (chatHtmlRenderEnabled && shouldRenderHtmlCodePart(part)) {
            const previewId = `${messageId}-html-${partIndex}`;
            return (
              <ChatHtmlPreview
                content={part.content}
                context={getHtmlPreviewContext()}
                frameRegistry={htmlPreviewFrameRefs}
                key={previewId}
                messageId={sourceMessageId}
                previewId={previewId}
              />
            );
          }

          const canExecute =
            part.executable &&
            localToolsEnabled &&
            localWorkspaceHandle?.kind === "electron" &&
            chatStatus.status !== "loading";

          return (
            <div
              className={`chat-code-block ${part.executable ? "executable" : ""}`}
              key={`${messageId}-code-${partIndex}`}
            >
              <div className="chat-code-toolbar">
                <span>{part.executable ? "shell" : part.language || "code"}</span>
                <div>
                  {part.executable && (
                    <button
                      type="button"
                      title={
                        canExecute
                          ? "执行命令"
                          : "需要 Electron 工作区授权且当前不能有任务执行中"
                      }
                      disabled={!canExecute}
                      onClick={() => void executeChatCommandBlock(part.content)}
                    >
                      <Play size={13} />
                      运行
                    </button>
                  )}
                  <button
                    type="button"
                    title="复制代码"
                    onClick={() => void copyChatCodeBlock(part.content)}
                  >
                    <Copy size={13} />
                    复制
                  </button>
                </div>
              </div>
              <pre><code>{part.content}</code></pre>
            </div>
          );
        })}
      </div>
    );
  };

  const renderChatAttachments = (attachments: ChatAttachment[]) => {
    if (attachments.length === 0) return null;

    return (
      <div className="chat-attachments">
        {attachments.map((attachment) => (
          <div className="chat-attachment-card" key={attachment.id}>
            {attachment.type.startsWith("image/") && attachment.dataUrl ? (
              <img src={attachment.dataUrl} alt={attachment.name} />
            ) : (
              <FileJson size={16} />
            )}
            <div>
              <strong title={attachment.name}>{attachment.name}</strong>
              <span>
                {attachment.type || "application/octet-stream"} · {formatFileSize(attachment.size)}
              </span>
            </div>
            {attachment.downloadUrl && (
              <a
                href={attachment.downloadUrl}
                download={attachment.name}
                title="下载文件"
              >
                <Download size={14} />
              </a>
            )}
          </div>
        ))}
      </div>
    );
  };

  const generateAssistantForMessages = async (
    nextMessages: ChatMessage[],
    requestSender: ChatSenderIdentity,
    options: {
      statusMessage?: string;
      streamingStatusMessage?: string;
      successMessage?: string;
      exposeHeartbeatTools?: boolean;
      responseMode?: "ai" | "persona" | "roleplay";
      responderPersona?: AgentPersona;
      requestProvider?: ModelProviderChannel;
      requestModelId?: string;
      multiAgentPersonaIds?: string[];
      multiAgentIndex?: number;
      multiAgentRound?: number;
      multiAgentRounds?: number;
      multiAgentAutoStopEnabled?: boolean;
      multiAgentStopCondition?: string;
    } = {},
  ) => {
    const responseMode =
      options.responseMode ??
      (chatMode === "ai" ? "ai" : chatMode === "roleplay" ? "roleplay" : "persona");
    const responderPersona = options.responderPersona ?? chatPersona;
    const responderCharacterCard =
      responseMode === "roleplay" ? activeSessionRoleplayCard : undefined;
    const responderName = responderCharacterCard?.name ?? responderPersona?.name ?? "AI";
    const assistantSender: ChatSenderIdentity | undefined =
      responseMode === "persona" && responderPersona
        ? { kind: "persona", personaId: responderPersona.id }
        : undefined;
    activeUserRequestTextRef.current =
      [...nextMessages].reverse().find((message) => message.role === "user")?.content ?? "";
    const requestProvider = options.requestProvider ?? chatProvider;
    const requestModelId =
      options.requestModelId?.trim() || getEffectiveProviderModelId(requestProvider);
    const isImageGenerationRequest = isImageGenerationModelId(requestModelId);
    if (!requestProvider?.apiBaseUrl || !requestModelId) {
      setChatStatus({
        status: "error",
        message: "先在设置里填写供应商 API 地址和模型 ID。",
      });
      return null;
    }

    const abortController = beginChatGeneration();
    const abortSignal = abortController.signal;
    let assistantMessageId = "";
    let streamingAssistantInserted = false;

    try {
      setChatStatus({ status: "loading", message: options.statusMessage ?? "正在重新生成回复..." });
      const requestMcpTools =
        enabledMcpServers.length > 0 ? await refreshMcpTools({ silent: true }) : [];
      throwIfChatAborted(abortSignal);
      const imageRecognitionMcpTool = findImageRecognitionMcpTool(requestMcpTools);
      const hasImageRecognitionMcp = Boolean(imageRecognitionMcpTool);
      const latestImageUserMessage = [...nextMessages]
        .reverse()
        .find((message) =>
          message.role === "user" &&
          (message.attachments ?? []).some((attachment) =>
            attachment.type.startsWith("image/") && attachment.dataUrl,
          ),
        );
      const useImageRecognitionMcp = shouldUseImageRecognitionMcpForAttachments(
        latestImageUserMessage?.attachments ?? [],
        imageRecognitionMcpTool,
      );
      const sendImageAttachmentsToProvider =
        isImageGenerationRequest ||
        (!useImageRecognitionMcp && canProviderReceiveImageUrl(requestProvider, requestModelId));
      const availableChatTools = isImageGenerationRequest
        ? []
        : getAvailableChatToolDefinitions(
            requestMcpTools,
            options.exposeHeartbeatTools,
            false,
            options.multiAgentAutoStopEnabled === true,
          );
      let messagesForApi = nextMessages;
      if (useImageRecognitionMcp && imageRecognitionMcpTool && latestImageUserMessage) {
        const imageRecognitionContext = await describeImageAttachmentsWithMcp(
          imageRecognitionMcpTool,
          latestImageUserMessage.attachments ?? [],
          latestImageUserMessage.content,
        );
        throwIfChatAborted(abortSignal);
        if (imageRecognitionContext) {
          messagesForApi = nextMessages.map((message) =>
            message.id === latestImageUserMessage.id
              ? {
                  ...message,
                  content: [message.content, imageRecognitionContext].filter(Boolean).join("\n\n"),
                }
              : message,
          );
        }
      }
      const selectedSystemPrompt = selectedSystemPrompts
        .map((promptProfile) => promptProfile.content.trim())
        .filter(Boolean)
        .join("\n\n");
      const skillSystemPrompt = await loadEnabledSkillPrompt();
      throwIfChatAborted(abortSignal);
      const userProfileSystemPrompt =
        requestSender.kind === "user" &&
        userProfile.sendToAi &&
        (userProfile.nickname.trim() || userProfile.bio.trim())
          ? [
              "当前用户资料：",
              userProfile.nickname.trim() ? `- 昵称：${userProfile.nickname.trim()}` : "",
              userProfile.bio.trim() ? `- 简介：${userProfile.bio.trim()}` : "",
            ]
              .filter(Boolean)
              .join("\n")
          : "";
      const personaSystemPrompt =
        responseMode === "persona" && responderPersona
          ? buildPersonaPrompt(responderPersona)
          : "";
      const roleplaySystemPrompt =
        responderCharacterCard
          ? buildCharacterCardPrompt(
              responderCharacterCard,
              userProfile.nickname.trim() || "用户",
            )
          : "";
      const personaMemoryPrompt =
        responseMode === "persona"
          ? buildPersonaMemoryPrompt(
              chatSessions,
              activeChatSessionId,
              responderPersona,
              personas,
              userProfile,
            )
          : "";
      const chatSenderContextPrompt =
        responseMode === "persona"
          ? buildChatSenderContextPrompt(nextMessages, personas, responderPersona)
          : buildChatSenderContextPrompt(nextMessages, personas);
      const multiAgentSystemPrompt =
        responderPersona && options.multiAgentPersonaIds && options.multiAgentPersonaIds.length > 1
          ? [
              "你正在参加一场多 Agent 顺序对话。每个 Agent 都会通过独立请求依次回复。",
              `本轮轮到你以「${responderPersona.name}」的身份回复；只输出你自己的回复，不要替其他 Agent 代答。`,
              `回复顺序：${options.multiAgentPersonaIds
                .map((personaId, index) => {
                  const persona = personas.find((item) => item.id === personaId);
                  return `${index + 1}. ${persona?.name ?? "未知 Agent"}`;
                })
                .join(" → ")}`,
              "历史 assistant 消息通过 Chat API 的 name 字段标识发言 Agent；name 只是隐藏身份元数据，不属于消息正文。",
              `Agent name 映射：${options.multiAgentPersonaIds
                .map((personaId) => {
                  const persona = personas.find((item) => item.id === personaId);
                  return `${getAgentApiName(personaId)}=${persona?.name ?? "未知 Agent"}`;
                })
                .join("；")}`,
              `当前是第 ${(options.multiAgentRound ?? 0) + 1}/${options.multiAgentRounds ?? 1} 轮、第 ${(options.multiAgentIndex ?? 0) + 1} 位 Agent。请阅读带 name 身份元数据的历史 assistant 消息，再从你自己的人格、观点和职责出发继续回应用户。`,
              options.multiAgentAutoStopEnabled
                ? [
                    `用户授予你提前结束所有剩余轮次的权限。结束时机：${options.multiAgentStopCondition?.trim() || "当你判断当前讨论已经自然完成、继续轮次不会产生新的有效信息时"}`,
                    "如果并且只有当你根据当前完整对话判断结束时机已经明确到达时，调用 multi_agent_end_rounds，并在 reason 中说明判断原因；尚未到达时不要调用。",
                    "调用后仍要完成你当前这一轮自己的正常回复，系统会在当前回复结束后停止后面的 Agent 和轮次。",
                    "这是静默的内部调度控制。不要在用户可见回复中提及申请权限、调用工具、提前结束、停止轮次、reason、evidence、判断原因或判断依据；只输出你当前正常的业务回复。",
                  ].join("\n")
                : "",
            ].join("\n")
          : "";
      const toolSystemPrompt =
        localToolsEnabled && localWorkspaceHandle
          ? buildLocalToolsSystemPrompt(localWorkspaceHandle)
          : "";
      const mcpToolsSystemPrompt = buildMcpToolsSystemPrompt(requestMcpTools);
      const heartbeatSystemPrompt = options.exposeHeartbeatTools
        ? buildHeartbeatSystemPrompt(activeChatSession?.heartbeat)
        : "";
      const worldBookSystemPrompt = buildWorldBookPrompt(
        worldBooks,
        activeWorldBookIds,
        messagesForApi.map((message) => ({ role: message.role, content: message.content })),
        {
          userName: userProfile.nickname,
          characterName: responderName,
        },
      );
      const responderCharacterWorldBook = responderCharacterCard
        ? resolveCharacterWorldBook(responderCharacterCard, worldBooks)
        : null;
      const characterWorldBookSystemPrompt =
        responderCharacterCard &&
        responderCharacterWorldBook &&
        !activeWorldBookIds.includes(responderCharacterWorldBook.id)
          ? buildWorldBookPrompt(
              [responderCharacterWorldBook],
              [responderCharacterWorldBook.id],
              messagesForApi.map((message) => ({
                role: message.role,
                content: message.content,
              })),
              {
                userName: userProfile.nickname,
                characterName: responderCharacterCard.name,
              },
            )
          : "";
      const systemPrompt = [
        selectedSystemPrompt,
        skillSystemPrompt,
        userProfileSystemPrompt,
        personaSystemPrompt,
        roleplaySystemPrompt,
        personaMemoryPrompt,
        chatSenderContextPrompt,
        multiAgentSystemPrompt,
        worldBookSystemPrompt,
        characterWorldBookSystemPrompt,
        toolSystemPrompt,
        mcpToolsSystemPrompt,
        heartbeatSystemPrompt,
      ]
        .filter(Boolean)
        .join("\n\n");
      const apiMessages = applyPromptRegexToApiMessages(composeChatApiMessages(
        systemPrompt,
        messagesForApi.map((message) =>
          buildChatMessageForApi(
            message,
            personas,
            userProfile,
            responseMode === "persona" ? responderPersona : undefined,
            {
            sendImageAttachmentsToProvider,
            hasImageRecognitionMcp,
            },
          ),
        ),
        responseMode === "persona" ? responderPersona : undefined,
        responderCharacterCard
          ? {
              name: responderCharacterCard.name,
              description: roleplaySystemPrompt,
            }
          : undefined,
      ), responderName);
      // 图生图：发图片模型前，自动把最近一张已生成图作为参考图挂到最后一条 user 消息上
      {
        const withRef = await maybeAttachReferenceImageForImageModel(apiMessages, requestModelId);
        throwIfChatAborted(abortSignal);
        if (withRef !== apiMessages) {
          apiMessages.splice(0, apiMessages.length, ...withRef);
        }
      }
      let assistantContent = "";
      let assistantReasoning = "";
      let hasVisibleToolResult = false;
      let pendingMcpObservationPrompt = "";
      let pendingMcpObservationRetries = 0;
      let pendingMcpObservationPromptSent = false;
      assistantMessageId = crypto.randomUUID();
      const requestChatCompletion = async (messages: ChatApiMessage[], options: {
        includeTools: boolean;
        stream: boolean;
        toolChoice?: "auto";
        onDelta?: (delta: string) => void;
        onReasoningDelta?: (delta: string) => void;
      }) => {
        throwIfChatAborted(abortSignal);
        const response = await fetch("/api/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: abortSignal,
          body: JSON.stringify({
            apiBaseUrl: trimTrailingSlash(requestProvider.apiBaseUrl),
            apiKey: requestProvider.apiKey,
            sessionId: activeChatSessionId,
            request: {
              model: requestModelId,
              messages,
              ...(options.includeTools
                ? {
                    tools: availableChatTools,
                    tool_choice: options.toolChoice ?? "auto",
                  }
                : {}),
              ...(activeChatPresetRequestParameters ?? {
                temperature: responseMode === "persona" ? 0.72 : 0.6,
              }),
              ...buildProviderReasoningRequest(requestProvider),
              stream: options.stream,
            },
          }),
        });

        if (options.stream) {
          const streamResult = await readChatStream(
            response,
            options.onDelta ?? (() => undefined),
            options.onReasoningDelta ?? (() => undefined),
            abortSignal,
          );
          return {
            payload: null,
            content: streamResult.content,
            reasoning: streamResult.reasoning,
          };
        }

        throwIfChatAborted(abortSignal);
        const payload = (await response.json()) as {
          error?: string | { message?: string };
          choices?: Array<{ message?: ChatApiMessage }>;
          output_text?: string;
        };
        throwIfChatAborted(abortSignal);
        if (!response.ok) {
          const errorMessage =
            typeof payload.error === "string" ? payload.error : payload.error?.message;
          throw new Error(errorMessage ? `请求失败：${response.status} ${errorMessage}` : `请求失败：${response.status}`);
        }

        return {
          payload,
          content: "",
          reasoning: getChatCompletionPayloadReasoning(payload),
        };
      };
      const appendStreamingAssistant = (delta: string) => {
        setChatMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: `${message.content}${delta}` }
              : message,
          ),
        );
      };
      const appendStreamingAssistantReasoning = (delta: string) => {
        assistantReasoning = `${assistantReasoning}${delta}`;
        setChatMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? { ...message, reasoning: `${message.reasoning ?? ""}${delta}` }
              : message,
          ),
        );
      };

      if (isImageGenerationRequest) {
        setChatStatus({
          status: "loading",
          message: "正在生成图片...",
        });
        const { payload, reasoning } = await requestChatCompletion(apiMessages, {
          includeTools: false,
          stream: false,
        });
        const assistantMessage = payload?.choices?.[0]?.message;
        assistantReasoning =
          getChatApiMessageReasoning(assistantMessage) || reasoning || assistantReasoning;
        assistantContent =
          getChatApiMessageText(assistantMessage).trim() || payload?.output_text?.trim() || "";
      } else if (chatStreamEnabled && availableChatTools.length === 0) {
        setChatMessages((current) => [
          ...current,
          {
            id: assistantMessageId,
            role: "assistant",
            content: "",
            ...(assistantSender ? { sender: assistantSender } : {}),
            createdAt: new Date().toISOString(),
          },
        ]);
        streamingAssistantInserted = true;
        setChatStatus({
          status: "loading",
          message: options.streamingStatusMessage ?? "正在流式生成回复...",
        });
        const streamResult = await requestChatCompletion(apiMessages, {
          includeTools: false,
          stream: true,
          onDelta: appendStreamingAssistant,
          onReasoningDelta: appendStreamingAssistantReasoning,
        });
        assistantContent = streamResult.content;
        assistantReasoning = streamResult.reasoning || assistantReasoning;
      } else {
        for (let toolRound = 0; toolRound < 99; toolRound += 1) {
          setChatStatus({
            status: "loading",
            message: `正在推进工具任务，第 ${toolRound + 1} 轮...`,
          });
          if (pendingMcpObservationPrompt && !pendingMcpObservationPromptSent) {
            apiMessages.push({
              role: "user",
              content: pendingMcpObservationPrompt,
            });
            pendingMcpObservationPromptSent = true;
          }
          const { payload, reasoning } = await requestChatCompletion(apiMessages, {
            includeTools: availableChatTools.length > 0,
            stream: false,
            toolChoice: "auto",
          });
          throwIfChatAborted(abortSignal);

          const assistantMessage = payload?.choices?.[0]?.message;
          const toolCalls = assistantMessage?.tool_calls ?? [];
          const hasSilentControlTool = toolCalls.some((toolCall) =>
            isSilentChatControlTool(toolCall.function.name),
          );
          const assistantMessageContent = getChatApiMessageText(assistantMessage).trim();
          const assistantMessageReasoning =
            getChatApiMessageReasoning(assistantMessage) || reasoning || "";
          if (hasSilentControlTool) {
            assistantContent = "";
            assistantReasoning = "";
          } else {
            assistantContent =
              assistantMessageContent || payload?.output_text?.trim() || assistantContent;
            if (assistantMessageReasoning) assistantReasoning = assistantMessageReasoning;
          }

          if (toolCalls.length === 0) {
            if (pendingMcpObservationPrompt && pendingMcpObservationRetries < 2 && toolRound < 98) {
              apiMessages.push({
                role: "assistant",
                content: assistantContent || "",
              });
              apiMessages.push({
                role: "user",
                content: pendingMcpObservationPrompt,
              });
              pendingMcpObservationRetries += 1;
              pendingMcpObservationPromptSent = true;
              assistantContent = "";
              assistantReasoning = "";
              continue;
            }

            if (
              localToolsEnabled &&
              localWorkspaceHandle &&
              toolRound < 98 &&
              shouldAutoContinueLocalTask(assistantContent)
            ) {
              appendAssistantTimelineMessage(
                setChatMessages,
                assistantContent,
                [],
                assistantReasoning,
                assistantSender,
              );
              apiMessages.push({
                role: "assistant",
                content: assistantContent,
              });
              apiMessages.push({
                role: "user",
                content:
                  "继续执行上面的任务，直接调用可用工具推进，直到任务完成、遇到真实阻塞或需要用户授权。不要只说明计划。",
              });
              assistantContent = "";
              assistantReasoning = "";
              continue;
            }

            break;
          }

          if (assistantMessageContent && !hasSilentControlTool) {
            appendAssistantTimelineMessage(
              setChatMessages,
              assistantMessageContent,
              [],
              assistantMessageReasoning,
              assistantSender,
            );
          }

          apiMessages.push({
            role: "assistant",
            content: hasSilentControlTool ? null : assistantMessageContent || null,
            tool_calls: toolCalls,
          });
          setChatStatus({
            status: "loading",
            message: hasSilentControlTool
              ? "正在继续当前回复..."
              : `正在执行 ${toolCalls.length} 个工具...`,
          });

          for (const toolCall of toolCalls) {
            throwIfChatAborted(abortSignal);
            const silentControl = isSilentChatControlTool(toolCall.function.name);
            if (!silentControl) {
              appendAssistantTimelineMessage(
                setChatMessages,
                formatToolActionMessage(toolCall, localWorkspaceHandle, requestMcpTools),
                [],
                "",
                assistantSender,
              );
            }
            try {
              const toolResult = await executeChatTool(
                toolCall.function.name,
                toolCall.function.arguments,
              );
              throwIfChatAborted(abortSignal);
              if (needsChromeDevtoolsObservation(toolCall, requestMcpTools)) {
                pendingMcpObservationPrompt = buildChromeDevtoolsObservationPrompt(requestMcpTools);
                pendingMcpObservationRetries = 0;
                pendingMcpObservationPromptSent = false;
              }
              if (isChromeDevtoolsObservation(toolCall, requestMcpTools)) {
                pendingMcpObservationPrompt = "";
                pendingMcpObservationRetries = 0;
                pendingMcpObservationPromptSent = false;
              }
              if (!silentControl) {
                const toolResultMessage = formatToolResultMessage(toolCall, toolResult);
                const toolResultAttachments = getToolResultAttachments(toolResult);
                appendAssistantTimelineMessage(
                  setChatMessages,
                  toolResultMessage,
                  toolResultAttachments,
                  "",
                  assistantSender,
                );
                if (toolResultMessage.trim() || toolResultAttachments.length > 0) {
                  hasVisibleToolResult = true;
                }
              }
              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: formatToolResultForApi(toolResult, toolCall.function.name),
              });
              const visionMessage = sendImageAttachmentsToProvider
                ? getToolResultVisionMessage(toolCall, toolResult)
                : null;
              if (visionMessage) apiMessages.push(visionMessage);
            } catch (toolError) {
              if (isChatAbortError(toolError)) throw toolError;
              const toolErrorResult = {
                error: toolError instanceof Error ? toolError.message : "工具执行失败",
              };
              if (!silentControl) {
                appendAssistantTimelineMessage(
                  setChatMessages,
                  formatToolErrorMessage(toolCall, toolError),
                  [],
                  "",
                  assistantSender,
                );
                hasVisibleToolResult = true;
              }
              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: silentControl
                  ? JSON.stringify({
                      ended: false,
                      instruction:
                        "这是静默内部控制。继续完成当前正常回复，不要向用户提及工具、权限、提前结束、停止轮次、错误、原因或依据。",
                    })
                  : JSON.stringify(toolErrorResult),
              });
            }
          }

        }
      }

      throwIfChatAborted(abortSignal);
      if (!assistantContent) {
        if (hasVisibleToolResult) {
          setChatStatus({ status: "success", message: options.successMessage ?? "工具执行完成。" });
          return null;
        }
        throw new Error("响应里没有可显示的回复内容。");
      }

      const finalAssistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: assistantContent,
        ...(assistantReasoning.trim() ? { reasoning: assistantReasoning.trim() } : {}),
        ...(assistantSender ? { sender: assistantSender } : {}),
        createdAt: new Date().toISOString(),
      };

      if (streamingAssistantInserted) {
        setChatMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  ...finalAssistantMessage,
                }
              : message,
          ),
        );
      }

      if (!streamingAssistantInserted) {
        setChatMessages((current) => {
          if (current.some((message) => message.id === assistantMessageId)) return current;
          return [
            ...current,
            finalAssistantMessage,
          ];
        });
      }
      setChatStatus({ status: "success", message: options.successMessage ?? "回复已重新生成。" });
      emitTavernMessageEvent(TAVERN_EVENTS.MESSAGE_RECEIVED, finalAssistantMessage.id);
      return finalAssistantMessage;
    } catch (error) {
      if (isChatAbortError(error)) {
        if (streamingAssistantInserted && assistantMessageId) {
          setChatMessages((current) =>
            current.filter(
              (message) => message.id !== assistantMessageId || message.content.trim(),
            ),
          );
        }
        setChatStatus({ status: "success", message: "已停止输出。" });
        return null;
      }

      const message = error instanceof Error ? error.message : "调用失败。";
      setChatMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `调用失败：${message}`,
          ...(assistantSender ? { sender: assistantSender } : {}),
          createdAt: new Date().toISOString(),
        },
      ]);
      setChatStatus({
        status: "error",
        message: "调用失败。请检查本地服务、供应商地址、密钥、模型 ID 或上游限流状态。",
      });
      return null;
    } finally {
      finishChatGeneration(abortController);
    }
  };

  const handleChatAttachmentChange = async (files: FileList | null) => {
    const selectedFiles = Array.from(files ?? []);
    if (chatAttachmentInputRef.current) {
      chatAttachmentInputRef.current.value = "";
    }
    if (selectedFiles.length === 0) return;

    setChatStatus({ status: "loading", message: "正在读取附件..." });
    try {
      const nextAttachments = await Promise.all(
        selectedFiles.map((file) => createChatAttachmentFromFile(file)),
      );
      nextAttachments.forEach((attachment, index) => {
        const file = selectedFiles[index];
        if (file) chatAttachmentFilesRef.current.set(attachment.id, file);
        chatAttachmentMetadataRef.current.set(attachment.id, attachment);
      });
      setChatAttachments((current) => [...current, ...nextAttachments]);
      setChatStatus({
        status: "success",
        message: `已添加 ${selectedFiles.length} 个附件。`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "附件读取失败。";
      setChatStatus({ status: "error", message });
    }
  };

  const removeChatAttachment = (attachmentId: string) => {
    chatAttachmentFilesRef.current.delete(attachmentId);
    chatAttachmentMetadataRef.current.delete(attachmentId);
    setChatAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId),
    );
  };

  const getMultiAgentConfigurationError = () => {
    if (multiAgentPersonas.length < 2) {
      return "多 Agent 模式至少需要按顺序选择 2 个 Agent。";
    }

    for (const persona of multiAgentPersonas) {
      const { provider, modelId } = getMultiAgentRequestConfig(persona.id);
      if (!provider?.apiBaseUrl || !modelId) {
        return `请为 ${persona.name} 选择已配置 API 地址和模型的供应商。`;
      }
    }

    return "";
  };

  const runMultiAgentResponses = async (
    initialMessages: ChatMessage[],
    requestSender: ChatSenderIdentity,
    triggerContent: string,
  ) => {
    const configurationError = getMultiAgentConfigurationError();
    if (configurationError) {
      setChatStatus({ status: "error", message: configurationError });
      return false;
    }

    pendingMultiAgentEndRef.current = null;
    let accumulatedMessages = initialMessages;
    const totalReplies = multiAgentPersonas.length * multiAgentRounds;

    for (let roundIndex = 0; roundIndex < multiAgentRounds; roundIndex += 1) {
      for (let index = 0; index < multiAgentPersonas.length; index += 1) {
        const responderPersona = multiAgentPersonas[index];
        const { provider, modelId } = getMultiAgentRequestConfig(responderPersona.id);
        const completedBefore = roundIndex * multiAgentPersonas.length + index;
        const sequenceLabel = `${completedBefore + 1}/${totalReplies}`;
        const roundLabel = `${roundIndex + 1}/${multiAgentRounds}`;
        const assistantMessage = await generateAssistantForMessages(
          accumulatedMessages,
          requestSender,
          {
            responseMode: "persona",
            responderPersona,
            requestProvider: provider,
            requestModelId: modelId,
            multiAgentPersonaIds,
            multiAgentIndex: index,
            multiAgentRound: roundIndex,
            multiAgentRounds,
            multiAgentAutoStopEnabled,
            multiAgentStopCondition,
            exposeHeartbeatTools:
              completedBefore === totalReplies - 1 &&
              shouldExposeHeartbeatTools(triggerContent),
            statusMessage: `正在请求 ${responderPersona.name}（第 ${roundLabel} 轮，${sequenceLabel}）...`,
            streamingStatusMessage: `${responderPersona.name} 正在回复（第 ${roundLabel} 轮，${sequenceLabel}）...`,
            successMessage: `${responderPersona.name} 已完成回复（${sequenceLabel}）。`,
          },
        );

        if (!assistantMessage) {
          pendingMultiAgentEndRef.current = null;
          return false;
        }
        accumulatedMessages = [...accumulatedMessages, assistantMessage];
        const earlyEndRequest = pendingMultiAgentEndRef.current as {
          reason: string;
          evidence: string;
        } | null;
        if (earlyEndRequest) {
          pendingMultiAgentEndRef.current = null;
          setChatStatus({
            status: "success",
            message: "多 Agent 对话已结束。",
          });
          return true;
        }
      }
    }

    pendingMultiAgentEndRef.current = null;
    setChatStatus({
      status: "success",
      message: `${multiAgentPersonas.length} 个 Agent 已完成 ${multiAgentRounds} 轮、共 ${totalReplies} 次回复。`,
    });
    return true;
  };

  const sendMultiAgentMessage = async (
    content: string,
    attachmentsToSend: ChatAttachment[],
  ) => {
    const configurationError = getMultiAgentConfigurationError();
    if (configurationError) {
      setChatStatus({ status: "error", message: configurationError });
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      sender: currentChatSender,
      ...(attachmentsToSend.length > 0 ? { attachments: attachmentsToSend } : {}),
    };
    let accumulatedMessages = [...chatMessagesRef.current, userMessage];

    chatMessagesRef.current = accumulatedMessages;
    setChatMessages(accumulatedMessages);
    emitTavernMessageEvent(TAVERN_EVENTS.MESSAGE_SENT, userMessage.id);
    setChatInput("");
    setChatAttachments([]);
    activeUserRequestTextRef.current = content;
    await runMultiAgentResponses(accumulatedMessages, currentChatSender, content);
  };

  const sendChatMessage = async (
    contentOverride?: string,
    attachmentsOverride?: ChatAttachment[],
  ) => {
    const hasContentOverride = contentOverride !== undefined;
    const content = (hasContentOverride ? contentOverride : chatInput).trim();
    const attachmentsToSend =
      attachmentsOverride ?? (hasContentOverride ? [] : chatAttachments);
    if ((!content && attachmentsToSend.length === 0) || chatStatus.status === "loading") return;
    if (chatMode === "multi") {
      await sendMultiAgentMessage(content, attachmentsToSend);
      return;
    }
    if (chatMode === "roleplay" && !activeSessionRoleplayCard) {
      setChatStatus({
        status: "error",
        message: "请先选择角色卡，再开始角色扮演会话。",
      });
      return;
    }
    activeUserRequestTextRef.current = content;

    const requestModelId = getEffectiveProviderModelId(chatProvider);
    const isImageGenerationRequest = isImageGenerationModelId(requestModelId);
    if (!chatProvider?.apiBaseUrl || !requestModelId) {
      setChatStatus({
        status: "error",
        message: "先在设置里填写供应商 API 地址和模型 ID。",
      });
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      sender: currentChatSender,
      ...(attachmentsToSend.length > 0 ? { attachments: attachmentsToSend } : {}),
    };
    const nextMessages = [...chatMessagesRef.current, userMessage];

    chatMessagesRef.current = nextMessages;
    setChatMessages(nextMessages);
    emitTavernMessageEvent(TAVERN_EVENTS.MESSAGE_SENT, userMessage.id);
    setChatInput("");
    setChatAttachments([]);
    const abortController = beginChatGeneration();
    const abortSignal = abortController.signal;
    let assistantMessageId = "";
    let streamingAssistantInserted = false;

    try {
      setChatStatus({ status: "loading", message: "正在生成回复..." });
      const requestMcpTools =
        enabledMcpServers.length > 0 ? await refreshMcpTools({ silent: true }) : [];
      throwIfChatAborted(abortSignal);
      const imageRecognitionMcpTool = findImageRecognitionMcpTool(requestMcpTools);
      const hasImageRecognitionMcp = Boolean(imageRecognitionMcpTool);
      const useImageRecognitionMcp = shouldUseImageRecognitionMcpForAttachments(
        attachmentsToSend,
        imageRecognitionMcpTool,
      );
      const sendImageAttachmentsToProvider =
        isImageGenerationRequest ||
        (!useImageRecognitionMcp && canProviderReceiveImageUrl(chatProvider, requestModelId));
      const suppressAttachmentTransferTool = false;
      let messagesForApi = nextMessages;
      if (useImageRecognitionMcp && imageRecognitionMcpTool) {
        const imageRecognitionContext = await describeImageAttachmentsWithMcp(
          imageRecognitionMcpTool,
          attachmentsToSend,
          content,
        );
        throwIfChatAborted(abortSignal);
        if (imageRecognitionContext) {
          messagesForApi = nextMessages.map((message) =>
            message.id === userMessage.id
              ? {
                  ...message,
                  content: [message.content, imageRecognitionContext].filter(Boolean).join("\n\n"),
                }
              : message,
          );
        }
      }
      const exposeHeartbeatTools = shouldExposeHeartbeatTools(content);
      const availableChatTools = isImageGenerationRequest
        ? []
        : getAvailableChatToolDefinitions(
            requestMcpTools,
            exposeHeartbeatTools,
            suppressAttachmentTransferTool,
          );
      const selectedSystemPrompt = selectedSystemPrompts
        .map((promptProfile) => promptProfile.content.trim())
        .filter(Boolean)
        .join("\n\n");
      const skillSystemPrompt = await loadEnabledSkillPrompt();
      throwIfChatAborted(abortSignal);
      const userProfileSystemPrompt =
        currentChatSender.kind === "user" &&
        userProfile.sendToAi &&
        (userProfile.nickname.trim() || userProfile.bio.trim())
          ? [
              "当前用户资料：",
              userProfile.nickname.trim() ? `- 昵称：${userProfile.nickname.trim()}` : "",
              userProfile.bio.trim() ? `- 简介：${userProfile.bio.trim()}` : "",
            ]
              .filter(Boolean)
              .join("\n")
          : "";
      const personaSystemPrompt =
        chatMode === "persona" && chatPersona ? buildPersonaPrompt(chatPersona) : "";
      const roleplaySystemPrompt =
        chatMode === "roleplay" && activeSessionRoleplayCard
          ? buildCharacterCardPrompt(
              activeSessionRoleplayCard,
              userProfile.nickname.trim() || "用户",
            )
          : "";
      const personaMemoryPrompt =
        chatMode === "persona"
          ? buildPersonaMemoryPrompt(
              chatSessions,
              activeChatSessionId,
              chatPersona,
              personas,
              userProfile,
            )
          : "";
      const chatSenderContextPrompt =
        chatMode === "persona"
          ? buildChatSenderContextPrompt(nextMessages, personas, chatPersona)
          : buildChatSenderContextPrompt(nextMessages, personas);
      const toolSystemPrompt =
        localToolsEnabled && localWorkspaceHandle
          ? buildLocalToolsSystemPrompt(localWorkspaceHandle)
          : "";
      const mcpToolsSystemPrompt = buildMcpToolsSystemPrompt(requestMcpTools);
      const heartbeatSystemPrompt = exposeHeartbeatTools
        ? buildHeartbeatSystemPrompt(activeChatSession?.heartbeat)
        : "";
      const worldBookSystemPrompt = buildWorldBookPrompt(
        worldBooks,
        activeWorldBookIds,
        messagesForApi.map((message) => ({ role: message.role, content: message.content })),
        {
          userName: userProfile.nickname,
          characterName:
            chatMode === "roleplay" && activeSessionRoleplayCard
              ? activeSessionRoleplayCard.name
              : chatPersona.name,
        },
      );
      const activeCharacterWorldBook = activeSessionRoleplayCard
        ? resolveCharacterWorldBook(activeSessionRoleplayCard, worldBooks)
        : null;
      const characterWorldBookSystemPrompt =
        chatMode === "roleplay" &&
        activeSessionRoleplayCard &&
        activeCharacterWorldBook &&
        !activeWorldBookIds.includes(activeCharacterWorldBook.id)
          ? buildWorldBookPrompt(
              [activeCharacterWorldBook],
              [activeCharacterWorldBook.id],
              messagesForApi.map((message) => ({
                role: message.role,
                content: message.content,
              })),
              {
                userName: userProfile.nickname,
                characterName: activeSessionRoleplayCard.name,
              },
            )
          : "";
      const systemPrompt = [
        selectedSystemPrompt,
        skillSystemPrompt,
        userProfileSystemPrompt,
        personaSystemPrompt,
        roleplaySystemPrompt,
        personaMemoryPrompt,
        chatSenderContextPrompt,
        worldBookSystemPrompt,
        characterWorldBookSystemPrompt,
        toolSystemPrompt,
        mcpToolsSystemPrompt,
        heartbeatSystemPrompt,
      ]
        .filter(Boolean)
        .join("\n\n");
      const apiMessages = applyPromptRegexToApiMessages(composeChatApiMessages(
        systemPrompt,
        messagesForApi.map((message) =>
          buildChatMessageForApi(
            message,
            personas,
            userProfile,
            chatMode === "persona" ? chatPersona : undefined,
            {
              sendImageAttachmentsToProvider,
              hasImageRecognitionMcp,
            },
          ),
        ),
        chatMode === "persona" ? chatPersona : undefined,
        chatMode === "roleplay" && activeSessionRoleplayCard
          ? {
              name: activeSessionRoleplayCard.name,
              description: roleplaySystemPrompt,
            }
          : undefined,
      ), chatMode === "roleplay" && activeSessionRoleplayCard
        ? activeSessionRoleplayCard.name
        : chatPersona.name);
      // 图生图：发图片模型前，自动把最近一张已生成图作为参考图挂到最后一条 user 消息上
      {
        const withRef = await maybeAttachReferenceImageForImageModel(apiMessages, requestModelId);
        throwIfChatAborted(abortSignal);
        if (withRef !== apiMessages) {
          apiMessages.splice(0, apiMessages.length, ...withRef);
        }
      }
      let assistantContent = "";
      let assistantReasoning = "";
      let hasVisibleToolResult = false;
      let pendingMcpObservationPrompt = "";
      let pendingMcpObservationRetries = 0;
      let pendingMcpObservationPromptSent = false;
      assistantMessageId = crypto.randomUUID();
      const requestChatCompletion = async (messages: ChatApiMessage[], options: {
        includeTools: boolean;
        stream: boolean;
        toolChoice?: "auto";
        onDelta?: (delta: string) => void;
        onReasoningDelta?: (delta: string) => void;
      }) => {
        throwIfChatAborted(abortSignal);
        const response = await fetch("/api/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: abortSignal,
          body: JSON.stringify({
            apiBaseUrl: trimTrailingSlash(chatProvider.apiBaseUrl),
            apiKey: chatProvider.apiKey,
            sessionId: activeChatSessionId,
            request: {
              model: requestModelId,
              messages,
              ...(options.includeTools
                ? {
                    tools: availableChatTools,
                    tool_choice: options.toolChoice ?? "auto",
                  }
                : {}),
              ...(activeChatPresetRequestParameters ?? {
                temperature: chatMode === "persona" ? 0.72 : 0.6,
              }),
              ...buildProviderReasoningRequest(chatProvider),
              stream: options.stream,
            },
          }),
        });

        if (options.stream) {
          const streamResult = await readChatStream(
            response,
            options.onDelta ?? (() => undefined),
            options.onReasoningDelta ?? (() => undefined),
            abortSignal,
          );
          return {
            payload: null,
            content: streamResult.content,
            reasoning: streamResult.reasoning,
          };
        }

        throwIfChatAborted(abortSignal);
        const payload = (await response.json()) as {
          error?: string | { message?: string };
          choices?: Array<{ message?: ChatApiMessage }>;
          output_text?: string;
        };
        throwIfChatAborted(abortSignal);
        if (!response.ok) {
          const errorMessage =
            typeof payload.error === "string" ? payload.error : payload.error?.message;
          throw new Error(errorMessage ? `请求失败：${response.status} ${errorMessage}` : `请求失败：${response.status}`);
        }

        return {
          payload,
          content: "",
          reasoning: getChatCompletionPayloadReasoning(payload),
        };
      };
      const appendStreamingAssistant = (delta: string) => {
        setChatMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: `${message.content}${delta}` }
              : message,
          ),
        );
      };
      const appendStreamingAssistantReasoning = (delta: string) => {
        assistantReasoning = `${assistantReasoning}${delta}`;
        setChatMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? { ...message, reasoning: `${message.reasoning ?? ""}${delta}` }
              : message,
          ),
        );
      };

      if (isImageGenerationRequest) {
        setChatStatus({ status: "loading", message: "正在生成图片..." });
        const { payload, reasoning } = await requestChatCompletion(apiMessages, {
          includeTools: false,
          stream: false,
        });
        const assistantMessage = payload?.choices?.[0]?.message;
        assistantReasoning =
          getChatApiMessageReasoning(assistantMessage) || reasoning || assistantReasoning;
        assistantContent =
          getChatApiMessageText(assistantMessage).trim() || payload?.output_text?.trim() || "";
      } else if (chatStreamEnabled && availableChatTools.length === 0) {
        setChatMessages((current) => [
          ...current,
          {
            id: assistantMessageId,
            role: "assistant",
            content: "",
            createdAt: new Date().toISOString(),
          },
        ]);
        streamingAssistantInserted = true;
        setChatStatus({ status: "loading", message: "正在流式生成回复..." });
        const streamResult = await requestChatCompletion(apiMessages, {
          includeTools: false,
          stream: true,
          onDelta: appendStreamingAssistant,
          onReasoningDelta: appendStreamingAssistantReasoning,
        });
        assistantContent = streamResult.content;
        assistantReasoning = streamResult.reasoning || assistantReasoning;
      } else {
        for (let toolRound = 0; toolRound < 99; toolRound += 1) {
          setChatStatus({
            status: "loading",
            message: `正在推进工具任务，第 ${toolRound + 1} 轮...`,
          });
          if (pendingMcpObservationPrompt && !pendingMcpObservationPromptSent) {
            apiMessages.push({
              role: "user",
              content: pendingMcpObservationPrompt,
            });
            pendingMcpObservationPromptSent = true;
          }
          const { payload, reasoning } = await requestChatCompletion(apiMessages, {
            includeTools: availableChatTools.length > 0,
            stream: false,
            toolChoice: "auto",
          });
          throwIfChatAborted(abortSignal);

          const assistantMessage = payload?.choices?.[0]?.message;
          const toolCalls = assistantMessage?.tool_calls ?? [];
          const hasSilentControlTool = toolCalls.some((toolCall) =>
            isSilentChatControlTool(toolCall.function.name),
          );
          const assistantMessageContent = getChatApiMessageText(assistantMessage).trim();
          const assistantMessageReasoning =
            getChatApiMessageReasoning(assistantMessage) || reasoning || "";
          if (hasSilentControlTool) {
            assistantContent = "";
            assistantReasoning = "";
          } else {
            assistantContent =
              assistantMessageContent || payload?.output_text?.trim() || assistantContent;
            if (assistantMessageReasoning) assistantReasoning = assistantMessageReasoning;
          }

          if (toolCalls.length === 0) {
            if (pendingMcpObservationPrompt && pendingMcpObservationRetries < 2 && toolRound < 98) {
              apiMessages.push({
                role: "assistant",
                content: assistantContent || "",
              });
              apiMessages.push({
                role: "user",
                content: pendingMcpObservationPrompt,
              });
              pendingMcpObservationRetries += 1;
              pendingMcpObservationPromptSent = true;
              assistantContent = "";
              assistantReasoning = "";
              continue;
            }

            if (
              localToolsEnabled &&
              localWorkspaceHandle &&
              toolRound < 98 &&
              shouldAutoContinueLocalTask(assistantContent)
            ) {
              appendAssistantTimelineMessage(
                setChatMessages,
                assistantContent,
                [],
                assistantReasoning,
              );
              apiMessages.push({
                role: "assistant",
                content: assistantContent,
              });
              apiMessages.push({
                role: "user",
                content:
                  "继续执行上面的任务，直接调用可用工具推进，直到任务完成、遇到真实阻塞或需要用户授权。不要只说明计划。",
              });
              assistantContent = "";
              assistantReasoning = "";
              continue;
            }

            break;
          }

          if (assistantMessageContent && !hasSilentControlTool) {
            appendAssistantTimelineMessage(
              setChatMessages,
              assistantMessageContent,
              [],
              assistantMessageReasoning,
            );
          }

          apiMessages.push({
            role: "assistant",
            content: hasSilentControlTool ? null : assistantMessageContent || null,
            tool_calls: toolCalls,
          });
          setChatStatus({
            status: "loading",
            message: hasSilentControlTool
              ? "正在继续当前回复..."
              : `正在执行 ${toolCalls.length} 个工具...`,
          });

          for (const toolCall of toolCalls) {
            throwIfChatAborted(abortSignal);
            const silentControl = isSilentChatControlTool(toolCall.function.name);
            if (!silentControl) {
              appendAssistantTimelineMessage(
                setChatMessages,
                formatToolActionMessage(toolCall, localWorkspaceHandle, requestMcpTools),
              );
            }
            try {
              const toolResult = await executeChatTool(
                toolCall.function.name,
                toolCall.function.arguments,
              );
              throwIfChatAborted(abortSignal);
              if (needsChromeDevtoolsObservation(toolCall, requestMcpTools)) {
                pendingMcpObservationPrompt = buildChromeDevtoolsObservationPrompt(requestMcpTools);
                pendingMcpObservationRetries = 0;
                pendingMcpObservationPromptSent = false;
              }
              if (isChromeDevtoolsObservation(toolCall, requestMcpTools)) {
                pendingMcpObservationPrompt = "";
                pendingMcpObservationRetries = 0;
                pendingMcpObservationPromptSent = false;
              }
              if (!silentControl) {
                const toolResultMessage = formatToolResultMessage(toolCall, toolResult);
                const toolResultAttachments = getToolResultAttachments(toolResult);
                appendAssistantTimelineMessage(
                  setChatMessages,
                  toolResultMessage,
                  toolResultAttachments,
                );
                if (toolResultMessage.trim() || toolResultAttachments.length > 0) {
                  hasVisibleToolResult = true;
                }
              }
              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: formatToolResultForApi(toolResult, toolCall.function.name),
              });
              const visionMessage = sendImageAttachmentsToProvider
                ? getToolResultVisionMessage(toolCall, toolResult)
                : null;
              if (visionMessage) apiMessages.push(visionMessage);
            } catch (toolError) {
              if (isChatAbortError(toolError)) throw toolError;
              const toolErrorResult = {
                error: toolError instanceof Error ? toolError.message : "工具执行失败",
              };
              if (!silentControl) {
                appendAssistantTimelineMessage(
                  setChatMessages,
                  formatToolErrorMessage(toolCall, toolError),
                );
                hasVisibleToolResult = true;
              }
              apiMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: silentControl
                  ? JSON.stringify({
                      ended: false,
                      instruction:
                        "这是静默内部控制。继续完成当前正常回复，不要向用户提及工具、权限、提前结束、停止轮次、错误、原因或依据。",
                    })
                  : JSON.stringify(toolErrorResult),
              });
            }
          }

        }
      }

      throwIfChatAborted(abortSignal);
      if (!assistantContent) {
        if (hasVisibleToolResult) {
          setChatStatus({ status: "success", message: "工具执行完成。" });
          return;
        }
        throw new Error("响应里没有可显示的回复内容。");
      }

      if (streamingAssistantInserted) {
        setChatMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  content: assistantContent,
                  ...(assistantReasoning.trim() ? { reasoning: assistantReasoning.trim() } : {}),
                }
              : message,
          ),
        );
      }

      if (!streamingAssistantInserted) {
        setChatMessages((current) => {
          if (current.some((message) => message.id === assistantMessageId)) return current;
          return [
            ...current,
            {
              id: assistantMessageId,
              role: "assistant",
              content: assistantContent,
              ...(assistantReasoning.trim() ? { reasoning: assistantReasoning.trim() } : {}),
              createdAt: new Date().toISOString(),
            },
          ];
        });
      }
      setChatStatus({ status: "success", message: "回复已生成。" });
      emitTavernMessageEvent(TAVERN_EVENTS.MESSAGE_RECEIVED, assistantMessageId);
    } catch (error) {
      if (isChatAbortError(error)) {
        if (streamingAssistantInserted && assistantMessageId) {
          setChatMessages((current) =>
            current.filter(
              (message) => message.id !== assistantMessageId || message.content.trim(),
            ),
          );
        }
        setChatStatus({ status: "success", message: "已停止输出。" });
        return;
      }

      const message = error instanceof Error ? error.message : "调用失败。";
      setChatMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `调用失败：${message}`,
          createdAt: new Date().toISOString(),
        },
      ]);
      setChatStatus({
        status: "error",
        message: "调用失败。请检查本地服务、供应商地址、密钥、模型 ID 或上游限流状态。",
      });
    } finally {
      finishChatGeneration(abortController);
    }
  };
  sendChatMessageRef.current = sendChatMessage;

  const finalizeHeartbeatRun = (sessionId: string) => {
    const timestamp = new Date().toISOString();
    setChatSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) return session;

        const currentHeartbeat = normalizeHeartbeatConfig(session.heartbeat);
        const nextRunCount = currentHeartbeat.runCount + 1;
        const reachedLoopLimit =
          currentHeartbeat.loopLimit !== null && nextRunCount >= currentHeartbeat.loopLimit;
        const enabled =
          currentHeartbeat.enabled &&
          !reachedLoopLimit &&
          currentHeartbeat.event.trim().length > 0;
        const nextHeartbeat: ChatHeartbeatConfig = {
          ...currentHeartbeat,
          enabled,
          runCount: nextRunCount,
          lastRunAt: timestamp,
          ...(enabled
            ? { nextRunAt: getHeartbeatNextRunAt(currentHeartbeat.intervalMinutes) }
            : {}),
          updatedAt: timestamp,
        };

        if (!enabled) {
          delete nextHeartbeat.nextRunAt;
        }

        return {
          ...session,
          heartbeat: nextHeartbeat,
          updatedAt: timestamp,
        };
      }),
    );
  };

  const runHeartbeatForSession = async (sessionId: string) => {
    const session = chatSessions.find((item) => item.id === sessionId);
    if (!session || heartbeatRunningRef.current || chatStatus.status === "loading") return;

    const heartbeat = normalizeHeartbeatConfig(session.heartbeat);
    if (!heartbeat.enabled || !heartbeat.event.trim()) return;
    if (heartbeat.loopLimit !== null && heartbeat.runCount >= heartbeat.loopLimit) {
      updateHeartbeatForSession(sessionId, { enabled: false });
      return;
    }

    heartbeatRunningRef.current = true;
    const heartbeatMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      sender: { kind: "system" },
      createdAt: new Date().toISOString(),
      source: "heartbeat",
      content: [
        "【心跳检查】这是当前会话的自动心跳触发。",
        `待执行事件：${heartbeat.event.trim()}`,
        "请先检查并完成本轮任务，再总结结果。只有在本轮任务完成后，才调用 chat_update_heartbeat 修改或关闭心跳设置。",
      ].join("\n"),
    };
    const nextMessages = [...chatMessages, heartbeatMessage];

    setChatMessages(nextMessages);

    try {
      await generateAssistantForMessages(nextMessages, { kind: "system" }, {
        statusMessage: "心跳检查正在运行...",
        streamingStatusMessage: "心跳检查正在流式生成回复...",
        successMessage: "心跳检查已完成。",
        exposeHeartbeatTools: true,
      });
    } finally {
      finalizeHeartbeatRun(sessionId);
      const pendingUpdate = pendingHeartbeatUpdateRef.current;
      if (pendingUpdate?.sessionId === sessionId) {
        updateHeartbeatForSession(sessionId, pendingUpdate.patch);
        pendingHeartbeatUpdateRef.current = null;
      }
      heartbeatRunningRef.current = false;
    }
  };

  useEffect(() => {
    if (!appDataLoaded || !activeChatSession) return;

    const heartbeat = activeChatSession.heartbeat;
    if (!heartbeat.enabled || !heartbeat.event.trim()) return;
    if (heartbeat.loopLimit !== null && heartbeat.runCount >= heartbeat.loopLimit) {
      updateHeartbeatForSession(activeChatSession.id, { enabled: false });
      return;
    }
    if (chatStatus.status === "loading" || heartbeatRunningRef.current) return;

    const nextRunTimestamp = Date.parse(
      heartbeat.nextRunAt ?? getHeartbeatNextRunAt(heartbeat.intervalMinutes),
    );
    const delay = Math.max(
      0,
      (Number.isFinite(nextRunTimestamp) ? nextRunTimestamp : Date.now()) - Date.now(),
    );
    const timerId = window.setTimeout(() => {
      void runHeartbeatForSession(activeChatSession.id);
    }, delay);

    return () => window.clearTimeout(timerId);
  }, [
    activeChatSession?.id,
    activeHeartbeat.enabled,
    activeHeartbeat.event,
    activeHeartbeat.intervalMinutes,
    activeHeartbeat.loopLimit,
    activeHeartbeat.nextRunAt,
    activeHeartbeat.runCount,
    appDataLoaded,
    chatMessages,
    chatSessions,
    chatStatus.status,
  ]);

  const cancelEditingChatMessage = () => {
    setEditingChatMessage(null);
    setChatStatus({ status: "idle", message: "" });
  };

  const saveEditedAssistantMessage = () => {
    if (!editingChatMessage || chatStatus.status === "loading") return;

    const content = editingChatMessage.content.trim();
    if (!content) return;

    setChatMessages((current) =>
      current.map((message) =>
        message.id === editingChatMessage.messageId ? { ...message, content } : message,
      ),
    );
    setEditingChatMessage(null);
    setChatStatus({ status: "success", message: "AI 消息已保存。" });
  };

  const saveEditedUserMessage = () => {
    if (!editingChatMessage || chatStatus.status === "loading") return;

    const content = editingChatMessage.content.trim();
    if (!content) return;

    setChatMessages((current) =>
      current.map((message) =>
        message.id === editingChatMessage.messageId ? { ...message, content } : message,
      ),
    );
    setEditingChatMessage(null);
    setChatStatus({ status: "success", message: "用户消息已保存，后续对话未改变。" });
  };

  const resendEditedUserMessage = async () => {
    if (!editingChatMessage || chatStatus.status === "loading") return;

    const content = editingChatMessage.content.trim();
    if (!content) return;

    const messageIndex = chatMessages.findIndex(
      (message) => message.id === editingChatMessage.messageId,
    );
    const message = chatMessages[messageIndex];
    if (!message || message.role !== "user") return;

    const editedMessage: ChatMessage = {
      ...message,
      content,
    };
    const nextMessages = [...chatMessages.slice(0, messageIndex), editedMessage];
    const requestSender = normalizeChatSenderIdentity(editedMessage.sender, personas);

    if (chatMode === "multi") {
      const configurationError = getMultiAgentConfigurationError();
      if (configurationError) {
        setChatStatus({ status: "error", message: configurationError });
        return;
      }
    }

    setChatSender(requestSender);
    setChatMessages(nextMessages);
    setEditingChatMessage(null);
    if (chatMode === "multi") {
      await runMultiAgentResponses(nextMessages, requestSender, content);
    } else {
      await generateAssistantForMessages(nextMessages, requestSender);
    }
  };

  const updateEntryType = (typeId: string, patch: Partial<PersonalityEntryType>) => {
    updatePersona((persona) => ({
      ...persona,
      entryTypes: persona.entryTypes.map((type) =>
        type.id === typeId ? { ...type, ...patch, updatedAt: new Date().toISOString() } : type,
      ),
    }));
  };

  const updateEntry = (typeId: string, entryId: string, patch: Partial<PersonalityEntry>) => {
    updatePersona((persona) => ({
      ...persona,
      entryTypes: persona.entryTypes.map((type) =>
        type.id === typeId
          ? {
              ...type,
              entries: type.entries.map((entry) =>
                entry.id === entryId
                  ? { ...entry, ...patch, updatedAt: new Date().toISOString() }
                  : entry,
              ),
              updatedAt: new Date().toISOString(),
            }
          : type,
      ),
    }));
  };

  const addPersona = () => {
    const persona = createPersona(`人格 ${personas.length + 1}`);
    setPersonas((current) => [...current, persona]);
    setActivePersonaId(persona.id);
  };

  const duplicatePersona = () => {
    if (!activePersona) return;
    const duplicated: AgentPersona = {
      ...activePersona,
      id: crypto.randomUUID(),
      name: `${activePersona.name} 副本`,
      entryTypes: activePersona.entryTypes.map((type) => ({
        ...type,
        id: crypto.randomUUID(),
        entries: type.entries.map((entry) => ({ ...entry, id: crypto.randomUUID() })),
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setPersonas((current) => [...current, duplicated]);
    setActivePersonaId(duplicated.id);
  };

  const deletePersona = () => {
    if (!activePersona || personas.length <= 1) return;
    const remaining = personas.filter((persona) => persona.id !== activePersona.id);
    setPersonas(remaining);
    setActivePersonaId(remaining[0]?.id ?? "");
  };

  const addEntry = () => {
    const targetTypeId = selectedTypeId === "all" ? activeTypes[0]?.id : selectedTypeId;
    if (!targetTypeId) return;

    updatePersona((persona) => ({
      ...persona,
      entryTypes: persona.entryTypes.map((type) =>
        type.id === targetTypeId
          ? {
              ...type,
              entries: [...type.entries, createEntry()],
              updatedAt: new Date().toISOString(),
            }
          : type,
      ),
    }));
    setSelectedTypeId(targetTypeId);
  };

  const addEntryType = () => {
    const normalizedName = displayEntryKind(newTypeName);
    if (!normalizedName || normalizedName === "自定义") return;

    const newType = createEntryType(normalizedName);
    updatePersona((persona) => ({
      ...persona,
      entryTypes: [...persona.entryTypes, newType],
    }));
    setSelectedTypeId(newType.id);
    setNewTypeName("");
  };

  const deleteEntryType = (typeId: string) => {
    if (!activePersona || activePersona.entryTypes.length <= 1) return;

    const deletedType = activePersona.entryTypes.find((type) => type.id === typeId);
    const fallbackType = activePersona.entryTypes.find((type) => type.id !== typeId);
    if (!deletedType || !fallbackType) return;

    updatePersona((persona) => ({
      ...persona,
      entryTypes: persona.entryTypes
        .filter((type) => type.id !== typeId)
        .map((type) =>
          type.id === fallbackType.id
            ? {
                ...type,
                entries: [...type.entries, ...deletedType.entries],
                updatedAt: new Date().toISOString(),
              }
            : type,
        ),
    }));

    if (selectedTypeId === typeId) {
      setSelectedTypeId("all");
    }
  };

  const removeEntry = (typeId: string, entryId: string) => {
    updatePersona((persona) => ({
      ...persona,
      entryTypes: persona.entryTypes.map((type) =>
        type.id === typeId
          ? {
              ...type,
              entries: type.entries.filter((entry) => entry.id !== entryId),
              updatedAt: new Date().toISOString(),
            }
          : type,
      ),
    }));
  };

  const moveEntryToType = (sourceTypeId: string, entryId: string, targetTypeId: string) => {
    if (sourceTypeId === targetTypeId) return;

    updatePersona((persona) => {
      const sourceType = persona.entryTypes.find((type) => type.id === sourceTypeId);
      const entryToMove = sourceType?.entries.find((entry) => entry.id === entryId);
      const movedEntry = entryToMove;
      if (!movedEntry) return persona;

      return {
        ...persona,
        entryTypes: persona.entryTypes.map((type) => {
          if (type.id === sourceTypeId) {
            return {
              ...type,
              entries: type.entries.filter((entry) => entry.id !== entryId),
              updatedAt: new Date().toISOString(),
            };
          }

          if (type.id === targetTypeId) {
            return {
              ...type,
              entries: [...type.entries, { ...entryToMove, updatedAt: new Date().toISOString() }],
              updatedAt: new Date().toISOString(),
            };
          }

          return type;
        }),
      };
    });

    if (selectedTypeId === sourceTypeId) {
      setSelectedTypeId(targetTypeId);
    }
  };

  const reorderEntry = (
    sourceTypeId: string,
    entryId: string,
    targetTypeId: string,
    targetEntryId: string,
    placement: DragPlacement,
  ) => {
    if (sourceTypeId !== targetTypeId) return;
    if (sourceTypeId === targetTypeId && entryId === targetEntryId) return;

    updatePersona((persona) => {
      const now = new Date().toISOString();
      let entryToMove: PersonalityEntry | undefined;
      const entryTypesWithoutDraggedEntry = persona.entryTypes.map((type) => {
        if (type.id !== sourceTypeId) return type;

        entryToMove = type.entries.find((entry) => entry.id === entryId);
        if (!entryToMove) return type;

        return {
          ...type,
          entries: type.entries.filter((entry) => entry.id !== entryId),
          updatedAt: now,
        };
      });

      const movedEntry = entryToMove;
      if (!movedEntry) return persona;

      return {
        ...persona,
        entryTypes: entryTypesWithoutDraggedEntry.map((type) => {
          if (type.id !== targetTypeId) return type;

          const entries = [...type.entries];
          const targetIndex = entries.findIndex((entry) => entry.id === targetEntryId);
          const insertionIndex =
            targetIndex === -1 ? entries.length : targetIndex + (placement === "after" ? 1 : 0);

          entries.splice(insertionIndex, 0, {
            ...movedEntry,
            updatedAt: now,
          });

          return {
            ...type,
            entries,
            updatedAt: now,
          };
        }),
      };
    });
  };

  const reorderEntryType = (
    sourceTypeId: string,
    targetTypeId: string,
    placement: DragPlacement,
  ) => {
    if (sourceTypeId === targetTypeId) return;

    updatePersona((persona) => {
      const sourceType = persona.entryTypes.find((type) => type.id === sourceTypeId);
      if (!sourceType) return persona;

      const entryTypesWithoutDraggedType = persona.entryTypes.filter(
        (type) => type.id !== sourceTypeId,
      );
      const targetIndex = entryTypesWithoutDraggedType.findIndex(
        (type) => type.id === targetTypeId,
      );
      const insertionIndex =
        targetIndex === -1
          ? entryTypesWithoutDraggedType.length
          : targetIndex + (placement === "after" ? 1 : 0);

      return {
        ...persona,
        entryTypes: [
          ...entryTypesWithoutDraggedType.slice(0, insertionIndex),
          { ...sourceType, updatedAt: new Date().toISOString() },
          ...entryTypesWithoutDraggedType.slice(insertionIndex),
        ],
      };
    });
  };

  const exportJson = () => {
    if (!activePersona) return;
    const blob = new Blob([JSON.stringify(activePersona, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activePersona.name || "persona"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importPersonaFile = async (file?: File) => {
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = (() => {
        const trimmedText = text.trim();
        if (!trimmedText) {
          throw new Error("人格文件为空。");
        }

        try {
          return normalizePersona(JSON.parse(trimmedText) as AgentPersona);
        } catch {
          return createPersonaFromPromptText(trimmedText);
        }
      })();

      const baseName = parsed.name.trim() || "导入人格";
      const existingNames = new Set(personas.map((persona) => persona.name.trim()));
      let nextName = baseName;
      let suffix = 2;

      while (existingNames.has(nextName)) {
        nextName = `${baseName} ${suffix}`;
        suffix += 1;
      }

      const imported: AgentPersona = {
        ...parsed,
        id: crypto.randomUUID(),
        name: nextName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setPersonas((current) => [...current, imported]);
      setActivePersonaId(imported.id);
    } catch (error) {
      console.error(error);
      window.alert("导入失败：请提供有效的 Persona JSON，或符合 Prompt 预览格式的文本文件。");
    }
  };

  const copyPrompt = () => {
    const fallbackCopy = () => {
      const textarea = document.createElement("textarea");
      textarea.value = prompt;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    };

    try {
      const copyRequest = navigator.clipboard?.writeText(prompt);
      if (copyRequest) void copyRequest.catch(fallbackCopy);
      else fallbackCopy();
    } catch {
      fallbackCopy();
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const selectAvatarFile = async (file?: File, target: AvatarCropState["target"] = "persona") => {
    if (!file || !file.type.startsWith("image/")) return;
    const src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }
        reject(new Error("无法读取头像文件"));
      };
      reader.onerror = () => reject(reader.error ?? new Error("无法读取头像文件"));
      reader.readAsDataURL(file);
    });

    const image = new Image();
    image.src = src;
    await image.decode();

    if (!image.naturalWidth || !image.naturalHeight) return;

    setAvatarCrop({
      target,
      src,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    });
  };

  const closeAvatarCrop = () => {
    setAvatarCrop(null);
    if (avatarInputRef.current) {
      avatarInputRef.current.value = "";
    }
    if (userAvatarInputRef.current) {
      userAvatarInputRef.current.value = "";
    }
  };

  const saveCroppedAvatar = async () => {
    if (!avatarCrop) return;
    const clampedCrop = clampAvatarCrop(avatarCrop);
    const image = new Image();
    image.src = clampedCrop.src;
    await image.decode();

    const size = AVATAR_OUTPUT_SIZE;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return;

    const coverScale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
    const outputOffsetScale = size / CROP_PREVIEW_SIZE;
    const drawWidth = image.naturalWidth * coverScale * clampedCrop.zoom;
    const drawHeight = image.naturalHeight * coverScale * clampedCrop.zoom;
    const drawX = size / 2 + clampedCrop.offsetX * outputOffsetScale - drawWidth / 2;
    const drawY = size / 2 + clampedCrop.offsetY * outputOffsetScale - drawHeight / 2;
    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

    const avatarImage = canvas.toDataURL("image/png");
    if (avatarCrop.target === "user") {
      setUserProfile((current) => ({
        ...current,
        avatarImage,
        updatedAt: new Date().toISOString(),
      }));
    } else {
      updatePersona((persona) => ({ ...persona, avatarImage }));
    }
    closeAvatarCrop();
  };

  const avatarCropModal = avatarCrop ? (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="裁剪头像">
      <section className="crop-modal">
        <div className="crop-header">
          <h2>裁剪头像</h2>
          <button type="button" className="icon-button flat" title="关闭" onClick={closeAvatarCrop}>
            <X size={18} />
          </button>
        </div>
        <div className="crop-stage">
          <img
            src={avatarCrop.src}
            alt="待裁剪头像"
            style={{
              width: `${cropMetrics?.scaledWidth ?? CROP_PREVIEW_SIZE}px`,
              height: `${cropMetrics?.scaledHeight ?? CROP_PREVIEW_SIZE}px`,
              left: `${
                CROP_PREVIEW_SIZE / 2 +
                avatarCrop.offsetX -
                (cropMetrics?.scaledWidth ?? CROP_PREVIEW_SIZE) / 2
              }px`,
              top: `${
                CROP_PREVIEW_SIZE / 2 +
                avatarCrop.offsetY -
                (cropMetrics?.scaledHeight ?? CROP_PREVIEW_SIZE) / 2
              }px`,
            }}
          />
        </div>
        <div className="crop-controls">
          <label className="field">
            <span>缩放</span>
            <input
              type="range"
              min="1"
              max="3"
              step="0.01"
              value={avatarCrop.zoom}
              onChange={(event) =>
                setAvatarCrop((current) =>
                  current
                    ? clampAvatarCrop({ ...current, zoom: Number(event.target.value) })
                    : current,
                )
              }
            />
          </label>
          <label className="field">
            <span>水平位置</span>
            <input
              type="range"
              min={-(cropMetrics?.maxOffsetX ?? 0)}
              max={cropMetrics?.maxOffsetX ?? 0}
              step="1"
              value={avatarCrop.offsetX}
              onChange={(event) =>
                setAvatarCrop((current) =>
                  current
                    ? clampAvatarCrop({ ...current, offsetX: Number(event.target.value) })
                    : current,
                )
              }
            />
          </label>
          <label className="field">
            <span>垂直位置</span>
            <input
              type="range"
              min={-(cropMetrics?.maxOffsetY ?? 0)}
              max={cropMetrics?.maxOffsetY ?? 0}
              step="1"
              value={avatarCrop.offsetY}
              onChange={(event) =>
                setAvatarCrop((current) =>
                  current
                    ? clampAvatarCrop({ ...current, offsetY: Number(event.target.value) })
                    : current,
                )
              }
            />
          </label>
        </div>
        <div className="crop-actions">
          <button type="button" className="ghost-action" onClick={closeAvatarCrop}>
            取消
          </button>
          <button type="button" className="small-action" onClick={saveCroppedAvatar}>
            <Check size={16} />
            保存头像
          </button>
        </div>
      </section>
    </div>
  ) : null;

  const pcBrowserModal = pcBrowserOpen ? (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="连接电脑工作区">
      <section className="pc-browser-modal">
        <div className="crop-header">
          <h2>连接电脑工作区</h2>
          <button
            type="button"
            className="icon-button flat"
            title="关闭"
            onClick={() => setPcBrowserOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        <div className="pc-connect-row">
          <label className="field">
            <span>电脑地址</span>
            <input
              value={pcServerUrl}
              placeholder="例如：192.168.1.20:5190"
              onChange={(event) => setPcServerUrl(event.target.value)}
            />
          </label>
          <button type="button" className="small-action" onClick={() => void loadPcDirectory("")}>
            <Server size={16} />
            连接
          </button>
        </div>

        <div className={`provider-status ${pcBrowserStatus.status}`}>
          {pcBrowserStatus.message ||
            "电脑端先运行 npm run build && npm run serve，并确保手机和电脑在同一局域网。"}
        </div>

        <div className="pc-path-row">
          <button
            type="button"
            className="ghost-action"
            disabled={!pcCurrentPath}
            onClick={() => void loadPcDirectory(getPcParentPath(pcCurrentPath))}
          >
            <ArrowLeft size={15} />
            上级
          </button>
          <button type="button" className="ghost-action" onClick={() => void loadPcDirectory("")}>
            磁盘
          </button>
          <div title={pcCurrentPath || "电脑磁盘"}>{pcCurrentPath || "电脑磁盘"}</div>
        </div>

        <div className="pc-entry-list">
          {pcEntries.map((entry) => (
            <button
              type="button"
              className={`pc-entry ${entry.kind}`}
              key={entry.path}
              disabled={entry.kind !== "directory"}
              onClick={() => {
                if (entry.kind === "directory") void loadPcDirectory(entry.path);
              }}
            >
              {entry.kind === "directory" ? <FolderOpen size={15} /> : <FileJson size={15} />}
              <span>{entry.name}</span>
            </button>
          ))}
        </div>

        <div className="crop-actions">
          <button type="button" className="ghost-action" onClick={() => setPcBrowserOpen(false)}>
            取消
          </button>
          <button
            type="button"
            className="small-action"
            disabled={!pcCurrentPath}
            onClick={() => selectPcWorkspace()}
          >
            <Check size={16} />
            设为工作区
          </button>
        </div>
      </section>
    </div>
  ) : null;

  if (!activePersona) {
    return <div className="boot">正在初始化人格工作台...</div>;
  }

  if (view === "home") {
    return (
      <main className="home-shell">
        <header className="home-topbar">
          <div className="brand home-brand">
            <div className="brand-mark">
              <Boxes size={22} />
            </div>
            <div>
              <strong>Renge Agent Lab</strong>
              <span>人格与智能体工作台</span>
            </div>
          </div>
          <nav className="home-nav" aria-label="主要导航">
            <button type="button" title="人格工作室" onClick={() => setView("studio")}>
              <Bot size={16} />
              人格工作室
            </button>
            <button type="button" title="角色卡管理器" onClick={() => setView("characters")}>
              <BookOpen size={16} />
              角色卡
            </button>
            <button type="button" title="对话" onClick={() => setView("chat")}>
              <MessageSquare size={16} />
              对话
            </button>
            <button
              type="button"
              title="设置"
              onClick={() => {
                setSettingsTab("providers");
                setView("settings");
              }}
            >
              <Settings2 size={16} />
              设置
            </button>
          </nav>
        </header>

        <section className="home-main">
          <div className="home-heading">
            <div>
              <div className="eyebrow">工作台</div>
              <h1>Agent 工作台</h1>
            </div>
            <div className="home-status-strip" aria-label="当前工作状态">
              <span>
                <UserRound size={15} />
                {activePersona.name}
              </span>
              <span className={chatModelReady ? "ready" : "attention"}>
                <Server size={15} />
                {chatModelLabel}
              </span>
              <span>
                <MessageSquare size={15} />
                {chatSessions.length} 个会话
              </span>
            </div>
          </div>

          <div className="module-grid">
            <article className="module-card">
              <div className="module-icon">
                <Bot size={24} />
              </div>
              <div className="module-card-copy">
                <h2>人格工作室</h2>
                <p>编辑人格档案、长期记忆、行为边界与类型化条目。</p>
              </div>
              <div className="module-meta">
                <span>{personas.length} 个人格</span>
                <span>{getEntryCount(activePersona)} 个当前条目</span>
              </div>
              <button type="button" className="home-primary-action" onClick={() => setView("studio")}>
                <Pencil size={16} />
                打开工作室
              </button>
            </article>

            <article className="module-card character-module-card">
              <div className="module-icon">
                <BookOpen size={24} />
              </div>
              <div className="module-card-copy">
                <h2>角色卡管理器</h2>
                <p>导入、编辑、翻译和导出酒馆 PNG / JSON 角色卡。</p>
              </div>
              <div className="module-meta">
                <span>{characterCards.length} 张角色卡</span>
                <span>
                  {characterCards.filter((card) => card.characterBook).length} 本内置世界书 · {characterCards.reduce((total, card) => total + card.regexScripts.length, 0)} 条私有正则 · {characterCards.reduce((total, card) => total + card.tavernScripts.length, 0)} 个内置脚本
                </span>
              </div>
              <button
                type="button"
                className="home-primary-action"
                onClick={() => setView("characters")}
              >
                <BookOpen size={16} />
                打开管理器
              </button>
            </article>

            <article className="module-card">
              <div className="module-icon">
                <MessageSquare size={24} />
              </div>
              <div className="module-card-copy">
                <h2>Codex Chat</h2>
                <p>使用当前模型直接对话，或带着人格设定进入会话。</p>
              </div>
              <div className="module-meta">
                <span>
                  {chatMode === "persona"
                    ? "人格 Agent"
                    : chatMode === "multi"
                      ? `${multiAgentPersonas.length} Agent 轮流`
                      : chatMode === "roleplay"
                        ? activeRoleplayCard
                          ? `角色扮演 · ${activeRoleplayCard.name}`
                          : "角色扮演"
                      : "AI 直连"}
                </span>
                <span>{chatModelLabel}</span>
              </div>
              <button type="button" className="home-primary-action" onClick={() => setView("chat")}>
                <MessageSquare size={16} />
                开始对话
              </button>
            </article>
          </div>

          <section className="home-recent" aria-labelledby="recent-chat-title">
            <div className="home-section-heading">
              <div>
                <div className="eyebrow">继续处理</div>
                <h2 id="recent-chat-title">最近会话</h2>
              </div>
              <button type="button" onClick={() => setView("chat")}>
                <MessageSquare size={15} />
                查看全部
              </button>
            </div>
            <div className="home-recent-list">
              {recentChatSessions.map((session) => (
                <button
                  type="button"
                  className="home-recent-item"
                  key={session.id}
                  onClick={() => {
                    void openChatSession(session.id);
                    setView("chat");
                  }}
                >
                  <span className="home-recent-icon">
                    <MessageSquare size={17} />
                  </span>
                  <span className="home-recent-copy">
                    <strong>{session.title}</strong>
                    <span>
                      {session.workspaceName} · {session.messages.length} 条消息
                    </span>
                  </span>
                  <time dateTime={session.updatedAt}>
                    {new Date(session.updatedAt).toLocaleString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </button>
              ))}
            </div>
          </section>
        </section>
        {pcBrowserModal}
      </main>
    );
  }

  if (view === "characters") {
    return (
      <main className="character-manager-shell">
        <header className="character-manager-header">
          <div>
            <button type="button" className="ghost-action" onClick={() => setView("home")}>
              <ArrowLeft size={16} />
              主页
            </button>
            <div>
              <div className="eyebrow">SillyTavern Character Cards</div>
              <h1>角色卡管理器</h1>
              <p>角色卡内置世界书、正则与酒馆脚本独立保存，只在绑定该角色的会话中生效。</p>
            </div>
          </div>
          <div className="character-manager-actions">
            <label className="character-search">
              <Search size={16} />
              <input
                value={characterSearch}
                placeholder="搜索名称、作者或标签"
                onChange={(event) => setCharacterSearch(event.target.value)}
              />
            </label>
            <input
              ref={characterImportInputRef}
              type="file"
              accept=".png,.json,image/png,application/json"
              multiple
              hidden
              onChange={(event) => void importCharacterCardFiles(event.target.files ?? [])}
            />
            <button
              type="button"
              className="ghost-action"
              onClick={() => characterImportInputRef.current?.click()}
            >
              <Upload size={16} />
              导入 PNG / JSON
            </button>
            <button type="button" className="small-action" onClick={addCharacterCard}>
              <Plus size={16} />
              新建角色卡
            </button>
          </div>
        </header>

        {characterImportState.status !== "idle" && (
          <div className={`provider-status character-manager-status ${characterImportState.status}`}>
            {characterImportState.message}
          </div>
        )}

        <section className="character-gallery" aria-label="角色卡列表">
          {filteredCharacterCards.length === 0 ? (
            <div className="character-gallery-empty">
              <BookOpen size={34} />
              <h2>{characterCards.length === 0 ? "还没有角色卡" : "没有匹配的角色卡"}</h2>
              <p>
                {characterCards.length === 0
                  ? "可以批量导入酒馆原生 PNG / JSON 角色卡，也可以从空白卡开始编辑。"
                  : "换一个名称、作者或标签关键词试试。"}
              </p>
              {characterCards.length === 0 && (
                <button
                  type="button"
                  className="small-action"
                  onClick={() => characterImportInputRef.current?.click()}
                >
                  <Upload size={16} />
                  导入角色卡
                </button>
              )}
            </div>
          ) : (
            filteredCharacterCards.map((card) => (
              <article className="character-cover-card" key={card.id}>
                <button
                  type="button"
                  className="character-cover-button"
                  title={`以 ${card.name} 开始角色扮演`}
                  onClick={() => openOrCreateCharacterRoleplay(card)}
                >
                  {card.avatarDataUrl ? (
                    <img src={card.avatarDataUrl} alt={`${card.name} 封面`} />
                  ) : (
                    <span className="character-cover-placeholder">
                      <UserRound size={52} />
                    </span>
                  )}
                  <span className="character-cover-gradient" />
                  <span className="character-cover-copy">
                    <strong>{card.name || "未命名角色"}</strong>
                    <small>{card.creator || card.sourceFileName || "本地角色卡"}</small>
                  </span>
                </button>
                <div className="character-card-badges">
                  {card.characterBook && <span>内置世界书 {card.characterBook.entries.length}</span>}
                  {card.regexScripts.length > 0 && <span>私有正则 {card.regexScripts.length}</span>}
                  {card.tavernScripts.length > 0 && <span>内置脚本 {card.tavernScripts.length}</span>}
                </div>
                <div className="character-card-tags">
                  {card.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                </div>
                <div className="character-card-actions">
                  <button
                    type="button"
                    title="开始角色扮演"
                    onClick={() => openOrCreateCharacterRoleplay(card)}
                  >
                    <Play size={15} />
                  </button>
                  <button
                    type="button"
                    title="编辑角色卡"
                    onClick={() => {
                      setEditingCharacterCardId(card.id);
                      setCharacterEditorTab("basic");
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    title="翻译角色卡"
                    disabled={characterTranslationState.status === "loading"}
                    onClick={() => void translateCharacterCard(card)}
                  >
                    <Languages size={15} />
                  </button>
                  <button
                    type="button"
                    title="查看原始封面"
                    disabled={!card.avatarDataUrl}
                    onClick={() => window.open(card.avatarDataUrl, "_blank", "noopener,noreferrer")}
                  >
                    <Eye size={15} />
                  </button>
                  <button type="button" title="导出 PNG" onClick={() => void exportCharacterPng(card)}>
                    <Download size={15} />
                  </button>
                  <button type="button" title="导出 JSON" onClick={() => exportCharacterJson(card)}>
                    <FileJson size={15} />
                  </button>
                  <button type="button" title="删除角色卡" onClick={() => deleteCharacterCard(card)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))
          )}
        </section>

        {characterTranslationState.status !== "idle" && (
          <div className={`provider-status character-manager-status ${characterTranslationState.status}`}>
            {characterTranslationState.message}
          </div>
        )}

        {editingCharacterCard && (
          <div className="modal-backdrop character-editor-backdrop" role="dialog" aria-modal="true">
            <section className="character-editor-modal">
              <header className="character-editor-header">
                <div>
                  <h2>编辑 {editingCharacterCard.name || "角色卡"}</h2>
                  <span>
                    {editingCharacterCard.sourceFormat === "sillytavern-png"
                      ? "PNG 角色卡"
                      : editingCharacterCard.sourceFormat === "sillytavern-json"
                        ? "JSON 角色卡"
                        : "本地角色卡"}
                  </span>
                </div>
                <div>
                  <button
                    type="button"
                    className="ghost-action"
                    onClick={() => void translateCharacterCard(editingCharacterCard)}
                  >
                    <Languages size={15} />
                    翻译
                  </button>
                  <button
                    type="button"
                    className="icon-button flat"
                    title="关闭"
                    onClick={() => setEditingCharacterCardId("")}
                  >
                    <X size={18} />
                  </button>
                </div>
              </header>
              <nav className="character-editor-tabs">
                {([
                  ["basic", "基本信息"],
                  ["advanced", "高级设定"],
                  ["greetings", `问候语 ${1 + editingCharacterCard.alternateGreetings.length}`],
                  ["worldbook", `内置世界书 ${editingCharacterCard.characterBook?.entries.length ?? 0}`],
                  ["regex", `角色正则 ${editingCharacterCard.regexScripts.length}`],
                  ["scripts", `内置脚本 ${editingCharacterCard.tavernScripts.length}`],
                ] as const).map(([tab, label]) => (
                  <button
                    type="button"
                    className={characterEditorTab === tab ? "active" : ""}
                    key={tab}
                    onClick={() => setCharacterEditorTab(tab)}
                  >
                    {label}
                  </button>
                ))}
              </nav>

              <div className="character-editor-content">
                {characterEditorTab === "basic" && (
                  <div className="character-basic-layout">
                    <div className="character-avatar-editor">
                      {editingCharacterCard.avatarDataUrl ? (
                        <img src={editingCharacterCard.avatarDataUrl} alt="角色封面" />
                      ) : (
                        <span><UserRound size={58} /></span>
                      )}
                      <input
                        ref={characterAvatarInputRef}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(event) => void replaceCharacterAvatar(event.target.files?.[0])}
                      />
                      <button
                        type="button"
                        className="ghost-action"
                        onClick={() => characterAvatarInputRef.current?.click()}
                      >
                        <Upload size={15} />
                        更换封面
                      </button>
                    </div>
                    <div className="character-form-grid">
                      <label className="field">
                        <span>角色名称</span>
                        <input
                          value={editingCharacterCard.name}
                          onChange={(event) => updateCharacterCard(editingCharacterCard.id, { name: event.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>昵称</span>
                        <input
                          value={editingCharacterCard.nickname}
                          onChange={(event) => updateCharacterCard(editingCharacterCard.id, { nickname: event.target.value })}
                        />
                      </label>
                      <label className="field character-field-wide">
                        <span>标签（逗号或换行分隔）</span>
                        <input
                          value={editingCharacterCard.tags.join(", ")}
                          onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                            tags: event.target.value.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean),
                          })}
                        />
                      </label>
                      {([
                        ["description", "角色描述"],
                        ["personality", "性格"],
                        ["scenario", "场景设定"],
                        ["messageExample", "示例对话"],
                      ] as const).map(([key, label]) => (
                        <label className="field character-field-wide" key={key}>
                          <span>{label}</span>
                          <textarea
                            rows={key === "messageExample" ? 12 : 8}
                            value={editingCharacterCard[key]}
                            onChange={(event) => updateCharacterCard(editingCharacterCard.id, { [key]: event.target.value })}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {characterEditorTab === "advanced" && (
                  <div className="character-form-grid single-column">
                    <div className="character-inline-grid">
                      <label className="field">
                        <span>作者</span>
                        <input value={editingCharacterCard.creator} onChange={(event) => updateCharacterCard(editingCharacterCard.id, { creator: event.target.value })} />
                      </label>
                      <label className="field">
                        <span>角色版本</span>
                        <input value={editingCharacterCard.characterVersion} onChange={(event) => updateCharacterCard(editingCharacterCard.id, { characterVersion: event.target.value })} />
                      </label>
                    </div>
                    {([
                      ["systemPrompt", "角色系统指令"],
                      ["postHistoryInstructions", "历史后指令"],
                      ["creatorNotes", "创作者备注"],
                    ] as const).map(([key, label]) => (
                      <label className="field" key={key}>
                        <span>{label}</span>
                        <textarea rows={10} value={editingCharacterCard[key]} onChange={(event) => updateCharacterCard(editingCharacterCard.id, { [key]: event.target.value })} />
                      </label>
                    ))}
                  </div>
                )}

                {characterEditorTab === "greetings" && (
                  <div className="character-greetings-editor">
                    <label className="field">
                      <span>开场白</span>
                      <textarea rows={12} value={editingCharacterCard.firstMessage} onChange={(event) => updateCharacterCard(editingCharacterCard.id, { firstMessage: event.target.value })} />
                    </label>
                    {editingCharacterCard.alternateGreetings.map((greeting, index) => (
                      <div className="character-array-item" key={index}>
                        <label className="field">
                          <span>备选问候 {index + 1}</span>
                          <textarea
                            rows={10}
                            value={greeting}
                            onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                              alternateGreetings: editingCharacterCard.alternateGreetings.map((item, itemIndex) => itemIndex === index ? event.target.value : item),
                            })}
                          />
                        </label>
                        <button type="button" className="icon-button flat" title="删除备选问候" onClick={() => updateCharacterCard(editingCharacterCard.id, {
                          alternateGreetings: editingCharacterCard.alternateGreetings.filter((_, itemIndex) => itemIndex !== index),
                        })}><Trash2 size={15} /></button>
                      </div>
                    ))}
                    <button type="button" className="ghost-action" onClick={() => updateCharacterCard(editingCharacterCard.id, {
                      alternateGreetings: [...editingCharacterCard.alternateGreetings, ""],
                    })}><Plus size={15} />增加备选问候</button>
                  </div>
                )}

                {characterEditorTab === "worldbook" && (
                  <div className="character-private-editor">
                    <div className="character-private-notice">
                      <Bookmark size={17} />
                      <span>这里的世界书只绑定当前角色卡，不会进入设置中的全局世界书列表。</span>
                    </div>
                    {!editingCharacterCard.characterBook ? (
                      <button type="button" className="small-action" onClick={() => updateCharacterCard(editingCharacterCard.id, {
                        characterBook: createWorldBook(`${editingCharacterCard.name || "角色"}的内置世界书`),
                      })}><Plus size={15} />创建内置世界书</button>
                    ) : (
                      <>
                        <div className="character-inline-grid">
                          <label className="field">
                            <span>世界书名称</span>
                            <input value={editingCharacterCard.characterBook.name} onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                              characterBook: { ...editingCharacterCard.characterBook!, name: event.target.value },
                            })} />
                          </label>
                          <button type="button" className="ghost-action danger" onClick={() => updateCharacterCard(editingCharacterCard.id, { characterBook: null })}><Trash2 size={15} />移除内置世界书</button>
                        </div>
                        <label className="field">
                          <span>世界书描述</span>
                          <textarea rows={5} value={editingCharacterCard.characterBook.description} onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                            characterBook: { ...editingCharacterCard.characterBook!, description: event.target.value },
                          })} />
                        </label>
                        <div className="character-private-list">
                          {editingCharacterCard.characterBook.entries.map((entry, index) => (
                            <details className="character-private-entry" key={entry.id} open={index === 0}>
                              <summary>
                                <span>{entry.comment || `条目 ${index + 1}`}</span>
                                <small>{entry.enabled ? "启用" : "停用"}</small>
                              </summary>
                              <div>
                                <div className="character-inline-grid">
                                  <label className="field">
                                    <span>条目名称</span>
                                    <input value={entry.comment} onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                                      characterBook: { ...editingCharacterCard.characterBook!, entries: editingCharacterCard.characterBook!.entries.map((item) => item.id === entry.id ? { ...item, comment: event.target.value } : item) },
                                    })} />
                                  </label>
                                  <label className="toggle-field compact-toggle">
                                    <input type="checkbox" checked={entry.enabled} onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                                      characterBook: { ...editingCharacterCard.characterBook!, entries: editingCharacterCard.characterBook!.entries.map((item) => item.id === entry.id ? { ...item, enabled: event.target.checked } : item) },
                                    })} />
                                    <span>启用</span>
                                  </label>
                                </div>
                                <label className="field">
                                  <span>主关键词（逗号或换行）</span>
                                  <input value={entry.keys.join(", ")} onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                                    characterBook: { ...editingCharacterCard.characterBook!, entries: editingCharacterCard.characterBook!.entries.map((item) => item.id === entry.id ? { ...item, keys: event.target.value.split(/[,，\n]/).map((key) => key.trim()).filter(Boolean) } : item) },
                                  })} />
                                </label>
                                <label className="field">
                                  <span>条目内容</span>
                                  <textarea rows={16} value={entry.content} onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                                    characterBook: { ...editingCharacterCard.characterBook!, entries: editingCharacterCard.characterBook!.entries.map((item) => item.id === entry.id ? { ...item, content: event.target.value } : item) },
                                  })} />
                                </label>
                                <button type="button" className="ghost-action danger" onClick={() => updateCharacterCard(editingCharacterCard.id, {
                                  characterBook: { ...editingCharacterCard.characterBook!, entries: editingCharacterCard.characterBook!.entries.filter((item) => item.id !== entry.id) },
                                })}><Trash2 size={14} />删除条目</button>
                              </div>
                            </details>
                          ))}
                        </div>
                        <button type="button" className="ghost-action" onClick={() => updateCharacterCard(editingCharacterCard.id, {
                          characterBook: { ...editingCharacterCard.characterBook!, entries: [...editingCharacterCard.characterBook!.entries, createWorldBookEntry(editingCharacterCard.characterBook!.entries.length)] },
                        })}><Plus size={15} />增加世界书条目</button>
                      </>
                    )}
                  </div>
                )}

                {characterEditorTab === "regex" && (
                  <div className="character-private-editor">
                    <div className="character-private-notice">
                      <Braces size={17} />
                      <span>这里的正则只绑定当前角色卡，不会进入设置中的全局正则列表。</span>
                    </div>
                    <div className="character-private-list">
                      {editingCharacterCard.regexScripts.map((script, index) => (
                        <details className="character-private-entry" key={script.id} open={index === 0}>
                          <summary>
                            <span>{script.scriptName || `正则 ${index + 1}`}</span>
                            <small>{script.disabled ? "停用" : "启用"}</small>
                          </summary>
                          <div>
                            <div className="character-inline-grid">
                              <label className="field">
                                <span>脚本名称</span>
                                <input value={script.scriptName} onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                                  regexScripts: editingCharacterCard.regexScripts.map((item) => item.id === script.id ? { ...item, scriptName: event.target.value } : item),
                                })} />
                              </label>
                              <label className="toggle-field compact-toggle">
                                <input type="checkbox" checked={!script.disabled} onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                                  regexScripts: editingCharacterCard.regexScripts.map((item) => item.id === script.id ? { ...item, disabled: !event.target.checked } : item),
                                })} />
                                <span>启用</span>
                              </label>
                            </div>
                            <label className="field">
                              <span>查找正则</span>
                              <textarea rows={7} className="code-textarea" value={script.findRegex} onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                                regexScripts: editingCharacterCard.regexScripts.map((item) => item.id === script.id ? { ...item, findRegex: event.target.value } : item),
                              })} />
                            </label>
                            <label className="field">
                              <span>替换内容</span>
                              <textarea rows={14} className="code-textarea" value={script.replaceString} onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                                regexScripts: editingCharacterCard.regexScripts.map((item) => item.id === script.id ? { ...item, replaceString: event.target.value } : item),
                              })} />
                            </label>
                            <div className="character-regex-options">
                              {[1, 2].map((placement) => (
                                <label className="toggle-field compact-toggle" key={placement}>
                                  <input type="checkbox" checked={script.placement.includes(placement)} onChange={() => updateCharacterCard(editingCharacterCard.id, {
                                    regexScripts: editingCharacterCard.regexScripts.map((item) => item.id === script.id ? { ...item, placement: item.placement.includes(placement) ? item.placement.filter((value) => value !== placement) : [...item.placement, placement] } : item),
                                  })} />
                                  <span>{placement === 1 ? "用户输入" : "AI 输出"}</span>
                                </label>
                              ))}
                              <label className="toggle-field compact-toggle">
                                <input type="checkbox" checked={script.promptOnly} onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                                  regexScripts: editingCharacterCard.regexScripts.map((item) => item.id === script.id ? { ...item, promptOnly: event.target.checked } : item),
                                })} />
                                <span>仅提示词</span>
                              </label>
                              <label className="toggle-field compact-toggle">
                                <input type="checkbox" checked={script.markdownOnly} onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                                  regexScripts: editingCharacterCard.regexScripts.map((item) => item.id === script.id ? { ...item, markdownOnly: event.target.checked } : item),
                                })} />
                                <span>仅显示</span>
                              </label>
                            </div>
                            {getRegexScriptError(script) && <small className="field-error">{getRegexScriptError(script)}</small>}
                            <button type="button" className="ghost-action danger" onClick={() => updateCharacterCard(editingCharacterCard.id, {
                              regexScripts: editingCharacterCard.regexScripts.filter((item) => item.id !== script.id),
                            })}><Trash2 size={14} />删除正则</button>
                          </div>
                        </details>
                      ))}
                    </div>
                    <button type="button" className="ghost-action" onClick={() => updateCharacterCard(editingCharacterCard.id, {
                      regexScripts: [...editingCharacterCard.regexScripts, createRegexScript(`角色正则 ${editingCharacterCard.regexScripts.length + 1}`)],
                    })}><Plus size={15} />增加角色正则</button>
                  </div>
                )}

                {characterEditorTab === "scripts" && (
                  <div className="character-private-editor">
                    <div className="character-private-notice">
                      <Play size={17} />
                      <span>这里的脚本只绑定当前角色卡，与设置中的全局脚本分开保存；进入该角色会话时才会运行。</span>
                    </div>
                    <div className="character-private-list">
                      {editingCharacterCard.tavernScripts.map((script, index) => (
                        <details className="character-private-entry" key={script.id} open={index === 0}>
                          <summary>
                            <span>{script.name || `脚本 ${index + 1}`}</span>
                            <small>{script.enabled ? "启用" : "停用"}</small>
                          </summary>
                          <div>
                            <div className="character-inline-grid">
                              <label className="field">
                                <span>脚本名称</span>
                                <input
                                  value={script.name}
                                  onChange={(event) =>
                                    updateCharacterCard(editingCharacterCard.id, {
                                      tavernScripts: editingCharacterCard.tavernScripts.map((item) =>
                                        item.id === script.id
                                          ? { ...item, name: event.target.value, updatedAt: new Date().toISOString() }
                                          : item,
                                      ),
                                    })
                                  }
                                />
                              </label>
                              <label className="field">
                                <span>运行时机</span>
                                <select
                                  value={script.runOn}
                                  onChange={(event) =>
                                    updateCharacterCard(editingCharacterCard.id, {
                                      tavernScripts: editingCharacterCard.tavernScripts.map((item) =>
                                        item.id === script.id
                                          ? { ...item, runOn: event.target.value as TavernScript["runOn"], updatedAt: new Date().toISOString() }
                                          : item,
                                      ),
                                    })
                                  }
                                >
                                  <option value="startup">进入会话时运行</option>
                                  <option value="message">首次收发消息时运行</option>
                                  <option value="manual">仅手动运行</option>
                                </select>
                              </label>
                            </div>
                            <div className="character-regex-options">
                              <label className="toggle-field compact-toggle">
                                <input
                                  type="checkbox"
                                  checked={script.enabled}
                                  onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                                    tavernScripts: editingCharacterCard.tavernScripts.map((item) => item.id === script.id ? { ...item, enabled: event.target.checked, updatedAt: new Date().toISOString() } : item),
                                  })}
                                />
                                <span>启用</span>
                              </label>
                              <label className="toggle-field compact-toggle">
                                <input
                                  type="checkbox"
                                  checked={script.autoRun}
                                  onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                                    tavernScripts: editingCharacterCard.tavernScripts.map((item) => item.id === script.id ? { ...item, autoRun: event.target.checked, updatedAt: new Date().toISOString() } : item),
                                  })}
                                />
                                <span>自动运行</span>
                              </label>
                              <label className="toggle-field compact-toggle">
                                <input
                                  type="checkbox"
                                  checked={script.buttonEnabled}
                                  onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                                    tavernScripts: editingCharacterCard.tavernScripts.map((item) => item.id === script.id ? { ...item, buttonEnabled: event.target.checked, updatedAt: new Date().toISOString() } : item),
                                  })}
                                />
                                <span>脚本按钮</span>
                              </label>
                            </div>
                            <label className="field">
                              <span>说明</span>
                              <input
                                value={script.info}
                                onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                                  tavernScripts: editingCharacterCard.tavernScripts.map((item) => item.id === script.id ? { ...item, info: event.target.value, updatedAt: new Date().toISOString() } : item),
                                })}
                              />
                            </label>
                            <label className="field">
                              <span>脚本内容</span>
                              <textarea
                                rows={18}
                                className="code-textarea"
                                spellCheck={false}
                                value={script.content}
                                onChange={(event) => updateCharacterCard(editingCharacterCard.id, {
                                  tavernScripts: editingCharacterCard.tavernScripts.map((item) => item.id === script.id ? { ...item, content: event.target.value, updatedAt: new Date().toISOString() } : item),
                                })}
                              />
                            </label>
                            {script.buttons.length > 0 && (
                              <div className="character-script-button-summary">
                                <strong>脚本按钮</strong>
                                <span>{script.buttons.map((button) => button.name).join("、")}</span>
                              </div>
                            )}
                            <div className="topbar-actions">
                              <button
                                type="button"
                                className="ghost-action"
                                onClick={() => {
                                  setSelectedTavernScriptKey(`character:${editingCharacterCard.id}:${script.id}`);
                                  setEditingCharacterCardId("");
                                  setSettingsTab("scripts");
                                  setView("settings");
                                }}
                              >
                                <Settings2 size={14} />
                                完整管理
                              </button>
                              <button type="button" className="ghost-action danger" onClick={() => updateCharacterCard(editingCharacterCard.id, {
                                tavernScripts: editingCharacterCard.tavernScripts.filter((item) => item.id !== script.id),
                              })}><Trash2 size={14} />删除脚本</button>
                            </div>
                          </div>
                        </details>
                      ))}
                    </div>
                    <button type="button" className="ghost-action" onClick={() => updateCharacterCard(editingCharacterCard.id, {
                      tavernScripts: [...editingCharacterCard.tavernScripts, createTavernScript(`角色脚本 ${editingCharacterCard.tavernScripts.length + 1}`)],
                    })}><Plus size={15} />增加角色脚本</button>
                  </div>
                )}
              </div>

              <footer className="character-editor-footer">
                <span>修改会自动保存到本地和应用数据。</span>
                <div>
                  <button type="button" className="ghost-action" onClick={() => exportCharacterJson(editingCharacterCard)}><FileJson size={15} />导出 JSON</button>
                  <button type="button" className="ghost-action" onClick={() => void exportCharacterPng(editingCharacterCard)}><Download size={15} />导出 PNG</button>
                  <button type="button" className="small-action" onClick={() => setEditingCharacterCardId("")}><Check size={15} />完成</button>
                </div>
              </footer>
            </section>
          </div>
        )}

        {characterTranslationPreview && (
          <div className="modal-backdrop character-translation-backdrop" role="dialog" aria-modal="true">
            <section className="character-translation-modal">
              <header className="character-editor-header">
                <div>
                  <h2>翻译预览</h2>
                  <span>勾选要覆盖到角色卡的字段；正则脚本不会翻译。</span>
                </div>
                <button type="button" className="icon-button flat" title="关闭" onClick={() => setCharacterTranslationPreview(null)}><X size={18} /></button>
              </header>
              <div className="character-translation-list">
                {characterTranslationPreview.items.map((item) => (
                  <article key={item.key}>
                    <label className="toggle-field compact-toggle">
                      <input type="checkbox" checked={item.selected} onChange={(event) => setCharacterTranslationPreview((current) => current ? {
                        ...current,
                        items: current.items.map((candidate) => candidate.key === item.key ? { ...candidate, selected: event.target.checked } : candidate),
                      } : current)} />
                      <strong>{item.label}</strong>
                    </label>
                    <div>
                      <label className="field">
                        <span>原文</span>
                        <textarea rows={6} value={item.source} readOnly />
                      </label>
                      <label className="field">
                        <span>译文</span>
                        <textarea rows={6} value={item.translated} onChange={(event) => setCharacterTranslationPreview((current) => current ? {
                          ...current,
                          items: current.items.map((candidate) => candidate.key === item.key ? { ...candidate, translated: event.target.value } : candidate),
                        } : current)} />
                      </label>
                    </div>
                  </article>
                ))}
              </div>
              <footer className="character-editor-footer">
                <button type="button" className="ghost-action" onClick={() => setCharacterTranslationPreview((current) => current ? {
                  ...current,
                  items: current.items.map((item) => ({ ...item, selected: true })),
                } : current)}>全选</button>
                <div>
                  <button type="button" className="ghost-action" onClick={() => setCharacterTranslationPreview(null)}>取消</button>
                  <button type="button" className="small-action" onClick={applySelectedCharacterTranslations}><Check size={15} />应用所选翻译</button>
                </div>
              </footer>
            </section>
          </div>
        )}
      </main>
    );
  }

  if (view === "settings") {
    return (
      <main className={`settings-shell ${mobileSidebarOpen ? "mobile-sidebar-open" : ""}`}>
        <button
          type="button"
          className="mobile-sidebar-toggle"
          title="打开菜单"
          aria-label="打开菜单"
          onClick={openMobileSidebar}
        >
          <Menu size={19} />
        </button>
        <aside className="settings-nav">
          <button
            type="button"
            className="settings-back"
            onClick={() => {
              setView("home");
              closeMobileSidebar();
            }}
          >
            <ArrowLeft size={16} />
            主页
          </button>
          <div className="settings-title">
            <Settings2 size={18} />
            <strong>设置</strong>
          </div>
          <button
            type="button"
            className={`settings-tab ${settingsTab === "providers" ? "active" : ""}`}
            onClick={() => {
              setSettingsTab("providers");
              closeMobileSidebar();
            }}
          >
            <Server size={16} />
            供应商渠道
          </button>
          <button
            type="button"
            className={`settings-tab ${settingsTab === "prompts" ? "active" : ""}`}
            onClick={() => {
              setSettingsTab("prompts");
              closeMobileSidebar();
            }}
          >
            <FileJson size={16} />
            提示词
          </button>
          <button
            type="button"
            className={`settings-tab ${settingsTab === "presets" ? "active" : ""}`}
            onClick={() => {
              setSettingsTab("presets");
              closeMobileSidebar();
            }}
          >
            <SlidersHorizontal size={16} />
            预设
          </button>
          <button
            type="button"
            className={`settings-tab ${settingsTab === "worldbooks" ? "active" : ""}`}
            onClick={() => {
              setSettingsTab("worldbooks");
              closeMobileSidebar();
            }}
          >
            <Bookmark size={16} />
            世界书
          </button>
          <button
            type="button"
            className={`settings-tab ${settingsTab === "regexes" ? "active" : ""}`}
            onClick={() => {
              setSettingsTab("regexes");
              closeMobileSidebar();
            }}
          >
            <Braces size={16} />
            正则
          </button>
          <button
            type="button"
            className={`settings-tab ${settingsTab === "scripts" ? "active" : ""}`}
            onClick={() => {
              setSettingsTab("scripts");
              closeMobileSidebar();
            }}
          >
            <Play size={16} />
            酒馆脚本
          </button>
          <button
            type="button"
            className={`settings-tab ${settingsTab === "user" ? "active" : ""}`}
            onClick={() => {
              setSettingsTab("user");
              closeMobileSidebar();
            }}
          >
            <UserRound size={16} />
            用户资料
          </button>
          <button
            type="button"
            className={`settings-tab ${settingsTab === "personalization" ? "active" : ""}`}
            onClick={() => {
              setSettingsTab("personalization");
              closeMobileSidebar();
            }}
          >
            <Palette size={16} />
            个性化
          </button>
          <button
            type="button"
            className={`settings-tab ${settingsTab === "mcp" ? "active" : ""}`}
            onClick={() => {
              setSettingsTab("mcp");
              closeMobileSidebar();
            }}
          >
            <Boxes size={16} />
            MCP 服务器
          </button>
          <button
            type="button"
            className={`settings-tab ${settingsTab === "skills" ? "active" : ""}`}
            onClick={() => {
              setSettingsTab("skills");
              closeMobileSidebar();
            }}
          >
            <Sparkles size={16} />
            Skills
          </button>
          <button
            type="button"
            className={`settings-tab ${settingsTab === "device" ? "active" : ""}`}
            onClick={() => {
              setSettingsTab("device");
              closeMobileSidebar();
            }}
          >
            <Wrench size={16} />
            手机端
          </button>
        </aside>
        <button
          type="button"
          className="mobile-sidebar-backdrop"
          title="关闭菜单"
          aria-label="关闭菜单"
          onClick={closeMobileSidebar}
        />

        <section className="settings-content">
          <header className="topbar">
            <div>
              <div className="eyebrow">系统设置</div>
              <h1>
                {settingsTab === "providers"
                  ? "供应商渠道"
                  : settingsTab === "prompts"
                    ? "提示词"
                    : settingsTab === "presets"
                      ? "预设"
                      : settingsTab === "worldbooks"
                        ? "世界书"
                        : settingsTab === "regexes"
                          ? "正则后处理"
                          : settingsTab === "scripts"
                            ? "酒馆脚本"
                            : settingsTab === "user"
                              ? "用户资料"
                              : settingsTab === "personalization"
                                ? "个性化"
                                : settingsTab === "mcp"
                                  ? "MCP 服务器"
                                  : settingsTab === "skills"
                                    ? "Skills"
                                    : "手机端"}
              </h1>
            </div>
            {settingsTab === "providers" && (
              <div className="topbar-actions">
                <button
                  type="button"
                  className="ghost-action"
                  onClick={addVolcengineCodingPlanProvider}
                >
                  <Server size={16} />
                  添加火山 Coding Plan
                </button>
                <button type="button" className="small-action" onClick={addProvider}>
                  <Plus size={16} />
                  添加供应商
                </button>
              </div>
            )}
            {settingsTab === "prompts" && (
              <button type="button" className="small-action" onClick={addSystemPrompt}>
                <Plus size={16} />
                添加提示词
              </button>
            )}
            {settingsTab === "presets" && (
              <div className="topbar-actions">
                <button
                  type="button"
                  className="ghost-action"
                  onClick={() => presetImportInputRef.current?.click()}
                >
                  <Upload size={16} />
                  导入酒馆预设
                </button>
                <input
                  ref={presetImportInputRef}
                  className="hidden-input"
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => void importChatPresetFile(event.target.files?.[0])}
                />
                <button type="button" className="small-action" onClick={addChatPreset}>
                  <Plus size={16} />
                  新建预设
                </button>
              </div>
            )}
            {settingsTab === "worldbooks" && (
              <div className="topbar-actions">
                <button
                  type="button"
                  className="ghost-action"
                  onClick={() => worldBookImportInputRef.current?.click()}
                >
                  <Upload size={16} />
                  导入酒馆世界书
                </button>
                <input
                  ref={worldBookImportInputRef}
                  className="hidden-input"
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => void importWorldBookFile(event.target.files?.[0])}
                />
                <button type="button" className="small-action" onClick={addWorldBook}>
                  <Plus size={16} />
                  新建世界书
                </button>
              </div>
            )}
            {settingsTab === "regexes" && (
              <div className="topbar-actions">
                <button
                  type="button"
                  className="ghost-action"
                  onClick={() => regexImportInputRef.current?.click()}
                >
                  <Upload size={16} />
                  导入酒馆正则
                </button>
                <input
                  ref={regexImportInputRef}
                  className="hidden-input"
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => void importRegexScriptFile(event.target.files?.[0])}
                />
                <button type="button" className="small-action" onClick={addRegexScript}>
                  <Plus size={16} />
                  新建正则
                </button>
              </div>
            )}
            {settingsTab === "scripts" && (
              <div className="topbar-actions">
                {tavernScripts.length > 0 && (
                  <button
                    type="button"
                    className="ghost-action"
                    onClick={() =>
                      downloadTavernScriptJson(
                        exportTavernScriptCollectionJson(tavernScripts),
                        "Renge-酒馆脚本",
                      )
                    }
                  >
                    <Download size={16} />
                    导出全局脚本
                  </button>
                )}
                <button
                  type="button"
                  className="ghost-action"
                  onClick={() => tavernScriptImportInputRef.current?.click()}
                >
                  <Upload size={16} />
                  导入酒馆脚本
                </button>
                <input
                  ref={tavernScriptImportInputRef}
                  className="hidden-input"
                  type="file"
                  multiple
                  accept=".json,application/json"
                  onChange={(event) =>
                    void importTavernScriptFiles(event.target.files ?? [])
                  }
                />
                <button type="button" className="small-action" onClick={addTavernScript}>
                  <Plus size={16} />
                  新建脚本
                </button>
              </div>
            )}
            {settingsTab === "mcp" && (
              <div className="topbar-actions">
                <button
                  type="button"
                  className="ghost-action"
                  onClick={() => mcpImportInputRef.current?.click()}
                >
                  <Upload size={16} />
                  导入 JSON
                </button>
                <input
                  ref={mcpImportInputRef}
                  className="hidden-input"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => void importMcpJsonFile(event.target.files?.[0])}
                />
                <button
                  type="button"
                  className="ghost-action"
                  disabled={mcpStatus.status === "loading"}
                  onClick={() => void refreshMcpTools()}
                >
                  <RefreshCw size={16} />
                  发现工具
                </button>
                <button type="button" className="small-action" onClick={addMcpServer}>
                  <Plus size={16} />
                  添加服务器
                </button>
              </div>
            )}
            {settingsTab === "skills" && (
              <div className="topbar-actions">
                <button
                  type="button"
                  className="ghost-action"
                  onClick={() => void selectAndImportSkillFolder()}
                >
                  <FolderOpen size={16} />
                  导入文件夹
                </button>
                <button
                  type="button"
                  className="ghost-action"
                  onClick={() => skillZipInputRef.current?.click()}
                >
                  <Upload size={16} />
                  导入 ZIP
                </button>
                <input
                  ref={skillZipInputRef}
                  className="hidden-input"
                  type="file"
                  accept=".zip,application/zip,application/x-zip-compressed"
                  onChange={(event) => void importSkillZipFile(event.target.files?.[0])}
                />
              </div>
            )}
          </header>

          {settingsTab === "providers" && activeProvider && (
            <div className="settings-grid">
              <aside className="provider-list">
                {providers.map((provider) => (
                  <button
                    type="button"
                    className={`provider-item ${
                      provider.id === activeProvider.id ? "active" : ""
                    }`}
                    key={provider.id}
                    onClick={() => {
                      setActiveProviderId(provider.id);
                      setProviderPullState({ status: "idle", message: "" });
                    }}
                  >
                    <strong>{provider.name || "未命名供应商"}</strong>
                    <span>
                      {[
                        getEffectiveProviderModelId(provider) || "未设置模型",
                        provider.reasoningEnabled
                          ? `思考${getProviderReasoningEffortLabel(provider.reasoningEffort)}`
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                ))}
              </aside>

              <section className="section-block provider-editor">
                <div className="section-heading compact">
                  <div>
                    <h2>供应商设置</h2>
                    <p>兼容 OpenAI 风格接口；模型列表从 API 地址下的 /models 拉取。</p>
                  </div>
                  <button
                    type="button"
                    className="icon-button danger"
                    title="删除供应商"
                    disabled={providers.length <= 1}
                    onClick={deleteProvider}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="provider-form">
                  <label className="field">
                    <span>供应商名称</span>
                    <input
                      value={activeProvider.name}
                      placeholder="例如：OpenAI Compatible"
                      onChange={(event) =>
                        updateProvider(activeProvider.id, { name: event.target.value })
                      }
                    />
                  </label>

                  <label className="field">
                    <span>API 地址</span>
                    <input
                      value={activeProvider.apiBaseUrl}
                      placeholder="例如：https://api.openai.com/v1"
                      onChange={(event) =>
                        updateProvider(activeProvider.id, { apiBaseUrl: event.target.value })
                      }
                    />
                  </label>

                  <label className="field">
                    <span>密钥</span>
                    <div className="secret-input">
                      <KeyRound size={16} />
                      <input
                        type={providerApiKeyVisible ? "text" : "password"}
                        value={activeProvider.apiKey}
                        placeholder="sk-..."
                        onChange={(event) =>
                          updateProvider(activeProvider.id, { apiKey: event.target.value })
                        }
                      />
                      <button
                        type="button"
                        className="secret-toggle"
                        title={providerApiKeyVisible ? "隐藏密钥" : "显示密钥"}
                        aria-label={providerApiKeyVisible ? "隐藏密钥" : "显示密钥"}
                        aria-pressed={providerApiKeyVisible}
                        onClick={() => setProviderApiKeyVisible((visible) => !visible)}
                      >
                        {providerApiKeyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </label>

                  <label className="field">
                    <span>模型 ID</span>
                    <div className="model-input-row">
                      <input
                        value={activeProvider.modelId}
                        placeholder={activeProvider.models.length > 0 ? "留空使用已拉取模型" : "手动填写模型 ID"}
                        onChange={(event) =>
                          updateProvider(activeProvider.id, { modelId: event.target.value })
                        }
                      />
                      {activeProvider.modelId && (
                        <button
                          type="button"
                          className="ghost-action"
                          title="清除模型 ID，恢复使用拉取列表"
                          onClick={() => updateProvider(activeProvider.id, { modelId: "" })}
                        >
                          <X size={16} />
                          清除
                        </button>
                      )}
                      {activeProvider.models.length > 0 && (
                        <select
                          value={
                            activeProvider.models.includes(activeProvider.modelId)
                              ? activeProvider.modelId
                              : activeProvider.modelId
                                ? ""
                                : activeProvider.models[0]
                          }
                          title="选择已拉取模型"
                          onChange={(event) =>
                            updateProvider(activeProvider.id, { modelId: event.target.value })
                          }
                        >
                          <option value="" disabled>
                            选择已拉取模型
                          </option>
                          {activeProvider.models.map((modelId) => (
                            <option key={modelId} value={modelId}>
                              {modelId}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        className="ghost-action"
                        disabled={providerPullState.status === "loading"}
                        onClick={pullProviderModels}
                      >
                        <RefreshCw size={16} />
                        拉取模型
                      </button>
                    </div>
                  </label>

                  <div className="provider-thinking-row">
                    <label
                      className={`provider-thinking-toggle ${
                        activeProvider.reasoningEnabled ? "active" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={activeProvider.reasoningEnabled}
                        onChange={(event) =>
                          updateProvider(activeProvider.id, {
                            reasoningEnabled: event.target.checked,
                          })
                        }
                      />
                      <span>请求思考</span>
                    </label>

                    <label className="field provider-thinking-level">
                      <span>思考强度</span>
                      <select
                        value={activeProvider.reasoningEffort}
                        disabled={!activeProvider.reasoningEnabled}
                        onChange={(event) =>
                          updateProvider(activeProvider.id, {
                            reasoningEffort: normalizeProviderReasoningEffort(event.target.value),
                          })
                        }
                      >
                        {providerReasoningEffortOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {providerPullState.message && (
                    <p className={`provider-status ${providerPullState.status}`}>
                      {providerPullState.message}
                    </p>
                  )}
                </div>
              </section>
            </div>
          )}

          {settingsTab === "prompts" && activeSystemPrompt && (
            <div className="settings-grid prompt-settings-grid">
              <aside className="provider-list prompt-list">
                {systemPrompts.map((promptProfile) => (
                  <div
                    className={`provider-item ${
                      promptProfile.id === activeSystemPrompt.id ? "active" : ""
                    }`}
                    key={promptProfile.id}
                  >
                    <label className="prompt-select-check" title="加入组合">
                      <input
                        type="checkbox"
                        checked={activeSystemPromptIds.includes(promptProfile.id)}
                        onChange={() => toggleSystemPromptSelection(promptProfile.id)}
                      />
                    </label>
                    <button
                      type="button"
                      className="prompt-item-main"
                      onClick={() => setActiveSystemPromptId(promptProfile.id)}
                    >
                      <strong>{promptProfile.name || "未命名提示词"}</strong>
                      <span>{promptProfile.content.trim() ? "已设置内容" : "空提示词"}</span>
                    </button>
                  </div>
                ))}
              </aside>

              <section className="section-block provider-editor prompt-editor">
                <div className="section-heading compact">
                  <div>
                    <h2>System Prompt</h2>
                    <p>左侧勾选的多个提示词会按顺序组合，在 Codex Chat 发送时生效。</p>
                  </div>
                  <button
                    type="button"
                    className="icon-button danger"
                    title="删除提示词"
                    disabled={systemPrompts.length <= 1}
                    onClick={deleteSystemPrompt}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="provider-form prompt-form">
                  <label className="field">
                    <span>名称</span>
                    <input
                      value={activeSystemPrompt.name}
                      placeholder="例如：代码审查助手"
                      onChange={(event) =>
                        updateSystemPrompt(activeSystemPrompt.id, { name: event.target.value })
                      }
                    />
                  </label>

                  <label className="field">
                    <span>内容</span>
                    <textarea
                      className="system-prompt-textarea"
                      value={activeSystemPrompt.content}
                      placeholder="输入会注入到 Codex Chat 的 System Prompt"
                      onChange={(event) =>
                        updateSystemPrompt(activeSystemPrompt.id, {
                          content: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
              </section>
            </div>
          )}

          {settingsTab === "presets" && (
            <div className="settings-grid preset-settings-grid">
              <aside className="provider-list preset-list-panel">
                <label className={`provider-thinking-toggle ${chatPresetEnabled ? "active" : ""}`}>
                  <input
                    type="checkbox"
                    checked={chatPresetEnabled}
                    onChange={(event) => setChatPresetEnabled(event.target.checked)}
                  />
                  应用当前预设到会话
                </label>

                {chatPresets.map((preset) => (
                  <button
                    type="button"
                    className={`provider-item ${preset.id === activeChatPreset?.id ? "active" : ""}`}
                    key={preset.id}
                    onClick={() => {
                      setActiveChatPresetId(preset.id);
                      setSelectedChatPresetPromptId(preset.prompts[0]?.identifier ?? "");
                    }}
                  >
                    <strong>{preset.name}</strong>
                    <span>
                      {preset.sourceFormat === "sillytavern" ? "酒馆原生" : "Renge"} · {preset.prompts.length} 个模块
                    </span>
                  </button>
                ))}

                {presetImportState.status === "error" && presetImportState.message && (
                  <p className="provider-status error">
                    {presetImportState.message}
                  </p>
                )}
              </aside>

              {activeChatPreset ? (
                <section className="section-block preset-editor">
                  <div className="section-heading compact preset-editor-heading">
                    <div>
                      <h2>全局预设编辑器</h2>
                      <p>
                        当前会话使用「{activeChatPreset.name}」；酒馆预设按 prompt_order
                        的顺序和启用状态导入。
                      </p>
                    </div>
                    <div className="topbar-actions">
                      <button type="button" className="ghost-action" onClick={duplicateChatPreset}>
                        <Copy size={15} />
                        另存副本
                      </button>
                      <button type="button" className="danger-action" onClick={deleteChatPreset}>
                        <Trash2 size={15} />
                        删除
                      </button>
                    </div>
                  </div>

                  <div className="preset-meta-grid">
                    <label className="field">
                      <span>预设名称</span>
                      <input
                        value={activeChatPreset.name}
                        onChange={(event) => updateActiveChatPreset({ name: event.target.value })}
                      />
                    </label>
                    <div className="preset-source-card">
                      <span>来源</span>
                      <strong>
                        {activeChatPreset.sourceFormat === "sillytavern"
                          ? `SillyTavern · ${activeChatPreset.sourceFileName || "JSON"}`
                          : "Renge 内建预设"}
                      </strong>
                    </div>
                    <div className="preset-source-card">
                      <span>提示词模块</span>
                      <strong>
                        启用 {activeChatPreset.prompts.filter((prompt) => prompt.enabled).length} / {activeChatPreset.prompts.length} · 正则 {activeChatPreset.regexScripts.length}
                      </strong>
                    </div>
                  </div>

                  <div className="preset-editor-section">
                    <div className="section-heading compact">
                      <div>
                        <h3>主要参数</h3>
                        <p>应用预设时覆盖会话请求的采样和 Token 参数。</p>
                      </div>
                    </div>
                    <div className="preset-parameter-grid">
                      <label className="field">
                        <span>Temperature</span>
                        <input
                          type="number"
                          min="0"
                          max="2"
                          step="0.01"
                          value={activeChatPreset.temperature}
                          onChange={(event) => updateActiveChatPreset({ temperature: Number(event.target.value) })}
                        />
                      </label>
                      <label className="field">
                        <span>Top P</span>
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={activeChatPreset.topP}
                          onChange={(event) => updateActiveChatPreset({ topP: Number(event.target.value) })}
                        />
                      </label>
                      <label className="field">
                        <span>Top K</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={activeChatPreset.topK}
                          onChange={(event) => updateActiveChatPreset({ topK: Number(event.target.value) })}
                        />
                      </label>
                      <label className="field">
                        <span>Top A</span>
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={activeChatPreset.topA}
                          onChange={(event) => updateActiveChatPreset({ topA: Number(event.target.value) })}
                        />
                      </label>
                      <label className="field">
                        <span>Min P</span>
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={activeChatPreset.minP}
                          onChange={(event) => updateActiveChatPreset({ minP: Number(event.target.value) })}
                        />
                      </label>
                      <label className="field">
                        <span>Repetition Penalty</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={activeChatPreset.repetitionPenalty}
                          onChange={(event) => updateActiveChatPreset({ repetitionPenalty: Number(event.target.value) })}
                        />
                      </label>
                      <label className="field">
                        <span>Frequency Penalty</span>
                        <input
                          type="number"
                          min="-2"
                          max="2"
                          step="0.01"
                          value={activeChatPreset.frequencyPenalty}
                          onChange={(event) => updateActiveChatPreset({ frequencyPenalty: Number(event.target.value) })}
                        />
                      </label>
                      <label className="field">
                        <span>Presence Penalty</span>
                        <input
                          type="number"
                          min="-2"
                          max="2"
                          step="0.01"
                          value={activeChatPreset.presencePenalty}
                          onChange={(event) => updateActiveChatPreset({ presencePenalty: Number(event.target.value) })}
                        />
                      </label>
                      <label className="field">
                        <span>最大生成 Tokens</span>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={activeChatPreset.maxTokens}
                          onChange={(event) => updateActiveChatPreset({ maxTokens: Number(event.target.value) })}
                        />
                      </label>
                      <label className="field">
                        <span>最大上下文长度</span>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={activeChatPreset.maxContext}
                          onChange={(event) => updateActiveChatPreset({ maxContext: Number(event.target.value) })}
                        />
                      </label>
                      <label className={`provider-thinking-toggle ${activeChatPreset.squashSystemMessages ? "active" : ""}`}>
                        <input
                          type="checkbox"
                          checked={activeChatPreset.squashSystemMessages}
                          onChange={(event) => updateActiveChatPreset({ squashSystemMessages: event.target.checked })}
                        />
                        合并连续 System 消息
                      </label>
                    </div>
                  </div>

                  <div className="preset-editor-section">
                    <div className="section-heading compact">
                      <div>
                        <h3>提示词注入</h3>
                        <p>
                          模块顺序会直接影响注入顺序；main 放置现有系统提示，chatHistory
                          放置当前会话历史。
                        </p>
                      </div>
                      <button type="button" className="small-action" onClick={addChatPresetPrompt}>
                        <Plus size={15} />
                        添加模块
                      </button>
                    </div>

                    <div className="preset-prompt-workspace">
                      <div className="preset-prompt-list">
                        {activeChatPreset.prompts.length === 0 ? (
                          <div className="preset-empty-state">当前预设没有提示词模块。</div>
                        ) : (
                          activeChatPreset.prompts.map((prompt, index) => (
                            <div
                              className={`preset-prompt-item ${
                                prompt.identifier === selectedChatPresetPrompt?.identifier ? "active" : ""
                              } ${prompt.enabled ? "" : "disabled"}`}
                              key={prompt.identifier}
                            >
                              <input
                                type="checkbox"
                                aria-label={`启用 ${prompt.name}`}
                                checked={prompt.enabled}
                                onChange={(event) =>
                                  updateChatPresetPrompt(prompt.identifier, { enabled: event.target.checked })
                                }
                              />
                              <button
                                type="button"
                                className="preset-prompt-select"
                                onClick={() => setSelectedChatPresetPromptId(prompt.identifier)}
                              >
                                <strong>{prompt.name}</strong>
                                <span>
                                  {prompt.role} · {prompt.marker ? "占位符" : prompt.injectionPosition === 2 ? `聊天深度 ${prompt.injectionDepth}` : "相对注入"}
                                </span>
                              </button>
                              <div className="preset-prompt-order-actions">
                                <button
                                  type="button"
                                  title="上移"
                                  disabled={index === 0}
                                  onClick={() => moveChatPresetPrompt(prompt.identifier, -1)}
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  title="下移"
                                  disabled={index === activeChatPreset.prompts.length - 1}
                                  onClick={() => moveChatPresetPrompt(prompt.identifier, 1)}
                                >
                                  ↓
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {selectedChatPresetPrompt ? (
                        <div className="preset-prompt-editor">
                          <div className="preset-prompt-editor-title">
                            <strong>编辑模块</strong>
                            <button
                              type="button"
                              className="danger-action"
                              onClick={() => deleteChatPresetPrompt(selectedChatPresetPrompt.identifier)}
                            >
                              <Trash2 size={14} />
                              删除模块
                            </button>
                          </div>
                          <label className="field">
                            <span>模块名称</span>
                            <input
                              value={selectedChatPresetPrompt.name}
                              onChange={(event) =>
                                updateChatPresetPrompt(selectedChatPresetPrompt.identifier, { name: event.target.value })
                              }
                            />
                          </label>
                          <div className="preset-prompt-fields-row">
                            <label className="field">
                              <span>角色</span>
                              <select
                                value={selectedChatPresetPrompt.role}
                                onChange={(event) =>
                                  updateChatPresetPrompt(selectedChatPresetPrompt.identifier, {
                                    role: event.target.value as ChatPresetPrompt["role"],
                                  })
                                }
                              >
                                <option value="system">System</option>
                                <option value="user">User</option>
                                <option value="assistant">Assistant</option>
                              </select>
                            </label>
                            <label className="field">
                              <span>位置</span>
                              <select
                                value={selectedChatPresetPrompt.injectionPosition}
                                onChange={(event) =>
                                  updateChatPresetPrompt(selectedChatPresetPrompt.identifier, {
                                    injectionPosition: Number(event.target.value) as 0 | 1 | 2,
                                  })
                                }
                              >
                                <option value={0}>相对注入</option>
                                <option value={1}>相对注入（兼容）</option>
                                <option value={2}>聊天中注入</option>
                              </select>
                            </label>
                            <label className="field">
                              <span>深度</span>
                              <input
                                type="number"
                                min="0"
                                value={selectedChatPresetPrompt.injectionDepth}
                                disabled={selectedChatPresetPrompt.injectionPosition !== 2}
                                onChange={(event) =>
                                  updateChatPresetPrompt(selectedChatPresetPrompt.identifier, {
                                    injectionDepth: Math.max(0, Number(event.target.value)),
                                  })
                                }
                              />
                            </label>
                          </div>
                          <label className="field">
                            <span>提示词内容</span>
                            <textarea
                              className="preset-prompt-content"
                              value={selectedChatPresetPrompt.content}
                              placeholder={selectedChatPresetPrompt.marker ? "这是酒馆占位模块，通常不需要内容。" : "输入要注入会话的提示词"}
                              onChange={(event) =>
                                updateChatPresetPrompt(selectedChatPresetPrompt.identifier, { content: event.target.value })
                              }
                            />
                          </label>
                        </div>
                      ) : (
                        <div className="preset-empty-state">选择一个模块后可编辑内容与注入位置。</div>
                      )}
                    </div>

                    {activeChatPreset.backupPrompts.length > 0 && (
                      <div className="preset-backup-prompts">
                        <strong>备用模块（未进入 prompt_order）</strong>
                        <p>这些模块来自导入文件，但不在酒馆当前顺序表中；点击即可加入当前预设。</p>
                        <div>
                          {activeChatPreset.backupPrompts.map((prompt) => (
                            <button
                              type="button"
                              className="ghost-action"
                              key={prompt.identifier}
                              onClick={() => activateBackupPresetPrompt(prompt.identifier)}
                            >
                              <Plus size={13} />
                              {prompt.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              ) : (
                <section className="section-block preset-empty-state">
                  没有可编辑的预设，请新建或导入酒馆 JSON 预设。
                </section>
              )}
            </div>
          )}

          {settingsTab === "worldbooks" && (
            <div className="settings-grid worldbook-settings-grid">
              <aside className="worldbook-list-panel section-block">
                <div className="section-heading compact">
                  <div>
                    <h2>全局世界书</h2>
                    <p>勾选的世界书会共同作用于普通、人格、多 Agent 和角色扮演会话；角色卡内置世界书仍保持私有。</p>
                  </div>
                </div>
                <div className="worldbook-active-summary">
                  <strong>{activeWorldBookIds.length}</strong>
                  <span>本已启用 · {enabledWorldBookEntryCount} 个可用条目</span>
                </div>
                {worldBookImportState.status === "error" && (
                  <div className="provider-status error">{worldBookImportState.message}</div>
                )}
                <div className="worldbook-list">
                  {worldBooks.length === 0 ? (
                    <div className="preset-empty-state">
                      尚未添加世界书。可导入酒馆原生 JSON，或新建一本世界书。
                    </div>
                  ) : (
                    worldBooks.map((worldBook) => {
                      const active = activeWorldBookIds.includes(worldBook.id);
                      return (
                        <div
                          className={`worldbook-list-item ${
                            worldBook.id === selectedWorldBook?.id ? "selected" : ""
                          } ${active ? "enabled" : ""}`}
                          key={worldBook.id}
                        >
                          <input
                            type="checkbox"
                            aria-label={`在会话中启用 ${worldBook.name}`}
                            checked={active}
                            onChange={() => toggleWorldBook(worldBook.id)}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedWorldBookId(worldBook.id);
                              setSelectedWorldBookEntryId(worldBook.entries[0]?.id ?? "");
                            }}
                          >
                            <strong>{worldBook.name}</strong>
                            <span>
                              {worldBook.entries.filter((entry) => entry.enabled).length}/
                              {worldBook.entries.length} 个条目启用
                            </span>
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </aside>

              {selectedWorldBook ? (
                <section className="worldbook-editor section-block">
                  <div className="worldbook-editor-heading">
                    <div>
                      <h2>世界书编辑器</h2>
                      <p>
                        {selectedWorldBook.sourceFormat === "sillytavern"
                          ? `酒馆原生世界书${selectedWorldBook.sourceFileName ? ` · ${selectedWorldBook.sourceFileName}` : ""}`
                          : "Renge 世界书"}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="danger-action"
                      onClick={deleteSelectedWorldBook}
                    >
                      <Trash2 size={15} />
                      删除世界书
                    </button>
                  </div>

                  <div className="worldbook-book-fields">
                    <label className="field">
                      <span>世界书名称</span>
                      <input
                        value={selectedWorldBook.name}
                        onChange={(event) => updateSelectedWorldBook({ name: event.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>描述</span>
                      <textarea
                        value={selectedWorldBook.description}
                        placeholder="说明这本世界书的用途（可选）"
                        onChange={(event) =>
                          updateSelectedWorldBook({ description: event.target.value })
                        }
                      />
                    </label>
                  </div>

                  <div className="worldbook-entry-heading">
                    <div>
                      <h3>条目</h3>
                      <p>常驻条目始终生效；其他条目在最近对话命中关键词后生效。</p>
                    </div>
                    <button type="button" className="small-action" onClick={addWorldBookEntry}>
                      <Plus size={15} />
                      添加条目
                    </button>
                  </div>

                  <div className="worldbook-entry-workspace">
                    <div className="worldbook-entry-list">
                      {selectedWorldBook.entries.length === 0 ? (
                        <div className="preset-empty-state">当前世界书没有条目。</div>
                      ) : (
                        selectedWorldBook.entries.map((entry, index) => (
                          <div
                            className={`worldbook-entry-item ${
                              entry.id === selectedWorldBookEntry?.id ? "active" : ""
                            } ${entry.enabled ? "" : "disabled"}`}
                            key={entry.id}
                          >
                            <input
                              type="checkbox"
                              aria-label={`启用 ${entry.comment || `条目 ${index + 1}`}`}
                              checked={entry.enabled}
                              onChange={(event) =>
                                updateWorldBookEntry(entry.id, { enabled: event.target.checked })
                              }
                            />
                            <button
                              type="button"
                              className="worldbook-entry-select"
                              onClick={() => setSelectedWorldBookEntryId(entry.id)}
                            >
                              <strong>{entry.comment || `条目 ${index + 1}`}</strong>
                              <span>
                                {entry.constant
                                  ? "常驻"
                                  : entry.keys.length > 0
                                    ? entry.keys.join("、")
                                    : "无触发词"}
                              </span>
                            </button>
                            <div className="worldbook-entry-order-actions">
                              <button
                                type="button"
                                title="上移"
                                disabled={index === 0}
                                onClick={() => moveWorldBookEntry(entry.id, -1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                title="下移"
                                disabled={index === selectedWorldBook.entries.length - 1}
                                onClick={() => moveWorldBookEntry(entry.id, 1)}
                              >
                                ↓
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {selectedWorldBookEntry ? (
                      <div className="worldbook-entry-editor">
                        <div className="worldbook-entry-editor-title">
                          <strong>编辑条目</strong>
                          <button
                            type="button"
                            className="danger-action"
                            onClick={() => deleteWorldBookEntry(selectedWorldBookEntry.id)}
                          >
                            <Trash2 size={14} />
                            删除条目
                          </button>
                        </div>
                        <label className="field">
                          <span>条目名称</span>
                          <input
                            value={selectedWorldBookEntry.comment}
                            onChange={(event) =>
                              updateWorldBookEntry(selectedWorldBookEntry.id, {
                                comment: event.target.value,
                              })
                            }
                          />
                        </label>
                        <div className="worldbook-key-fields">
                          <label className="field">
                            <span>主关键词</span>
                            <textarea
                              value={selectedWorldBookEntry.keys.join("\n")}
                              placeholder="每行一个，或使用逗号分隔"
                              onChange={(event) =>
                                updateWorldBookEntry(selectedWorldBookEntry.id, {
                                  keys: event.target.value
                                    .split(/[\n,，]+/)
                                    .map((value) => value.trim())
                                    .filter(Boolean),
                                })
                              }
                            />
                          </label>
                          <label className="field">
                            <span>次关键词</span>
                            <textarea
                              value={selectedWorldBookEntry.secondaryKeys.join("\n")}
                              placeholder="选择性匹配时使用"
                              onChange={(event) =>
                                updateWorldBookEntry(selectedWorldBookEntry.id, {
                                  secondaryKeys: event.target.value
                                    .split(/[\n,，]+/)
                                    .map((value) => value.trim())
                                    .filter(Boolean),
                                })
                              }
                            />
                          </label>
                        </div>
                        <label className="field worldbook-content-field">
                          <span>条目内容</span>
                          <textarea
                            value={selectedWorldBookEntry.content}
                            placeholder="命中后注入会话的设定、规则或背景内容"
                            onChange={(event) =>
                              updateWorldBookEntry(selectedWorldBookEntry.id, {
                                content: event.target.value,
                              })
                            }
                          />
                        </label>

                        <div className="worldbook-toggle-grid">
                          <label className={`provider-thinking-toggle ${selectedWorldBookEntry.constant ? "active" : ""}`}>
                            <input
                              type="checkbox"
                              checked={selectedWorldBookEntry.constant}
                              onChange={(event) =>
                                updateWorldBookEntry(selectedWorldBookEntry.id, {
                                  constant: event.target.checked,
                                })
                              }
                            />
                            常驻条目
                          </label>
                          <label className={`provider-thinking-toggle ${selectedWorldBookEntry.selective ? "active" : ""}`}>
                            <input
                              type="checkbox"
                              checked={selectedWorldBookEntry.selective}
                              onChange={(event) =>
                                updateWorldBookEntry(selectedWorldBookEntry.id, {
                                  selective: event.target.checked,
                                })
                              }
                            />
                            选择性匹配
                          </label>
                          <label className={`provider-thinking-toggle ${selectedWorldBookEntry.caseSensitive ? "active" : ""}`}>
                            <input
                              type="checkbox"
                              checked={selectedWorldBookEntry.caseSensitive}
                              onChange={(event) =>
                                updateWorldBookEntry(selectedWorldBookEntry.id, {
                                  caseSensitive: event.target.checked,
                                })
                              }
                            />
                            区分大小写
                          </label>
                          <label className={`provider-thinking-toggle ${selectedWorldBookEntry.matchWholeWords ? "active" : ""}`}>
                            <input
                              type="checkbox"
                              checked={selectedWorldBookEntry.matchWholeWords}
                              onChange={(event) =>
                                updateWorldBookEntry(selectedWorldBookEntry.id, {
                                  matchWholeWords: event.target.checked,
                                })
                              }
                            />
                            完整词匹配
                          </label>
                          <label className={`provider-thinking-toggle ${selectedWorldBookEntry.useRegex ? "active" : ""}`}>
                            <input
                              type="checkbox"
                              checked={selectedWorldBookEntry.useRegex}
                              onChange={(event) =>
                                updateWorldBookEntry(selectedWorldBookEntry.id, {
                                  useRegex: event.target.checked,
                                })
                              }
                            />
                            正则匹配
                          </label>
                          <label className={`provider-thinking-toggle ${selectedWorldBookEntry.useProbability ? "active" : ""}`}>
                            <input
                              type="checkbox"
                              checked={selectedWorldBookEntry.useProbability}
                              onChange={(event) =>
                                updateWorldBookEntry(selectedWorldBookEntry.id, {
                                  useProbability: event.target.checked,
                                })
                              }
                            />
                            使用触发概率
                          </label>
                        </div>

                        <div className="worldbook-advanced-fields">
                          <label className="field">
                            <span>次关键词逻辑</span>
                            <select
                              value={selectedWorldBookEntry.selectiveLogic}
                              disabled={!selectedWorldBookEntry.selective}
                              onChange={(event) =>
                                updateWorldBookEntry(selectedWorldBookEntry.id, {
                                  selectiveLogic: Number(event.target.value),
                                })
                              }
                            >
                              <option value={0}>任一命中</option>
                              <option value={3}>全部命中</option>
                              <option value={2}>全部不命中</option>
                              <option value={1}>非全部命中</option>
                            </select>
                          </label>
                          <label className="field">
                            <span>注入位置</span>
                            <select
                              value={selectedWorldBookEntry.position}
                              onChange={(event) =>
                                updateWorldBookEntry(selectedWorldBookEntry.id, {
                                  position: event.target.value as WorldBookEntry["position"],
                                })
                              }
                            >
                              <option value="before_char">角色定义之前</option>
                              <option value="after_char">角色定义之后</option>
                              <option value="before_an">作者注释之前</option>
                              <option value="after_an">作者注释之后</option>
                              <option value="at_depth">指定聊天深度</option>
                            </select>
                          </label>
                          <label className="field">
                            <span>注入深度</span>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={selectedWorldBookEntry.depth}
                              onChange={(event) =>
                                updateWorldBookEntry(selectedWorldBookEntry.id, {
                                  depth: Math.max(0, Number(event.target.value)),
                                })
                              }
                            />
                          </label>
                          <label className="field">
                            <span>扫描深度</span>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={selectedWorldBookEntry.scanDepth ?? ""}
                              placeholder="默认 8"
                              onChange={(event) =>
                                updateWorldBookEntry(selectedWorldBookEntry.id, {
                                  scanDepth: event.target.value
                                    ? Math.max(1, Number(event.target.value))
                                    : null,
                                })
                              }
                            />
                          </label>
                          <label className="field">
                            <span>排序</span>
                            <input
                              type="number"
                              step="1"
                              value={selectedWorldBookEntry.order}
                              onChange={(event) =>
                                updateWorldBookEntry(selectedWorldBookEntry.id, {
                                  order: Number(event.target.value),
                                })
                              }
                            />
                          </label>
                          <label className="field">
                            <span>触发概率（%）</span>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              disabled={!selectedWorldBookEntry.useProbability}
                              value={selectedWorldBookEntry.probability}
                              onChange={(event) =>
                                updateWorldBookEntry(selectedWorldBookEntry.id, {
                                  probability: Math.min(100, Math.max(0, Number(event.target.value))),
                                })
                              }
                            />
                          </label>
                        </div>
                      </div>
                    ) : (
                      <div className="preset-empty-state">选择一个条目后可编辑匹配规则和内容。</div>
                    )}
                  </div>
                </section>
              ) : (
                <section className="section-block preset-empty-state">
                  没有可编辑的世界书，请新建或导入酒馆 JSON 世界书。
                </section>
              )}
            </div>
          )}

          {settingsTab === "regexes" && (
            <div className="settings-grid regex-settings-grid">
              <aside className="regex-list-panel section-block">
                <div className="section-heading compact">
                  <div>
                    <h2>正则后处理</h2>
                    <p>按列表顺序处理 AI 的显示文本，原始会话内容保持不变。</p>
                  </div>
                </div>
                <div className="regex-active-summary">
                  <strong>
                    {effectiveRegexScripts.filter(
                      (script) =>
                        !script.disabled &&
                        script.placement.includes(2) &&
                        !script.promptOnly,
                    ).length}
                  </strong>
                  <span>
                    个当前生效 · 全局 {regexScripts.length} · 预设 {chatPresets.reduce((total, preset) => total + preset.regexScripts.length, 0)} · 当前角色私有 {scopedRoleplayCard?.regexScripts.length ?? 0}（不进入全局列表）
                  </span>
                </div>
                {regexImportState.status === "error" && (
                  <div className="provider-status error">{regexImportState.message}</div>
                )}
                <div className="regex-script-list">
                  {regexScriptTargets.length === 0 ? (
                    <div className="preset-empty-state">
                      尚未添加正则。可导入酒馆原生 JSON，或新建一条规则。
                    </div>
                  ) : (
                    regexScriptTargets.map((target) => {
                      const presetIsActive =
                        target.scope === "preset" &&
                        chatPresetEnabled &&
                        target.presetId === activeChatPreset?.id;
                      return (
                        <div
                          className={`regex-script-item ${
                            target.key === selectedRegexTarget?.key ? "selected" : ""
                          } ${target.script.disabled ? "disabled" : ""}`}
                          key={target.key}
                        >
                          <input
                            type="checkbox"
                            aria-label={`启用正则 ${target.script.scriptName}`}
                            checked={!target.script.disabled}
                            onChange={(event) =>
                              updateRegexScriptTarget(target, {
                                disabled: !event.target.checked,
                              })
                            }
                          />
                          <button
                            type="button"
                            className="regex-script-select"
                            onClick={() => setSelectedRegexTargetKey(target.key)}
                          >
                            <strong>{target.script.scriptName}</strong>
                            <span>
                              {target.scope === "global"
                                ? "全局"
                                : `预设 · ${target.presetName}${presetIsActive ? " · 当前生效" : ""}`}
                            </span>
                          </button>
                          <div className="regex-script-order-actions">
                            <button
                              type="button"
                              title="上移"
                              disabled={target.index === 0}
                              onClick={() => moveRegexScriptTarget(target, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              title="下移"
                              disabled={target.index === target.total - 1}
                              onClick={() => moveRegexScriptTarget(target, 1)}
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </aside>

              {selectedRegexTarget ? (
                <section className="regex-editor section-block">
                  <div className="regex-editor-heading">
                    <div>
                      <h2>正则脚本编辑器</h2>
                      <p>
                        {selectedRegexTarget.scope === "global"
                          ? `全局规则${selectedRegexTarget.script.sourceFileName ? ` · ${selectedRegexTarget.script.sourceFileName}` : ""}`
                          : `预设规则 · ${selectedRegexTarget.presetName}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="danger-action"
                      onClick={() => deleteRegexScriptTarget(selectedRegexTarget)}
                    >
                      <Trash2 size={15} />
                      删除正则
                    </button>
                  </div>

                  <label className="field">
                    <span>规则名称</span>
                    <input
                      value={selectedRegexTarget.script.scriptName}
                      onChange={(event) =>
                        updateRegexScriptTarget(selectedRegexTarget, {
                          scriptName: event.target.value,
                        })
                      }
                    />
                  </label>

                  <label className="field regex-find-field">
                    <span>查找正则</span>
                    <textarea
                      value={selectedRegexTarget.script.findRegex}
                      placeholder="支持原始表达式，或 /pattern/gim 格式"
                      spellCheck={false}
                      onChange={(event) =>
                        updateRegexScriptTarget(selectedRegexTarget, {
                          findRegex: event.target.value,
                        })
                      }
                    />
                  </label>
                  {selectedRegexError && (
                    <div className="regex-validation-error">
                      <strong>正则不可执行</strong>
                      <span>{selectedRegexError}</span>
                    </div>
                  )}

                  <label className="field regex-replace-field">
                    <span>替换内容</span>
                    <textarea
                      value={selectedRegexTarget.script.replaceString}
                      placeholder="支持 $1、$2 等捕获组；可以包含 Markdown 或 HTML/CSS"
                      spellCheck={false}
                      onChange={(event) =>
                        updateRegexScriptTarget(selectedRegexTarget, {
                          replaceString: event.target.value,
                        })
                      }
                    />
                  </label>

                  <div className="regex-toggle-grid">
                    <label className={`provider-thinking-toggle ${!selectedRegexTarget.script.disabled ? "active" : ""}`}>
                      <input
                        type="checkbox"
                        checked={!selectedRegexTarget.script.disabled}
                        onChange={(event) =>
                          updateRegexScriptTarget(selectedRegexTarget, {
                            disabled: !event.target.checked,
                          })
                        }
                      />
                      启用规则
                    </label>
                    <label className={`provider-thinking-toggle ${selectedRegexTarget.script.markdownOnly ? "active" : ""}`}>
                      <input
                        type="checkbox"
                        checked={selectedRegexTarget.script.markdownOnly}
                        onChange={(event) =>
                          updateRegexScriptTarget(selectedRegexTarget, {
                            markdownOnly: event.target.checked,
                          })
                        }
                      />
                      仅显示文本
                    </label>
                    <label className={`provider-thinking-toggle ${selectedRegexTarget.script.promptOnly ? "active" : ""}`}>
                      <input
                        type="checkbox"
                        checked={selectedRegexTarget.script.promptOnly}
                        onChange={(event) =>
                          updateRegexScriptTarget(selectedRegexTarget, {
                            promptOnly: event.target.checked,
                          })
                        }
                      />
                      仅提示词
                    </label>
                    <label className={`provider-thinking-toggle ${selectedRegexTarget.script.runOnEdit ? "active" : ""}`}>
                      <input
                        type="checkbox"
                        checked={selectedRegexTarget.script.runOnEdit}
                        onChange={(event) =>
                          updateRegexScriptTarget(selectedRegexTarget, {
                            runOnEdit: event.target.checked,
                          })
                        }
                      />
                      编辑后重跑
                    </label>
                    <label className={`provider-thinking-toggle ${selectedRegexTarget.script.substituteRegex > 0 ? "active" : ""}`}>
                      <input
                        type="checkbox"
                        checked={selectedRegexTarget.script.substituteRegex > 0}
                        onChange={(event) =>
                          updateRegexScriptTarget(selectedRegexTarget, {
                            substituteRegex: event.target.checked ? 1 : 0,
                          })
                        }
                      />
                      替换正则宏
                    </label>
                  </div>

                  <div className="regex-editor-section">
                    <div>
                      <h3>执行位置</h3>
                      <p>Renge 当前只对 AI 输出的显示文本执行；其他位置会原样保留以兼容酒馆格式。</p>
                    </div>
                    <div className="regex-placement-grid">
                      {[
                        { value: 1, label: "用户输入" },
                        { value: 2, label: "AI 输出" },
                        { value: 3, label: "快捷命令" },
                        { value: 5, label: "世界书" },
                      ].map((placement) => (
                        <label
                          className={`provider-thinking-toggle ${
                            selectedRegexTarget.script.placement.includes(placement.value)
                              ? "active"
                              : ""
                          }`}
                          key={placement.value}
                        >
                          <input
                            type="checkbox"
                            checked={selectedRegexTarget.script.placement.includes(placement.value)}
                            onChange={() =>
                              toggleRegexPlacement(selectedRegexTarget, placement.value)
                            }
                          />
                          {placement.label}（{placement.value}）
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="regex-advanced-fields">
                    <label className="field">
                      <span>最小深度</span>
                      <input
                        type="number"
                        min="0"
                        value={selectedRegexTarget.script.minDepth ?? ""}
                        placeholder="不限制"
                        onChange={(event) =>
                          updateRegexScriptTarget(selectedRegexTarget, {
                            minDepth: event.target.value
                              ? Math.max(0, Number(event.target.value))
                              : null,
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>最大深度</span>
                      <input
                        type="number"
                        min="0"
                        value={selectedRegexTarget.script.maxDepth ?? ""}
                        placeholder="不限制"
                        onChange={(event) =>
                          updateRegexScriptTarget(selectedRegexTarget, {
                            maxDepth: event.target.value
                              ? Math.max(0, Number(event.target.value))
                              : null,
                          })
                        }
                      />
                    </label>
                    <label className="field regex-trim-field">
                      <span>替换后移除字符串</span>
                      <textarea
                        value={selectedRegexTarget.script.trimStrings.join("\n")}
                        placeholder="每行一个；通常保持为空"
                        onChange={(event) =>
                          updateRegexScriptTarget(selectedRegexTarget, {
                            trimStrings: event.target.value
                              .split("\n")
                              .map((value) => value.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </label>
                  </div>

                  <div className="regex-editor-note">
                    <Braces size={16} />
                    <span>
                      替换内容中的 HTML/CSS 需要在会话侧栏开启“渲染 HTML”。正则只改变显示结果，不会修改存档原文，也不会发送给 AI。
                    </span>
                  </div>
                </section>
              ) : (
                <section className="section-block preset-empty-state">
                  没有可编辑的正则，请新建或导入酒馆 JSON 正则。
                </section>
              )}
            </div>
          )}

          {settingsTab === "scripts" && (
            <div className="settings-grid tavern-script-settings-grid">
              <aside className="section-block tavern-script-list-panel">
                <div className="section-heading compact">
                  <div>
                    <h2>脚本管理器</h2>
                    <p>全局脚本作用于所有会话；角色内置脚本只在绑定角色的会话运行。</p>
                  </div>
                </div>
                <div className={`tavern-runtime-summary ${tavernRuntimeStatus.state}`}>
                  <span>
                    全局 {tavernScripts.length} · 角色内置 {characterCards.reduce(
                      (total, card) => total + card.tavernScripts.length,
                      0,
                    )}
                  </span>
                  <strong>
                    {tavernRuntimeStatus.state === "ready"
                      ? "运行中"
                      : tavernRuntimeStatus.state === "loading"
                        ? "正在加载"
                        : tavernRuntimeStatus.state === "error"
                          ? "运行异常"
                          : "未启动"}
                  </strong>
                </div>
                {tavernRuntimeStatus.state === "error" && tavernRuntimeStatus.message && (
                  <div className="provider-status error">{tavernRuntimeStatus.message}</div>
                )}
                {tavernScriptImportState.status === "error" && (
                  <div className="provider-status error">{tavernScriptImportState.message}</div>
                )}
                <div className="tavern-script-list">
                  {tavernScriptTargets.length === 0 ? (
                    <div className="preset-empty-state">
                      导入酒馆助手脚本 JSON，或新建一个全局脚本。
                    </div>
                  ) : (
                    tavernScriptTargets.map((target) => {
                      const characterIsActive =
                        target.scope === "character" &&
                        target.characterId === scopedRoleplayCard?.id;
                      return (
                        <div
                          className={`tavern-script-item ${
                            selectedTavernScriptTarget?.key === target.key ? "active" : ""
                          }`}
                          key={target.key}
                        >
                          <button
                            type="button"
                            className="tavern-script-select"
                            onClick={() => setSelectedTavernScriptKey(target.key)}
                          >
                            <strong>{target.script.name || "未命名脚本"}</strong>
                            <span>
                              {target.scope === "global"
                                ? "全局脚本"
                                : `角色内置 · ${target.characterName}${
                                    characterIsActive ? " · 当前生效" : ""
                                  }`}
                            </span>
                            <small>
                              {target.script.enabled ? "已启用" : "已停用"} · {
                                target.script.runOn === "startup"
                                  ? "会话启动"
                                  : target.script.runOn === "message"
                                    ? "收到消息"
                                    : "手动运行"
                              }
                            </small>
                          </button>
                          <div className="tavern-script-order-actions">
                            <button
                              type="button"
                              title="上移"
                              disabled={target.index === 0}
                              onClick={() => moveTavernScriptTarget(target, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              title="下移"
                              disabled={target.index === target.total - 1}
                              onClick={() => moveTavernScriptTarget(target, 1)}
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </aside>

              {selectedTavernScriptTarget ? (
                <section className="section-block tavern-script-editor">
                  <div className="tavern-script-editor-heading">
                    <div>
                      <span>
                        {selectedTavernScriptTarget.scope === "global"
                          ? "全局酒馆脚本"
                          : `角色内置脚本 · ${selectedTavernScriptTarget.characterName}`}
                      </span>
                      <h2>{selectedTavernScriptTarget.script.name || "未命名脚本"}</h2>
                    </div>
                    <div className="topbar-actions">
                      <button
                        type="button"
                        className="ghost-action"
                        disabled={tavernScriptImportState.status === "loading"}
                        onClick={() => void runSelectedTavernScript()}
                      >
                        <Play size={15} />
                        立即运行
                      </button>
                      <button
                        type="button"
                        className="ghost-action"
                        onClick={() =>
                          downloadTavernScriptJson(
                            exportTavernScriptJson(selectedTavernScriptTarget.script),
                            selectedTavernScriptTarget.script.name,
                          )
                        }
                      >
                        <Download size={15} />
                        导出
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        title="删除脚本"
                        onClick={() => deleteTavernScriptTarget(selectedTavernScriptTarget)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="tavern-script-meta-grid">
                    <label className="field">
                      <span>脚本名称</span>
                      <input
                        value={selectedTavernScriptTarget.script.name}
                        onChange={(event) =>
                          updateTavernScriptTarget(selectedTavernScriptTarget, {
                            name: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>运行时机</span>
                      <select
                        value={selectedTavernScriptTarget.script.runOn}
                        onChange={(event) =>
                          updateTavernScriptTarget(selectedTavernScriptTarget, {
                            runOn: event.target.value as TavernScript["runOn"],
                          })
                        }
                      >
                        <option value="startup">进入会话时运行</option>
                        <option value="message">首次收发消息时运行</option>
                        <option value="manual">仅手动运行</option>
                      </select>
                    </label>
                    <label className="field tavern-script-info-field">
                      <span>说明</span>
                      <input
                        value={selectedTavernScriptTarget.script.info}
                        placeholder="脚本用途或依赖说明"
                        onChange={(event) =>
                          updateTavernScriptTarget(selectedTavernScriptTarget, {
                            info: event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>

                  <div className="tavern-script-toggle-grid">
                    <label className="provider-thinking-toggle active">
                      <input
                        type="checkbox"
                        checked={selectedTavernScriptTarget.script.enabled}
                        onChange={(event) =>
                          updateTavernScriptTarget(selectedTavernScriptTarget, {
                            enabled: event.target.checked,
                          })
                        }
                      />
                      启用脚本
                    </label>
                    <label className="provider-thinking-toggle active">
                      <input
                        type="checkbox"
                        checked={selectedTavernScriptTarget.script.autoRun}
                        onChange={(event) =>
                          updateTavernScriptTarget(selectedTavernScriptTarget, {
                            autoRun: event.target.checked,
                          })
                        }
                      />
                      自动运行
                    </label>
                    <label className="provider-thinking-toggle active">
                      <input
                        type="checkbox"
                        checked={selectedTavernScriptTarget.script.buttonEnabled}
                        onChange={(event) =>
                          updateTavernScriptTarget(selectedTavernScriptTarget, {
                            buttonEnabled: event.target.checked,
                          })
                        }
                      />
                      显示脚本按钮
                    </label>
                  </div>

                  <label className="field tavern-script-content-field">
                    <span>脚本内容</span>
                    <textarea
                      value={selectedTavernScriptTarget.script.content}
                      spellCheck={false}
                      placeholder="支持酒馆助手原生 JavaScript 与远程 ES Module import"
                      onChange={(event) =>
                        updateTavernScriptTarget(selectedTavernScriptTarget, {
                          content: event.target.value,
                        })
                      }
                    />
                  </label>

                  <div className="tavern-script-editor-section">
                    <div className="section-heading compact">
                      <div>
                        <h3>脚本按钮</h3>
                        <p>可见按钮会显示在会话输入框上方，并触发脚本注册的按钮事件。</p>
                      </div>
                      <button
                        type="button"
                        className="ghost-action"
                        onClick={() =>
                          updateTavernScriptTarget(selectedTavernScriptTarget, {
                            buttons: [
                              ...selectedTavernScriptTarget.script.buttons,
                              {
                                id: crypto.randomUUID(),
                                name: `按钮 ${selectedTavernScriptTarget.script.buttons.length + 1}`,
                                visible: true,
                              },
                            ],
                          })
                        }
                      >
                        <Plus size={14} />
                        添加按钮
                      </button>
                    </div>
                    <div className="tavern-script-button-editor-list">
                      {selectedTavernScriptTarget.script.buttons.length === 0 ? (
                        <div className="preset-empty-state">此脚本没有按钮。</div>
                      ) : (
                        selectedTavernScriptTarget.script.buttons.map((button) => (
                          <div className="tavern-script-button-editor" key={button.id}>
                            <input
                              value={button.name}
                              aria-label="按钮名称"
                              onChange={(event) =>
                                updateTavernScriptTarget(selectedTavernScriptTarget, {
                                  buttons: selectedTavernScriptTarget.script.buttons.map((item) =>
                                    item.id === button.id
                                      ? { ...item, name: event.target.value }
                                      : item,
                                  ),
                                })
                              }
                            />
                            <label className="tool-toggle">
                              <input
                                type="checkbox"
                                checked={button.visible}
                                onChange={(event) =>
                                  updateTavernScriptTarget(selectedTavernScriptTarget, {
                                    buttons: selectedTavernScriptTarget.script.buttons.map((item) =>
                                      item.id === button.id
                                        ? { ...item, visible: event.target.checked }
                                        : item,
                                    ),
                                  })
                                }
                              />
                              <span>可见</span>
                            </label>
                            <button
                              type="button"
                              className="icon-button danger"
                              title="删除按钮"
                              onClick={() =>
                                updateTavernScriptTarget(selectedTavernScriptTarget, {
                                  buttons: selectedTavernScriptTarget.script.buttons.filter(
                                    (item) => item.id !== button.id,
                                  ),
                                })
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="tavern-script-data-section">
                    <label className="field">
                      <span>脚本数据（JSON）</span>
                      <textarea
                        value={tavernScriptDataDraft}
                        spellCheck={false}
                        onChange={(event) => setTavernScriptDataDraft(event.target.value)}
                      />
                    </label>
                    <button type="button" className="ghost-action" onClick={saveTavernScriptData}>
                      <Save size={14} />
                      保存脚本数据
                    </button>
                  </div>

                  <details className="tavern-script-log-panel">
                    <summary>
                      运行日志
                      <span>{tavernRuntimeLogs.length} 条</span>
                    </summary>
                    <div className="tavern-script-log-list">
                      {tavernRuntimeLogs.length === 0 ? (
                        <p>当前还没有脚本运行日志。</p>
                      ) : (
                        [...tavernRuntimeLogs].reverse().map((log) => (
                          <div className={`tavern-script-log ${log.level}`} key={log.id}>
                            <span>
                              {new Date(log.createdAt).toLocaleTimeString("zh-CN", {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })}
                            </span>
                            <strong>{log.scriptName}</strong>
                            <p>{log.message}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </details>

                  <div className="tavern-script-security-note">
                    <Braces size={16} />
                    <span>
                      酒馆脚本可以运行远程 JavaScript，并能读写当前会话消息和变量。请只启用来源可信的脚本。
                    </span>
                  </div>
                </section>
              ) : (
                <section className="section-block preset-empty-state">
                  没有可编辑的酒馆脚本，请新建或导入 JSON 文件。
                </section>
              )}
            </div>
          )}

          {settingsTab === "user" && (
            <section className="section-block user-profile-settings">
              <div className="section-heading compact">
                <div>
                  <h2>用户资料</h2>
                  <p>用于聊天界面的用户显示；开启后昵称和简介会注入给 AI。</p>
                </div>
              </div>

              <div className="user-profile-form">
                <label className="field avatar-profile">
                  <span>用户头像</span>
                  <button
                    type="button"
                    className="avatar-upload"
                    onClick={() => userAvatarInputRef.current?.click()}
                  >
                    {userProfile.avatarImage ? (
                      <img src={userProfile.avatarImage} alt={`${userProfile.nickname || "User"} 头像`} />
                    ) : (
                      <UserRound size={42} />
                    )}
                  </button>
                  <input
                    ref={userAvatarInputRef}
                    className="hidden-input"
                    type="file"
                    accept="image/*"
                    onChange={(event) => selectAvatarFile(event.target.files?.[0], "user")}
                  />
                </label>

                <label className="field">
                  <span>用户昵称</span>
                  <input
                    value={userProfile.nickname}
                    placeholder="例如：我"
                    onChange={(event) =>
                      setUserProfile((current) => ({
                        ...current,
                        nickname: event.target.value,
                        updatedAt: new Date().toISOString(),
                      }))
                    }
                  />
                </label>

                <label className="field">
                  <span>用户简介</span>
                  <textarea
                    value={userProfile.bio}
                    placeholder="写给 AI 了解你的简短资料"
                    onChange={(event) =>
                      setUserProfile((current) => ({
                        ...current,
                        bio: event.target.value,
                        updatedAt: new Date().toISOString(),
                      }))
                    }
                  />
                </label>

                <label className="tool-toggle user-profile-toggle">
                  <input
                    type="checkbox"
                    checked={userProfile.sendToAi}
                    onChange={(event) =>
                      setUserProfile((current) => ({
                        ...current,
                        sendToAi: event.target.checked,
                        updatedAt: new Date().toISOString(),
                      }))
                    }
                  />
                  <span>发送用户昵称和简介给 AI</span>
                </label>
              </div>
            </section>
          )}

          {settingsTab === "personalization" && (
            <section
              className={`section-block personalization-settings ${
                chatPersonalization.quoteStyleEnabled ? "quote-style-enabled" : ""
              } ${chatPersonalization.italicStyleEnabled ? "italic-style-enabled" : ""}`}
              style={
                {
                  "--chat-quote-color": chatPersonalization.quoteStyleColor,
                  "--chat-italic-color": chatPersonalization.italicStyleColor,
                } as CSSProperties
              }
            >
              <div className="section-heading compact">
                <div>
                  <h2>聊天文字样式</h2>
                  <p>为对话中的引用内容和斜体内容设置独立颜色。</p>
                </div>
              </div>

              <div className="personalization-style-list">
                <article className="personalization-style-card">
                  <div className="personalization-style-heading">
                    <label className="tool-toggle personalization-toggle">
                      <input
                        type="checkbox"
                        checked={chatPersonalization.quoteStyleEnabled}
                        onChange={(event) =>
                          setChatPersonalization((current) => ({
                            ...current,
                            quoteStyleEnabled: event.target.checked,
                          }))
                        }
                      />
                      <span>引用文样式</span>
                    </label>
                    <label className="personalization-color-field">
                      <span>颜色</span>
                      <input
                        type="color"
                        aria-label="引用文样式颜色"
                        value={chatPersonalization.quoteStyleColor}
                        onChange={(event) =>
                          setChatPersonalization((current) => ({
                            ...current,
                            quoteStyleColor: event.target.value.toUpperCase(),
                          }))
                        }
                      />
                      <code>{chatPersonalization.quoteStyleColor}</code>
                    </label>
                  </div>
                  <p>
                    适用于半角/全角双引号、中文弯引号、`「」`、`『』` 和半角 `｢｣`
                    包裹的内容。
                  </p>
                  <div className="personalization-preview" aria-label="引用文样式预览">
                    {renderInlineText('“这是引用文样式预览”')}
                  </div>
                </article>

                <article className="personalization-style-card">
                  <div className="personalization-style-heading">
                    <label className="tool-toggle personalization-toggle">
                      <input
                        type="checkbox"
                        checked={chatPersonalization.italicStyleEnabled}
                        onChange={(event) =>
                          setChatPersonalization((current) => ({
                            ...current,
                            italicStyleEnabled: event.target.checked,
                          }))
                        }
                      />
                      <span>斜体文样式</span>
                    </label>
                    <label className="personalization-color-field">
                      <span>颜色</span>
                      <input
                        type="color"
                        aria-label="斜体文样式颜色"
                        value={chatPersonalization.italicStyleColor}
                        onChange={(event) =>
                          setChatPersonalization((current) => ({
                            ...current,
                            italicStyleColor: event.target.value.toUpperCase(),
                          }))
                        }
                      />
                      <code>{chatPersonalization.italicStyleColor}</code>
                    </label>
                  </div>
                  <p>适用于单星号 `*文本*` 包裹的 Markdown 斜体内容。</p>
                  <div className="personalization-preview" aria-label="斜体文样式预览">
                    {renderInlineText("*这是斜体文样式预览*")}
                  </div>
                </article>
              </div>
            </section>
          )}

          {settingsTab === "mcp" && (
            <div className="settings-grid mcp-settings-grid">
              <aside className="provider-list">
                {mcpServers.length === 0 ? (
                  <div className="provider-item muted-provider-item">
                    <strong>未配置服务器</strong>
                    <span>导入 JSON 或手动添加</span>
                  </div>
                ) : (
                  mcpServers.map((server) => (
                    <div
                      className={`provider-item mcp-server-item ${
                        server.id === activeMcpServer?.id ? "active" : ""
                      }`}
                      key={server.id}
                    >
                      <label className="prompt-select-check" title={server.enabled ? "禁用" : "启用"}>
                        <input
                          type="checkbox"
                          checked={server.enabled}
                          onChange={(event) =>
                            updateMcpServer(server.id, { enabled: event.target.checked })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="prompt-item-main"
                        onClick={() => setActiveMcpServerId(server.id)}
                      >
                        <strong>{server.name || "未命名 MCP"}</strong>
                        <span>{getMcpServerSummary(server)}</span>
                      </button>
                    </div>
                  ))
                )}
              </aside>

              <section className="section-block provider-editor mcp-editor">
                <div className="section-heading compact">
                  <div>
                    <h2>MCP 工具</h2>
                    <p>启用后，聊天发送时会自动发现工具并交给模型按需调用。</p>
                  </div>
                  <div className="mcp-editor-actions">
                    <button
                      type="button"
                      className={`ghost-action ${mcpJsonViewEnabled ? "active-json" : ""}`}
                      title={mcpJsonViewEnabled ? "切换到表单视图" : "切换到 JSON 视图"}
                      onClick={() => setMcpJsonViewEnabled((current) => !current)}
                    >
                      <FileJson size={16} />
                      {mcpJsonViewEnabled ? "表单视图" : "JSON 视图"}
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      title="删除 MCP 服务器"
                      disabled={!activeMcpServer}
                      onClick={deleteMcpServer}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="provider-form mcp-form">
                  {mcpJsonViewEnabled ? (
                    <div className="mcp-json-view">
                      <div className="mcp-json-view-toolbar">
                        <strong>全部服务器 JSON</strong>
                        <button
                          type="button"
                          className="ghost-action"
                          disabled={mcpServers.length === 0}
                          onClick={() => void copyMcpExportJson()}
                        >
                          <Copy size={16} />
                          复制 JSON
                        </button>
                      </div>
                      <textarea
                        className="mcp-export-textarea"
                        value={mcpExportJson}
                        readOnly
                        spellCheck={false}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                    </div>
                  ) : (
                    <>
                      <label className="field">
                        <span>粘贴 JSON 导入</span>
                        <textarea
                          className="mcp-json-textarea"
                          value={mcpImportText}
                          placeholder={'例如：{"mcpServers":{"filesystem":{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","E:/AI/project/renge"]}}}'}
                          onChange={(event) => setMcpImportText(event.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        className="ghost-action mcp-import-button"
                        disabled={!mcpImportText.trim()}
                        onClick={importMcpJsonText}
                      >
                        <Upload size={16} />
                        导入粘贴内容
                      </button>

                      {activeMcpServer && (
                        <>
                          <label className="tool-toggle mcp-enable-toggle">
                            <input
                              type="checkbox"
                              checked={activeMcpServer.enabled}
                              onChange={(event) =>
                                updateMcpServer(activeMcpServer.id, { enabled: event.target.checked })
                              }
                            />
                            <span>启用这个 MCP 服务器</span>
                          </label>

                          <label className="field">
                            <span>名称</span>
                            <input
                              value={activeMcpServer.name}
                              onChange={(event) =>
                                updateMcpServer(activeMcpServer.id, { name: event.target.value })
                              }
                            />
                          </label>

                          <label className="field">
                            <span>连接方式</span>
                            <select
                              value={activeMcpServer.transport}
                              onChange={(event) =>
                                updateMcpServer(activeMcpServer.id, {
                                  transport: event.target.value as McpServerTransport,
                                })
                              }
                            >
                              <option value="stdio">stdio command</option>
                              <option value="http">streamable HTTP</option>
                            </select>
                          </label>

                          {activeMcpServer.transport === "stdio" ? (
                            <>
                              <label className="field">
                                <span>Command</span>
                                <input
                                  value={activeMcpServer.command}
                                  placeholder="npx / node / uvx / python"
                                  onChange={(event) =>
                                    updateMcpServer(activeMcpServer.id, { command: event.target.value })
                                  }
                                />
                              </label>

                              <label className="field">
                                <span>Args JSON</span>
                                <textarea
                                  value={formatJsonForTextarea(activeMcpServer.args)}
                                  onChange={(event) => {
                                    try {
                                      const parsed = JSON.parse(event.target.value) as unknown;
                                      if (!Array.isArray(parsed)) throw new Error("args 必须是数组");
                                      updateMcpServer(activeMcpServer.id, {
                                        args: parsed.map(String),
                                      });
                                    } catch {
                                      setMcpStatus({ status: "error", message: "Args 必须是 JSON 字符串数组。" });
                                    }
                                  }}
                                />
                              </label>

                              <label className="field">
                                <span>工作目录</span>
                                <input
                                  value={activeMcpServer.cwd}
                                  placeholder="可选"
                                  onChange={(event) =>
                                    updateMcpServer(activeMcpServer.id, { cwd: event.target.value })
                                  }
                                />
                              </label>

                              <label className="field">
                                <span>Env JSON</span>
                                <textarea
                                  value={formatJsonForTextarea(activeMcpServer.env)}
                                  onChange={(event) => {
                                    try {
                                      updateMcpServer(activeMcpServer.id, {
                                        env: normalizeStringRecord(JSON.parse(event.target.value)),
                                      });
                                    } catch {
                                      setMcpStatus({ status: "error", message: "Env 必须是 JSON 对象。" });
                                    }
                                  }}
                                />
                              </label>
                            </>
                          ) : (
                            <>
                              <label className="field">
                                <span>HTTP URL</span>
                                <input
                                  value={activeMcpServer.url}
                                  placeholder="http://127.0.0.1:3000/mcp"
                                  onChange={(event) =>
                                    updateMcpServer(activeMcpServer.id, { url: event.target.value })
                                  }
                                />
                              </label>

                              <label className="field">
                                <span>Headers JSON</span>
                                <textarea
                                  value={formatJsonForTextarea(activeMcpServer.headers)}
                                  onChange={(event) => {
                                    try {
                                      updateMcpServer(activeMcpServer.id, {
                                        headers: normalizeStringRecord(JSON.parse(event.target.value)),
                                      });
                                    } catch {
                                      setMcpStatus({ status: "error", message: "Headers 必须是 JSON 对象。" });
                                    }
                                  }}
                                />
                              </label>
                            </>
                          )}
                        </>
                      )}
                    </>
                  )}

                  {mcpStatus.message && (
                    <p className={`provider-status ${mcpStatus.status}`}>{mcpStatus.message}</p>
                  )}

                  {mcpTools.length > 0 && (
                    <div className="mcp-tool-list">
                      {mcpTools.map((tool) => (
                        <div className="mcp-tool-row" key={`${tool.serverId}-${tool.originalName}`}>
                          <Wrench size={14} />
                          <strong>{tool.serverName}</strong>
                          <span>{tool.originalName}</span>
                          <code>{tool.function.name}</code>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {settingsTab === "skills" && (
            <div className="settings-grid skill-settings-grid">
              <aside className="provider-list prompt-list">
                {skills.length === 0 ? (
                  <div className="provider-item muted-provider-item">
                    <strong>未导入技能</strong>
                    <span>从文件夹或 ZIP 导入</span>
                  </div>
                ) : (
                  skills.map((skill) => (
                    <div
                      className={`provider-item mcp-server-item ${
                        skill.id === activeSkill?.id ? "active" : ""
                      }`}
                      key={skill.id}
                    >
                      <label className="prompt-select-check" title={skill.enabled ? "禁用" : "启用"}>
                        <input
                          type="checkbox"
                          checked={skill.enabled}
                          onChange={(event) => updateSkill(skill.id, { enabled: event.target.checked })}
                        />
                      </label>
                      <button
                        type="button"
                        className="prompt-item-main"
                        onClick={() => setActiveSkillId(skill.id)}
                      >
                        <strong>{skill.name || "未命名技能"}</strong>
                        <span>{getSkillSummary(skill)}</span>
                      </button>
                    </div>
                  ))
                )}
              </aside>

              <section className="section-block provider-editor skill-editor">
                <div className="section-heading compact">
                  <div>
                    <h2>Skill 设置</h2>
                    <p>启用后，聊天发送时会自动读取技能说明并注入给 AI 进行匹配和使用。</p>
                  </div>
                  <button
                    type="button"
                    className="icon-button danger"
                    title="移除技能"
                    disabled={!activeSkill}
                    onClick={deleteSkill}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="provider-form skill-form">
                  <label className="field">
                    <span>文件夹路径导入</span>
                    <div className="model-input-row">
                      <input
                        value={skillFolderPath}
                        placeholder="例如：E:\\AI\\skills\\my-skill"
                        onChange={(event) => setSkillFolderPath(event.target.value)}
                      />
                      <button
                        type="button"
                        className="ghost-action"
                        disabled={!skillFolderPath.trim() || skillStatus.status === "loading"}
                        onClick={() => void importSkillFolder()}
                      >
                        <Upload size={16} />
                        导入
                      </button>
                    </div>
                  </label>

                  {activeSkill && (
                    <>
                      <label className="tool-toggle mcp-enable-toggle">
                        <input
                          type="checkbox"
                          checked={activeSkill.enabled}
                          onChange={(event) =>
                            updateSkill(activeSkill.id, { enabled: event.target.checked })
                          }
                        />
                        <span>启用这个 Skill</span>
                      </label>

                      <label className="field">
                        <span>名称</span>
                        <input
                          value={activeSkill.name}
                          onChange={(event) =>
                            updateSkill(activeSkill.id, { name: event.target.value })
                          }
                        />
                      </label>

                      <label className="field">
                        <span>描述</span>
                        <textarea
                          value={activeSkill.description}
                          onChange={(event) =>
                            updateSkill(activeSkill.id, { description: event.target.value })
                          }
                        />
                      </label>

                      <label className="field">
                        <span>入口文件</span>
                        <input
                          value={activeSkill.entryFile}
                          placeholder="SKILL.md"
                          onChange={(event) =>
                            updateSkill(activeSkill.id, { entryFile: event.target.value })
                          }
                        />
                      </label>

                      <label className="field">
                        <span>已导入路径</span>
                        <input value={activeSkill.path} readOnly />
                      </label>

                      <div className="skill-meta-row">
                        <span>{activeSkill.sourceType === "zip" ? "ZIP 导入" : "文件夹导入"}</span>
                        <span>{activeSkill.enabled ? "已启用" : "已禁用"}</span>
                        <span>{new Date(activeSkill.importedAt).toLocaleString("zh-CN")}</span>
                      </div>
                    </>
                  )}

                  {skillStatus.message && (
                    <p className={`provider-status ${skillStatus.status}`}>{skillStatus.message}</p>
                  )}

                  {skills.length > 0 && (
                    <p className="provider-status idle">
                      当前启用 {enabledSkills.length} 个 Skill；发送消息时会自动读取并交给 AI 判断是否使用。
                    </p>
                  )}
                </div>
              </section>
            </div>
          )}

          {settingsTab === "device" && (
            <section className="section-block user-profile-settings">
              <div className="section-heading compact">
                <div>
                  <h2>ROOT 权限</h2>
                  <p>用于手机端系统级文件访问和高级传输能力。</p>
                </div>
              </div>

              <div className="user-profile-form">
                <button
                  type="button"
                  className="small-action"
                  disabled={rootAccessState.status === "loading"}
                  onClick={requestAndroidRootAccess}
                >
                  <Wrench size={16} />
                  {rootAccessState.status === "loading"
                    ? "检测中"
                    : rootAccessState.granted
                      ? "重新检测 ROOT 权限"
                      : "请求 ROOT 权限"}
                </button>

                <label className="field">
                  <span>ROOT 工作区路径</span>
                  <input
                    value={rootWorkspacePath}
                    placeholder="/"
                    onChange={(event) => setRootWorkspacePath(event.target.value)}
                  />
                </label>

                <button
                  type="button"
                  className="small-action"
                  disabled={rootAccessState.status === "loading"}
                  onClick={selectAndroidRootWorkspace}
                >
                  <FolderOpen size={16} />
                  设为 ROOT 工作区
                </button>

                <p className={`provider-status ${rootAccessState.status}`}>
                  {rootAccessState.message ||
                    (window.rengeAndroid?.isAndroid
                      ? "未检测 ROOT 权限。"
                      : "当前不在 Android App 内。")}
                </p>

                {rootAccessState.details && (
                  <pre className="root-access-details">{rootAccessState.details}</pre>
                )}
              </div>
            </section>
          )}
        </section>
        {avatarCropModal}
        {pcBrowserModal}
      </main>
    );
  }

  if (view === "chat") {
    return (
      <main
        className={`chat-shell ${mobileSidebarOpen ? "mobile-sidebar-open" : ""} ${
          chatPersonalization.quoteStyleEnabled ? "quote-style-enabled" : ""
        } ${chatPersonalization.italicStyleEnabled ? "italic-style-enabled" : ""}`}
        style={
          {
            "--chat-quote-color": chatPersonalization.quoteStyleColor,
            "--chat-italic-color": chatPersonalization.italicStyleColor,
          } as CSSProperties
        }
      >
        <button
          type="button"
          className="mobile-sidebar-toggle"
          title="打开菜单"
          aria-label="打开菜单"
          onClick={openMobileSidebar}
        >
          <Menu size={19} />
        </button>
        <aside className="chat-sidebar">
          <div className="module-nav">
            <button
              type="button"
              onClick={() => {
                setView("home");
                closeMobileSidebar();
              }}
            >
              <Home size={16} />
              主页
            </button>
            <button
              type="button"
              onClick={() => {
                setSettingsTab("providers");
                setView("settings");
                closeMobileSidebar();
              }}
            >
              <Settings2 size={16} />
              设置
            </button>
          </div>

          <div className="chat-control-panel">
            <div className="chat-mode-toggle">
              <button
                type="button"
                className={chatMode === "ai" ? "active" : ""}
                onClick={() => setChatMode("ai")}
              >
                <Sparkles size={15} />
                AI
              </button>
              <button
                type="button"
                className={chatMode === "persona" ? "active" : ""}
                onClick={() => setChatMode("persona")}
              >
                <Bot size={15} />
                人格 Agent
              </button>
              <button
                type="button"
                className={chatMode === "multi" ? "active" : ""}
                onClick={() => setChatMode("multi")}
              >
                <Boxes size={15} />
                多 Agent
              </button>
              <button
                type="button"
                className={chatMode === "roleplay" ? "active" : ""}
                onClick={() => setChatMode("roleplay")}
              >
                <BookOpen size={15} />
                角色扮演
              </button>
            </div>
            <label className="chat-field">
              <span>会话预设</span>
              <select
                value={chatPresetEnabled ? activeChatPreset?.id ?? "" : ""}
                onChange={(event) => {
                  if (!event.target.value) {
                    setChatPresetEnabled(false);
                    return;
                  }
                  setActiveChatPresetId(event.target.value);
                  setChatPresetEnabled(true);
                }}
              >
                <option value="">不应用预设</option>
                {chatPresets.map((preset) => (
                  <option value={preset.id} key={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
            <details className="chat-worldbook-control">
              <summary>
                <span>世界书</span>
                <strong>{activeWorldBookIds.length > 0 ? `${activeWorldBookIds.length} 本已启用` : "未启用"}</strong>
              </summary>
              <div className="chat-worldbook-options">
                {worldBooks.length === 0 ? (
                  <p>请先在设置的“世界书”中导入或新建。</p>
                ) : (
                  worldBooks.map((worldBook) => (
                    <label className="tool-toggle" key={worldBook.id}>
                      <input
                        type="checkbox"
                        checked={activeWorldBookIds.includes(worldBook.id)}
                        onChange={() => toggleWorldBook(worldBook.id)}
                      />
                      <span>{worldBook.name}</span>
                    </label>
                  ))
                )}
              </div>
            </details>
            {chatMode === "roleplay" && activeSessionRoleplayCard && (
              <div className="chat-roleplay-scope">
                <BookOpen size={15} />
                <div>
                  <strong>{activeSessionRoleplayCard.name}</strong>
                  <span>
                    私有世界书 {activeSessionRoleplayCard.characterBook?.entries.length ?? 0} 条 · 私有正则 {activeSessionRoleplayCard.regexScripts.length} 条 · 内置脚本 {activeSessionRoleplayCard.tavernScripts.length} 个
                  </span>
                </div>
              </div>
            )}
            <div className="chat-output-options">
              <label className="tool-toggle">
                <input
                  type="checkbox"
                  checked={chatStreamEnabled}
                  onChange={(event) => setChatStreamEnabled(event.target.checked)}
                />
                <span>流式输出</span>
              </label>
              <label className="tool-toggle">
                <input
                  type="checkbox"
                  checked={chatMultiBubbleEnabled}
                  onChange={(event) => setChatMultiBubbleEnabled(event.target.checked)}
                />
                <span>多段气泡</span>
              </label>
              <label className="tool-toggle">
                <input
                  type="checkbox"
                  checked={chatHtmlRenderEnabled}
                  onChange={(event) => setChatHtmlRenderEnabled(event.target.checked)}
                />
                <span>渲染 HTML</span>
              </label>
              <label className="tool-toggle">
                <input
                  type="checkbox"
                  checked={chatReasoningVisible}
                  onChange={(event) => setChatReasoningVisible(event.target.checked)}
                />
                <span>显示思维链</span>
              </label>
            </div>
          </div>

          <div className="local-tools-panel">
            <button type="button" className="local-workspace-button" onClick={authorizeLocalWorkspace}>
              <FolderOpen size={16} />
              {localWorkspaceHandle ? localWorkspaceHandle.name : "选择文件夹"}
            </button>
            <button type="button" className="local-workspace-button" onClick={openPcBrowser}>
              <Server size={16} />
              连接电脑
            </button>
            {localWorkspaceHandle && (
              <button
                type="button"
                className="session-icon-button local-workspace-clear"
                title="取消工作区"
                onClick={clearLocalWorkspace}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {mcpServers.length > 0 && (
            <div className="mcp-chat-status">
              <Boxes size={14} />
              <span>{enabledMcpServers.length} 个 MCP 已启用</span>
              <span>{enabledMcpToolCount} 个工具</span>
            </div>
          )}
          {skills.length > 0 && (
            <div className="mcp-chat-status">
              <Sparkles size={14} />
              <span>{enabledSkills.length} 个 Skill 已启用</span>
              <span>发送时自动匹配</span>
            </div>
          )}

          <div className="chat-session-area">
            {workspaceGroups.map((group) => (
              <section
                className="chat-session-group"
                key={group.key}
                title="右键删除该工作区的所有会话"
                onContextMenu={(event) => {
                  event.preventDefault();
                  deleteWorkspaceSessions(group.key, group.name);
                }}
              >
                <div className="chat-session-group-header">
                  <span title={group.name}>
                    <FolderOpen size={14} />
                    {group.name}
                  </span>
                  <button
                    type="button"
                    className="session-icon-button"
                    title="新建会话"
                    onClick={() => addChatSession(group.key, group.name)}
                  >
                    <Plus size={13} />
                  </button>
                </div>
                <div className="chat-session-list">
                  {group.sessions.map((session) => (
                    <div
                      className={`chat-session-item ${
                        session.id === activeChatSessionId ? "active" : ""
                      }`}
                      key={session.id}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          void openChatSession(session.id);
                          closeMobileSidebar();
                        }}
                      >
                        <MessageSquare size={14} />
                        <span>{session.title}</span>
                      </button>
                      <button
                        type="button"
                        className="session-icon-button danger"
                        title="删除会话"
                        onClick={() => deleteChatSession(session.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </aside>
        <button
          type="button"
          className="mobile-sidebar-backdrop"
          title="关闭菜单"
          aria-label="关闭菜单"
          onClick={closeMobileSidebar}
        />

        <section className="chat-workspace">
          <header className="chat-header">
            <div>
              <h1>
                {activeChatSession?.title ??
                  (chatMode === "persona"
                    ? `${activePersona.name} / Agent`
                    : chatMode === "multi"
                      ? "多 Agent 对话"
                      : chatMode === "roleplay"
                        ? activeSessionRoleplayCard
                          ? `角色：${activeSessionRoleplayCard.name}`
                          : "选择角色卡开始角色扮演"
                      : "AI Direct")}
              </h1>
            </div>
            <div className="chat-header-actions">
              <label
                className={`heartbeat-toggle ${activeHeartbeat.enabled ? "active" : ""}`}
                title={activeHeartbeat.event.trim() ? "开启/关闭当前会话心跳" : "先填写心跳事件"}
              >
                <input
                  type="checkbox"
                  checked={activeHeartbeat.enabled}
                  disabled={!activeChatSession || !activeHeartbeat.event.trim()}
                  onChange={(event) =>
                    updateActiveHeartbeat({
                      enabled: event.target.checked,
                      resetRunCount: true,
                    })
                  }
                />
                <RefreshCw size={15} />
                <span>心跳</span>
              </label>
              <details className="heartbeat-menu">
                <summary className="ghost-action" title="心跳设置">
                  <Settings2 size={16} />
                  设置
                </summary>
                <div className="heartbeat-panel">
                  <label className="heartbeat-field compact">
                    <span>间隔</span>
                    <input
                      type="number"
                      min={MIN_HEARTBEAT_INTERVAL_MINUTES}
                      max={MAX_HEARTBEAT_INTERVAL_MINUTES}
                      value={activeHeartbeat.intervalMinutes}
                      onChange={(event) =>
                        updateActiveHeartbeat({
                          intervalMinutes: Number(event.target.value),
                          resetRunCount: true,
                        })
                      }
                    />
                    <small>分钟</small>
                  </label>
                  <label className="heartbeat-field">
                    <span>待执行事件</span>
                    <textarea
                      rows={3}
                      value={activeHeartbeat.event}
                      placeholder="例如：检查构建是否完成，未完成则继续修复并重新测试"
                      onChange={(event) =>
                        updateActiveHeartbeat({
                          event: event.target.value,
                          resetRunCount: true,
                        })
                      }
                    />
                  </label>
                  <label className="heartbeat-check">
                    <input
                      type="checkbox"
                      checked={activeHeartbeat.loopLimit !== null}
                      onChange={(event) =>
                        updateActiveHeartbeat({
                          loopLimit: event.target.checked ? activeHeartbeat.loopLimit ?? 3 : null,
                          resetRunCount: true,
                        })
                      }
                    />
                    <span>限制循环次数</span>
                  </label>
                  <label className="heartbeat-check">
                    <input
                      type="checkbox"
                      checked={chatHeartbeatReminderVisible}
                      onChange={(event) =>
                        setChatHeartbeatReminderVisible(event.target.checked)
                      }
                    />
                    <span>显示心跳检查提醒气泡</span>
                  </label>
                  <label className="heartbeat-field compact">
                    <span>次数</span>
                    <input
                      type="number"
                      min={1}
                      value={activeHeartbeat.loopLimit ?? 3}
                      disabled={activeHeartbeat.loopLimit === null}
                      onChange={(event) =>
                        updateActiveHeartbeat({
                          loopLimit: Number(event.target.value),
                          resetRunCount: true,
                        })
                      }
                    />
                    <small>{activeHeartbeat.loopLimit === null ? "无限" : "次"}</small>
                  </label>
                  <div className="heartbeat-status-line">
                    <span>
                      已执行 {activeHeartbeat.runCount}
                      {activeHeartbeat.loopLimit === null ? " / 无限" : ` / ${activeHeartbeat.loopLimit}`}
                    </span>
                    <span>下次 {formatHeartbeatTime(activeHeartbeat.nextRunAt)}</span>
                  </div>
                </div>
              </details>
              <button
                type="button"
                className={`ghost-action ${activeSessionMemoryEnabled ? "active-memory" : ""}`}
                disabled={chatMode !== "persona" || !activePersona || !activeChatSession}
                title={
                  activePersona
                    ? `${activeSessionMemoryEnabled ? "取消" : "设为"} ${activePersona.name} 的记忆`
                    : "需要先选择人格 Agent"
                }
                onClick={toggleActiveSessionMemory}
              >
                <Bookmark size={16} />
                {activeSessionMemoryEnabled ? "取消记忆" : "设为记忆"}
              </button>
              {chatMode === "roleplay" &&
                activeSessionRoleplayCard &&
                getCharacterCardGreetings(
                  activeSessionRoleplayCard,
                  userProfile.nickname.trim() || "用户",
                ).length > 1 && (
                  <button
                    type="button"
                    className="ghost-action"
                    title="切换开场白"
                    onClick={cycleRoleplayGreeting}
                  >
                    <RefreshCw size={16} />
                    切换问候
                  </button>
                )}
              <button
                type="button"
                className="ghost-action"
                disabled={chatMessages.length === 0 || chatStatus.status === "loading"}
                title="清空当前会话"
                aria-label="清空当前会话"
                onClick={() => {
                  const greeting =
                    chatMode === "roleplay" && activeSessionRoleplayCard
                      ? createRoleplayGreetingMessage(
                          activeSessionRoleplayCard,
                          userProfile.nickname.trim() || "用户",
                          activeChatSession?.roleplayGreetingIndex ?? 0,
                        )
                      : null;
                  setChatMessages(greeting ? [greeting] : []);
                  setChatStatus({ status: "idle", message: "" });
                }}
              >
                <X size={16} />
                清空
              </button>
            </div>
          </header>

          <div className="chat-thread" onScroll={() => setChatMessageMenu(null)}>
            {visibleChatMessages.length === 0 ? (
              <div
                className={`chat-empty ${
                  chatMode === "roleplay" && !activeSessionRoleplayCard
                    ? "chat-character-picker"
                    : ""
                }`}
              >
                {chatMode === "roleplay" && !activeSessionRoleplayCard ? (
                  <>
                    <div className="chat-empty-icon">
                      <BookOpen size={24} />
                    </div>
                    <h2>选择一张角色卡</h2>
                    <p className="chat-character-picker-description">
                      点击封面后，角色卡会直接绑定到当前工作区的这个新会话。
                    </p>
                    <div
                      className={`chat-empty-model ${
                        effectiveChatModelId ? "ready" : "attention"
                      }`}
                    >
                      <Server size={14} />
                      {effectiveChatModelId || "尚未配置模型，可先选择角色卡"}
                    </div>
                    {roleplayPickerCards.length > 0 ? (
                      <div className="chat-character-picker-grid" aria-label="可选角色卡">
                        {roleplayPickerCards.map((card) => (
                          <button
                            type="button"
                            className="chat-character-choice"
                            aria-label={`选择角色：${card.name}`}
                            key={card.id}
                            onClick={() => startRoleplayInCurrentWorkspace(card)}
                          >
                            <span className="chat-character-choice-cover">
                              {card.avatarDataUrl ? (
                                <img src={card.avatarDataUrl} alt={`${card.name} 封面`} />
                              ) : (
                                <span className="chat-character-choice-placeholder">
                                  <UserRound size={38} />
                                </span>
                              )}
                              <span className="chat-character-choice-gradient" />
                              <strong>{card.name || "未命名角色"}</strong>
                            </span>
                            <span className="chat-character-choice-meta">
                              <small>世界书 {card.characterBook?.entries.length ?? 0}</small>
                              <small>正则 {card.regexScripts.length} · 脚本 {card.tavernScripts.length}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="chat-empty-action"
                        onClick={() => setView("characters")}
                      >
                        <BookOpen size={16} />
                        导入角色卡
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <div className="chat-empty-icon">
                      {chatMode === "ai" ? <Sparkles size={24} /> : chatMode === "roleplay" ? <BookOpen size={24} /> : <Bot size={24} />}
                    </div>
                    <h2>
                      {chatMode === "persona"
                        ? activePersona.name
                        : chatMode === "multi"
                          ? `多 Agent · 已选 ${multiAgentPersonas.length} 个`
                          : chatMode === "roleplay"
                            ? activeSessionRoleplayCard?.name ?? "选择一张角色卡"
                          : "AI 直连"}
                    </h2>
                    <div className={`chat-empty-model ${chatModelReady ? "ready" : "attention"}`}>
                      <Server size={14} />
                      {chatModelReady ? chatModelLabel : "尚未配置模型"}
                    </div>
                    {!chatModelReady && (
                      <button
                        type="button"
                        className="chat-empty-action"
                        onClick={() => {
                          setSettingsTab("providers");
                          setView("settings");
                        }}
                      >
                        <Settings2 size={16} />
                        配置模型
                      </button>
                    )}
                    {chatModelReady && (
                      <div className="chat-empty-suggestions" aria-label="快捷开场">
                        {chatStarterPrompts.map((promptText) => (
                          <button
                            type="button"
                            key={promptText}
                            onClick={() => {
                              setChatInput(promptText);
                              requestAnimationFrame(() => chatInputRef.current?.focus());
                            }}
                          >
                            <Play size={14} />
                            <span>{promptText}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              getRenderedChatItems(regexProcessedChatMessages, chatMultiBubbleEnabled).map((item) => {
                if (item.kind === "toolGroup") {
                  const hasEditingMessage = item.segments.some(
                    (segment) => editingChatMessage?.messageId === segment.message.id,
                  );
                  if (!hasEditingMessage) {
                    const message = item.message;
                    const assistantPersona = getAssistantMessagePersona(
                      message,
                      personas,
                      chatMode === "persona" ? activePersona : undefined,
                    );
                    const messageName =
                      chatMode === "roleplay" && activeSessionRoleplayCard
                        ? activeSessionRoleplayCard.name
                        : assistantPersona?.name ?? "AI";
                    const messageAvatarImage =
                      chatMode === "roleplay" && activeSessionRoleplayCard
                        ? activeSessionRoleplayCard.avatarDataUrl
                        : assistantPersona?.avatarImage ?? "";

                    return (
                      <article className="chat-message assistant" key={item.id}>
                        {item.showTime && (
                          <time className="chat-message-time">
                            {new Date(message.createdAt).toLocaleTimeString("zh-CN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        )}
                        <div className="chat-message-row">
                          <div className="chat-identity">
                            <strong>{messageName}</strong>
                            <div className="chat-avatar">
                              {messageAvatarImage ? (
                                <img src={messageAvatarImage} alt={`${messageName} 头像`} />
                              ) : (
                                <Bot size={16} />
                              )}
                            </div>
                          </div>
                          <div className="chat-bubble tool-run-bubble">
                            {renderToolRunGroup(item, item.id)}
                          </div>
                        </div>
                      </article>
                    );
                  }
                }

                const renderedSegments =
                  item.kind === "toolGroup"
                    ? item.segments.map((segment) => ({ kind: "segment" as const, ...segment }))
                    : [item];

                return renderedSegments.map(({ id, message, segment, segmentIndex, showTime }) => {
                const isEditingMessage = editingChatMessage?.messageId === message.id;
                if (isEditingMessage && segmentIndex > 0) return null;
                const messageSender = message.role === "user" ? (message.sender ?? { kind: "user" as const }) : undefined;
                const assistantPersona =
                  message.role === "assistant"
                    ? getAssistantMessagePersona(
                        message,
                        personas,
                        chatMode === "persona" ? activePersona : undefined,
                      )
                    : null;
                const messageName =
                  message.role === "user"
                    ? getChatSenderName(messageSender, personas, userProfile)
                    : chatMode === "roleplay" && activeSessionRoleplayCard
                      ? activeSessionRoleplayCard.name
                      : assistantPersona?.name ?? "AI";
                const messageAvatarImage =
                  message.role === "user"
                    ? getChatSenderAvatarImage(messageSender, personas, userProfile)
                    : chatMode === "roleplay" && activeSessionRoleplayCard
                      ? activeSessionRoleplayCard.avatarDataUrl
                      : assistantPersona?.avatarImage ?? "";

                return (
                  <article className={`chat-message ${message.role}`} key={id}>
                    {showTime && (
                      <time className="chat-message-time">
                        {new Date(message.createdAt).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    )}
                    <div className="chat-message-row">
                      <div className="chat-identity">
                        <strong>{messageName}</strong>
                        <div className="chat-avatar">
                          {messageAvatarImage ? (
                            <img src={messageAvatarImage} alt={`${messageName} 头像`} />
                          ) : messageSender?.kind === "system" ? (
                            <Settings2 size={16} />
                          ) : messageSender?.kind === "persona" ? (
                            <Bot size={16} />
                          ) : message.role === "user" ? (
                            <UserRound size={16} />
                          ) : (
                            <Bot size={16} />
                          )}
                        </div>
                      </div>
                      <div
                        className={`chat-bubble ${isEditingMessage ? "editing" : ""}`}
                        onContextMenu={(event) => openChatMessageMenu(message.id, event)}
                      >
                        {isEditingMessage ? (
                          <div className="chat-inline-editor">
                            <textarea
                              value={editingChatMessage.content}
                              rows={Math.min(10, Math.max(3, editingChatMessage.content.split("\n").length + 1))}
                              onChange={(event) =>
                                setEditingChatMessage((current) =>
                                  current?.messageId === message.id
                                    ? { ...current, content: event.target.value }
                                    : current,
                                )
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  cancelEditingChatMessage();
                                }
                              }}
                            />
                            <div className="chat-inline-editor-actions">
                              <button type="button" onClick={cancelEditingChatMessage}>
                                取消
                              </button>
                              {message.role === "user" ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={!editingChatMessage.content.trim() || chatStatus.status === "loading"}
                                    onClick={saveEditedUserMessage}
                                  >
                                    保存
                                  </button>
                                  <button
                                    type="button"
                                    className="primary"
                                    disabled={!editingChatMessage.content.trim() || chatStatus.status === "loading"}
                                    onClick={() => void resendEditedUserMessage()}
                                  >
                                    发送
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className="primary"
                                  disabled={!editingChatMessage.content.trim() || chatStatus.status === "loading"}
                                  onClick={saveEditedAssistantMessage}
                                >
                                  保存
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <>
                            {segmentIndex === 0 &&
                              message.role === "assistant" &&
                              renderChatReasoning(message.reasoning, id)}
                            {renderChatContent(segment, id, message.id)}
                            {segmentIndex === 0 &&
                              renderChatAttachments(message.attachments ?? [])}
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                );
                });
              })
            )}
            {chatMessageMenu && chatMessageMenuMessage && (
              <div
                className="chat-message-menu"
                style={{ left: chatMessageMenu.x, top: chatMessageMenu.y }}
                onClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.preventDefault()}
              >
                <button
                  type="button"
                  disabled={chatStatus.status === "loading"}
                  onClick={() => startEditingChatMessage(chatMessageMenuMessage.id)}
                >
                  <Pencil size={14} />
                  编辑
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={chatStatus.status === "loading"}
                  onClick={() => deleteChatMessage(chatMessageMenuMessage.id)}
                >
                  <Trash2 size={14} />
                  删除
                </button>
              </div>
            )}
          </div>

          {tavernRuntimeButtons.length > 0 && (
            <div className="chat-tavern-script-buttons" aria-label="酒馆脚本按钮">
              <span className="chat-tavern-script-buttons-label">
                <Play size={14} />
                酒馆脚本
              </span>
              <div>
                {tavernRuntimeButtons.map((button) => (
                  <button
                    type="button"
                    title={`${button.scriptName} · ${button.name}`}
                    key={`${button.scriptId}:${button.id}:${button.name}`}
                    disabled={
                      tavernRuntimeStatus.state !== "ready" || chatStatus.status === "loading"
                    }
                    onClick={() => void triggerTavernScriptButton(button)}
                  >
                    {button.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <section className="chat-composer">
            {chatStatus.message && (
              <p className={`chat-status ${chatStatus.status}`}>{chatStatus.message}</p>
            )}
            <div className="chat-composer-box">
              <input
                ref={chatAttachmentInputRef}
                className="chat-attachment-input"
                type="file"
                multiple
                onChange={(event) => void handleChatAttachmentChange(event.target.files)}
              />
              <textarea
                id="send_textarea"
                ref={chatInputRef}
                value={chatInput}
                placeholder="输入消息"
                rows={3}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendChatMessage();
                  }
                }}
              />
              {chatAttachments.length > 0 && (
                <div className="chat-pending-attachments">
                  {chatAttachments.map((attachment) => (
                    <div className="chat-pending-attachment" key={attachment.id}>
                      {attachment.type.startsWith("image/") && attachment.dataUrl ? (
                        <img src={attachment.dataUrl} alt={attachment.name} />
                      ) : (
                        <FileJson size={14} />
                      )}
                      <span title={attachment.name}>{attachment.name}</span>
                      <small>{formatFileSize(attachment.size)}</small>
                      <button
                        type="button"
                        title="移除附件"
                        onClick={() => removeChatAttachment(attachment.id)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="chat-composer-footer">
                <button
                  type="button"
                  className="composer-upload-button"
                  disabled={chatStatus.status === "loading"}
                  onClick={() => chatAttachmentInputRef.current?.click()}
                  title="上传文件"
                >
                  <Upload size={16} />
                </button>
                <div
                  className={`composer-selects ${chatMode === "multi" ? "multi-mode" : ""}`}
                >
                  <details className="composer-prompt-menu">
                    <summary
                      className="composer-pill-select prompt"
                      title={
                        selectedSystemPrompts.length > 0
                          ? selectedSystemPrompts.map((promptProfile) => promptProfile.name).join(" + ")
                          : "未启用 System Prompt"
                      }
                    >
                      <span>系统提示词</span>
                    </summary>
                    <div className="composer-prompt-options">
                      {systemPrompts.map((promptProfile) => (
                        <label className="composer-prompt-option" key={promptProfile.id}>
                          <input
                            type="checkbox"
                            checked={activeSystemPromptIds.includes(promptProfile.id)}
                            onChange={() => toggleSystemPromptSelection(promptProfile.id)}
                          />
                          <span>{promptProfile.name || "未命名提示词"}</span>
                        </label>
                      ))}
                    </div>
                  </details>
                  <details
                    className={`composer-select-menu ${chatMode === "ai" ? "disabled" : ""}`}
                    onClick={(event) => {
                      if (chatMode === "ai") event.preventDefault();
                    }}
                  >
                    <summary
                      className="composer-pill-select"
                      title={
                        chatMode === "ai"
                          ? "AI 直连模式不使用人格"
                          : chatMode === "multi"
                            ? "按点击顺序选择至少 2 个 Agent"
                            : chatMode === "roleplay"
                              ? "选择角色卡并创建绑定会话"
                            : "选择人格"
                      }
                    >
                      <span>
                        {chatMode === "ai"
                          ? "AI直连"
                          : chatMode === "multi"
                            ? `多Agent · ${multiAgentPersonas.length}`
                            : chatMode === "roleplay"
                              ? activeSessionRoleplayCard?.name ?? "选择角色卡"
                            : activePersona.name}
                      </span>
                    </summary>
                    <div
                      className={`composer-menu-options ${
                        chatMode === "multi" ? "multi-agent-options" : ""
                      }`}
                    >
                      {chatMode === "multi" ? (
                        <>
                          <div className="multi-agent-sequence">
                            <strong>回复顺序</strong>
                            <label className="multi-agent-rounds-field">
                              <span>回复轮次</span>
                              <input
                                type="number"
                                min={1}
                                max={MAX_MULTI_AGENT_ROUNDS}
                                value={multiAgentRounds}
                                onChange={(event) =>
                                  setMultiAgentRounds(
                                    normalizeMultiAgentRounds(event.target.value),
                                  )
                                }
                              />
                              <small>
                                共 {multiAgentPersonas.length * multiAgentRounds} 次回复
                              </small>
                            </label>
                            <label className="multi-agent-auto-stop-toggle">
                              <input
                                type="checkbox"
                                checked={multiAgentAutoStopEnabled}
                                onChange={(event) =>
                                  setMultiAgentAutoStopEnabled(event.target.checked)
                                }
                              />
                              <span>允许 Agent 自主提前结束全部轮次</span>
                            </label>
                            <label
                              className={`multi-agent-stop-condition-field ${
                                multiAgentAutoStopEnabled ? "enabled" : "disabled"
                              }`}
                            >
                              <span>允许提前结束的时机</span>
                              <textarea
                                rows={2}
                                value={multiAgentStopCondition}
                                disabled={!multiAgentAutoStopEnabled}
                                placeholder="例如：大家已经形成一致结论，或继续讨论不会产生新的有效信息"
                                onChange={(event) =>
                                  setMultiAgentStopCondition(event.target.value)
                                }
                              />
                              <small>
                                {!multiAgentAutoStopEnabled
                                  ? "当前关闭，将固定执行完所有轮次"
                                  : multiAgentStopCondition.trim()
                                    ? "Agent 将在判断用户设置的时机到达后结束剩余轮次"
                                    : "未指定时机，由 Agent 判断讨论是否已自然完成"}
                              </small>
                            </label>
                            <span>
                              {multiAgentPersonas.length > 0
                                ? `每轮：${multiAgentPersonas
                                    .map((persona, index) => `${index + 1}. ${persona.name}`)
                                    .join(" → ")}`
                                : "按下方 Agent 的点击顺序排列"}
                            </span>
                            <small
                              className={multiAgentPersonas.length >= 2 ? "ready" : "attention"}
                            >
                              {multiAgentPersonas.length >= 2
                                ? `已选择 ${multiAgentPersonas.length} 个 Agent`
                                : "至少选择 2 个 Agent 才能发送"}
                            </small>
                          </div>
                          {personas.map((persona) => {
                            const orderIndex = multiAgentPersonaIds.indexOf(persona.id);
                            const requestConfig = getMultiAgentRequestConfig(persona.id);
                            const providerModelIds = Array.from(
                              new Set(
                                [
                                  requestConfig.modelId,
                                  ...getProviderModelIds(requestConfig.provider),
                                ].filter(Boolean),
                              ),
                            );
                            return (
                              <div
                                className={`multi-agent-config-row ${
                                  orderIndex >= 0 ? "active" : ""
                                }`}
                                key={persona.id}
                              >
                                <button
                                  type="button"
                                  className="multi-agent-option"
                                  aria-pressed={orderIndex >= 0}
                                  onClick={() => toggleMultiAgentPersona(persona.id)}
                                >
                                  <span className="multi-agent-order">
                                    {orderIndex >= 0 ? orderIndex + 1 : "+"}
                                  </span>
                                  <span>{persona.name}</span>
                                </button>
                                <div className="multi-agent-model-selects">
                                  <select
                                    aria-label={`${persona.name} 供应商`}
                                    title={`${persona.name} 使用的供应商`}
                                    value={requestConfig.provider?.id ?? ""}
                                    disabled={providers.length === 0}
                                    onChange={(event) =>
                                      updateMultiAgentProvider(persona.id, event.target.value)
                                    }
                                  >
                                    {providers.length === 0 && (
                                      <option value="">未配置供应商</option>
                                    )}
                                    {providers.map((provider) => (
                                      <option key={provider.id} value={provider.id}>
                                        {provider.name || "未命名供应商"}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    aria-label={`${persona.name} 模型`}
                                    title={`${persona.name} 使用的模型`}
                                    value={requestConfig.modelId}
                                    disabled={providerModelIds.length === 0}
                                    onChange={(event) =>
                                      updateMultiAgentModel(persona.id, event.target.value)
                                    }
                                  >
                                    {providerModelIds.length === 0 && (
                                      <option value="">未设置模型</option>
                                    )}
                                    {providerModelIds.map((modelId) => (
                                      <option key={modelId} value={modelId}>
                                        {modelId}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            );
                          })}
                        </>
                      ) : chatMode === "roleplay" ? (
                        characterCards.length > 0 ? (
                          characterCards.map((card) => (
                            <button
                              type="button"
                              className={card.id === activeSessionRoleplayCard?.id ? "active character-option" : "character-option"}
                              key={card.id}
                              onClick={(event) => {
                                startRoleplayInCurrentWorkspace(card);
                                event.currentTarget.closest("details")?.removeAttribute("open");
                              }}
                            >
                              <span className="composer-character-avatar">
                                {card.avatarDataUrl ? <img src={card.avatarDataUrl} alt="" /> : <UserRound size={15} />}
                              </span>
                              <span>{card.name}</span>
                              <small>
                                世界书 {card.characterBook?.entries.length ?? 0} · 正则 {card.regexScripts.length} · 脚本 {card.tavernScripts.length}
                              </small>
                            </button>
                          ))
                        ) : (
                          <button type="button" onClick={() => setView("characters")}>
                            <BookOpen size={15} />
                            <span>导入角色卡</span>
                          </button>
                        )
                      ) : (
                        personas.map((persona) => (
                          <button
                            type="button"
                            className={persona.id === activePersona.id ? "active" : ""}
                            key={persona.id}
                            onClick={(event) => {
                              setActivePersonaId(persona.id);
                              event.currentTarget.closest("details")?.removeAttribute("open");
                            }}
                          >
                            <span>{persona.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </details>
                  {chatMode !== "multi" && (
                  <details className="composer-select-menu model">
                    <summary
                      className="composer-pill-select model"
                      title={selectedModelOption?.providerName ?? "选择模型"}
                    >
                      <span>{selectedModelOption?.modelId ?? "未设置模型"}</span>
                    </summary>
                    <div className="composer-menu-options model">
                      {modelOptions.length === 0 ? (
                        <button type="button" disabled>
                          <span>未设置模型</span>
                        </button>
                      ) : (
                        modelOptions.map((option) => (
                          <button
                            type="button"
                            className={option.value === selectedModelValue ? "active" : ""}
                            key={option.value}
                            onClick={(event) => {
                              if (!chatProvider) return;
                              updateProvider(chatProvider.id, { modelId: option.value });
                              event.currentTarget.closest("details")?.removeAttribute("open");
                            }}
                          >
                            <span>{option.modelId}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </details>
                  )}
                  <details className="composer-sender-menu">
                    <summary
                      className="composer-sender-summary"
                      title={`发送身份：${currentChatSenderName}`}
                    >
                      {currentChatSenderAvatarImage ? (
                        <img src={currentChatSenderAvatarImage} alt={`${currentChatSenderName} 头像`} />
                      ) : currentChatSender.kind === "system" ? (
                        <Settings2 size={15} />
                      ) : currentChatSender.kind === "persona" ? (
                        <Bot size={15} />
                      ) : (
                        <UserRound size={15} />
                      )}
                    </summary>
                    <div className="composer-sender-options">
                      <button
                        type="button"
                        className={currentChatSender.kind === "user" ? "active" : ""}
                        onClick={(event) => {
                          setChatSender({ kind: "user" });
                          event.currentTarget.closest("details")?.removeAttribute("open");
                        }}
                      >
                        <span className="composer-sender-option-avatar">
                          {userProfile.avatarImage ? (
                            <img src={userProfile.avatarImage} alt={`${userProfile.nickname || "User"} 头像`} />
                          ) : (
                            <UserRound size={14} />
                          )}
                        </span>
                        <span>{userProfile.nickname || "User"}</span>
                      </button>
                      <button
                        type="button"
                        className={currentChatSender.kind === "system" ? "active" : ""}
                        onClick={(event) => {
                          setChatSender({ kind: "system" });
                          event.currentTarget.closest("details")?.removeAttribute("open");
                        }}
                      >
                        <span className="composer-sender-option-avatar">
                          <Settings2 size={14} />
                        </span>
                        <span>系统提示词</span>
                      </button>
                      {personas.map((persona) => (
                        <button
                          type="button"
                          className={
                            currentChatSender.kind === "persona" &&
                            currentChatSender.personaId === persona.id
                              ? "active"
                              : ""
                          }
                          key={persona.id}
                          onClick={(event) => {
                            setChatSender({ kind: "persona", personaId: persona.id });
                            event.currentTarget.closest("details")?.removeAttribute("open");
                          }}
                        >
                          <span className="composer-sender-option-avatar">
                            {persona.avatarImage ? (
                              <img src={persona.avatarImage} alt={`${persona.name} 头像`} />
                            ) : (
                              <Bot size={14} />
                            )}
                          </span>
                          <span>{persona.name}</span>
                        </button>
                      ))}
                    </div>
                  </details>
                </div>
                <button
                  id="send_but"
                  ref={chatSendButtonRef}
                  type="button"
                  className={`send-button ${chatGenerationState !== "idle" ? "stop" : ""}`}
                  disabled={
                    chatGenerationState === "idle" &&
                    ((!chatInput.trim() && chatAttachments.length === 0) ||
                      chatStatus.status === "loading" ||
                      (chatMode === "roleplay" && !activeSessionRoleplayCard))
                  }
                  onClick={() =>
                    chatGenerationState === "idle"
                      ? void sendChatMessage()
                      : stopChatGeneration()
                  }
                  title={chatGenerationState === "idle" ? "发送" : "停止输出"}
                  aria-label={chatGenerationState === "idle" ? "发送" : "停止输出"}
                >
                  {chatGenerationState === "idle" ? (
                    <Send size={18} />
                  ) : (
                    <Square size={15} fill="currentColor" strokeWidth={0} />
                  )}
                </button>
              </div>
            </div>
          </section>
        </section>
        {pcBrowserModal}
      </main>
    );
  }

  return (
    <main className={`app-shell ${mobileSidebarOpen ? "mobile-sidebar-open" : ""}`}>
      <button
        type="button"
        className="mobile-sidebar-toggle"
        title="打开菜单"
        aria-label="打开菜单"
        onClick={openMobileSidebar}
      >
        <Menu size={19} />
      </button>
      <aside className="sidebar">
        <div className="module-nav">
          <button
            type="button"
            onClick={() => {
              setView("home");
              closeMobileSidebar();
            }}
          >
            <Home size={16} />
            主页
          </button>
          <button
            type="button"
            onClick={() => {
              setSettingsTab("providers");
              setView("settings");
              closeMobileSidebar();
            }}
          >
            <Settings2 size={16} />
            设置
          </button>
        </div>

        <button
          className="primary-action"
          type="button"
          onClick={() => {
            addPersona();
            closeMobileSidebar();
          }}
        >
          <Plus size={18} />
          新建人格
        </button>

        <div className="persona-list">
          {personas.map((persona) => (
            <button
              className={`persona-item ${persona.id === activePersona.id ? "active" : ""}`}
              key={persona.id}
              type="button"
              onClick={() => {
                setActivePersonaId(persona.id);
                closeMobileSidebar();
              }}
            >
              <span className="avatar-dot">
                {persona.avatarImage ? (
                  <img src={persona.avatarImage} alt={`${persona.name} 头像`} />
                ) : (
                  <UserRound size={12} />
                )}
              </span>
              <span>
                <strong>{persona.name}</strong>
                <small>{getEntryCount(persona)} 个条目</small>
              </span>
            </button>
          ))}
        </div>

        <div className="sidebar-panel">
          <div className="panel-title">
            <Database size={16} />
            底层接口
          </div>
          <p>当前使用 LocalPersonaAdapter。后续可替换为 REST、GraphQL、向量库或多 Agent 编排服务。</p>
        </div>
      </aside>
      <button
        type="button"
        className="mobile-sidebar-backdrop"
        title="关闭菜单"
        aria-label="关闭菜单"
        onClick={closeMobileSidebar}
      />

      <section className="workspace">
        <header className="topbar studio-topbar">
          <div className="studio-heading">
            <div>
              <div className="eyebrow">人格工作室</div>
              <h1>{activePersona.name}</h1>
            </div>
            <span className="studio-save-status">
              <Check size={14} />
              已自动保存
            </span>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="icon-button mobile-prompt-preview-button"
              title="预览提示词"
              aria-label="预览提示词"
              onClick={() => setMobilePromptPreviewOpen(true)}
            >
              <Eye size={18} />
            </button>
            <button type="button" className="icon-button" title="导入人格文件" onClick={() => fileInputRef.current?.click()}>
              <Upload size={18} />
            </button>
            <input
              ref={fileInputRef}
              className="hidden-input"
              type="file"
              accept=".json,.txt,.md,application/json,text/plain,text/markdown"
              onChange={(event) => importPersonaFile(event.target.files?.[0])}
            />
            <button type="button" className="icon-button" title="导出 JSON" onClick={exportJson}>
              <Download size={18} />
            </button>
            <button type="button" className="icon-button studio-duplicate-action" title="复制人格" onClick={duplicatePersona}>
              <FileJson size={18} />
            </button>
            <span className="toolbar-divider" aria-hidden="true" />
            <button
              type="button"
              className="icon-button danger"
              title="删除人格"
              disabled={personas.length <= 1}
              onClick={deletePersona}
            >
              <Trash2 size={18} />
            </button>
          </div>
        </header>

        <div className="content-grid">
          <section className="editor-column">
            <div className="section-block">
              <div className="section-heading">
                <div>
                  <h2>基础档案</h2>
                  <p>这些字段是人格容器元数据，不直接等同于人格条目。</p>
                </div>
                <Save size={18} />
              </div>

              <div className="profile-grid">
                <div className="avatar-profile">
                  <button
                    type="button"
                    className="avatar-upload"
                    onClick={() => avatarInputRef.current?.click()}
                  >
                    {activePersona.avatarImage ? (
                      <img src={activePersona.avatarImage} alt={`${activePersona.name} 头像`} />
                    ) : (
                      <UserRound size={42} />
                    )}
                  </button>
                  <input
                    ref={avatarInputRef}
                    className="hidden-input"
                    type="file"
                    accept="image/*"
                    onChange={(event) => selectAvatarFile(event.target.files?.[0], "persona")}
                  />
                </div>

                <label className="field">
                  <span>人格名称</span>
                  <input
                    value={activePersona.name}
                    onChange={(event) =>
                      updatePersona((persona) => ({ ...persona, name: event.target.value }))
                    }
                  />
                </label>
              </div>
            </div>

            <div className="section-block">
              <div className="section-heading compact">
                <div>
                  <h2>人格条目</h2>
                  <p>影响等级只作用于条目类型，条目本身不再重复保存类型和影响等级。</p>
                </div>
                <button type="button" className="small-action" onClick={addEntry}>
                  <ListPlus size={16} />
                  添加条目
                </button>
              </div>

              <div className="type-tools">
                <div className="type-input-wrap">
                  <Tags size={16} />
                  <input
                    value={newTypeName}
                    placeholder="输入新类型名，例如：价值观"
                    onChange={(event) => setNewTypeName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") addEntryType();
                    }}
                  />
                </div>
                <button type="button" className="ghost-action" onClick={addEntryType}>
                  <Plus size={16} />
                  添加类型
                </button>
              </div>

              <div className="kind-tabs">
                <button
                  type="button"
                  className={selectedTypeId === "all" ? "selected" : ""}
                  onClick={() => setSelectedTypeId("all")}
                >
                  全部
                </button>
                {activeTypes.map((type) => (
                  <span
                    className={`kind-tab ${selectedTypeId === type.id ? "selected" : ""} ${
                      draggedTypeId === type.id ? "dragging" : ""
                    } ${
                      dragOverType?.typeId === type.id
                        ? `drag-over ${dragOverType.placement}`
                        : ""
                    }`}
                    key={type.id}
                    onDragOver={(event) => {
                      if (!draggedTypeId) return;
                      event.preventDefault();
                      setDragOverType({
                        typeId: type.id,
                        placement: getHorizontalDropPlacement(event),
                      });
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggedTypeId && dragOverType) {
                        reorderEntryType(
                          draggedTypeId,
                          dragOverType.typeId,
                          dragOverType.placement,
                        );
                      }
                      setDraggedTypeId(null);
                      setDragOverType(null);
                    }}
                  >
                    <button
                      type="button"
                      className="type-drag-handle"
                      draggable
                      title="拖动类型排序"
                      onDragStart={(event) => {
                        event.stopPropagation();
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", type.id);
                        setDraggedTypeId(type.id);
                      }}
                      onDragEnd={() => {
                        setDraggedTypeId(null);
                        setDragOverType(null);
                      }}
                    >
                      <GripHorizontal size={13} />
                    </button>
                    <button
                      type="button"
                      className="kind-tab-main"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedTypeId(type.id);
                      }}
                    >
                      {type.name}
                    </button>
                    <select
                      className="influence-select"
                      value={type.influence}
                      title={`${type.name} 影响等级`}
                      onChange={(event) =>
                        updateEntryType(type.id, { influence: event.target.value as InfluenceLevel })
                      }
                    >
                      {influenceLevels.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                    {activeTypes.length > 1 && (
                      <button
                        type="button"
                        className="kind-tab-remove"
                        title={`删除类型 ${type.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteEntryType(type.id);
                        }}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </span>
                ))}
              </div>

              <div className="entry-list">
                {visibleEntryRows.map(({ type, entry }) => (
                  <article
                    className={`entry-card ${
                      draggedEntry?.entryId === entry.id ? "dragging" : ""
                    } ${
                      dragOverEntry?.entryId === entry.id
                        ? `drag-over ${dragOverEntry.placement}`
                        : ""
                    }`}
                    key={entry.id}
                    onDragOver={(event) => {
                      if (!draggedEntry) return;
                      if (draggedEntry.typeId !== type.id) return;
                      event.preventDefault();
                      setDragOverEntry({
                        typeId: type.id,
                        entryId: entry.id,
                        placement: getVerticalDropPlacement(event),
                      });
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggedEntry && dragOverEntry) {
                        reorderEntry(
                          draggedEntry.typeId,
                          draggedEntry.entryId,
                          dragOverEntry.typeId,
                          dragOverEntry.entryId,
                          dragOverEntry.placement,
                        );
                      }
                      setDraggedEntry(null);
                      setDragOverEntry(null);
                    }}
                  >
                    <div className="entry-main-row">
                      <button
                        type="button"
                        className="entry-drag-handle"
                        draggable
                        title="拖动条目排序"
                        onDragStart={(event) => {
                          event.stopPropagation();
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", entry.id);
                          setDraggedEntry({ typeId: type.id, entryId: entry.id });
                        }}
                        onDragEnd={() => {
                          setDraggedEntry(null);
                          setDragOverEntry(null);
                        }}
                      >
                        <GripVertical size={16} />
                      </button>

                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={entry.enabled}
                          onChange={(event) =>
                            updateEntry(type.id, entry.id, { enabled: event.target.checked })
                          }
                        />
                        <span />
                      </label>

                      <label className="field compact-field name-field">
                        <span>条目</span>
                        <input
                          value={entry.key}
                          onChange={(event) => updateEntry(type.id, entry.id, { key: event.target.value })}
                          placeholder="例如：姓名"
                        />
                      </label>

                      <label className="field compact-field entry-type-field">
                        <span>类型</span>
                        <select
                          value={type.id}
                          title="切换条目类型"
                          onChange={(event) => moveEntryToType(type.id, entry.id, event.target.value)}
                        >
                          {activeTypes.map((entryType) => (
                            <option key={entryType.id} value={entryType.id}>
                              {entryType.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <button
                        type="button"
                        className="icon-button flat danger"
                        title="删除条目"
                        onClick={() => removeEntry(type.id, entry.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    <label className="field entry-content-field">
                      <textarea
                        rows={2}
                        value={entry.value}
                        onChange={(event) => updateEntry(type.id, entry.id, { value: event.target.value })}
                        placeholder="写入这个人格应长期遵循的信息、偏好、记忆、关系或边界。"
                      />
                    </label>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <aside className="inspector">
            <section className="inspector-panel inspector-summary-panel">
              <div className="persona-header">
                <div className="large-avatar">
                  {activePersona.avatarImage ? (
                    <img src={activePersona.avatarImage} alt={`${activePersona.name} 头像`} />
                  ) : (
                    <UserRound size={32} />
                  )}
                </div>
                <div>
                  <h2>{activePersona.name}</h2>
                  <p>{activePersona.entryTypes.length} 个类型 / {getEntryCount(activePersona)} 个条目</p>
                </div>
              </div>

              <div className="metric-row">
                <div>
                  <strong>{getEntryCount(activePersona)}</strong>
                  <span>条目</span>
                </div>
                <div>
                  <strong>{getEnabledEntryCount(activePersona)}</strong>
                  <span>启用</span>
                </div>
                <div>
                  <strong>{activePersona.entryTypes.length}</strong>
                  <span>类型</span>
                </div>
              </div>
            </section>

            <section className="inspector-panel inspector-prompt-panel">
              <div className="panel-heading">
                <Sparkles size={18} />
                <h2>提示词预览</h2>
                <button
                  type="button"
                  className="icon-button flat"
                  title={copied ? "提示词已复制" : "复制提示词"}
                  aria-label={copied ? "提示词已复制" : "复制提示词"}
                  onClick={copyPrompt}
                >
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                </button>
              </div>
              <pre className="prompt-preview">{prompt}</pre>
            </section>

            <section className="inspector-panel inspector-api-panel">
              <div className="panel-heading">
                <Settings2 size={18} />
                <h2>扩展接口</h2>
              </div>
              <div className="api-list">
                <div>
                  <SlidersHorizontal size={16} />
                  <span>influence: 类型级别 HIGH / MEDIUM / LOW</span>
                </div>
                <div>
                  <Bot size={16} />
                  <span>modelProfile: 可接 OpenAI 兼容接口或私有模型</span>
                </div>
                <div>
                  <Database size={16} />
                  <span>entryTypes: 每个类型拥有自己的条目列表</span>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </section>

      {mobilePromptPreviewOpen && (
        <div
          className="mobile-prompt-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="提示词预览"
        >
          <button
            type="button"
            className="mobile-prompt-drawer-backdrop"
            title="关闭提示词预览"
            aria-label="关闭提示词预览"
            onClick={() => setMobilePromptPreviewOpen(false)}
          />
          <section className="mobile-prompt-drawer-sheet">
            <header className="mobile-prompt-drawer-header">
              <div>
                <Sparkles size={18} />
                <h2>提示词预览</h2>
              </div>
              <div>
                <button
                  type="button"
                  className="icon-button flat"
                  title={copied ? "提示词已复制" : "复制提示词"}
                  aria-label={copied ? "提示词已复制" : "复制提示词"}
                  onClick={copyPrompt}
                >
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                </button>
                <button
                  type="button"
                  className="icon-button flat"
                  title="关闭"
                  aria-label="关闭提示词预览"
                  onClick={() => setMobilePromptPreviewOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
            </header>
            <pre className="prompt-preview">{prompt}</pre>
          </section>
        </div>
      )}

      {avatarCrop && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="裁剪头像">
          <section className="crop-modal">
            <div className="crop-header">
              <h2>裁剪头像</h2>
              <button type="button" className="icon-button flat" title="关闭" onClick={closeAvatarCrop}>
                <X size={18} />
              </button>
            </div>
            <div className="crop-stage">
              <img
                src={avatarCrop.src}
                alt="待裁剪头像"
                style={{
                  width: `${cropMetrics?.scaledWidth ?? CROP_PREVIEW_SIZE}px`,
                  height: `${cropMetrics?.scaledHeight ?? CROP_PREVIEW_SIZE}px`,
                  left: `${
                    CROP_PREVIEW_SIZE / 2 +
                    avatarCrop.offsetX -
                    (cropMetrics?.scaledWidth ?? CROP_PREVIEW_SIZE) / 2
                  }px`,
                  top: `${
                    CROP_PREVIEW_SIZE / 2 +
                    avatarCrop.offsetY -
                    (cropMetrics?.scaledHeight ?? CROP_PREVIEW_SIZE) / 2
                  }px`,
                }}
              />
            </div>
            <div className="crop-controls">
              <label className="field">
                <span>缩放</span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.01"
                  value={avatarCrop.zoom}
                  onChange={(event) =>
                    setAvatarCrop((current) =>
                      current
                        ? clampAvatarCrop({ ...current, zoom: Number(event.target.value) })
                        : current,
                    )
                  }
                />
              </label>
              <label className="field">
                <span>水平位置</span>
                <input
                  type="range"
                  min={-(cropMetrics?.maxOffsetX ?? 0)}
                  max={cropMetrics?.maxOffsetX ?? 0}
                  step="1"
                  value={avatarCrop.offsetX}
                  onChange={(event) =>
                    setAvatarCrop((current) =>
                      current
                        ? clampAvatarCrop({ ...current, offsetX: Number(event.target.value) })
                        : current,
                    )
                  }
                />
              </label>
              <label className="field">
                <span>垂直位置</span>
                <input
                  type="range"
                  min={-(cropMetrics?.maxOffsetY ?? 0)}
                  max={cropMetrics?.maxOffsetY ?? 0}
                  step="1"
                  value={avatarCrop.offsetY}
                  onChange={(event) =>
                    setAvatarCrop((current) =>
                      current
                        ? clampAvatarCrop({ ...current, offsetY: Number(event.target.value) })
                        : current,
                    )
                  }
                />
              </label>
            </div>
            <div className="crop-actions">
              <button type="button" className="ghost-action" onClick={closeAvatarCrop}>
                取消
              </button>
              <button type="button" className="small-action" onClick={saveCroppedAvatar}>
                <Check size={16} />
                保存头像
              </button>
            </div>
          </section>
        </div>
      )}
      {pcBrowserModal}
    </main>
  );
}


