import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@adam/contracts": fileURLToPath(new URL("../../packages/contracts/src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    typecheck: {
      enabled: true,
      include: ["test/**/*.test.ts", "test/**/*.test-d.ts"],
      tsconfig: "./tsconfig.test.json"
    }
  }
});
