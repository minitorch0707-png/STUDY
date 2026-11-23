import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The desktop app bundles a self-contained server build (see scripts/prepare-desktop.mjs).
  output: process.env.LECTURELAB_STANDALONE === "1" ? "standalone" : undefined,
  // The data folder is chosen at runtime, which makes the bundler think the whole
  // project might be needed. Keep source, docs, tests and the desktop shell out of the server bundle.
  outputFileTracingExcludes: {
    "*": ["./desktop/**", "./docs/**", "./demo/**", "./tests/**", "./test-fixtures/**", "./scripts/**", "./src/**", "./data/**", "./*.md", "./install.sh", "./tsconfig*", "./eslint.config.mjs", "./vitest.config.mts", "./.github/**", "./.git/**", "./.env*", "./.next/cache/**"],
  },
  // Native / heavy server-only libraries are loaded straight from node_modules
  // instead of being bundled.
  serverExternalPackages: ["better-sqlite3", "unpdf", "mammoth", "jszip", "cfb", "word-extractor"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
