self.onmessage = async (event: MessageEvent<{ id: number; url: string; method: string; value: unknown }>) => {
  try {
    const { url, method, value } = event.data;
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
    self.postMessage({ id: event.data.id, response: { ok: response.ok, status: response.status, payload: await response.json().catch(() => ({})) } });
  } catch (error) {
    self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
