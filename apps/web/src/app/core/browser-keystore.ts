/**
 * The browser counterpart of `src/keystore.ts`.
 *
 * The Node version writes a mnemonic to a file; this one writes it to
 * `localStorage`. Both are demo-grade on purpose, and the browser version is
 * arguably the worse of the two: anything that can run script on this origin
 * can read it.
 *
 * A real browser wallet would derive a key from a user passphrase and store
 * only ciphertext, or keep the seed in a service worker that never exposes it
 * to the page. Neither belongs in a teaching app whose subject is the payment
 * protocol, so this stays deliberately small and deliberately loud about it.
 */

import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

const STORAGE_KEY = "firstsats.wallet.v1";

export interface StoredWallet {
    readonly version: 1;
    readonly mnemonic: string;
    readonly network: string;
    readonly createdAt: string;
}

export class KeystoreError extends Error {}

/** Generate a fresh 12-word BIP-39 mnemonic (128 bits of entropy). */
export function createMnemonic(): string {
    return generateMnemonic(wordlist);
}

/** Collapse whitespace and lowercase -- the canonical BIP-39 input form. */
export function normalizeMnemonic(phrase: string): string {
    return phrase.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

export function isValidMnemonic(phrase: string): boolean {
    return validateMnemonic(normalizeMnemonic(phrase), wordlist);
}

export function loadWallet(): StoredWallet | null {
    let raw: string | null;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as Partial<StoredWallet>;
        if (
            parsed.version === 1 &&
            typeof parsed.mnemonic === "string" &&
            isValidMnemonic(parsed.mnemonic)
        ) {
            return parsed as StoredWallet;
        }
    } catch {
        // Fall through: corrupt entry is treated as no wallet.
    }
    return null;
}

export function saveWallet(mnemonic: string, network: string): StoredWallet {
    const normalized = normalizeMnemonic(mnemonic);
    if (!isValidMnemonic(normalized)) {
        throw new KeystoreError(
            "That is not a valid BIP-39 recovery phrase. Check the word count (12 or 24) and the spelling -- one wrong word fails the checksum."
        );
    }
    const stored: StoredWallet = {
        version: 1,
        mnemonic: normalized,
        network,
        createdAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return stored;
}

export function forgetWallet(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Nothing to do; the caller reloads regardless.
    }
}
