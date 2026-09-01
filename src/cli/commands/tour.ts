/**
 * `firstsats tour` -- a guided walkthrough that adapts to where you actually are.
 *
 * The whole point of this command is that it never tells you to do something you
 * have already done. It reads real wallet state and picks the next step.
 */

import type { BalanceView } from "../../account.js";
import { sats } from "../../format.js";
import { type Command, withSession } from "../context.js";
import { style } from "../style.js";

interface TourState {
    readonly balance: BalanceView;
    readonly vtxoCount: number;
    readonly arkadeAddress: string;
    readonly boardingAddress: string;
    readonly faucetUrl?: string | undefined;
}

/** The single most useful thing to do next, given the wallet's state. */
export function nextStep(state: TourState): { title: string; body: string } {
    if (state.balance.total === 0) {
        return {
            title: "Step 2 of 4 -- get some test coins",
            body:
                `Your wallet is empty, which is exactly right for a wallet that was just created.\n\n` +
                `  Ask someone with an Arkade wallet to send to:\n` +
                `    ${style.green(state.arkadeAddress)}\n\n` +
                `  Or send on-chain test coins to your boarding address:\n` +
                `    ${style.yellow(state.boardingAddress)}\n` +
                (state.faucetUrl ? `    faucet: ${state.faucetUrl}\n` : "") +
                `\n  Then run: ${style.bold("firstsats receive")}`,
        };
    }

    if (state.balance.boarding > 0) {
        return {
            title: "Step 3 of 4 -- come off-chain",
            body:
                `You have ${style.bold(sats(state.balance.boarding))} sitting on-chain at your\n` +
                `  boarding address. On-chain money is slow and costs a fee to move.\n\n` +
                `  Run ${style.bold("firstsats onboard")} to swap it for VTXOs. That joins the next\n` +
                `  batch round -- about a minute -- and is the only on-chain step in the\n` +
                `  entire flow. Everything after it is instant.`,
        };
    }

    if (state.balance.available > 0) {
        return {
            title: "Step 4 of 4 -- send a payment",
            body:
                `You have ${style.bold(sats(state.balance.available))} spendable across ` +
                `${state.vtxoCount} VTXO(s).\n\n` +
                `  Send some to another arkade address:\n` +
                `    ${style.bold("firstsats send ark1... 1000")}\n\n` +
                `  Watch how long it takes. There is no block to wait for, and no fee\n` +
                `  leaves your balance. Then look at ${style.bold("firstsats vtxos")} to see which\n` +
                `  coins were destroyed and created.`,
        };
    }

    return {
        title: "Everything is tied up",
        body:
            `You hold ${style.bold(sats(state.balance.total))}, but none of it is spendable right now.\n` +
            `  ${sats(state.balance.recoverable)} is recoverable from expired or dust outputs, and\n` +
            `  ${sats(state.balance.preconfirmed)} is preconfirmed. Run ${style.bold("firstsats balance")} for the breakdown.`,
    };
}

export const tour: Command = async (ctx) => {
    const state = await withSession(ctx, async (session) => {
        const addresses = await session.account.addresses();
        const balance = await session.account.balance();
        const vtxos = await session.account.vtxos();
        return {
            balance,
            vtxoCount: vtxos.length,
            arkadeAddress: addresses.arkade,
            boardingAddress: addresses.boarding,
            faucetUrl: session.config.network.faucetUrl,
        } satisfies TourState;
    });

    const step = nextStep(state);

    ctx.out();
    ctx.out(`  ${style.bold("Step 1 of 4 -- create a wallet")} ${style.green("done")}`);
    ctx.out(
        style.dim(
            "  Twelve words on disk. No account, no server, no permission needed --\n" +
                "  the wallet existed before anything on the network knew about it."
        )
    );
    ctx.out();
    ctx.out(`  ${style.bold(step.title)}`);
    ctx.out(`  ${step.body}`);
    ctx.out();
};
