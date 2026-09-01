/**
 * Fail the build when a template names an icon the font subset does not carry.
 *
 * The icon font is subsetted to keep it at ~60 KB instead of 3.5 MB, and a name
 * outside that subset does not fail loudly — the browser renders the ligature
 * text instead, so `close` shows as a stray "C" and `autorenew` as an "A". That
 * has shipped four times, always the same way: an icon added to a template, the
 * regeneration step forgotten, the breakage noticed only on screen.
 *
 * So the manifest is checked against the templates here rather than by eye.
 * Wired into `npm run build`, so forgetting is no longer possible.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Names Material reaches for on its own, plus words the scan cannot tell from
 * an icon. Keeping both lists here means the scan can stay blunt.
 */
const IMPLICIT = ["done", "create", "warning", "check", "close", "expand_more", "expand_less"];
const NOT_ICONS = new Set([
    "none", "block", "start", "ok", "fail", "light", "dark", "system",
    "utxo", "vtxo", "sent", "received", "end", "bottom", "todo", "tour",
    "wallet", "receive", "current", "number", "outline", "dynamic", "hd",
    "auto", "static", "empty", "awaiting", "quest", "free",
    "onboard", "arrival", "exit", "ark", "deposit", "sweep", "moved",
    "settled", "preconfirmed", "waiting", "unconfirmed",
]);

/** Every `.ts` under a directory, recursively. */
function sources(dir) {
    return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return sources(path);
        return path.endsWith(".ts") ? [path] : [];
    });
}

/** Icon names the templates ask for. */
function used() {
    const names = new Set(IMPLICIT);
    for (const file of sources(join(root, "src", "app"))) {
        const text = readFileSync(file, "utf8");
        // The closing tag is often split across lines by the formatter.
        for (const m of text.matchAll(/<mat-icon\b[^>]*>\s*([a-z_0-9]+)\s*<\/mat-icon\s*>/g)) {
            names.add(m[1]);
        }
        // Record maps of icon names, e.g. TAB_ICONS.
        for (const m of text.matchAll(/^\s*(?:[a-z]+):\s*"([a-z_0-9]+)",\s*$/gm)) {
            names.add(m[1]);
        }
        // Ternaries that swap one icon for another.
        for (const m of text.matchAll(/\?\s*"([a-z_0-9]+)"\s*:\s*"([a-z_0-9]+)"/g)) {
            names.add(m[1]);
            names.add(m[2]);
        }
    }
    return new Set([...names].filter((n) => !NOT_ICONS.has(n) && !/^\d/.test(n)));
}

/** Icon names the shipped subset carries, read from the manifest comment. */
function shipped() {
    const scss = readFileSync(join(root, "src", "styles.scss"), "utf8");
    const block = scss.match(/reaches for them on its own:\n \*\n((?: \*   [^\n]*\n)+)/);
    if (!block) throw new Error("no icon manifest in styles.scss");
    return new Set(block[1].match(/[a-z_0-9]+/g) ?? []);
}

const have = shipped();
const missing = [...used()].filter((name) => !have.has(name)).sort();

if (missing.length > 0) {
    console.error(
        `\n${missing.length} icon(s) are used but not in the font subset:\n` +
            missing.map((n) => `  ${n}`).join("\n") +
            "\n\nThey would render as their own name in raw text. Add them to the\n" +
            "manifest comment in src/styles.scss and regenerate the woff2 — the\n" +
            "comment carries the command.\n"
    );
    process.exit(1);
}

console.log(`icons: ${have.size} in the subset, all used names covered`);
