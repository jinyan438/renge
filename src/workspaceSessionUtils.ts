const DEFAULT_WORKSPACE_KEY = "default";

export function normalizeWorkspaceSessionPath(
  workspaceKey: unknown,
  workspacePath: unknown,
) {
  const key = String(workspaceKey ?? "").trim() || DEFAULT_WORKSPACE_KEY;
  if (key === DEFAULT_WORKSPACE_KEY || key.startsWith("browser:")) return undefined;

  const path = typeof workspacePath === "string" ? workspacePath.trim() : "";
  return path || key;
}

export function isDefaultWorkspaceKey(workspaceKey: unknown) {
  return String(workspaceKey ?? "").trim() === DEFAULT_WORKSPACE_KEY;
}
