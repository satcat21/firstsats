#!/usr/bin/env node
/**
 * The `firstsats` command-line interface.
 *
 * Every command is a thin shell around `src/account.ts`. If you are reading this
 * repository to learn the SDK, read that file first -- this one is only about
 * argument parsing and printing.
 */

import { pathToFileURL } from "node:url";
import { PaymentError } from "../account.js";
import { ConfigError, PRESET_NAMES } from "../config.js";
import { KeystoreError } from "../keystore.js";
import { Narrator } from "../narrator.js";
import { DEFAULT_WALLET_NAME, SessionError } from "../session.js";
import { ArgError, boolFlag, parseArgs, stringFlag } from "./args.js";
import { address, balance, history, info, vtxos } from "./commands/inspect.js";
import { offboard, onboard, receive, send } from "./commands/pay.js";
import { tour } from "./commands/tour.js";
import { init, wallets } from "./commands/wallet.js";
import type { CliContext, Command } from "./context.js";
import { createStepRenderer } from "./render.js";
import { style } from "./style.js";

const COMMANDS: Record<string, { run: Command; summary: string; usage: string }> = {
    init: {
        run: init,
        summary: "Create a wallet (or import one with --import)",
        usage: "firstsats init [--wallet <name>] [--import <phrase>] [--force]",
    },
    wallets: {
        run: wallets,
        summary: "List the wallets on this machine",
        usage: "firstsats wallets",
    },
    tour: {
        run: tour,
        summary: "A guided walkthrough that adapts to your wallet's state",
        usage: "firstsats tour",
    },
    address: {
        run: address,
        summary: "Show your arkade and boarding addresses",
        usage: "firstsats address",
    },
    balance: {
        run: balance,
        summary: "Show your balance, broken into buckets",
        usage: "firstsats balance",
    },
    vtxos: {
        run: vtxos,
        summary: "List the individual virtual outputs you hold",
        usage: "firstsats vtxos",
    },
    history: {
        run: history,
        summary: "List past payments",
        usage: "firstsats history",
    },
    receive: {
        run: receive,
        summary: "Show your address and wait for money to arrive",
        usage: "firstsats receive [--timeout <seconds>]",
    },
    send: {
        run: send,
        summary: "Send sats off-chain to an arkade address",
        usage: "firstsats send <arkade-address> <amount-in-sats>",
    },
    onboard: {
        run: onboard,
        summary: "Convert confirmed on-chain funds into VTXOs",
        usage: "firstsats onboard",
    },
    offboard: {
        run: offboard,
        summary: "Withdraw off-chain funds back to an on-chain address",
        usage: "firstsats offboard <on-chain-address>",
    },
    info: {
        run: info,
        summary: "Show the Arkade server's parameters",
        usage: "firstsats info",
    },
};

function printHelp(out: (line?: string) => void): void {
    out();
    out(
        `  ${style.bold("firstsats")} -- learn Arkade by sending real testnet payments`
    );
    out();
    out(style.dim("  Commands:"));
    const width = Math.max(...Object.keys(COMMANDS).map((c) => c.length));
    for (const [name, { summary }] of Object.entries(COMMANDS)) {
        out(`    ${style.bold(name.padEnd(width))}  ${summary}`);
    }
    out();
    out(style.dim("  Global flags:"));
    out(
        `    ${"--wallet <name>".padEnd(18)} which wallet to use (default: ${DEFAULT_WALLET_NAME})`
    );
    out(`    ${"--json".padEnd(18)} machine-readable output`);
    out(`    ${"--no-explain".padEnd(18)} hide the "behind the scenes" commentary`);
    out(`    ${"--quiet".padEnd(18)} hide step-by-step narration entirely`);
    out();
    out(style.dim(`  Networks (set FIRSTSATS_NETWORK): ${PRESET_NAMES.join(", ")}`));
    out(style.dim("  New here? Run `firstsats init` then `firstsats tour`."));
    out();
}

export async function main(argv: readonly string[]): Promise<number> {
    const out = (line = ""): void => {
        console.log(line);
    };
    const args = parseArgs(argv);

    if (args.command === "help" || boolFlag(args, "help", false)) {
        printHelp(out);
        return 0;
    }

    const entry = COMMANDS[args.command];
    if (!entry) {
        console.error(`Unknown command "${args.command}".`);
        printHelp(out);
        return 1;
    }

    const json = boolFlag(args, "json", false);
    const narrator = new Narrator();
    narrator.on(
        createStepRenderer({
            explain: boolFlag(args, "explain", true),
            // Narration is prose; it would corrupt `--json` output.
            quiet: json || boolFlag(args, "quiet", false),
            write: out,
        })
    );

    const ctx: CliContext = {
        args,
        narrator,
        walletName: stringFlag(args, "wallet") ?? DEFAULT_WALLET_NAME,
        json,
        out,
    };

    try {
        await entry.run(ctx);
        return 0;
    } catch (error) {
        return reportError(error, entry.usage);
    }
}

/**
 * Turn an error into an exit code and a message a beginner can act on.
 *
 * The error types this app defines are all "you did something understandable
 * but wrong" -- they get a plain message. Anything else is a bug or a network
 * failure and gets a stack trace, because hiding those helps nobody.
 */
function reportError(error: unknown, usage: string): number {
    if (
        error instanceof ArgError ||
        error instanceof PaymentError ||
        error instanceof KeystoreError ||
        error instanceof SessionError ||
        error instanceof ConfigError
    ) {
        console.error();
        console.error(`  ${style.red("Error")}  ${error.message}`);
        if (error instanceof ArgError) {
            console.error(style.dim(`  usage: ${usage}`));
        }
        console.error();
        return 1;
    }

    console.error();
    console.error(`  ${style.red("Unexpected error")}`);
    console.error(error);
    console.error();
    return 2;
}

// Only run when executed directly, so tests can import `main` freely.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = await main(process.argv.slice(2));
}
