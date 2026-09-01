/** Wallet lifecycle commands: `init` and `wallets`. */

import { resolveConfig } from "../../config.js";
import { listWallets } from "../../keystore.js";
import { createWallet } from "../../session.js";
import { boolFlag, stringFlag } from "../args.js";
import { type Command, present } from "../context.js";
import { style } from "../style.js";

/**
 * `firstsats init [--wallet name] [--import "twelve words..."] [--force]`
 *
 * Creates a seed and writes it to disk. Nothing touches the network: an Arkade
 * wallet exists the moment you have the words, before any server knows about it.
 */
export const init: Command = async (ctx) => {
    const imported = stringFlag(ctx.args, "import");
    const result = await createWallet({
        walletName: ctx.walletName,
        ...(imported !== undefined ? { mnemonic: imported } : {}),
        overwrite: boolFlag(ctx.args, "force", false),
    });

    present(
        ctx,
        {
            name: result.keystore.name,
            network: result.keystore.network,
            path: result.path,
            generated: result.generated,
            // The mnemonic is printed on stdout only because this is a testnet
            // teaching tool. Never do this in a real wallet.
            mnemonic: result.keystore.mnemonic,
        },
        () => {
            ctx.out();
            ctx.out(
                `  Created wallet ${style.bold(result.keystore.name)} on ${style.bold(
                    result.config.network.label
                )}`
            );
            ctx.out(style.dim(`  keystore: ${result.path}`));
            ctx.out();

            if (result.generated) {
                ctx.out(
                    style.yellow(
                        "  Your recovery phrase -- write these twelve words down:"
                    )
                );
                ctx.out();
                ctx.out(`    ${style.bold(result.keystore.mnemonic)}`);
                ctx.out();
                ctx.out(
                    style.dim(
                        "  These words ARE the money. Anyone who reads them can spend your funds,\n" +
                            "  and nobody -- not Arkade, not this program -- can recover them for you.\n" +
                            "  This demo stores them unencrypted, so use it only with testnet coins."
                    )
                );
            } else {
                ctx.out(style.dim("  Imported an existing recovery phrase."));
            }

            ctx.out();
            ctx.out(
                style.dim("  Next: `firstsats address` to see where to receive money.")
            );
            ctx.out();
        }
    );
};

/** `firstsats wallets` -- list the keystores in the data directory. */
export const wallets: Command = async (ctx) => {
    const config = resolveConfig();
    const names = await listWallets(config.dataDir);

    present(ctx, { dataDir: config.dataDir, wallets: names }, () => {
        ctx.out();
        if (names.length === 0) {
            ctx.out(
                style.dim(`  No wallets in ${config.dataDir}. Run \`firstsats init\`.`)
            );
        } else {
            ctx.out(style.dim(`  Wallets in ${config.dataDir}:`));
            ctx.out();
            for (const name of names) ctx.out(`    ${name}`);
        }
        ctx.out();
    });
};
