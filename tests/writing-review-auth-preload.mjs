// Preload for tests/writing-review-auth.test.ts — swaps the real
// mysql2 driver for tests/mocks/mysql2-promise.mjs so route/auth code
// can be exercised without any database.
//   NODE_OPTIONS="--import ./tests/writing-review-auth-preload.mjs" \
//     npx tsx tests/writing-review-auth.test.ts
import { registerHooks } from "node:module";

const MOCK_MYSQL_URL = new URL("./mocks/mysql2-promise.mjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "mysql2/promise" || specifier === "mysql2") {
      return { url: MOCK_MYSQL_URL, shortCircuit: true };
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && !specifier.endsWith(".ts") && !specifier.endsWith(".js") && !specifier.endsWith(".mjs") && !specifier.endsWith(".json") && error.code === "ERR_MODULE_NOT_FOUND") {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});
