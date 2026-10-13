import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { build } from "esbuild";

const htmlPreviewDependenciesId = "virtual:html-preview-dependencies";
const resolvedHtmlPreviewDependenciesId = `\0${htmlPreviewDependenciesId}`;

export default defineConfig({
  plugins: [
    react(),
    {
      name: "html-preview-dependencies",
      resolveId(id) {
        if (id === htmlPreviewDependenciesId) return resolvedHtmlPreviewDependenciesId;
      },
      async load(id) {
        if (id !== resolvedHtmlPreviewDependenciesId) return;
        const entryPoint = fileURLToPath(new URL("./src/htmlPreviewDependencies.ts", import.meta.url));
        this.addWatchFile(entryPoint);
        const result = await build({
          entryPoints: [entryPoint],
          bundle: true,
          format: "iife",
          platform: "browser",
          target: "es2020",
          minify: true,
          write: false,
        });
        return `export default ${JSON.stringify(result.outputFiles[0].text)};`;
      },
    },
  ],
  resolve: {
    alias: {
      ejs: fileURLToPath(new URL("./node_modules/ejs/ejs.min.js", import.meta.url)),
    },
  },
});
