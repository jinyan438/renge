const enabledValues = new Set(["1", "true", "on", "enabled"]);
const disabledValues = new Set(["0", "false", "off", "disabled"]);

export function hasVirtualDisplayAdapter(names = []) {
  return names.some((name) => /(?:virtual.*display|display.*virtual|indirect.*display|\b(?:parsec|gameviewer|zako|mumu)\b)/i.test(String(name)));
}

export function shouldDisableGpuCompositing({ platform = process.platform, env = process.env, virtualDisplayAdapterPresent = false } = {}) {
  const override = String(env.RENGE_HARDWARE_ACCELERATION ?? "").trim().toLowerCase();
  if (enabledValues.has(override) || disabledValues.has(override)) return false;
  // Windows virtual display drivers can stall the native window compositor
  // even while its renderer is idle. Keep WebGL/video GPU acceleration available.
  return platform === "win32" && virtualDisplayAdapterPresent;
}

export function shouldDisableHardwareAcceleration({
  platform = process.platform,
  env = process.env,
  nvidiaDriverPresent = false,
} = {}) {
  const override = String(env.RENGE_HARDWARE_ACCELERATION ?? "").trim().toLowerCase();
  if (enabledValues.has(override)) return false;
  if (disabledValues.has(override)) return true;

  const sessionType = String(env.XDG_SESSION_TYPE ?? "").trim().toLowerCase();
  const isX11 = sessionType === "x11"
    || (!sessionType && Boolean(env.DISPLAY) && !env.WAYLAND_DISPLAY);
  return platform === "linux" && isX11 && nvidiaDriverPresent;
}
