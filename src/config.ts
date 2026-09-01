/**
 * Network presets and runtime configuration.
 *
 * A newcomer should not have to know what an "Arkade server URL" or an
 * "Esplora endpoint" is before they can send their first payment, so every
 * setting here has a working default. Everything can still be overridden by
 * environment variable — see `.env.example`.
 */

import { ESPLORA_URL, type NetworkName } from "@arkade-os/sdk";

/** A ready-to-use set of endpoints for one Bitcoin test network. */
export interface NetworkPreset {
    /** The SDK's canonical network name. */
    readonly name: NetworkName;
    /**
     * Short human-friendly name, e.g. `"Signet"`.
     *
     * Short because it appears inside sentences and notification titles, where
     * a parenthetical about who runs the deployment pushes the useful part off
     * the line. That belongs in {@link deployment}.
     */
    readonly label: string;
    /** Who operates this deployment, shown as supporting detail. */
    readonly deployment?: string;
    /** Base URL of the Arkade server (the batch co-signer). */
    readonly arkServerUrl: string;
    /** Esplora-compatible REST API used to read on-chain state. */
    readonly esploraUrl: string;
    /** Where a human can go to get free coins for this network. */
    readonly faucetUrl?: string;
    /**
     * Every faucet known for this network, best first.
     *
     * More than one because faucets rate-limit per IP, not per address: asking
     * the same faucet for a second address gets you nothing, but a different
     * faucet has its own limit. `faucetUrl` is the head of this list and stays
     * for callers that only want one.
     */
    readonly faucetUrls?: readonly string[];
    /** Block explorer link for an on-chain transaction id. */
    readonly explorerTxUrl?: (txid: string) => string;
    /**
     * Block explorer link for an address.
     *
     * Needed as well as the transaction link because a boarding address is
     * retired the moment it is paid, so the payment that is still waiting for a
     * block usually belongs to an address the wallet has already rotated past
     * and is no longer fetching transactions for. The address page lists it.
     */
    readonly explorerAddressUrl?: (address: string) => string;
    /**
     * Other chains whose addresses look exactly like this one's.
     *
     * Signet, testnet3 and testnet4 all use the `tb1` prefix, so one address
     * string is syntactically valid on all three and a faucet on the wrong one
     * accepts it without complaint. The coins then sit on a chain this app
     * never queries, and the wallet shows zero with nothing visibly wrong.
     * Listing the look-alikes lets the app go and find them.
     */
    readonly lookalikeChains?: ReadonlyArray<{
        readonly label: string;
        readonly esploraUrl: string;
    }>;
}

/**
 * Signet is the default: the Arkade-operated deployment at `signet.arkade.sh`
 * is public, free, and its coins are worthless, which is exactly what you want
 * while learning.
 */
export const NETWORKS = {
    signet: {
        name: "signet",
        label: "Signet",
        deployment: "Arkade public deployment",
        arkServerUrl: "https://signet.arkade.sh",
        esploraUrl: ESPLORA_URL.signet,
        faucetUrl: "https://signetfaucet.com/",
        faucetUrls: [
            "https://signetfaucet.com/",
            "https://alt.signetfaucet.com/",
            "https://bitcoinsignetfaucet.com/",
        ],
        explorerTxUrl: (txid: string) => `https://mempool.signet.arkade.sh/tx/${txid}`,
        explorerAddressUrl: (address: string) =>
            `https://mempool.signet.arkade.sh/address/${address}`,
        lookalikeChains: [
            { label: "testnet3", esploraUrl: "https://mempool.space/testnet/api" },
            { label: "testnet4", esploraUrl: "https://mempool.space/testnet4/api" },
        ],
    },
    mutinynet: {
        name: "mutinynet",
        label: "Mutinynet",
        deployment: "30-second blocks",
        arkServerUrl: "https://mutinynet.arkade.sh",
        esploraUrl: ESPLORA_URL.mutinynet,
        faucetUrl: "https://faucet.mutinynet.com/",
        faucetUrls: ["https://faucet.mutinynet.com/"],
        explorerTxUrl: (txid: string) =>
            `https://mempool.mutinynet.arkade.sh/tx/${txid}`,
        explorerAddressUrl: (address: string) =>
            `https://mempool.mutinynet.arkade.sh/address/${address}`,
    },
    regtest: {
        name: "regtest",
        label: "Regtest",
        deployment: "local arkade-regtest stack",
        arkServerUrl: "http://localhost:7070",
        esploraUrl: ESPLORA_URL.regtest,
    },
} as const satisfies Record<string, NetworkPreset>;

/** Names of the presets this app ships with. */
export type PresetName = keyof typeof NETWORKS;

export const PRESET_NAMES = Object.keys(NETWORKS) as PresetName[];

/** Fully resolved configuration for one run of the app. */
export interface AppConfig {
    readonly network: NetworkPreset;
    /** Directory holding wallet keystores. */
    readonly dataDir: string;
}

/** The subset of `process.env` this module reads. Injectable so tests need no globals. */
export interface Env {
    FIRSTSATS_NETWORK?: string | undefined;
    FIRSTSATS_ARK_SERVER_URL?: string | undefined;
    FIRSTSATS_ESPLORA_URL?: string | undefined;
    FIRSTSATS_DATA_DIR?: string | undefined;
}

export class ConfigError extends Error {}

/**
 * Build the effective configuration from environment variables, falling back
 * to the signet preset.
 *
 * @throws {ConfigError} if `FIRSTSATS_NETWORK` names a preset that does not exist.
 */
/**
 * `process.env` where it exists, an empty object in a browser.
 *
 * Read off `globalThis` rather than the bare `process` identifier so this file
 * compiles in a browser tsconfig that has no Node type declarations.
 */
function ambientEnv(): Env {
    const global = globalThis as {
        process?: { env?: Record<string, string | undefined> };
    };
    return (global.process?.env as Env) ?? {};
}

export function resolveConfig(env: Env = ambientEnv()): AppConfig {
    const requested = env.FIRSTSATS_NETWORK?.trim().toLowerCase();
    if (requested && !(requested in NETWORKS)) {
        throw new ConfigError(
            `Unknown network "${requested}". Available: ${PRESET_NAMES.join(", ")}.`
        );
    }
    const preset = NETWORKS[(requested ?? "signet") as PresetName];

    const network: NetworkPreset = {
        ...preset,
        arkServerUrl: env.FIRSTSATS_ARK_SERVER_URL?.trim() || preset.arkServerUrl,
        esploraUrl: env.FIRSTSATS_ESPLORA_URL?.trim() || preset.esploraUrl,
    };

    return {
        network,
        dataDir: env.FIRSTSATS_DATA_DIR?.trim() || ".firstsats",
    };
}
