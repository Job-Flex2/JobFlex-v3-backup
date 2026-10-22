import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
      "prisma/migrations/**",
      "**/*.css",
      // Generated Prisma client + one-off report scripts for the legacy importer.
      "scripts/migrate-v2/.generated/**",
      "scripts/migrate-v2/reports/**",
      // Not source: scratch harnesses, other builds' output folders, QA Lab runs and baselines,
      // the voice server, archived pages and a stray folder named `undefined`.
      ".cache/**",
      ".next-*/**",
      "qa/runs/**",
      "qa/baselines/**",
      "voice/**",
      "old-design-pages/**",
      "undefined/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];
