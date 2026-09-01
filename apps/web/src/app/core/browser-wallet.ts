/**
 * The browser counterpart of `src/wallet.ts`.
 *
 * A browser needs neither of the two things the Node build has to arrange: it
 * has a native `EventSource`, and the SDK's IndexedDB repositories are its
 * default storage. So this file is shorter than its Node sibling, and the only
 * interesting line is the deliberate choice of persistent repositories.
 *
 * That choice matters. The CLI uses in-memory repositories and rebuilds state
 * from the indexer on every run, which is fine for a process that lives for a
 * second. A wallet a person actually keeps should persist, because the data it
 * holds includes the exit paths that make a unilateral exit possible.
 */

import {
    IndexedDBContractRepository,
    IndexedDBWalletRepository,
    MnemonicIdentity,
    Wallet,
} from "@arkade-os/sdk";
import type { NetworkPreset } from "@firstsats/core";

/**
 * One database per wallet.
 *
 * The SDK persists HD state — descriptors, rotation watermarks, contracts —
 * against the identity that owns it, and refuses to open a store belonging to a
 * different one. That refusal is correct and it is what a single shared
 * database name turns into a hard error the moment a second profile exists.
 */
export function databaseFor(id: string): string {
    return `firstsats.${id}`;
}

/** Marks the one-time removal of the pre-profiles shared database. */
const LEGACY_CLEARED = "firstsats.legacyDbCleared";

/**
 * Drop the single database every wallet used before profiles existed.
 *
 * It holds one identity's HD state, which is exactly what made a second profile
 * fail to open. Nothing is lost by deleting it: wallet state is rebuilt from the
 * indexer, and the seed lives in the profile, not here.
 */
function dropLegacyDatabase(): void {
    try {
        if (localStorage.getItem(LEGACY_CLEARED)) return;
        localStorage.setItem(LEGACY_CLEARED, "1");
        indexedDB.deleteDatabase("firstsats");
    } catch {
        // Storage unavailable, or the browser refused. Harmless either way:
        // the database is orphaned, not in the way.
    }
}

export interface OpenWalletOptions {
    readonly mnemonic: string;
    readonly network: NetworkPreset;
    /** Profile id. Scopes this wallet's local storage to itself. */
    readonly id: string;
}

export async function openBrowserWallet(
    options: OpenWalletOptions
): Promise<Wallet> {
    // BIP-86 uses coin type 0 for mainnet and 1 for everything else. The SDK
    // defaults to mainnet and refuses to attach a mainnet-derived identity to
    // a testnet server, so the network has to be declared.
    const identity = MnemonicIdentity.fromMnemonic(options.mnemonic, {
        isMainnet: options.network.name === "bitcoin",
    });

    dropLegacyDatabase();

    const database = databaseFor(options.id);

    return Wallet.create({
        identity,
        // Explicit rather than "auto": boarding-address rotation only exists on
        // an HD wallet, and "auto" resolving it from the identity's shape is a
        // silent dependency for a privacy property this app relies on.
        walletMode: "hd",
        arkServerUrl: options.network.arkServerUrl,
        esploraUrl: options.network.esploraUrl,
        storage: {
            walletRepository: new IndexedDBWalletRepository(database),
            contractRepository: new IndexedDBContractRepository(database),
        },
    });
}
