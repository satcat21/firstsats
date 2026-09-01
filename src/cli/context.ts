/** Shared plumbing every CLI command receives. */

import type { Narrator } from "../narrator.js";
import { openSession, type Session } from "../session.js";
import type { ParsedArgs } from "./args.js";

export interface CliContext {
    readonly args: ParsedArgs;
    readonly narrator: Narrator;
    /** Which keystore to use. */
    readonly walletName: string;
    /** Print machine-readable JSON instead of prose. */
    readonly json: boolean;
    /** Write a line of output. */
    readonly out: (line?: string) => void;
}

export type Command = (ctx: CliContext) => Promise<void>;

/**
 * Open a session, run `fn`, and always close it.
 *
 * Closing matters: the wallet holds an open SSE subscription to the Arkade
 * server, and Node will not exit while it is alive.
 */
export async function withSession<T>(
    ctx: CliContext,
    fn: (session: Session) => Promise<T>
): Promise<T> {
    const session = await openSession({
        walletName: ctx.walletName,
        narrator: ctx.narrator,
    });
    try {
        return await fn(session);
    } finally {
        await session.close();
    }
}

/** Emit a result as JSON when `--json` was passed, otherwise run the pretty printer. */
export function present(ctx: CliContext, payload: unknown, pretty: () => void): void {
    if (ctx.json) {
        ctx.out(JSON.stringify(payload, jsonSafe, 2));
        return;
    }
    pretty();
}

/** `JSON.stringify` replacer: bigints are common in this SDK and are not JSON. */
function jsonSafe(_key: string, value: unknown): unknown {
    return typeof value === "bigint" ? value.toString() : value;
}
