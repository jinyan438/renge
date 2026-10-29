export function httpFileBrowserActions(options: {
  scope: "temporary" | "workspace";
  workspacePath?: string;
  baseUrl?: string;
}) {
  const request = async (operation: string, path: string, extra: Record<string, unknown> = {}) => {
    const response = await fetch(`${options.baseUrl ?? ""}/api/workspace-files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...options, operation, path, ...extra }),
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || "文件操作失败。");
    return result;
  };
  return {
    renamePath: (path: string, name: string) => request("rename", path, { name }),
    deletePath: (path: string, recursive: boolean) => request(recursive ? "deleteDirectory" : "delete", path),
  };
}
