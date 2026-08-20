import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, "src/main/index.ts"), external: ["better-sqlite3"] } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve(__dirname, "src/preload/index.ts") } },
  },
  renderer: {
    root: "src/renderer",
    plugins: [react(), tailwindcss()],
    // Monaco exposes Vite virtual `?worker` modules. Pre-bundling those modules
    // produces stale `/node_modules/.vite/deps/*worker.js` URLs in dev.
    optimizeDeps: {
      exclude: ["monaco-editor"],
    },
    resolve: {
      alias: {
        "monaco-editor/esm": resolve(__dirname, "node_modules/monaco-editor/esm"),
      },
    },
    build: {
      rollupOptions: { input: resolve(__dirname, "src/renderer/index.html") },
    },
  },
});
