import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const dependencyEntries = new Map([
  ["virtual:html-preview-dependencies-url", {
    entry: "./src/htmlPreviewDependencies.ts", name: "html-preview-libraries.js",
    classic: ["./node_modules/jquery/dist/jquery.min.js", "./node_modules/vue/dist/vue.global.prod.js"],
  }],
  ["virtual:tavern-yaml-url", { entry: "./src/tavernYamlDependency.ts", name: "tavern-yaml.js", classic: [] }],
]);
let productionBuild = false;

export default defineConfig({
  plugins: [
    react(),
    {
      name: "html-preview-dependencies",
      configResolved(config) {
        productionBuild = config.command === "build";
      },
      resolveId(id) {
        if (dependencyEntries.has(id)) return `\0${id}`;
      },
      async load(id) {
        const entry = dependencyEntries.get(id.slice(1));
        if (!id.startsWith("\0") || !entry) return;
        const entryPoint = fileURLToPath(new URL(entry.entry, import.meta.url));
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
        const classicSources = await Promise.all(entry.classic.map(async (path) => {
          const file = fileURLToPath(new URL(path, import.meta.url));
          this.addWatchFile(file);
          return await readFile(file, "utf8");
        }));
        const source = [...classicSources, result.outputFiles[0].text].join("\n;\n");
        if (!productionBuild) {
          // The dev server cannot emit Rollup assets. Keep the same ordered
          // classic-script contract without requiring a remote dependency.
          return `export default ${JSON.stringify(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)};`;
        }
        const reference = this.emitFile({ type: "asset", name: entry.name, source });
        return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
      },
    },
  ],
  resolve: {
    alias: {
      ejs: fileURLToPath(new URL("./node_modules/ejs/ejs.min.js", import.meta.url)),
    },
  },
});
