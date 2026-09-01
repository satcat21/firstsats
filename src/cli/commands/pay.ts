/** Money-moving commands: `send`, `receive`, `onboard`, `offboard`. */

import { sats } from "../../format.js";
import { ArgError, parseInteger, parseSats, stringFlag } from "../args.js";
import { type Command, present, withSession } from "../context.js";
import { style } from "../style.js";

/** `firstsats send <ark1-address> <amount-in-sats>` */
export const send: Command = async (ctx) => {
    const [address, amountArg] = ctx.args.positional;
    if (!address) {
        throw new ArgError(
            "Usage: firstsats send <arkade-address> <amount-in-sats>\n" +
                "Get the recipient's address from their `firstsats address` output."
        );
    }
    const amount = parseSats(amountArg);

    const txid = await withSession(ctx, (s) => s.account.send(address, amount));

    present(ctx, { txid, amount, address }, () => {
        ctx.out();
        ctx.out(`  ${style.green("Sent")} ${style.bold(sats(amount))}`);
        ctx.out(style.dim(`  arkade txid ${txid}`));
        ctx.out();
        ctx.out(
            style.dim(
                "  No on-chain transaction was broadcast and no miner fee was paid. The\n" +
                    "  recipient can already spend it."
            )
        );
        ctx.out();
    });
};

/**
 * `firstsats receive [--timeout seconds]`
 *
 * Prints the arkade address, then blocks until money shows up.
 */
export const receive: Command = async (ctx) => {
    const timeoutFlag = stringFlag(ctx.args, "timeout");
    const timeoutMs = timeoutFlag
        ? parseInteger(timeoutFlag, "timeout in seconds") * 1000
        : 300_000;

    const result = await withSession(ctx, async (session) => {
        const addresses = await session.account.addresses();
        if (!ctx.json) {
            ctx.out();
            ctx.out(`  Waiting for payment to ${style.green(addresses.arkade)}`);
            ctx.out(
                style.dim(
                    `  Also watching the boarding address ${addresses.boarding} for on-chain coins.`
                )
            );
            if (session.config.network.faucetUrl) {
                ctx.out(
                    style.dim(`  Need test coins? ${session.config.network.faucetUrl}`)
                );
            }
            ctx.out();
        }
        const funds = await session.account.waitForFunds(timeoutMs);
        return { addresses, funds };
    });

    present(ctx, result, () => {
        ctx.out();
        if (!result.funds) {
            ctx.out(style.yellow("  Timed out -- nothing arrived."));
        } else if (result.funds.type === "vtxo") {
            const total = result.funds.newVtxos.reduce((s, v) => s + v.value, 0);
            ctx.out(
                `  ${style.green("Received")} ${style.bold(sats(total))} off-chain.`
            );
            ctx.out(style.dim("  Spendable immediately: `firstsats balance`."));
        } else {
            const total = result.funds.coins.reduce((s, c) => s + c.value, 0);
            ctx.out(
                `  ${style.yellow("Received")} ${style.bold(sats(total))} on-chain.`
            );
            ctx.out(
                style.dim("  Wait for one confirmation, then run `firstsats onboard`.")
            );
        }
        ctx.out();
    });
};

/** `firstsats onboard` -- turn confirmed on-chain funds into VTXOs. */
export const onboard: Command = async (ctx) => {
    const txid = await withSession(ctx, (s) => s.account.onboard());

    present(ctx, { txid }, () => {
        ctx.out();
        ctx.out(`  ${style.green("Onboarded.")} commitment txid ${style.dim(txid)}`);
        ctx.out(
            style.dim("  Your money is now off-chain. `firstsats balance` to confirm.")
        );
        ctx.out();
    });
};

/** `firstsats offboard <onchain-address>` -- collaborative exit. */
export const offboard: Command = async (ctx) => {
    const [destination] = ctx.args.positional;
    if (!destination) {
        throw new ArgError(
            "Usage: firstsats offboard <on-chain-address>\n" +
                "This withdraws your off-chain funds back to an ordinary Bitcoin address."
        );
    }

    const txid = await withSession(ctx, (s) => s.account.offboard(destination));

    present(ctx, { txid, destination }, () => {
        ctx.out();
        ctx.out(
            `  ${style.green("Withdrawal submitted.")} commitment txid ${style.dim(txid)}`
        );
        ctx.out(
            style.dim(
                "  This one is a real on-chain transaction, so it needs a block confirmation."
            )
        );
        ctx.out();
    });
};
