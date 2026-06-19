import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  vite: {
    optimizeDeps: {
      exclude: [
        "aria-query",
        "axobject-query",
        "cssesc"
      ],
    },
  },
});
