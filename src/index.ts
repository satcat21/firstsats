/**
 * arkade-firstsats -- a reference application for the Arkade TypeScript SDK.
 *
 * This is the library entry point. The CLI in `src/cli` is one consumer of it;
 * a web UI would be another. Nothing in here touches `process.stdout`.
 *
 * @example
 * ```ts
 * import { openSession, Narrator } from "arkade-firstsats";
 *
 * const narrator = new Narrator();
 * narrator.on((step) => console.log(step.status, step.title));
 *
 * const session = await openSession({ walletName: "alice", narrator });
 * console.log(await session.account.addresses());
 * await session.close();
 * ```
 */

export * from "./account.js";
export * from "./config.js";
export * as format from "./format.js";

// NOTE: `keystore`, `wallet` and `session` above are Node-only -- they use
// `node:fs` and the `eventsource` package. A browser build should import
// `./account.js`, `./narrator.js`, `./config.js` and `./format.js` directly
// (all four are free of Node globals) and supply its own storage and wallet
// construction. See docs/04-web-ui.md.
export * from "./keystore.js";
export * from "./narrator.js";
export * from "./session.js";
export * from "./wallet.js";
