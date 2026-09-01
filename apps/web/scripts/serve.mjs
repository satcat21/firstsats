#!/usr/bin/env node
/**
 * Launcher for the Angular dev server.
 *
 * `@angular/build`'s dev server reads `process.env.PORT` and prefers it over
 * the `--port` flag, so on any machine that has `PORT` set for unrelated
 * reasons `ng serve` silently ignores what you asked for and tries to bind
 * that port instead -- usually failing with EACCES on a privileged or
 * already-taken port.
 *
 * Clearing the variable for the child process makes `--port` authoritative
 * again. Doing it here rather than in the npm script keeps it working on both
 * PowerShell and POSIX shells without a cross-env dependency.
 *
 * Any arguments are forwarded, so `npm run web -- --port 4300` works.
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

delete process.env.PORT;

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const ng = resolve(projectRoot, "node_modules/@angular/cli/bin/ng.js");

const child = spawn(process.execPath, [ng, "serve", ...process.argv.slice(2)], {
    // `ng` locates angular.json from the working directory, so it has to run
    // in apps/web even when invoked from the repository root.
    cwd: projectRoot,
    stdio: "inherit",
});

child.on("exit", (code, signal) => {
    process.exit(signal ? 1 : (code ?? 0));
});
