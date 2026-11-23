import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Advisory performance rule; our effects intentionally sync fetched data into local state.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    // Electron's main process uses CommonJS.
    files: ["desktop/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "desktop/node_modules/**",
    "desktop/dist/**",
    "desktop/resources/**",
  ]),
]);

export default eslintConfig;
