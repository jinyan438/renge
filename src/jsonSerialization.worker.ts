self.onmessage = (event: MessageEvent<unknown>) => {
  try {
    self.postMessage({ json: JSON.stringify(event.data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
