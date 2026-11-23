import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / heavy server-only libraries are loaded straight from node_modules
  // instead of being bundled.
  serverExternalPackages: ["better-sqlite3", "unpdf", "mammoth", "jszip"],
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
