/** Read-only commands: `address`, `balance`, `vtxos`, `history`, `info`. */

import { btc, duration, sats, short } from "../../format.js";
import { type Command, present, withSession } from "../context.js";
import { rows, style } from "../style.js";

/** `firstsats address` -- the two ways to be paid, and what each one means. */
export const address: Command = async (ctx) => {
    const view = await withSession(ctx, (s) => s.account.addresses());

    present(ctx, view, () => {
        ctx.out();
        ctx.out(`  ${style.bold("Arkade address")} ${style.dim("-- instant, no fee")}`);
        ctx.out(`  ${style.green(view.arkade)}`);
        ctx.out(
            style.dim(
                "  Give this to anyone paying you from an Arkade wallet. The money arrives\n" +
                    "  in about a second and costs nothing to receive."
            )
        );
        ctx.out();
        ctx.out(
            `  ${style.bold("Boarding address")} ${style.dim("-- ordinary on-chain Bitcoin")}`
        );
        ctx.out(`  ${style.yellow(view.boarding)}`);
        ctx.out(
            style.dim(
                "  Send normal on-chain Bitcoin here. Once it confirms, run `firstsats onboard`\n" +
                    "  to convert it into VTXOs you can spend instantly."
            )
        );
        ctx.out();
    });
};

/** `firstsats balance` -- the buckets, and why there is more than one. */
export const balance: Command = async (ctx) => {
    const view = await withSession(ctx, (s) => s.account.balance());

    present(ctx, view, () => {
        ctx.out();
        ctx.out(
            `  ${style.bold(sats(view.available))} ${style.dim("available to spend")}`
        );
        ctx.out(style.dim(`  ${btc(view.available)}`));
        ctx.out();
        ctx.out(
            rows([
                [
                    "settled",
                    `${sats(view.settled)}  ${style.dim("finalized in a batch")}`,
                ],
                [
                    "preconfirmed",
                    `${sats(view.preconfirmed)}  ${style.dim("accepted instantly, batch pending")}`,
                ],
                [
                    "boarding",
                    `${sats(view.boarding)}  ${style.dim("on-chain -- run `onboard` to use it")}`,
                ],
                [
                    "recoverable",
                    `${sats(view.recoverable)}  ${style.dim("expired or dust, reclaimable")}`,
                ],
                ["total", style.bold(sats(view.total))],
            ])
        );
        ctx.out();
    });
};

/** `firstsats vtxos` -- the individual coins behind the balance. */
export const vtxos: Command = async (ctx) => {
    const views = await withSession(ctx, (s) => s.account.vtxos());
    const now = Date.now();

    present(ctx, views, () => {
        ctx.out();
        if (views.length === 0) {
            ctx.out(
                style.dim(
                    "  No VTXOs yet. Receive some money first: `firstsats address`."
                )
            );
            ctx.out();
            return;
        }

        ctx.out(style.dim(`  ${views.length} virtual output(s):`));
        ctx.out();
        for (const v of views) {
            const state = v.isPreconfirmed
                ? style.yellow("preconfirmed")
                : v.isSwept
                  ? style.red("swept")
                  : style.green(v.state);
            const expiry =
                v.expiresAt !== undefined
                    ? style.dim(`expires in ${duration(v.expiresAt - now)}`)
                    : "";
            ctx.out(
                `    ${style.bold(sats(v.value).padStart(16))}  ${state.padEnd(14)} ${expiry}`
            );
            ctx.out(style.dim(`    ${short(v.txid, 16, 8)}:${v.vout}`));
            ctx.out();
        }
        ctx.out(
            style.dim(
                "  Each VTXO sits in a batch tree that expires. Before it does, the wallet\n" +
                    "  renews it in a new batch -- or you can exit to the blockchain on your own."
            )
        );
        ctx.out();
    });
};

/** `firstsats history` -- past payments, newest first. */
export const history: Command = async (ctx) => {
    const views = await withSession(ctx, (s) => s.account.history());

    present(ctx, views, () => {
        ctx.out();
        if (views.length === 0) {
            ctx.out(style.dim("  No payments yet."));
            ctx.out();
            return;
        }
        for (const p of views) {
            const sign = p.direction === "sent" ? style.red("-") : style.green("+");
            // A preconfirmed payment has no block yet, so no timestamp.
            const when = p.createdAt
                ? new Date(p.createdAt).toISOString().replace("T", " ").slice(0, 16)
                : "pending".padEnd(16);
            const status = p.settled
                ? style.dim("settled")
                : style.yellow("preconfirmed");
            ctx.out(
                `  ${sign}${sats(p.amount).padEnd(18)} ${style.dim(when)}  ${status}  ${style.dim(short(p.id))}`
            );
        }
        ctx.out();
    });
};

/** `firstsats info` -- the server parameters that govern everything else. */
export const info: Command = async (ctx) => {
    const result = await withSession(ctx, async (session) => ({
        info: await session.account.serverInfo(),
        network: session.config.network,
    }));

    present(
        ctx,
        {
            network: result.network.name,
            arkServerUrl: result.network.arkServerUrl,
            esploraUrl: result.network.esploraUrl,
            dust: result.info.dust.toString(),
            signerPubkey: result.info.signerPubkey,
            sessionDuration: result.info.sessionDuration.toString(),
            unilateralExitDelay: result.info.unilateralExitDelay.toString(),
            boardingExitDelay: result.info.boardingExitDelay.toString(),
        },
        () => {
            ctx.out();
            ctx.out(`  ${style.bold(result.network.label)}`);
            ctx.out();
            ctx.out(
                rows([
                    ["arkade server", result.network.arkServerUrl],
                    ["esplora", result.network.esploraUrl],
                    ["network", result.info.network],
                    ["dust limit", sats(result.info.dust)],
                    ["batch session", `${result.info.sessionDuration}s`],
                    [
                        "unilateral exit",
                        `${duration(Number(result.info.unilateralExitDelay) * 1000)} after unrolling`,
                    ],
                    [
                        "boarding exit",
                        duration(Number(result.info.boardingExitDelay) * 1000),
                    ],
                    ["server key", short(result.info.signerPubkey, 12, 8)],
                ])
            );
            ctx.out();
            ctx.out(
                style.dim(
                    "  `unilateral exit` is the safety net: if the Arkade server disappeared\n" +
                        "  right now, you could still take your money on-chain by yourself after\n" +
                        "  that delay. Nobody can freeze or seize it in the meantime."
                )
            );
            ctx.out();
        }
    );
};
