import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static viewer only. It renders committed run JSON from public/runs/ and never executes candidate code.
// D1: the viewer may import cli/core/schemas.ts and nothing else under cli/ (enforced by eslint.config.js).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
