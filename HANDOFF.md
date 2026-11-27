# HANDOFF: SillyTavern / Tavern Helper compatibility for Renge

Work stopped mid-task at the user's request (2026-11-27). **Nothing is committed. The tree has not been type-checked or tested since the last batch of edits.**

## 1. Goal and reference paths

Make Renge's roleplay renderer compatible with every HTML character card that plays in the latest SillyTavern + Tavern Helper, by adding the missing or incompatible APIs.

- Renge repo: `E:\AI\project\renge` (branch `main`, base HEAD `dee7db6`, remote `origin` = `https://github.com/jinyan438/renge.git`)
- SillyTavern **1.19.1**: `E:\AI\chat\SillyTavern2` (event names: `public/scripts/events.js`)
- Tavern Helper **4.12.2**: `E:\AI\chat\SillyTavern2\public\scripts\extensions\third-party\JS-Slash-Runner`
  - Type declarations: `@types/function/*.d.ts`, `@types/iframe/*.d.ts`
  - Real implementations: `src/function/*.ts`. Trust these over the doc comments.
- Reference repos are read-only. Shell commands with a working directory there are blocked; use Read/Glob/Grep.
- `AGENTS.md` rules still apply: run `git status --short --branch` first, never discard user changes, finish with one commit, push to `origin`, and report the commit ID, tests run and push result. No `reset --hard`, `clean` or force-push.

## 2. Work so far (all uncommitted)

### New files

| File | Contents | State |
|---|---|---|
| `src/tavernHelperCompat.ts` | Pure format layer: version constants, the full ST `event_types` list plus Renge extras, `TAVERN_HELPER_IFRAME_EVENTS`, `normalizeTavernEventName`, `TAVERN_MESSAGE_ID_EVENTS`, worldbook entry converters (TH4, legacy Lorebook, raw ST world-info, Renge flat), preset / character / persona converters, `createTavernHelperDefaultPreset`, `resolveTavernMessageRange`, `rotateTavernMessages`. | Written; last edits not type-checked. |
| `src/tavernSlashExecutor.ts` | Pure STscript pipeline interpreter: `executeTavernSlashPipeline(script, host)` plus the `TavernSlashHost` type. Covers variables, math, `/if`, `/run`, `/echo`, `/delay`, `/hide`, `/cut`, `/gen`, `/inject`, `/event-emit`, `/audio*`, closures and `{{pipe}}`. Unknown commands go to `host.runLegacy`. | Written; **not wired into App**. |
| `src/tavernHelperHostServices.ts` | `createTavernHelperHostServices(stores)`: character / preset / persona CRUD over Renge stores, `toTavernHelperRegex`, the `TavernHelperHostServices` and `TavernHelperSaveMode` types. | Written; **not wired into App**. |
| `HANDOFF.md` | This file. Do not include it in the final commit unless the user wants it. | |

### Modified files

`src/tavernCompatibilityUtils.ts`
- `resolveTavernCreateMessageInsertionIndex` accepts `{ insert_before | insert_at }`, negative ids and `"end"`.
- `createTavernMacroRegistry` passes capture groups to the callback and returns a new `unregisterMacroLike`.

`src/tavernScriptRuntime.ts` (large refactor, partly finished)
- **Events:** `TAVERN_EVENTS` is now the real ST list. Names are normalized in on / off / emit / clear. `emitFromScript` calls `adapter.onScriptEvent`. `emitNow` coerces a string message id to a number for message events.
- **Worldbook block rewritten:** TH4 shapes and return values, numeric uids, `loadWorldInfo` / `saveWorldInfo` in raw ST format, chat and character rebinding, legacy lorebook functions, sync `getLorebookSettings` / `getCharLorebooks`, and `listWorldBookRecords` (the old object-returning `getLorebooks`).
- **Chat messages rewritten:** `getChatMessages` (range syntax, `role`, `hide_state`), `setChatMessages`, `createChatMessages` (system role, `name`, `is_hidden`, `insert_before`), `deleteChatMessages` (negative ids), new `rotateChatMessages`.
- **Module-level `createTavernAudioPlayer(hostWindow)`:** `playAudio`, `pauseAudio`, `getAudioList`, `replaceAudioList`, `appendAudioList`, `getAudioSettings`, `setAudioSettings`, `getCurrentAudio`, `destroy`.
- **Class additions:** `apiOnly` option (4th constructor argument), `isApiOnly()`, `callApi(name, args)`, `substituteMacros()`, fields `api` / `audioPlayer` / `macroSubstitute`, an api-only fast path in `initialize()`, cleanup in `destroy()`, and `reportStatus` as a no-op when api-only.
- **Adapter type additions:** `Partial<TavernHelperHostServices>` plus `formatDisplayedMessage`, `getPersonaDescription`, `getChatHistory`, `resetCharacterWorldBookBinding`, `getInstalledExtensionIds`, `onScriptEvent`, `reloadChat`, `importRawFile`.
- **New block of local functions just before `const api = {` in `installCompatibilityApi`. These are defined but NOT yet exposed:**
  - Characters: `getCharacterNames`, `getCharacterIds`, `getCurrentCharacterName`, `getCurrentCharacterId`, `readTavernCharacter` (expose as `getCharacter`), `createCharacter`, `createOrReplaceCharacter`, `replaceCharacter`, `updateCharacterWith`, `deleteCharacter`
  - Raw character: `getCharData`, `getCharAvatarPath`, `getChatHistoryBrief`, `getChatHistoryDetail`, class `RawCharacter`
  - Presets: `default_preset`, `getPresetNames` (now includes `'in_use'`), `getLoadedPresetName`, `loadPreset`, `getPreset`, `createPreset`, `createOrReplacePreset`, `deletePreset`, `renamePreset`, `replacePreset`, `updatePresetWith`, `setPreset`
  - Personas: `getPersonaNames`, `getPersonaIds`, `getCurrentPersonaId`, `getCurrentPersonaName`, `getPersonaAvatarPath`, `getPersona`, `createPersona`, `createOrReplacePersona`, `deletePersona`, `replacePersona`, `updatePersonaWith`
  - Displayed messages: `formatAsDisplayedMessage`, `retrieveDisplayedMessage`, `refreshOneMessage`
  - Other: `builtin` (with `promptManager`), `isInstalledExtension`, `unsupportedExtensionOperation`, `getTavernFile`, `uploadTavernFile`, `deleteTavernFile`, `importRawFile`, `importRawResponse`, `getAllEnabledScriptButtons`, `initializeGlobal`, `audioApi`, and a `stopAllGeneration` that returns a boolean

`src/App.tsx` is **untouched**.

## 3. Current state

- **`npx tsc -b` PASSES** (checked after the section 5A api wiring). Tests not yet run.
- **5A done except:** enriching `getSillyTavernCharacters()` and passing `generation_id` through `generate`. All new-block functions are now on `api`; `this.api` / `this.macroSubstitute` are set; api-only mode returns before the parent bridge; versions, `getWorldBooks`, lorebook entries and `win.*` stubs are fixed. The "known gaps" list below is therefore resolved.
- **`npm test` PASSES** (553 + 9 + 9 + 4, zero failures). `test/diceAutoUpdateBrowser.test.mjs` assertion updated.
- **`npm run test:tavern` browser tests could NOT run in the agent sandbox** (Playwright's Chromium is missing from the sandbox cache path; needs `npx playwright install` or a run from the user's own terminal). The unit part (4 tests) passes. Browser tests are unverified.
- **Exact next step:** section 5B, starting with the adapter wiring in the runtime creation effect of `src/App.tsx`.
- Known gaps in `src/tavernScriptRuntime.ts` (not compile errors):
  - unused locals from the new block, if `noUnusedLocals` is on;
  - the `win.getPreset` stub after `Object.assign(win, api)` still uses the old name-lookup semantics;
  - `api.getCharData` is still the old inline lambda;
  - `this.api` and `this.macroSubstitute` are never assigned, so `callApi` always throws;
  - `installParentTavernApiBridge` still runs in api-only mode.
- No test has been run in this task. No unit tests exist yet for the three new modules.
- Temp helpers live outside the repo in `E:\.cache\TEMP\renge-edit\`. `replace.mjs <file> <startAnchorFile> <endAnchorFile> <replacementFile>` replaces from a unique start anchor up to, not including, the end anchor. Optional to reuse.

## 4. Key findings and design decisions

### Architecture

- Two Tavern environments exist:
  1. **Script runtime** (`TavernScriptRuntime`): a hidden same-origin iframe. `installCompatibilityApi()` builds `api`, which is bridged to the host window. App only creates it when `activeTavernScripts.length > 0` (App.tsx ~20282).
  2. **Message iframes**: cross-origin. Their API is a string-built script in `buildHtmlPreviewVariablesScript` (App.tsx ~4597–5101), working on a `snapshot` plus the postMessage RPC `requestParentCommand(operation, data)`, handled in `handleHtmlPreviewMessage` (~14496–14890). Self-contained TS functions are injected via `.toString()`; see `src/htmlPreviewTavernScripts.ts` and `src/htmlPreviewParentBridge.ts` for the pattern.
- **Decision:** the runtime is the single API implementation. Message iframes reach it through a generic RPC, `requestParentCommand("tavernApi", { name, args })` → `runtime.callApi`. When a card has no scripts, App creates an **api-only** runtime.
- Updater-style functions cannot cross postMessage. Implement them frame-side as get → updater → replace.
- Sync getters in frames need a snapshot field (planned: `tavern` on `HtmlPreviewContext`). Light data is always sent; heavy data (in-use preset, regexes, char data) only when the frame content references those API names.
- Planned event flow:
  - host `emitTavernEvent` forwards events to frames, only for names a frame subscribed to;
  - frame `eventEmit` runs local handlers, then RPCs to `runtime.emit` and the other frames;
  - script-emitted events reach frames through `adapter.onScriptEvent`.

### Gotchas (verified against TH source)

- Preset prompt ids are ST's **camelCase** identifiers (`worldInfoBefore`, `enhanceDefinitions`). The doc comments say snake_case, which is wrong; compat accepts snake_case as input aliases only. `builtin_prompt_default_order` for generate is separately snake_case and correct as is.
- `getPresetNames()` returns `['in_use', ...]`. `getPreset('in_use')` falls back to `default_preset` when Renge has presets switched off.
- Persona `position` and `role` are numbers (0 = in prompt, 9 = none) and `lorebook` is a string.
- Real event names: `CHAT_CHANGED = 'chat_id_changed'`, `GENERATION_AFTER_COMMANDS = 'GENERATION_AFTER_COMMANDS'`, `CHARACTER_DELETED = 'characterDeleted'`. Old Renge names are aliased by `normalizeTavernEventName`.
- Return shapes:
  - `createWorldbookEntries` → `{ worldbook, new_entries }`
  - `deleteWorldbookEntries` → `{ worldbook, deleted_entries }`
  - `createOrReplace*` → `true` if created, `false` if replaced
  - `createLorebookEntries` → `{ entries, new_uids }`
  - `deleteLorebookEntries` → `{ entries, delete_occurred }`
- TH-only worldbook fields (role, recursion, effect, …) are stored under `entry.extra.__tavern_helper` and hidden from scripts' `extra`.
- Renge's server already serves `/api/files/upload`, `/api/files/delete`, `/user/files/*`, `/api/characters/chats` and `/api/extensions/install|update`. The file functions use the first three.
- The host DOM already has `[mesid="N"] .mes_text`, which `retrieveDisplayedMessage` uses.
- `resetCharacterWorldBookBinding` must delete the session's `characterWorldBookOverrides[card.id]` key. The existing `updateRuntimeCharacterWorldBookOverride(null)` means "no book", which is different.
- Existing Renge quirk, to report and not change: the `worldbookUtils` import maps numeric positions 2/3 and 5/6 swapped relative to ST. New compat code uses the ST-true mapping.
- `tavernHelperHostServices.ts` has an extensionless value import, so its unit tests need `tsx --test`, not `node --experimental-strip-types`.
- App raw-import helpers available for `adapter.importRawFile`: `importCharacterCardFile(File)`, `importSillyTavernPreset(json, fileName)`, `importSillyTavernWorldBook(json, fileName)`.

## 5. Remaining tasks (in priority order)

### A. Finish `src/tavernScriptRuntime.ts`

- [ ] Run `npx tsc -b` and fix errors.
- [ ] In `installCompatibilityApi`:
  - set `this.api = api` and `this.macroSubstitute = substitudeMacros`;
  - skip `installParentTavernApiBridge` when `this.apiOnly`.
- [ ] Add to the `api` object:
  - every function from the new block listed in section 2, with `getCharacter: readTavernCharacter`;
  - `...audioApi`, `builtin`, `RawCharacter`, `default_preset`, `rotateChatMessages`, `unregisterMacroLike`;
  - `isPresetNormalPrompt`, `isPresetSystemPrompt`, `isPresetPlaceholderPrompt`;
  - `builtin_prompt_default_order` and `placeholder_prompt_default_order`;
  - `iframe_events: TAVERN_HELPER_IFRAME_EVENTS`;
  - `getProxyPresetNames: () => []`;
  - extension functions: `isAdmin`, `getTavernHelperExtensionId`, `getExtensionType`, `getExtensionInstallationInfo`, `isInstalledExtension`, and install / uninstall / reinstall / update mapped to `unsupportedExtensionOperation`;
  - file functions; `importRawCharacter`, `importRawChat`, `importRawWorldbook` via `importRawResponse`; `importRawPreset` via `importRawFile`;
  - worldbook and lorebook functions from the rewritten block that are not yet exposed: `createWorldbook`, `saveWorldInfo`, `rebindCharWorldbooks`, `getChatWorldbookName`, `rebindChatWorldbook`, `enableGlobalWorldbooks`, `replaceLorebookEntries`, `updateLorebookEntriesWith`, `setCurrentCharLorebooks`, `getChatLorebook`, `setChatLorebook`, `getOrCreateChatLorebook`, `createLorebook`, `deleteLorebook`;
  - util: `getIframeName`, `getMessageId`, `reloadIframe`, `eventOnButton`.
- [ ] Fix stale `api` entries:
  - `setLorebookSettings: async () => true` → the real `setLorebookSettings`
  - `deleteLorebookEntries: deleteWorldbookEntries` → `deleteLorebookEntries`
  - `getCharData` → the new function
  - `getTavernHelperVersion` → `TAVERN_HELPER_VERSION`
  - `getTavernVersion` → `SILLYTAVERN_VERSION`
  - the `/version` fetch stub and `sillyTavern.version` / `versionInfo`, which still say `"3.5.0"`
- [ ] In `getContext` and `sillyTavern`:
  - `getWorldBooks: listWorldBookRecords`;
  - add `saveWorldInfo`, `substituteParams`, `characters`, persona fields, etc.
- [ ] Replace the `win.getPreset`, `win.formatAsDisplayedMessage` and `win.retrieveDisplayedMessage` stubs with the real functions.
- [ ] `generate`: return `{ content }` when `should_return_reasoning === true`; pass `generation_id` through.
- [ ] Enrich `getSillyTavernCharacters()` with top-level v1 fields and the new optional `TavernRuntimeCharacter` fields.

### B. `src/App.tsx` integration

- [ ] Build the adapter before the no-scripts early return (~20282). When there are no scripts, create `new TavernScriptRuntime([], adapter, tavernHostWindow, { apiOnly: true })`.
- [ ] Make the settled check in `prepareHtmlPreviewSession` (~20941) tolerate it: `!runtime || runtime.isApiOnly()`.
- [ ] Spread `createTavernHelperHostServices({...})` into the adapter, using `characterCardsRef`, `chatPresetsRef`, `userProfileState` and their setters.
- [ ] Add the remaining adapter members: `formatDisplayedMessage`, `getPersonaDescription`, `getChatHistory`, `resetCharacterWorldBookBinding`, `onScriptEvent`, `importRawFile`, `getInstalledExtensionIds`.
- [ ] Enrich the adapter's `getCharacter` (~20554).
- [ ] `handleHtmlPreviewMessage`: add a `tavernApi` op that awaits runtime readiness and then calls `runtime.callApi`, plus event-emit and event-subscribe ops.
- [ ] `emitTavernEvent` (~13844): forward to subscribed frames.
- [ ] `createTavernExtensionEventBus` (~9779): normalize names with `normalizeTavernEventName`.
- [ ] `generateHtmlPreviewText` (~29366): also emit `js_generation_started`, `js_generation_ended` and `js_stream_token_received_fully|incrementally` with `generation_id`, to both frames and runtime. Keep the existing names.
- [ ] `executeSlashCommand` (~14436): try `parseTavernSlashCommand` first. If it returns null, run `executeTavernSlashPipeline` with a host whose `runLegacy` is the old path.
- [ ] Frame bridge (`buildHtmlPreviewVariablesScript`):
  - add a self-contained frame module (planned `src/htmlPreviewTavernHelperApi.ts`, injected via `.toString()`);
  - generic RPC stubs for all API names;
  - snapshot-backed sync getters;
  - frame-side updater functions;
  - the full event API (`eventOn`, `eventOnce`, `eventMakeFirst`, `eventMakeLast`, `eventEmit`, `eventEmitAndWait`, `eventRemoveListener`, `eventClear*`);
  - `tavern_events`, `iframe_events`, real version strings, an expanded `SillyTavern` / `getContext`, and `getIframeName`, `getMessageId`, `getScriptId`, `reloadIframe`;
  - pass the full generate config through. Today only `userInput`, `shouldStream` and `disableExtras` are passed.
- [ ] Add `tavern` to `HtmlPreviewContext` (~4223) and `htmlPreviewContextBase` (~21609).

### C. Tests and finalization

- [ ] `test/diceAutoUpdateBrowser.test.mjs` line 203: `"generation_after_commands"` → `"GENERATION_AFTER_COMMANDS"`.
- [ ] Add `tsx --test` unit tests for `tavernHelperCompat`, `tavernSlashExecutor` and `tavernHelperHostServices`, and wire them into `package.json`.
- [ ] Run `npm test`, `npm run test:tavern` and `npm run build`.
  - `test/tavernRunnerCompatibilityBrowser.test.mjs` must keep passing. It uses `getCharWorldbookNames('current').primary`, `createWorldbookEntries`, `getWorldbook(...).find(e => e.extra?.profile_source)` and `tavern_events.GENERATION_AFTER_COMMANDS`.
- [ ] Review `git diff`, make one commit, push to `origin`, and report the commit ID, tests and push status.
- [ ] The final report must list what is approximated or unsupported:
  - extension install / uninstall from scripts (501 stub);
  - `importRawChat`;
  - image and video token cost;
  - full STscript coverage;
  - `generate` `injects` / `tools`;
  - audio lists kept in memory only;
  - the worldbook numeric-position import quirk.
