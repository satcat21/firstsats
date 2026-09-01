import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["test/**/*.test.ts"],
        // The e2e suite talks to a live Arkade signet deployment and is slow.
        testTimeout: 20_000,
    },
});
