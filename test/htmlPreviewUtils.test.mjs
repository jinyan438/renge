import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeWhitespaceSeparatedHtmlPreviewSegments,
  stabilizeHtmlPreviewMapViewport,
  stabilizeHtmlPreviewRuntimeCompatibility,
} from "../src/htmlPreviewUtils.ts";

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
