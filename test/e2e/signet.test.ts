/**
 * Integration tests against the live public Arkade signet deployment.
 *
 * These are opt-in (`FIRSTSATS_E2E=1`) and never run in the default `npm test`.
 * A third-party deployment being down is not a defect in this repository, so it
 * must not turn the build red — but the assumptions the unit-test fakes are
 * built on do need checking against reality now and then, and that is what this
 * suite is for.
 *
 * Nothing here spends money. It creates a throwaway wallet, derives addresses,
 * and reads state.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArkAddress } from "@arkade-os/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWallet, openSession, type Session } from "../../src/index.js";

const enabled = process.env.FIRSTSATS_E2E === "1";

describe.skipIf(!enabled)("live signet deployment", () => {
    let dir: string;
    let session: Session;

    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), "firstsats-e2e-"));
        const env = { FIRSTSATS_DATA_DIR: dir, FIRSTSATS_NETWORK: "signet" };
        await createWallet({ env, walletName: "e2e" });
        session = await openSession({ env, walletName: "e2e" });
    }, 60_000);

    afterAll(async () => {
        await session?.close();
        if (dir) await rm(dir, { recursive: true, force: true });
    });

    it("reports the server's parameters", async () => {
        const info = await session.account.serverInfo();
        expect(info.network).toBe("signet");
        expect(info.dust).toBeGreaterThan(0n);
        expect(info.signerPubkey).toMatch(/^[0-9a-f]{66}$/);
        // The exit delay is the whole non-custodial guarantee; it must exist.
        expect(info.unilateralExitDelay).toBeGreaterThan(0n);
    });

    it("derives an arkade address that decodes, and a distinct boarding address", async () => {
        const { arkade, boarding } = await session.account.addresses();

        expect(() => ArkAddress.decode(arkade)).not.toThrow();
        expect(boarding).not.toBe(arkade);
        expect(boarding.startsWith("tb1")).toBe(true);
    });

    it("reports a zero balance for a brand new seed", async () => {
        const balance = await session.account.balance();
        expect(balance.total).toBe(0);
        expect(balance.available).toBe(0);
    });

    it("has no VTXOs and no history yet", async () => {
        await expect(session.account.vtxos()).resolves.toEqual([]);
        await expect(session.account.history()).resolves.toEqual([]);
    });

    it("refuses to send from an empty wallet", async () => {
        const { arkade } = await session.account.addresses();
        await expect(session.account.send(arkade, 1_000)).rejects.toThrow(/available/);
    });
});
