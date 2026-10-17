export type AppDataSaveResult = {
  ok: boolean;
  status: number;
  payload: { error?: string; sessionVersions?: Record<string, string> };
};

export async function sendAppDataJson(url: string, method: string, data: unknown): Promise<AppDataSaveResult> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return { ok: response.ok, status: response.status, payload: await response.json().catch(() => ({})) };
}
