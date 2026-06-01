import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Repo is served from https://darkbreton.github.io/atom/ on GitHub Pages.
// Locally (dev/preview) base stays "/".
export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/atom/" : "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
