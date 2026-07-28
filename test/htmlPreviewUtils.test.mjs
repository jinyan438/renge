import assert from "node:assert/strict";
import test from "node:test";

import {
  stabilizeHtmlPreviewMapViewport,
  stabilizeHtmlPreviewRuntimeCompatibility,
} from "../src/htmlPreviewUtils.ts";

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
