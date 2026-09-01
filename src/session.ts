/**
 * Putting the pieces together: config + keystore + SDK wallet + account.
 *
 * This is the one place that knows about all four, so every command in the CLI
 * is a two-liner: open a session, call a method on `session.account`.
 */

import { FirstSatsAccount, type WalletLike } from "./account.js";
import { type AppConfig, type Env, resolveConfig } from "./config.js";
import {
    createMnemonic,
    isValidMnemonic,
    KEYSTORE_VERSION,
    type Keystore,
    KeystoreError,
    loadKeystore,
    normalizeMnemonic,
    saveKeystore,
} from "./keystore.js";
import { type Narrator, silentNarrator } from "./narrator.js";
import { openWallet } from "./wallet.js";

export const DEFAULT_WALLET_NAME = "default";

export interface OpenSessionOptions {
    /** Which keystore to load. Defaults to `"default"`. */
    readonly walletName?: string;
    readonly narrator?: Narrator;
    /** Overrides for environment-derived settings, mainly for tests. */
    readonly env?: Env;
    /** Optional BIP-39 passphrase. */
    readonly passphrase?: string;
}

export interface Session {
    readonly account: FirstSatsAccount;
    readonly config: AppConfig;
    readonly keystore: Keystore;
    readonly narrator: Narrator;
    close(): Promise<void>;
}

export class SessionError extends Error {}

/**
 * Load a wallet from disk and connect it to the Arkade server.
 *
 * @throws {SessionError} if no wallet by that name exists. Creating one is an
 *   explicit, separate action -- see {@link createWallet}.
 */
export async function openSession(options: OpenSessionOptions = {}): Promise<Session> {
    const config = resolveConfig(options.env);
    const name = options.walletName ?? DEFAULT_WALLET_NAME;
    const narrator = options.narrator ?? silentNarrator();

    const keystore = await loadKeystore(config.dataDir, name);
    if (!keystore) {
        throw new SessionError(
            `No wallet named "${name}" in ${config.dataDir}. Run \`firstsats init\` to create one.`
        );
    }

    if (keystore.network !== config.network.name) {
        narrator.info("session.network-mismatch", "Network mismatch", {
            detail: `wallet "${name}" was created on ${keystore.network}, but you are connected to ${config.network.name}`,
            behindTheScenes:
                "The seed still works -- addresses are derived from it the same way on every " +
                "network -- but balances and history live per network, so this wallet will " +
                "look empty here.",
        });
    }

    const wallet = await narrator.track(
        {
            id: "session.open",
            title: `Connecting wallet "${name}" to ${config.network.label}`,
            before: {
                detail: config.network.arkServerUrl,
                behindTheScenes:
                    "The wallet derives its keys locally, then asks the Arkade server for its " +
                    "parameters and the indexer for any coins belonging to those keys. Your " +
                    "seed never leaves this machine.",
            },
        },
        () =>
            openWallet({
                mnemonic: keystore.mnemonic,
                network: config.network,
                ...(options.passphrase ? { passphrase: options.passphrase } : {}),
            })
    );

    const account = new FirstSatsAccount({
        wallet: wallet as unknown as WalletLike,
        network: config.network,
        narrator,
    });

    return {
        account,
        config,
        keystore,
        narrator,
        close: () => account.close(),
    };
}

export interface CreateWalletOptions {
    readonly walletName?: string;
    /** Import an existing BIP-39 phrase instead of generating a new one. */
    readonly mnemonic?: string;
    readonly env?: Env;
    readonly overwrite?: boolean;
}

export interface CreateWalletResult {
    readonly keystore: Keystore;
    readonly path: string;
    readonly config: AppConfig;
    /** True when the phrase was generated here and the user has not seen it before. */
    readonly generated: boolean;
}

/**
 * Create (or import) a wallet and write its keystore.
 *
 * @throws {KeystoreError} if an imported phrase is not a valid BIP-39 mnemonic,
 *   or a wallet of that name already exists and `overwrite` is not set.
 */
export async function createWallet(
    options: CreateWalletOptions = {}
): Promise<CreateWalletResult> {
    const config = resolveConfig(options.env);
    const name = options.walletName ?? DEFAULT_WALLET_NAME;

    const generated = options.mnemonic === undefined;
    const mnemonic = generated
        ? createMnemonic()
        : normalizeMnemonic(options.mnemonic as string);

    if (!isValidMnemonic(mnemonic)) {
        throw new KeystoreError(
            "That is not a valid BIP-39 mnemonic. Check the word count (12 or 24) and the " +
                "spelling -- one wrong word fails the checksum."
        );
    }

    const keystore: Keystore = {
        version: KEYSTORE_VERSION,
        name,
        network: config.network.name,
        mnemonic,
        createdAt: new Date().toISOString(),
    };

    const path = await saveKeystore(config.dataDir, keystore, {
        overwrite: options.overwrite ?? false,
    });

    return { keystore, path, config, generated };
}
