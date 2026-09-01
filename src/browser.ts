/**
 * The browser-safe surface of the core.
 *
 * `src/index.ts` is the Node entry point and pulls in `keystore`, `wallet` and
 * `session`, all of which use `node:fs` or the `eventsource` package. This
 * barrel exports only the modules that are free of Node globals, so a browser
 * bundle can import the same domain logic the CLI uses without dragging in
 * anything that will not run there.
 *
 * A browser build supplies its own storage and wallet construction; everything
 * else -- the account API, the narration stream, the network presets and the
 * formatters -- is shared verbatim.
 */

export * from "./account.js";
export * from "./config.js";
export * from "./format.js";
export * from "./narrator.js";
