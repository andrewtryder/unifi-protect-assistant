import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html", "text-summary"],
      include: ["src/**/*.ts", "shared/**/*.mjs"],
      exclude: ["src/types.ts"],
      thresholds: {
        lines: 55,
        statements: 55,
        functions: 50,
        branches: 40,
      },
    },
  },
});
