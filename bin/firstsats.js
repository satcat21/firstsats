#!/usr/bin/env node
// Thin launcher so `npx firstsats` works without a build step.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "../src/cli/index.ts");
const result = spawnSync(
    process.execPath,
    ["--import", "tsx", entry, ...process.argv.slice(2)],
    { stdio: "inherit" }
);
process.exit(result.status ?? 1);
