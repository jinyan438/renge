import { startRengeServer as startServer } from "../server.mjs";

// Run the same integration contracts against the desktop's isolated SDK host.
export const startRengeServer = (options = {}) => startServer({
  isolatePiHost: process.env.RENGE_TEST_PI_WORKER === "1", ...options,
});
