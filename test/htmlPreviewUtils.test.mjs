import assert from "node:assert/strict";
import test from "node:test";

import {
  collectInheritedHtmlPreviewStyleResources,
  deferHtmlPreviewFontStylesheets,
  getHtmlPreviewLayoutSettleDelays,
  injectHtmlPreviewHead,
  isHtmlPreviewRootTag,
  isTavernInlinePlaceholder,
  isTavernPlaceholderLine,
  mergeWhitespaceSeparatedHtmlPreviewSegments,
  normalizeRedundantTavernQuotePairs,
  stabilizeHtmlPreviewMapViewport,
  stabilizeHtmlPreviewRuntimeCompatibility,
  TAVERN_INLINE_PLACEHOLDER_PATTERN,
  unwrapTavernProseWrappers,
  unwrapPackedHtmlPreviewDocument,
} from "../src/htmlPreviewUtils.ts";

const packDocument = (html) => `<body><script>(function(){var h=new TextDecoder().decode(Uint8Array.from(atob('${Buffer.from(html).toString('base64')}'),function(c){return c.charCodeAt(0)}));document.write(h)})();</script></body>`;

test("unpacks complete UTF-8 document writers before preview compatibility transforms", () => {
  const html = '<head><title>档案 $& $1</title></head><body><div id="app">旅人</div></body>';
  assert.equal(unwrapPackedHtmlPreviewDocument(packDocument(html)),html);
  assert.equal(unwrapPackedHtmlPreviewDocument(packDocument(packDocument(html))),html);
  for (const source of [
    packDocument(html).replace('document.write(h)','sideEffect();document.write(h)'),
    packDocument(html).replace('<script>','<script src="external.js">'),
    packDocument(html).replace('<script>','<script type="module">'),
    packDocument(html).replace('<script>','<script type=module>'),
    packDocument(html)+'<p>Keep accompanying content</p>',
    packDocument('plain text'),
    packDocument(html).replace(/atob\('[^']+'\)/,"atob('====')"),
  ]) assert.equal(unwrapPackedHtmlPreviewDocument(source),source);
});

test("optional web fonts do not block frontend startup or alter author-managed links", () => {
  const font='<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fixture">';
  const deferred=deferHtmlPreviewFontStylesheets(font);
  assert.ok(deferred.includes('media="print"'));
  assert.ok(deferred.includes('onload="this.media=\'all\'"'));
  assert.equal(deferHtmlPreviewFontStylesheets(deferred),deferred);
  for (const tag of [font.replace('fonts.googleapis.com','fixture.invalid'),font.replace('rel="stylesheet"','rel="preconnect"'),font.replace('>',' media="screen">'),font.replace('>',' onload="loaded()">'),`<script>const font='${font}';</script>`,`<style>a::before{content:'${font}'}</style>`,`<!-- ${font} -->`]) {
    assert.equal(deferHtmlPreviewFontStylesheets(tag),tag);
  }
});

test("injects preview dependencies and card snapshots without expanding replacement tokens", () => {
  const injection = '<script>const tokens = ["$&", "$1", "$`", "$\'", "$$"];</script>';
  for (const [source, expected] of [
    ['<html lang="zh"><head data-card="yes"></head><body>form</body></html>', `<html lang="zh"><head data-card="yes">${injection}</head><body>form</body></html>`],
    ['<html lang="zh"><body>form</body></html>', `<html lang="zh"><head>${injection}</head><body>form</body></html>`],
    ['<body>form</body>', `<head>${injection}</head><body>form</body>`],
  ]) assert.equal(injectHtmlPreviewHead(source, injection), expected);
});

test("recognizes inert script placeholders without treating standard HTML as markers", () => {
  const standardTags = new Set(["img", "br", "script", "input"]);
  for (const source of [
    '<IllustrationImpl ref="landscape#1" />',
    "<StatusPlaceHolderImpl>",
    "<SceneArt ref='room > window'/>",
    '<OtherWidget data-ref="first" />',
  ]) {
    assert.equal(source.match(TAVERN_INLINE_PLACEHOLDER_PATTERN)?.[0], source);
    assert.equal(isTavernInlinePlaceholder(source, standardTags), true);
  }
  for (const source of ['<img src="photo.png" />', "<br/>", "<script>", "<story>"]) {
    assert.equal(isTavernInlinePlaceholder(source, standardTags), false);
  }
});

test("keeps consecutive placeholder lines separate from surrounding prose and code", () => {
  const standardTags = new Set(["img", "br", "script"]);
  assert.equal(isTavernPlaceholderLine('  <IllustrationImpl ref="one"/><SceneArt ref="two" /> ', standardTags), true);
  assert.equal(isTavernPlaceholderLine("<StatusPlaceHolderImpl>", standardTags), true);
  for (const source of ['正文 <SceneArt/>', '`<SceneArt/>`', '<img src="test.png"/>', '<story>', '', '<SceneArt ref="unfinished']) {
    assert.equal(isTavernPlaceholderLine(source, standardTags), false, source);
  }
});

test("bounds HTML preview fallback measurements to the startup window", () => {
  assert.deepEqual(getHtmlPreviewLayoutSettleDelays(false), [80, 240, 600]);
  assert.deepEqual(getHtmlPreviewLayoutSettleDelays(true), [240, 800, 1600]);
  assert.ok(Math.max(...getHtmlPreviewLayoutSettleDelays(true)) < 2000);
});

test("treats paired Tavern wrapper tags as HTML preview roots", () => {
  const standardTags = new Set(["div", "span", "details", "summary"]);
  const blockRootTags = new Set(["div", "details"]);

  assert.equal(isHtmlPreviewRootTag("catsay", standardTags, blockRootTags), true);
  assert.equal(isHtmlPreviewRootTag("BGINFOR", standardTags, blockRootTags), true);
  assert.equal(isHtmlPreviewRootTag("details", standardTags, blockRootTags), true);
  assert.equal(isHtmlPreviewRootTag("span", standardTags, blockRootTags), false);
});

test("unwraps Tavern content blocks so prose keeps Markdown layout", () => {
  const source = `<content>\n第一段。\n\n*第二段斜体。*\n</content>`;

  assert.equal(unwrapTavernProseWrappers(source), "\n第一段。\n\n*第二段斜体。*\n");
  assert.equal(
    unwrapTavernProseWrappers("<catsay><details>点评</details></catsay>"),
    "<catsay><details>点评</details></catsay>",
  );
});

test("removes redundant straight quotes around localized dialogue quotes", () => {
  assert.equal(
    normalizeRedundantTavernQuotePairs('她说："“欢迎回来。”"'),
    "她说：“欢迎回来。”",
  );
  assert.equal(
    normalizeRedundantTavernQuotePairs('居民称他为""“神大人”""。'),
    "居民称他为“神大人”。",
  );
});

test("inherits assistant style resources from earlier chat messages", () => {
  const result = collectInheritedHtmlPreviewStyleResources(
    [
      {
        role: "assistant",
        content:
          '<style>.st-ui{color:white}</style><link href="card.css" rel="stylesheet">',
      },
      { role: "user", content: "<style>.st-ui{color:red}</style>" },
      { role: "assistant", content: "<div class='st-ui'>当前卡片</div>" },
    ],
    2,
  );

  assert.equal(
    result,
    '<style>.st-ui{color:white}</style>\n<link href="card.css" rel="stylesheet">',
  );
});

test("keeps the last cascade position for repeated inherited styles", () => {
  const repeatedStyle = "<style>.card{padding:8px}</style>";
  const overridingStyle = "<style>.card{padding:12px}</style>";
  const result = collectInheritedHtmlPreviewStyleResources(
    [
      { role: "assistant", content: repeatedStyle },
      {
        role: "assistant",
        content: `<script>const example = ${JSON.stringify("<style>.card{display:none}</style>")};</script>${overridingStyle}`,
      },
      { role: "assistant", content: repeatedStyle },
      { role: "assistant", content: "<div class='card'>当前卡片</div>" },
    ],
    3,
  );

  assert.equal(result, `${overridingStyle}\n${repeatedStyle}`);
  assert.doesNotMatch(result, /display:none/);
});

test("keeps a style block and adjacent HTML roots in one preview document", () => {
  const result = mergeWhitespaceSeparatedHtmlPreviewSegments([
    { type: "text", content: "角色开场\n\n" },
    { type: "html", content: "<style>.card{color:#fff}</style>" },
    { type: "text", content: "\n<!-- status layout -->\n" },
    { type: "html", content: '<div class="card">状态</div>' },
    { type: "text", content: "\n" },
    { type: "html", content: '<div class="card">背包</div>' },
    { type: "text", content: "\n后续叙事" },
  ]);

  assert.deepEqual(result, [
    { type: "text", content: "角色开场\n\n" },
    {
      type: "html",
      content:
        '<style>.card{color:#fff}</style>\n<!-- status layout -->\n<div class="card">状态</div>\n<div class="card">背包</div>',
    },
    { type: "text", content: "\n后续叙事" },
  ]);
});

test("does not merge HTML roots separated by visible prose", () => {
  const result = mergeWhitespaceSeparatedHtmlPreviewSegments([
    { type: "html", content: "<div>第一块</div>" },
    { type: "text", content: "\n解释文字\n" },
    { type: "html", content: "<div>第二块</div>" },
  ]);

  assert.equal(result.length, 3);
  assert.equal(result[1].content, "\n解释文字\n");
});

test("guards optional preview event targets and missing card helpers", () => {
  const source = `
interactionChoicePanel.querySelector('.modal-close-btn').addEventListener('click', closePanel);
document.getElementById('optional-button').addEventListener('click', handleClick);
await loadFabShortcutConfig();
`;

  const result = stabilizeHtmlPreviewRuntimeCompatibility(source);

  assert.match(
    result,
    /interactionChoicePanel\.querySelector\('\.modal-close-btn'\)\?\.addEventListener/,
  );
  assert.match(
    result,
    /document\.getElementById\('optional-button'\)\?\.addEventListener/,
  );
  assert.match(
    result,
    /if \(typeof loadFabShortcutConfig === "function"\) await loadFabShortcutConfig\(\);/,
  );
});

test("fits MapRenderer data into the first visible canvas viewport", () => {
  const source = `
class MapRenderer {
  constructor(container, canvas, mapData) {
    this.container = container;
    this.canvas = canvas;
    this._mapData = mapData;
    this.drawCount = 0;
  }
  resize() {
    this.canvas.width = this.container.clientWidth;
    this.canvas.height = this.container.clientHeight;
    this.drawMap();
  }
  drawMap() {
    this.drawCount += 1;
  }
}
`;
  const transformed = stabilizeHtmlPreviewMapViewport(source);
  const Renderer = Function(`${transformed}; return MapRenderer;`)();
  const renderer = new Renderer(
    { clientWidth: 400, clientHeight: 800 },
    {},
    {
      terrains: [{ points: [[0, 0], [4000, 8000]] }],
      main_regions: [],
      sub_regions: [],
      points_of_interest: [],
    },
  );

  renderer.resize();

  assert.equal(renderer.canvas.width, 400);
  assert.equal(renderer.canvas.height, 800);
  assert.equal(renderer.scale, 0.09);
  assert.equal(renderer.offsetX, 20);
  assert.equal(renderer.offsetY, 40);
  assert.equal(renderer.__rengeInitialMapFit, true);
  assert.equal(renderer.drawCount, 1);
});

test("opens the only available birthplace map without an empty chooser step", async () => {
  const source = `
async function openBirthLocationSelection() {
  // 先打开地图管理弹窗让用户选择/确认地图
  await openMapManagement();
}
`;
  const transformed = stabilizeHtmlPreviewMapViewport(source);
  const calls = [];
  const onlyChoice = { checked: false };
  const overlay = { classList: { remove: value => calls.push(["remove", value]) } };
  const document = {
    querySelectorAll: selector => {
      calls.push(["query", selector]);
      return [onlyChoice];
    },
    getElementById: id => {
      calls.push(["get", id]);
      return overlay;
    },
  };
  const openMapManagement = async () => calls.push(["manage"]);
  const setDefaultMap = async () => calls.push(["default"]);
  const openMapSelection = () => calls.push(["open"]);
  const openBirthLocationSelection = Function(
    "document",
    "openMapManagement",
    "setDefaultMap",
    "openMapSelection",
    `${transformed}; return openBirthLocationSelection;`,
  )(document, openMapManagement, setDefaultMap, openMapSelection);

  await openBirthLocationSelection();

  assert.equal(onlyChoice.checked, true);
  assert.deepEqual(calls, [
    ["manage"],
    ["query", '#map-list-container input[name="defaultMapSelection"]'],
    ["default"],
    ["get", "map-management-overlay"],
    ["remove", "visible"],
    ["open"],
  ]);
});

test("keeps the birthplace map chooser when multiple maps are available", async () => {
  const source = `
async function openBirthLocationSelection() {
  await openMapManagement();
}
`;
  const transformed = stabilizeHtmlPreviewMapViewport(source);
  const calls = [];
  const document = {
    querySelectorAll: () => [{ checked: false }, { checked: false }],
    getElementById: () => {
      throw new Error("the chooser should remain open");
    },
  };
  const openMapManagement = async () => calls.push("manage");
  const setDefaultMap = async () => calls.push("default");
  const openMapSelection = () => calls.push("open");
  const openBirthLocationSelection = Function(
    "document",
    "openMapManagement",
    "setDefaultMap",
    "openMapSelection",
    `${transformed}; return openBirthLocationSelection;`,
  )(document, openMapManagement, setDefaultMap, openMapSelection);

  await openBirthLocationSelection();

  assert.deepEqual(calls, ["manage"]);
});
