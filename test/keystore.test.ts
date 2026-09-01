import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    createMnemonic,
    isValidMnemonic,
    KEYSTORE_VERSION,
    type Keystore,
    KeystoreError,
    listWallets,
    loadKeystore,
    normalizeMnemonic,
    saveKeystore,
} from "../src/keystore.js";
import { createWallet } from "../src/session.js";

let dir: string;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "firstsats-"));
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

function keystore(overrides: Partial<Keystore> = {}): Keystore {
    return {
        version: KEYSTORE_VERSION,
        name: "default",
        network: "signet",
        mnemonic: createMnemonic(),
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

describe("mnemonics", () => {
    it("generates a valid 12-word phrase", () => {
        const phrase = createMnemonic();
        expect(phrase.split(" ")).toHaveLength(12);
        expect(isValidMnemonic(phrase)).toBe(true);
    });

    it("rejects a phrase with a broken checksum", () => {
        expect(isValidMnemonic(`${"abandon ".repeat(11)}abandon`)).toBe(false);
    });

    it("rejects nonsense", () => {
        expect(isValidMnemonic("not actually a mnemonic at all")).toBe(false);
    });

    it("normalises case and whitespace before validating", () => {
        const phrase = createMnemonic();
        const messy = `  ${phrase.toUpperCase().split(" ").join("   ")}  `;
        expect(normalizeMnemonic(messy)).toBe(phrase);
        expect(isValidMnemonic(messy)).toBe(true);
    });
});

describe("keystore files", () => {
    it("round-trips", async () => {
        const store = keystore();
        await saveKeystore(dir, store);
        await expect(loadKeystore(dir, "default")).resolves.toEqual(store);
    });

    it("returns null for a wallet that does not exist", async () => {
        await expect(loadKeystore(dir, "nobody")).resolves.toBeNull();
    });

    it("refuses to clobber an existing seed", async () => {
        await saveKeystore(dir, keystore());
        await expect(saveKeystore(dir, keystore())).rejects.toThrow(KeystoreError);
    });

    it("overwrites only when explicitly asked", async () => {
        const first = keystore();
        await saveKeystore(dir, first);
        const second = keystore();
        await saveKeystore(dir, second, { overwrite: true });
        await expect(loadKeystore(dir, "default")).resolves.toEqual(second);
    });

    it("rejects a name that could escape the data directory", async () => {
        await expect(
            saveKeystore(dir, keystore({ name: "../escape" }))
        ).rejects.toThrow(KeystoreError);
    });

    it("rejects a file holding an invalid mnemonic", async () => {
        await writeFile(
            join(dir, "broken.wallet.json"),
            JSON.stringify({ ...keystore({ name: "broken" }), mnemonic: "nope" })
        );
        await expect(loadKeystore(dir, "broken")).rejects.toThrow(/valid mnemonic/);
    });

    it("rejects a keystore from a future version rather than guessing", async () => {
        await writeFile(
            join(dir, "future.wallet.json"),
            JSON.stringify(keystore({ name: "future", version: 99 }))
        );
        await expect(loadKeystore(dir, "future")).rejects.toThrow(/version 99/);
    });

    it("rejects a file that is not JSON", async () => {
        await writeFile(join(dir, "junk.wallet.json"), "{{{");
        await expect(loadKeystore(dir, "junk")).rejects.toThrow(/not valid JSON/);
    });

    it("lists wallets sorted, and an empty directory as empty", async () => {
        await expect(listWallets(join(dir, "missing"))).resolves.toEqual([]);
        await saveKeystore(dir, keystore({ name: "zoe" }));
        await saveKeystore(dir, keystore({ name: "alice" }));
        await expect(listWallets(dir)).resolves.toEqual(["alice", "zoe"]);
    });
});

describe("createWallet", () => {
    const env = () => ({ FIRSTSATS_DATA_DIR: dir });

    it("generates a seed and writes it", async () => {
        const result = await createWallet({ env: env(), walletName: "alice" });

        expect(result.generated).toBe(true);
        expect(isValidMnemonic(result.keystore.mnemonic)).toBe(true);
        await expect(readFile(result.path, "utf8")).resolves.toContain(
            result.keystore.mnemonic
        );
    });

    it("imports an existing phrase instead of generating one", async () => {
        const phrase = createMnemonic();
        const result = await createWallet({ env: env(), mnemonic: phrase });

        expect(result.generated).toBe(false);
        expect(result.keystore.mnemonic).toBe(phrase);
    });

    it("normalises an imported phrase", async () => {
        const phrase = createMnemonic();
        const result = await createWallet({
            env: env(),
            mnemonic: `  ${phrase.toUpperCase()}  `,
        });
        expect(result.keystore.mnemonic).toBe(phrase);
    });

    it("explains why a bad import failed", async () => {
        await expect(
            createWallet({ env: env(), mnemonic: "one two three" })
        ).rejects.toThrow(/word count \(12 or 24\)/);
    });

    it("stamps the network the wallet was created on", async () => {
        const result = await createWallet({
            env: { ...env(), FIRSTSATS_NETWORK: "mutinynet" },
        });
        expect(result.keystore.network).toBe("mutinynet");
    });
});
