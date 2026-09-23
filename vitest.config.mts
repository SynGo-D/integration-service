import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Node environment — this service has no DOM.
        environment: "node",
        include: ["tests/**/*.test.ts"],
        // Unit tests only: nothing here may touch Postgres or a provider API.
        // Anything needing those belongs in a separate integration suite so
        // `npm test` stays runnable with no infrastructure at all.
    }
});
