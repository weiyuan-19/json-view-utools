import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "plugin",
    emptyOutDir: true,
    modulePreload: {
      polyfill: false,
    },
  },
});
