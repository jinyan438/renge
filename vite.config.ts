import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      ejs: fileURLToPath(new URL("./node_modules/ejs/ejs.min.js", import.meta.url)),
    },
  },
});
