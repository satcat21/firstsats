/**
 * The payment flow, end to end, against a fake wallet.
 *
 * These tests assert on two things at once: that the operation did the right
 * thing, and that it *said* the right thing. The narration is the product here,
 * so it is covered like any other output.
 */

import { ArkAddress, TxType } from "@arkade-os/sdk";
import { describe, expect, it } from "vitest";
import {
    arkAddressParts,
    FirstSatsAccount,
    isArkadeAddress,
    isOnchainAddress,
    PaymentError,
    toMillis,
    toPaymentView,
    toVtxoView,
} from "../src/account.js";
import { Narrator } from "../src/narrator.js";
import {
    arkTx,
    balance,
    boardingUtxo,
    FakeRamps,
    FakeWallet,
    type FakeWalletOptions,
    ONCHAIN_ADDRESS,
    OTHER_ARK_ADDRESS,
    TEST_NETWORK,
    VALID_ARK_ADDRESS,
    vtxo,
} from "./fakes.js";

function makeAccount(options: FakeWalletOptions = {}) {
    const wallet = new FakeWallet(options);
    const narrator = new Narrator();
    const ramps = new FakeRamps();
    const account = new FirstSatsAccount({
        wallet,
        narrator,
        ramps,
        network: TEST_NETWORK,
    });
    return { account, wallet, narrator, ramps };
}

/** Concatenate every narration string for one step id, for substring assertions. */
function narrationFor(narrator: Narrator, id: string): string {
    return narrator
        .stepsFor(id)
        .map((s) => `${s.title} ${s.detail ?? ""} ${s.behindTheScenes ?? ""}`)
        .join(" ");
}

describe("addresses", () => {
    it("returns both addresses and explains the difference", async () => {
        const { account, narrator } = makeAccount({
            address: VALID_ARK_ADDRESS,
            boardingAddress: ONCHAIN_ADDRESS,
        });

        const view = await account.addresses();

        expect(view).toEqual({
            arkade: VALID_ARK_ADDRESS,
            boarding: ONCHAIN_ADDRESS,
            boardingHistory: [ONCHAIN_ADDRESS],
        });
        expect(narrationFor(narrator, "wallet.addresses")).toContain("unilateral exit");
    });
});

describe("balance", () => {
    it("flattens the SDK's buckets without conflating them", async () => {
        const { account } = makeAccount({
            balance: balance({
                available: 42_000,
                settled: 30_000,
                preconfirmed: 12_000,
                boarding: { confirmed: 5_000, unconfirmed: 0, total: 5_000 },
                recoverable: 700,
                total: 47_700,
            }),
        });

        await expect(account.balance()).resolves.toEqual({
            available: 42_000,
            settled: 30_000,
            preconfirmed: 12_000,
            boarding: 5_000,
            recoverable: 700,
            total: 47_700,
        });
    });

    it("explains that available is not total", async () => {
        const { account, narrator } = makeAccount();
        await account.balance();
        expect(narrationFor(narrator, "wallet.balance")).toContain(
            "Only the available bucket can be spent"
        );
    });
});

describe("vtxos", () => {
    it("maps every VTXO and sums them in the narration", async () => {
        const { account, narrator } = makeAccount({
            vtxos: [
                vtxo({ value: 10_000, txid: "a".repeat(64) }),
                vtxo({ value: 5_000, txid: "b".repeat(64), state: "preconfirmed" }),
            ],
        });

        const views = await account.vtxos();

        expect(views).toHaveLength(2);
        expect(views[0]?.value).toBe(10_000);
        expect(views[1]?.isPreconfirmed).toBe(true);
        expect(narrationFor(narrator, "wallet.vtxos")).toContain("15,000 sats");
    });

    it("teaches the expiry obligation, which is the part newcomers miss", async () => {
        const { account, narrator } = makeAccount({ vtxos: [vtxo({ value: 1 })] });
        await account.vtxos();
        const narration = narrationFor(narrator, "wallet.vtxos");
        expect(narration).toContain("expiry");
        expect(narration).toContain("come back online");
    });

    it("converts the indexer's second-based expiry to milliseconds", async () => {
        const { account } = makeAccount({
            vtxos: [vtxo({ value: 1, batchExpiry: 1_800_000_000 })],
        });
        const [view] = await account.vtxos();
        expect(view?.expiresAt).toBe(1_800_000_000_000);
    });

    it("omits expiresAt when the indexer did not report one", async () => {
        const { account } = makeAccount({ vtxos: [vtxo({ value: 1 })] });
        const [view] = await account.vtxos();
        expect(view?.expiresAt).toBeUndefined();
    });
});

describe("send", () => {
    const funded = () =>
        makeAccount({
            balance: balance({ available: 100_000, total: 100_000 }),
            sendTxid: "9".repeat(64),
        });

    it("sends and reports the arkade txid", async () => {
        const { account, wallet } = funded();

        const txid = await account.send(OTHER_ARK_ADDRESS, 5_000);

        expect(txid).toBe("9".repeat(64));
        expect(wallet.calls).toContainEqual({
            method: "sendBitcoin",
            args: [{ address: OTHER_ARK_ADDRESS, amount: 5_000 }],
        });
    });

    it("explains that no block and no fee were involved", async () => {
        const { account, narrator } = funded();
        await account.send(OTHER_ARK_ADDRESS, 5_000);
        const narration = narrationFor(narrator, "send.submit");
        expect(narration).toContain("No block is involved");
        expect(narration).toContain("preconfirmed");
    });

    it("rejects a fractional amount before touching the wallet", async () => {
        const { account, wallet } = funded();
        await expect(account.send(OTHER_ARK_ADDRESS, 1.5)).rejects.toThrow(
            PaymentError
        );
        expect(wallet.called("sendBitcoin")).toBe(false);
    });

    it("rejects zero and negative amounts", async () => {
        const { account } = funded();
        await expect(account.send(OTHER_ARK_ADDRESS, 0)).rejects.toThrow(
            /greater than zero/
        );
        await expect(account.send(OTHER_ARK_ADDRESS, -1)).rejects.toThrow(
            /greater than zero/
        );
    });

    it("points an on-chain address at offboard instead of failing cryptically", async () => {
        const { account, wallet } = funded();
        await expect(account.send(ONCHAIN_ADDRESS, 5_000)).rejects.toThrow(/offboard/);
        expect(wallet.called("sendBitcoin")).toBe(false);
    });

    it("refuses amounts below the dust limit, and says what dust is", async () => {
        const { account } = funded();
        await expect(account.send(OTHER_ARK_ADDRESS, 100)).rejects.toThrow(
            /dust limit of 330 sats/
        );
    });

    it("refuses to overspend and names the shortfall", async () => {
        const { account } = makeAccount({
            balance: balance({ available: 1_000, total: 1_000 }),
        });
        await expect(account.send(OTHER_ARK_ADDRESS, 5_000)).rejects.toThrow(
            /You have 1,000 sats available but tried to send 5,000 sats/
        );
    });

    it("mentions onboarding when the missing money is sitting on-chain", async () => {
        const { account } = makeAccount({
            balance: balance({
                available: 0,
                boarding: { confirmed: 50_000, unconfirmed: 0, total: 50_000 },
                total: 50_000,
            }),
        });
        await expect(account.send(OTHER_ARK_ADDRESS, 5_000)).rejects.toThrow(
            /run `onboard` to make it spendable/
        );
    });

    it("narrates a failure without swallowing it", async () => {
        const { account, narrator } = makeAccount({
            balance: balance({ available: 100_000, total: 100_000 }),
            sendError: new Error("server refused the intent"),
        });

        await expect(account.send(OTHER_ARK_ADDRESS, 5_000)).rejects.toThrow(
            "server refused the intent"
        );

        const steps = narrator.stepsFor("send.submit");
        expect(steps.at(-1)?.status).toBe("fail");
        expect(steps.at(-1)?.detail).toBe("server refused the intent");
    });
});

describe("arkAddressParts", () => {
    it("recovers both keys an address was built from", () => {
        // Round-tripped rather than hard-coded: the point being proved is that
        // an address really is the server's key and yours encoded together.
        const serverKey = new Uint8Array(32).fill(0xab);
        const vtxoKey = new Uint8Array(32).fill(0xcd);
        const address = new ArkAddress(serverKey, vtxoKey, "tark").encode();

        const parts = arkAddressParts(address);

        expect(parts?.serverKey).toBe("ab".repeat(32));
        expect(parts?.vtxoKey).toBe("cd".repeat(32));
    });

    it("returns null for something that is not an address", () => {
        expect(arkAddressParts("definitely not an address")).toBeNull();
    });
});

/**
 * The two the Send form asks before it will let a payment be submitted. They
 * decide which of two fields an address belongs in, so getting them wrong sends
 * somebody down the wrong flow entirely.
 */
describe("address kind", () => {
    const arkade = new ArkAddress(
        new Uint8Array(32).fill(0xab),
        new Uint8Array(32).fill(0xcd),
        "tark"
    ).encode();

    // A real signet faucet address, and the one this app is most often paid to.
    const onchain = "tb1qmt3ue2senlg6ddgmr76hwsk0rdvdk4rgeaen7l";

    it("tells the two kinds apart", () => {
        expect(isArkadeAddress(arkade)).toBe(true);
        expect(isArkadeAddress(onchain)).toBe(false);

        expect(isOnchainAddress(onchain, "signet")).toBe(true);
        expect(isOnchainAddress(arkade, "signet")).toBe(false);
    });

    it("shares tb1 between signet and mutinynet, which are both signet", () => {
        expect(isOnchainAddress(onchain, "mutinynet")).toBe(true);
        // The prefix is what separates the chains a browser can reach from the
        // one it cannot, and from mainnet.
        expect(isOnchainAddress(onchain, "regtest")).toBe(false);
        expect(isOnchainAddress(onchain, "bitcoin")).toBe(false);
    });

    it("rejects a mainnet address on a test network", () => {
        // The mistake that costs real money, so it is worth a test of its own.
        expect(
            isOnchainAddress("bc1qmt3ue2senlg6ddgmr76hwsk0rdvdk4rgm0uzgn", "signet")
        ).toBe(false);
    });

    it("rejects empty and obviously malformed input", () => {
        expect(isOnchainAddress("", "signet")).toBe(false);
        expect(isOnchainAddress("   ", "signet")).toBe(false);
        expect(isArkadeAddress("")).toBe(false);
        // `b`, `i` and `o` are not in bech32's alphabet.
        expect(isOnchainAddress("tb1bio", "signet")).toBe(false);
    });
});

describe("history", () => {
    it("does not call an un-onboarded boarding payment preconfirmed", () => {
        // Unsettled means two different things. For an Ark payment it is
        // preconfirmed; for a boarding payment it is simply on-chain money that
        // has not joined a round yet, which the balance counts as boarding.
        const view = toPaymentView(
            arkTx({
                amount: 2_500,
                settled: false,
                key: {
                    boardingTxid: "d".repeat(64),
                    commitmentTxid: "",
                    arkTxid: "",
                },
            })
        );

        expect(view.boarding).toBe(true);
        expect(view.settled).toBe(false);
    });

    it("marks an Arkade payment as not boarding", () => {
        const view = toPaymentView(arkTx({ amount: 1_000, settled: false }));
        expect(view.boarding).toBe(false);
    });
});

describe("onboard", () => {
    it("onboards every boarding output and reports the commitment txid", async () => {
        const { account, ramps, narrator } = makeAccount({
            boardingUtxos: [boardingUtxo(60_000), boardingUtxo(40_000, "c".repeat(64))],
        });

        const txid = await account.onboard();

        expect(txid).toBe("1".repeat(64));
        expect(ramps.onboarded).toHaveLength(1);
        expect(ramps.onboarded[0]?.utxos).toHaveLength(2);
        expect(narrationFor(narrator, "onboard.settle")).toContain("100,000 sats");
    });

    it("explains that this is the only on-chain step", async () => {
        const { account, narrator } = makeAccount({
            boardingUtxos: [boardingUtxo(60_000)],
        });
        await account.onboard();
        expect(narrationFor(narrator, "onboard.settle")).toContain(
            "only step in the whole flow that touches the blockchain"
        );
    });

    it("leaves unconfirmed outputs behind rather than failing the whole batch", async () => {
        const { account, ramps } = makeAccount({
            boardingUtxos: [
                boardingUtxo(60_000),
                boardingUtxo(40_000, "c".repeat(64), false),
            ],
        });

        await account.onboard();

        // The server rejects a batch containing an input it cannot see in a
        // block, so including the pending one would lose the confirmed one too.
        expect(ramps.onboarded[0]?.utxos).toHaveLength(1);
        expect(ramps.onboarded[0]?.utxos?.[0]?.value).toBe(60_000);
    });

    it("onboards only the outputs it is given", async () => {
        const { account, ramps } = makeAccount({
            boardingUtxos: [boardingUtxo(60_000), boardingUtxo(40_000, "c".repeat(64))],
        });

        await account.onboard([`${"c".repeat(64)}:0`]);

        expect(ramps.onboarded[0]?.utxos).toHaveLength(1);
        expect(ramps.onboarded[0]?.utxos?.[0]?.value).toBe(40_000);
    });

    it("says so when everything on the address is still unconfirmed", async () => {
        const { account, ramps } = makeAccount({
            boardingUtxos: [boardingUtxo(60_000, "b".repeat(64), false)],
        });

        await expect(account.onboard()).rejects.toThrow(/still in a mempool/);
        expect(ramps.onboarded).toHaveLength(0);
    });

    it("refuses when there is nothing to onboard, and says what to do", async () => {
        const { account, ramps } = makeAccount({ boardingUtxos: [] });
        await expect(account.onboard()).rejects.toThrow(
            /Send on-chain coins to the boarding address first/
        );
        expect(ramps.onboarded).toHaveLength(0);
    });

    /*
     * The picker in the web app ticks boxes against `boardingUtxos()` and hands
     * the chosen `outpoint` strings straight back to `onboard`. Nothing else
     * checks that those two agree on the format, and a drift between them fails
     * in the least helpful way available: every output is filtered out, and the
     * error says there is nothing confirmed to onboard while the money is
     * plainly on screen.
     */
    it("accepts the outpoints it hands out, so the picker cannot drift from it", async () => {
        const { account, ramps } = makeAccount({
            boardingUtxos: [boardingUtxo(60_000), boardingUtxo(40_000, "c".repeat(64))],
        });

        const views = await account.boardingUtxos();
        const chosen = views.filter((view) => view.value === 40_000);
        await account.onboard(chosen.map((view) => view.outpoint));

        expect(chosen).toHaveLength(1);
        expect(ramps.onboarded[0]?.utxos).toHaveLength(1);
        expect(ramps.onboarded[0]?.utxos?.[0]?.value).toBe(40_000);
    });

    it("reports each output with its confirmation state and outpoint", async () => {
        const { account } = makeAccount({
            boardingUtxos: [
                boardingUtxo(60_000),
                boardingUtxo(40_000, "c".repeat(64), false),
            ],
        });

        const views = await account.boardingUtxos();

        expect(views[0]).toMatchObject({
            value: 60_000,
            confirmed: true,
            outpoint: `${"b".repeat(64)}:0`,
        });
        // The one thing the onboard button reads to decide whether it can act.
        expect(views[1]?.confirmed).toBe(false);
    });

    /*
     * An empty selection means "onboard these zero outputs", not "onboard
     * everything" -- an empty array is truthy, so it filters everything out.
     * The dialog disables its button rather than sending one; this pins the
     * behaviour so a caller that does send one is not silently surprised.
     */
    it("treats an empty selection as nothing rather than everything", async () => {
        const { account, ramps } = makeAccount({
            boardingUtxos: [boardingUtxo(60_000)],
        });

        await expect(account.onboard([])).rejects.toThrow();
        expect(ramps.onboarded).toHaveLength(0);
    });
});

describe("offboard", () => {
    it("passes the destination through to the ramp", async () => {
        const { account, ramps } = makeAccount();
        const txid = await account.offboard(ONCHAIN_ADDRESS);
        expect(txid).toBe("2".repeat(64));
        expect(ramps.offboarded).toEqual([{ destination: ONCHAIN_ADDRESS }]);
    });
});

describe("waitForFunds", () => {
    it("resolves with an incoming VTXO and explains it was instant", async () => {
        const { account, narrator } = makeAccount({
            incoming: { type: "vtxo", newVtxos: [{ value: 7_000 }], spentVtxos: [] },
        });

        const funds = await account.waitForFunds(1_000);

        expect(funds).toEqual({
            type: "vtxo",
            newVtxos: [{ value: 7_000 }],
            spentVtxos: [],
        });
        expect(narrationFor(narrator, "receive.wait")).toContain("no fee");
    });

    it("tells you to onboard when the money landed on-chain", async () => {
        const { account, narrator } = makeAccount({
            incoming: { type: "utxo", coins: [{ value: 90_000 }] },
        });

        await account.waitForFunds(1_000);

        expect(narrationFor(narrator, "receive.wait")).toContain("Run `onboard`");
    });

    it("returns null on timeout and unsubscribes", async () => {
        const { account, wallet } = makeAccount();
        await expect(account.waitForFunds(10)).resolves.toBeNull();
        expect(wallet.unsubscribed).toBe(true);
    });
});

describe("history", () => {
    it("sorts newest first and normalises direction and sign", async () => {
        const { account } = makeAccount({
            history: [
                arkTx({ amount: 1_000, createdAt: 1_000 }),
                arkTx({ amount: -2_000, createdAt: 5_000, type: TxType.TxSent }),
            ],
        });

        const views = await account.history();

        expect(views.map((v) => v.createdAt)).toEqual([5_000, 1_000]);
        expect(views[0]).toMatchObject({ direction: "sent", amount: 2_000 });
        expect(views[1]).toMatchObject({ direction: "received", amount: 1_000 });
    });

    it("treats a zero timestamp as unknown rather than as 1970", async () => {
        // The indexer takes createdAt from the block a payment landed in, so a
        // preconfirmed payment arrives with 0. Passing that through renders as
        // "Jan 1, 1970" and sorts the newest entry to the bottom.
        const { account } = makeAccount({
            history: [
                arkTx({ amount: 1_000, createdAt: 5_000 }),
                arkTx({ amount: 9_000, createdAt: 0 }),
            ],
        });

        const views = await account.history();

        expect(views[0]).toMatchObject({ amount: 9_000 });
        expect(views[0]?.createdAt).toBeUndefined();
        expect(views[1]?.createdAt).toBe(5_000);
    });
});

describe("close", () => {
    it("disposes the wallet so the process can exit", async () => {
        const { account, wallet } = makeAccount();
        await account.close();
        expect(wallet.disposed).toBe(true);
    });
});

describe("mappers", () => {
    it("passes millisecond timestamps through unchanged", () => {
        expect(toMillis(1_800_000_000_000)).toBe(1_800_000_000_000);
    });

    it("falls back through the txid key in specificity order", () => {
        expect(
            toPaymentView(
                arkTx({
                    amount: 1,
                    key: {
                        arkTxid: "",
                        commitmentTxid: "commitment",
                        boardingTxid: "boarding",
                    },
                })
            ).id
        ).toBe("commitment");
    });

    it("reads the normalised boolean flags, not the lossy state string", () => {
        const view = toVtxoView(vtxo({ value: 1, state: "swept" }));
        expect(view.isSwept).toBe(true);
        expect(view.isPreconfirmed).toBe(false);
    });
});
