import assert from "node:assert/strict";
import test from "node:test";
import { hasVirtualDisplayAdapter, shouldDisableGpuCompositing, shouldDisableHardwareAcceleration } from "../electron/hardware-acceleration.mjs";

test("Windows virtual displays use software window composition without disabling hardware acceleration", () => {
  assert.equal(hasVirtualDisplayAdapter(["NVIDIA GeForce RTX 4090", "Intel(R) UHD Graphics 770"]), false);
  for (const name of ["Parsec Virtual Display Adapter", "GameViewer Virtual Display Adapter", "MuMu Virtual Display Adapter", "Zako Display Adapter", "Indirect Display Device"]) assert.equal(hasVirtualDisplayAdapter([name]), true);
  assert.equal(shouldDisableGpuCompositing({ platform: "win32", env: {}, virtualDisplayAdapterPresent: true }), true);
  assert.equal(shouldDisableHardwareAcceleration({ platform: "win32", env: {} }), false, "WebGL and video acceleration stay available");
  assert.equal(shouldDisableGpuCompositing({ platform: "win32", env: {}, virtualDisplayAdapterPresent: false }), false);
  assert.equal(shouldDisableGpuCompositing({ platform: "linux", env: {}, virtualDisplayAdapterPresent: true }), false);
  for (const value of ["1", "true", "on", "0", "false", "off"]) assert.equal(shouldDisableGpuCompositing({ platform: "win32", env: { RENGE_HARDWARE_ACCELERATION: value }, virtualDisplayAdapterPresent: true }), false);
});

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
