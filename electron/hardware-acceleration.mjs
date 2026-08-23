const enabledValues = new Set(["1", "true", "on", "enabled"]);
const disabledValues = new Set(["0", "false", "off", "disabled"]);

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
