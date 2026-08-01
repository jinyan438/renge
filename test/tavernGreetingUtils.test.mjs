import assert from "node:assert/strict";
import test from "node:test";

import {
  getTavernGreetingSwipeIndex,
  getTavernMessageSwipeState,
} from "../src/tavernGreetingUtils.ts";

test("greeting messages expose every opening as a swipe", () => {
  const variables = { stat_data: { chapter: "summer" } };
  const state = getTavernMessageSwipeState(
    {
      content: "summer rendered",
      source: "roleplay-greeting",
      variables,
      extra: { renderer: "active" },
    },
    { index: 2, greetings: ["default", "spring", "summer", "twilight"] },
  );

  assert.equal(state.swipeId, 2);
  assert.deepEqual(state.swipes, ["default", "spring", "summer", "twilight"]);
  assert.deepEqual(state.swipesData, [{}, {}, variables, {}]);
  assert.deepEqual(state.swipesInfo, [{}, {}, { renderer: "active" }, {}]);
});

test("a pure greeting swipe update requests an opening switch", () => {
  const message = { content: "spring", source: "roleplay-greeting" };

  assert.equal(getTavernGreetingSwipeIndex(message, { swipe_id: 2 }), 2);
  assert.equal(getTavernGreetingSwipeIndex(message, { swipe_id: "3" }), 3);
});

test("explicit swipe content does not request an opening switch", () => {
  const message = { content: "spring", source: "roleplay-greeting" };

  assert.equal(
    getTavernGreetingSwipeIndex(message, { swipe_id: 1, message: "edited" }),
    null,
  );
  assert.equal(
    getTavernGreetingSwipeIndex(message, { swipe_id: 1, swipes: ["a", "edited"] }),
    null,
  );
});

test("ordinary messages keep a single swipe and never switch greetings", () => {
  const message = { content: "ordinary", variables: { ready: true } };

  assert.deepEqual(getTavernMessageSwipeState(message), {
    swipeId: 0,
    swipes: ["ordinary"],
    swipesData: [{ ready: true }],
    swipesInfo: [{}],
  });
  assert.equal(getTavernGreetingSwipeIndex(message, { swipe_id: 1 }), null);
});
