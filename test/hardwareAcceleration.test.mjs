import assert from "node:assert/strict";
import test from "node:test";
import { shouldDisableHardwareAcceleration } from "../electron/hardware-acceleration.mjs";

test("disables hardware acceleration for NVIDIA on Linux X11", () => {
  assert.equal(shouldDisableHardwareAcceleration({
    platform: "linux",
    env: { XDG_SESSION_TYPE: "x11", DISPLAY: ":1" },
    nvidiaDriverPresent: true,
  }), true);
});

test("keeps hardware acceleration on Wayland and non-NVIDIA systems", () => {
  assert.equal(shouldDisableHardwareAcceleration({
    platform: "linux",
    env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" },
    nvidiaDriverPresent: true,
  }), false);
  assert.equal(shouldDisableHardwareAcceleration({
    platform: "linux",
    env: { XDG_SESSION_TYPE: "x11", DISPLAY: ":1" },
    nvidiaDriverPresent: false,
  }), false);
});

test("honors explicit hardware acceleration overrides", () => {
  assert.equal(shouldDisableHardwareAcceleration({
    platform: "linux",
    env: { XDG_SESSION_TYPE: "x11", RENGE_HARDWARE_ACCELERATION: "1" },
    nvidiaDriverPresent: true,
  }), false);
  assert.equal(shouldDisableHardwareAcceleration({
    platform: "win32",
    env: { RENGE_HARDWARE_ACCELERATION: "0" },
    nvidiaDriverPresent: false,
  }), true);
});
