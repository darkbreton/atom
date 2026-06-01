import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Repo is served from https://darkbreton.github.io/atom/ on GitHub Pages.
// Locally (dev/preview) base stays "/".
export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/atom/" : "/",
  plugins: [react()],
});
