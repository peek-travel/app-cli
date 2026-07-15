import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    include: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
    server: {
      deps: {
        inline: ["@peektravel/app-utilities"],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "lib/**/*.ts",
        "app/peek-pro/**/*.ts",
        "app/peek-pro/**/*.tsx",
        "app/examples/**/*.ts",
        "app/examples/**/*.tsx",
      ],
      exclude: ["**/*.d.ts", "**/__tests__/**"],
    },
  },
});
