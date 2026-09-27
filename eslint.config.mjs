import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// eslint-config-next 16 ships flat configs directly (no FlatCompat needed).
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", ".netlify/**", "out/**", "build/**", "next-env.d.ts", "scripts/**"]),
]);
