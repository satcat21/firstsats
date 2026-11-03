/**
 * Copy the root version into the web app's manifest.
 *
 * The two are released as one thing — one tag, one set of release notes
 * covering the CLI and the browser app together — so a reader opening either
 * manifest should see the same number. They had drifted three releases apart
 * before anyone noticed, because the tags were written by hand and the
 * manifests were not.
 *
 * Run from npm's `version` lifecycle, which fires after the bump and before the
 * commit, so the synced file lands in the same commit as the bump rather than
 * as a follow-up nobody remembers to make. The web app is `private: true` and
 * never published; this is for the people reading the repository.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webManifest = join(root, "apps", "web", "package.json");

const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const before = readFileSync(webManifest, "utf8");

/*
 * A targeted replacement rather than a parse-and-stringify: rewriting the file
 * through JSON would reformat every line it did not mean to touch, and the diff
 * for a version bump should be one line.
 */
const after = before.replace(
    /^(\s*"version":\s*)"[^"]*"/m,
    (_, prefix) => `${prefix}"${version}"`
);

if (after === before) {
    console.log(`web manifest already at ${version}`);
} else {
    writeFileSync(webManifest, after);
    // Staged here because `npm version` commits immediately after this runs.
    execFileSync("git", ["add", webManifest], { cwd: root });
    console.log(`web manifest -> ${version}`);
}
