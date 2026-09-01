/**
 * Wallet keystores.
 *
 * A BIP-39 mnemonic is written to a JSON file under the data directory. This is
 * deliberately the simplest thing that works so the interesting code stays
 * visible — it is **not** how a production wallet should store a seed. See the
 * warning in the README.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NetworkName } from "@arkade-os/sdk";
import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

export const KEYSTORE_VERSION = 1;
const SUFFIX = ".wallet.json";

export interface Keystore {
    readonly version: number;
    readonly name: string;
    readonly network: NetworkName;
    /** BIP-39 mnemonic, in the clear. Demo-grade storage — see README. */
    readonly mnemonic: string;
    readonly createdAt: string;
}

export class KeystoreError extends Error {}

/** Generate a fresh 12-word BIP-39 mnemonic (128 bits of entropy). */
export function createMnemonic(): string {
    return generateMnemonic(wordlist);
}

/** True if `phrase` is a well-formed BIP-39 English mnemonic with a valid checksum. */
export function isValidMnemonic(phrase: string): boolean {
    return validateMnemonic(normalizeMnemonic(phrase), wordlist);
}

/** Collapse whitespace and lowercase, the canonical BIP-39 input form. */
export function normalizeMnemonic(phrase: string): string {
    return phrase.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

function pathFor(dataDir: string, name: string): string {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
        throw new KeystoreError(
            `Invalid wallet name "${name}". Use letters, digits, dots, dashes or underscores.`
        );
    }
    return join(dataDir, `${name}${SUFFIX}`);
}

/**
 * Write a keystore. Refuses to clobber an existing file unless `overwrite` is
 * set — losing a seed is not a recoverable mistake.
 */
export async function saveKeystore(
    dataDir: string,
    keystore: Keystore,
    { overwrite = false } = {}
): Promise<string> {
    const file = pathFor(dataDir, keystore.name);
    await mkdir(dataDir, { recursive: true });
    await writeFile(file, `${JSON.stringify(keystore, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: overwrite ? "w" : "wx",
    }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "EEXIST") {
            throw new KeystoreError(
                `A wallet named "${keystore.name}" already exists at ${file}.`
            );
        }
        throw error;
    });
    return file;
}

/** Read a keystore, or `null` if there is no wallet by that name. */
export async function loadKeystore(
    dataDir: string,
    name: string
): Promise<Keystore | null> {
    const file = pathFor(dataDir, name);
    let raw: string;
    try {
        raw = await readFile(file, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new KeystoreError(`${file} is not valid JSON.`);
    }

    const store = parsed as Partial<Keystore>;
    if (typeof store.mnemonic !== "string" || !isValidMnemonic(store.mnemonic)) {
        throw new KeystoreError(`${file} does not contain a valid mnemonic.`);
    }
    if (store.version !== KEYSTORE_VERSION) {
        throw new KeystoreError(
            `${file} has keystore version ${String(store.version)}; this build understands ${KEYSTORE_VERSION}.`
        );
    }
    return store as Keystore;
}

/** Names of every wallet in the data directory, sorted. */
export async function listWallets(dataDir: string): Promise<string[]> {
    let entries: string[];
    try {
        entries = await readdir(dataDir);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
    }
    return entries
        .filter((e) => e.endsWith(SUFFIX))
        .map((e) => e.slice(0, -SUFFIX.length))
        .sort();
}
