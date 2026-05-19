import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // External API responses (DVF, DPE, IGN, Sirene) legitimately need any
      "@typescript-eslint/no-explicit-any": "warn",
      // useEffect deps warnings are intentional (Leaflet imperative API)
      "react-hooks/exhaustive-deps": "warn",
    },
  },
]);

export default eslintConfig;
