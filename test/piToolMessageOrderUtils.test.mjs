import assert from "node:assert/strict";
import test from "node:test";
import { resolvePiToolAnchor } from "../src/piToolMessageOrderUtils.ts";

function message(id, visualization) {
  return visualization ? { id, toolVisualization: visualization } : { id };
}

function running(toolCallId, name) {
  return { toolCallId, name, status: "running" };
}

test("anchors a tool completion on the message that started the tool", () => {
  const messages = [
    message("m1", running("call-1", "read")),
    message("text-after-tool", undefined),
  ];

  assert.equal(
    resolvePiToolAnchor(messages, { toolCallId: "call-1", toolName: "read" })?.id,
    "m1",
  );
});

test("does not move a completion to the tail when the id was renamed", () => {
  // Pi streams `stream-tool-call-0` but executes with its own id. The
  // completion must still resolve to the original placeholder position.
  const messages = [
    message("m1", running("stream-tool-call-0", "read")),
    message("streamed-text", undefined),
  ];

  const anchor = resolvePiToolAnchor(messages, {
    toolCallId: "pi-exec-42",
    toolName: "read",
  });

  assert.equal(anchor?.id, "m1");
});

test("reuses the newest running anchor for the same tool name", () => {
  const messages = [
    message("m1", { toolCallId: "a", name: "edit", status: "done" }),
    message("m2", running("b", "edit")),
    message("m3", running("c", "edit")),
  ];

  const anchor = resolvePiToolAnchor(messages, { toolName: "edit" });
  assert.equal(anchor?.id, "m3");
});

test("ignores finished anchors unless finished matches are allowed", () => {
  const messages = [message("m1", { toolCallId: "a", name: "read", status: "done" })];

  assert.equal(resolvePiToolAnchor(messages, { toolCallId: "a", toolName: "read" }), undefined);
  assert.equal(
    resolvePiToolAnchor(messages, {
      toolCallId: "a",
      toolName: "read",
      includeFinished: true,
    })?.id,
    "m1",
  );
});

test("returns undefined when nothing anchors the event so callers append", () => {
  const messages = [message("m1", running("a", "read")), message("text", undefined)];

  assert.equal(resolvePiToolAnchor(messages, { toolName: "bash" }), undefined);
  assert.equal(resolvePiToolAnchor(messages, {}), undefined);
  assert.equal(resolvePiToolAnchor([], { toolName: "read" }), undefined);
});

test("never anchors on a message that carries no tool visualization", () => {
  const messages = [message("m1", undefined), message("m2", undefined)];

  assert.equal(resolvePiToolAnchor(messages, { toolCallId: "m1", toolName: "read" }), undefined);
});
