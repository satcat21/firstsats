/**
 * Wiring the Arkade SDK up for Node.js.
 *
 * There are exactly two things a Node process has to do that a browser does
 * not, and both are handled here:
 *
 *  1. Provide an `EventSource`. The SDK uses Server-Sent Events to follow a
 *     batch settlement as it happens. Node has no global `EventSource`, so we
 *     hand the SDK a factory from the `eventsource` package.
 *  2. Choose repositories. The browser default is IndexedDB, which does not
 *     exist here. We use the in-memory repositories: state is rebuilt from the
 *     Arkade indexer on each run, which keeps this demo stateless apart from
 *     the seed.
 */

import {
    configureEventSource,
    InMemoryContractRepository,
    InMemoryWalletRepository,
    MnemonicIdentity,
    Wallet,
} from "@arkade-os/sdk";
import { EventSource } from "eventsource";
import type { NetworkPreset } from "./config.js";

let eventSourceConfigured = false;

/**
 * Teach the SDK how to open an SSE stream. Idempotent, and safe to call before
 * or after any SDK import — the factory is resolved when a stream opens.
 */
export function installEventSource(): void {
    if (eventSourceConfigured) return;
    configureEventSource((url) => new EventSource(url));
    eventSourceConfigured = true;
}

export interface OpenWalletOptions {
    readonly mnemonic: string;
    readonly network: NetworkPreset;
    /** Optional BIP-39 passphrase ("25th word"). */
    readonly passphrase?: string;
}

/**
 * Create a signing wallet from a mnemonic.
 *
 * `MnemonicIdentity` derives a BIP-86 (Taproot) key, the same standard other
 * Bitcoin wallets use, so the seed is not Arkade-specific.
 *
 * Remember to `await wallet.dispose()` — the wallet holds open subscriptions to
 * the Arkade server, and the process will not exit while they are live.
 */
export async function openWallet(options: OpenWalletOptions): Promise<Wallet> {
    installEventSource();

    // BIP-86 uses a different coin type for mainnet (0) and everything else (1).
    // The SDK defaults to mainnet and refuses to connect a mainnet-derived
    // identity to a testnet server, so the network has to be declared here.
    const identity = MnemonicIdentity.fromMnemonic(options.mnemonic, {
        isMainnet: options.network.name === "bitcoin",
        ...(options.passphrase ? { passphrase: options.passphrase } : {}),
    });

    return Wallet.create({
        identity,
        // Explicit rather than "auto": boarding-address rotation only exists on
        // an HD wallet, and "auto" resolving it from the identity's shape is a
        // silent dependency for a privacy property this app relies on.
        walletMode: "hd",
        arkServerUrl: options.network.arkServerUrl,
        esploraUrl: options.network.esploraUrl,
        storage: {
            walletRepository: new InMemoryWalletRepository(),
            contractRepository: new InMemoryContractRepository(),
        },
    });
}
