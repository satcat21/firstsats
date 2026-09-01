/**
 * The teachable API.
 *
 * `FirstSatsAccount` is a thin, opinionated wrapper over the SDK's `Wallet`. It
 * adds three things and nothing else:
 *
 *  - **Narration.** Every operation reports what it is doing and what the
 *    protocol did underneath, through a {@link Narrator}.
 *  - **Guardrails.** Amounts and addresses are checked before anything is sent,
 *    with error messages aimed at someone new to Bitcoin.
 *  - **Plain view types.** {@link BalanceView}, {@link VtxoView} and
 *    {@link PaymentView} are flat, serialisable shapes a UI can render without
 *    knowing SDK internals.
 *
 * It deliberately does *not* hide the SDK: `account.wallet` is public, and every
 * method here is a short, readable call into it.
 */

import {
    ArkAddress,
    type ArkadeExtendedVirtualCoin,
    type ArkInfo,
    type ArkTransaction,
    type ExtendedCoin,
    type FeeInfo,
    Ramps,
    type SendBitcoinParams,
    type SettlementEvent,
    type SettleParams,
    TxType,
    type Wallet,
    type WalletBalance,
} from "@arkade-os/sdk";
import type { NetworkPreset } from "./config.js";
import { btc, btcArg, type StepArg, sats, satsArg, short } from "./format.js";
import {
    type Narrator,
    type StepMessage,
    silentNarrator,
    type TranslatableError,
} from "./narrator.js";

/**
 * The SDK's virtual-output record.
 *
 * Derived from the method that returns it rather than imported by name: the
 * concrete type is not re-exported from the package root, and deriving it here
 * means an upstream rename cannot silently break this file.
 */
export type VtxoRecord = Awaited<ReturnType<Wallet["getVtxos"]>>[number];

/**
 * The slice of the SDK's `Wallet` this app actually uses.
 *
 * Depending on a narrow interface rather than the concrete class is what lets
 * the unit tests run the whole payment flow against a fake in milliseconds,
 * with no network. `Wallet` satisfies it structurally.
 */
export interface WalletLike {
    getAddress(): Promise<string>;
    getBoardingAddress(): Promise<string>;
    /**
     * Every boarding address this wallet has ever handed out, current last.
     *
     * Rotation means money can be sitting at an address that is no longer the
     * one on screen, so anything that reads the chain has to fan out over the
     * whole set rather than trusting {@link getBoardingAddress}.
     */
    getBoardingAddresses(): Promise<string[]>;
    /**
     * Allocate the next boarding address and make it current.
     *
     * Burns an HD index, so callers rotate when an address has actually been
     * used — not on every render.
     */
    getNewBoardingAddress(): Promise<string>;
    getBalance(): Promise<WalletBalance>;
    getVtxos(): Promise<VtxoRecord[]>;
    getSpendableVtxos(): Promise<ArkadeExtendedVirtualCoin[]>;
    getBoardingUtxos(): Promise<ExtendedCoin[]>;
    getTransactionHistory(): Promise<ArkTransaction[]>;
    sendBitcoin(params: SendBitcoinParams): Promise<string>;
    settle(
        params?: SettleParams,
        eventCallback?: (event: SettlementEvent) => void
    ): Promise<string>;
    notifyIncomingFunds(
        callback: (funds: IncomingFundsLike) => void
    ): Promise<() => void>;
    dispose(): Promise<void>;
    readonly arkProvider: { getInfo(): Promise<ArkInfo> };
    readonly dustAmount: bigint;
}

/** Mirrors the SDK's `IncomingFunds` union, narrowed to the fields used here. */
export type IncomingFundsLike =
    | { type: "utxo"; coins: Array<{ value: number }> }
    | {
          type: "vtxo";
          newVtxos: Array<{ value: number }>;
          spentVtxos: Array<{ value: number }>;
      };

/** On/off-ramp operations. Injectable so tests need no live settlement. */
export interface RampLike {
    onboard(
        feeInfo: FeeInfo,
        boardingUtxos?: ExtendedCoin[],
        amount?: bigint,
        eventCallback?: (event: SettlementEvent) => void
    ): Promise<string>;
    offboard(
        destination: string,
        feeInfo: FeeInfo,
        amount?: bigint,
        eventCallback?: (event: SettlementEvent) => void
    ): Promise<string>;
}

/** Both addresses a wallet hands out, and what each is for. */
export interface AddressView {
    /** `ark1...` -- receive off-chain payments here. Instant, no on-chain fee. */
    readonly arkade: string;
    /** `tb1...` -- send on-chain Bitcoin here, then run `onboard`. */
    readonly boarding: string;
    /** Every boarding address ever handed out, including {@link boarding}. */
    readonly boardingHistory: readonly string[];
}

/** A balance broken into the buckets that actually behave differently. */
/**
 * One on-chain output sitting on a boarding address.
 *
 * Exposed per output rather than as a single total because only *confirmed*
 * ones can be onboarded, and a wallet routinely holds both at once: a total
 * offers to move money the server will refuse, which fails with a decidedly
 * unhelpful `INVALID_PSBT_INPUT`.
 */
export interface BoardingUtxoView {
    readonly txid: string;
    readonly vout: number;
    readonly value: number;
    /** In a block. Only these can join a batch round. */
    readonly confirmed: boolean;
    /** `txid:vout`, the form used to pick one out for onboarding. */
    readonly outpoint: string;
}

export interface BalanceView {
    /** Spendable right now via `send`. */
    readonly available: number;
    /** Finalized in a batch. */
    readonly settled: number;
    /** Accepted instantly, not yet folded into a batch. */
    readonly preconfirmed: number;
    /** On-chain, waiting to be turned into VTXOs by `onboard`. */
    readonly boarding: number;
    /** Expired or dust VTXOs you can reclaim in a future batch. */
    readonly recoverable: number;
    /** Everything above. Not the same as spendable. */
    readonly total: number;
}

/** One virtual output, flattened for display. */
export interface VtxoView {
    readonly txid: string;
    readonly vout: number;
    readonly value: number;
    /** `settled` | `preconfirmed` | `swept` | `spent`. */
    readonly state: string;
    readonly isPreconfirmed: boolean;
    readonly isSwept: boolean;
    readonly createdAt: number;
    /** When the batch holding this VTXO expires, in ms since epoch, if known. */
    readonly expiresAt?: number;
}

/** One entry from the wallet's transaction history. */
export interface PaymentView {
    readonly direction: "sent" | "received";
    /** Always positive; read `direction` for the sign. */
    readonly amount: number;
    readonly settled: boolean;
    /**
     * Whether this entry is an on-chain payment to a boarding address.
     *
     * It changes what an unsettled entry *means*. An unsettled Ark payment is
     * preconfirmed: accepted by the server, waiting to be folded into a batch.
     * An unsettled boarding payment is not in Ark at all -- it is on-chain
     * money that has not been onboarded yet. Labelling both "preconfirmed"
     * had the activity list claim coins were in Ark while the balance, quite
     * correctly, still counted them as boarding.
     */
    readonly boarding: boolean;
    /**
     * Milliseconds since epoch, or absent when nothing knows yet.
     *
     * The indexer takes this from the block a payment landed in, so a
     * preconfirmed payment has no timestamp and the SDK reports `0`. That is
     * "unknown", not 1970, and rendering it as a date is worse than rendering
     * nothing — so it is dropped here rather than in every consumer.
     */
    readonly createdAt?: number;
    /** The most specific transaction id available for this entry. */
    readonly id: string;
    /**
     * The transaction id a block explorer can actually resolve, if any.
     *
     * An Arkade payment has no on-chain transaction — that is the point of it —
     * so linking every row to an explorer would produce dead links for exactly
     * the payments this app exists to demonstrate. Only commitment and boarding
     * transactions are real on-chain, and only those get a link.
     */
    readonly chainTxid?: string;
    /**
     * The on-chain payment that put this money on a boarding address.
     *
     * Kept separately from {@link chainTxid} because an onboarded deposit
     * carries two transactions -- the deposit and the round that swept it into
     * Ark -- and collapsing them showed every deposit in a round under the same
     * commitment id, as though they were the same payment.
     */
    readonly boardingTxid?: string;
    /** The round that settled this entry, when one has. */
    readonly commitmentTxid?: string;
}

/**
 * Turn the server's boarding rejection into something a beginner can act on.
 *
 * The block explorer and the Arkade server watch the chain through different
 * nodes, and the server's can trail by a block. So the app can say "confirmed"
 * in good faith — the explorer really has seen it in a block — while the server
 * still refuses the input. The fix is to wait and press again, which is exactly
 * what `INVALID_PSBT_INPUT (5): failed to validate boarding input` does not say.
 */
function explainSettlement(cause: unknown): never {
    const text = cause instanceof Error ? cause.message : String(cause);
    if (/INVALID_INTENT_PROOF|no matching intents/i.test(text)) {
        throw new PaymentError(
            "The batch round moved on before this registration was accepted, so the " +
                "server no longer recognises it. Nothing was spent and nothing was lost. " +
                "Press the button again to join the next round.",
            { key: "err.intentLost" }
        );
    }
    /*
     * A round is a group effort: every participant has to confirm inside the
     * window, and if enough of them do not, the server abandons the whole
     * round -- including the intents of everyone who did their part. It is a
     * transient failure of somebody else's making, and the raw text reads like
     * the wallet broke.
     */
    if (/not enough intent confirmations/i.test(text)) {
        throw new PaymentError(
            "That batch round was dropped: the server abandons a round when it does not " +
                "get enough confirmations inside the window, which happens when a " +
                "registration lands after the round has already started. Nothing was spent " +
                "and nothing was lost -- your coins are exactly where they were. Press the " +
                "button again and it will wait for a gap between rounds before trying.",
            { key: "err.roundAbandoned" }
        );
    }
    if (isUnseenBoarding(cause)) {
        throw new PaymentError(
            "The Arkade server still has not seen that confirmation. It watches the chain " +
                "through its own Bitcoin node, which can trail the block explorer, and this " +
                "already retried for about a minute. Press the button again shortly. This " +
                "wait has nothing to do with the batch countdown -- you do not have to wait " +
                "for the next round to try.",
            { key: "err.boardingUnconfirmed" }
        );
    }
    throw cause;
}

/** The server's node is behind, as opposed to the input being genuinely bad. */
function isUnseenBoarding(cause: unknown): boolean {
    const text = cause instanceof Error ? cause.message : String(cause);
    return /not confirmed/i.test(text);
}

const RETRY_DELAY_MS = 10_000;
const RETRY_ATTEMPTS = 6;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PaymentError extends Error implements TranslatableError {
    /**
     * The same message as a catalogue key, so a localised front end can show it
     * in the reader's language. `message` stays the English original -- the CLI
     * and every log line read that.
     */
    readonly i18n?: StepMessage;

    constructor(message: string, i18n?: StepMessage) {
        super(message);
        this.name = "PaymentError";
        if (i18n) this.i18n = i18n;
    }
}

export interface AccountDeps {
    readonly wallet: WalletLike;
    readonly network: NetworkPreset;
    readonly narrator?: Narrator;
    /** Defaults to the SDK's `Ramps` when `wallet` is a real `Wallet`. */
    readonly ramps?: RampLike;
}

export class FirstSatsAccount {
    readonly wallet: WalletLike;
    readonly narrator: Narrator;
    readonly network: NetworkPreset;
    readonly #ramps: RampLike;

    constructor(deps: AccountDeps) {
        this.wallet = deps.wallet;
        this.network = deps.network;
        this.narrator = deps.narrator ?? silentNarrator();
        this.#ramps = deps.ramps ?? new Ramps(deps.wallet as unknown as Wallet);
    }

    /** Current parameters of the Arkade server this wallet is talking to. */
    async serverInfo(): Promise<ArkInfo> {
        return this.narrator.track(
            {
                id: "server.info",
                title: "Asking the Arkade server how it is configured",
                titleMessage: { key: "step.server.info.title" },
                after: (info: ArkInfo) => ({
                    detail: `network ${info.network}, dust limit ${sats(info.dust)}, batch session ${info.sessionDuration}s`,
                    detailMessage: {
                        key: "step.server.info.detail",
                        args: [
                            info.network,
                            satsArg(info.dust),
                            Number(info.sessionDuration),
                        ],
                    },
                    behindMessage: { key: "step.server.info.why" },
                    behindTheScenes:
                        "The server publishes the rules everyone plays by: its signing key, the " +
                        "dust threshold, how long a batch round lasts, and how long you must wait " +
                        "to exit on your own if the server stops cooperating. Your wallet checks " +
                        "these before it signs anything.",
                    data: {
                        network: info.network,
                        dust: info.dust.toString(),
                        signerPubkey: info.signerPubkey,
                        unilateralExitDelay: info.unilateralExitDelay.toString(),
                    },
                }),
            },
            () => this.wallet.arkProvider.getInfo()
        );
    }

    /** The two addresses this wallet can receive on. */
    async addresses(): Promise<AddressView> {
        return this.narrator.track(
            {
                id: "wallet.addresses",
                title: "Deriving your receiving addresses",
                titleMessage: { key: "step.wallet.addresses.title" },
                after: (view: AddressView) => ({
                    detail: `arkade ${short(view.arkade)} / boarding ${short(view.boarding)}`,
                    detailMessage: {
                        key: "step.wallet.addresses.detail",
                        args: [short(view.arkade), short(view.boarding)],
                    },
                    behindMessage: { key: "step.wallet.addresses.why" },
                    behindTheScenes:
                        "Both addresses are Taproot outputs derived from the same seed. The " +
                        "arkade address commits to a script with two ways out: one you and the " +
                        "Arkade server take together, and a timelocked one only you can take. " +
                        "That second path is the unilateral exit, and it is the reason the " +
                        "first one is safe to rely on -- the server can stall you, but it can " +
                        "never keep your money. The boarding address is the on-chain door into " +
                        "that arrangement.",
                }),
            },
            async () => ({
                arkade: await this.wallet.getAddress(),
                boarding: await this.wallet.getBoardingAddress(),
                boardingHistory: await this.wallet.getBoardingAddresses(),
            })
        );
    }

    /**
     * Hand out a boarding address nobody has paid yet.
     *
     * Reusing an on-chain address publishes the link between every payment made
     * to it, which is the one privacy mistake Bitcoin makes easiest to commit.
     * The old addresses keep working -- the wallet still watches them and can
     * still spend what lands there -- they just stop being advertised.
     */
    async freshBoardingAddress(): Promise<string> {
        return this.narrator.track(
            {
                id: "wallet.rotateBoarding",
                title: "Taking a fresh boarding address",
                titleMessage: { key: "step.wallet.rotateBoarding.title" },
                after: (address: string) => ({
                    detail: short(address, 12, 8),
                    detailMessage: {
                        key: "step.wallet.rotateBoarding.detail",
                        args: [short(address, 12, 8)],
                    },
                    behindMessage: { key: "step.wallet.rotateBoarding.why" },
                    behindTheScenes:
                        "Each boarding address is a different index on the same seed, so this " +
                        "needs no new backup -- your twelve words already control every one of " +
                        "them. Anyone watching the chain sees unrelated addresses instead of " +
                        "one address collecting everything. The previous ones stay watched, so " +
                        "money already on its way still arrives.",
                    data: { address },
                }),
            },
            () => this.wallet.getNewBoardingAddress()
        );
    }

    /** Balance, split into buckets that behave differently. */
    async balance(): Promise<BalanceView> {
        return this.narrator.track(
            {
                id: "wallet.balance",
                title: "Adding up what you own",
                titleMessage: { key: "step.wallet.balance.title" },
                after: (view: BalanceView) => ({
                    detail: `${sats(view.available)} available of ${sats(view.total)} total`,
                    detailMessage: {
                        key: "step.wallet.balance.detail",
                        args: [satsArg(view.available), satsArg(view.total)],
                    },
                    behindMessage: { key: "step.wallet.balance.why" },
                    behindTheScenes:
                        "A balance is not one number. Settled funds are finalized inside a " +
                        "batch; preconfirmed funds were accepted instantly and will be folded " +
                        "into the next batch; boarding funds are still plain on-chain coins. " +
                        "Only the available bucket can be spent by `send` right now.",
                    data: { ...view },
                }),
            },
            async () => toBalanceView(await this.wallet.getBalance())
        );
    }

    /** Every virtual output the wallet holds -- the coins behind the balance. */
    async vtxos(): Promise<VtxoView[]> {
        return this.narrator.track(
            {
                id: "wallet.vtxos",
                title: "Listing your virtual outputs (VTXOs)",
                titleMessage: { key: "step.wallet.vtxos.title" },
                after: (views: VtxoView[]) => ({
                    detail:
                        views.length === 0
                            ? "no VTXOs yet"
                            : `${views.length} VTXO${views.length === 1 ? "" : "s"} worth ${sats(
                                  views.reduce((sum, v) => sum + v.value, 0)
                              )}`,
                    detailMessage: plural("step.wallet.vtxos.detail", views.length, [
                        views.length,
                        satsArg(views.reduce((sum, v) => sum + v.value, 0)),
                    ]),
                    behindMessage: { key: "step.wallet.vtxos.why" },
                    behindTheScenes:
                        "A VTXO is a pre-signed transaction that would put a real UTXO under " +
                        "your sole control the moment you broadcast it -- you simply never " +
                        "need to. It is a leaf in a tree hanging off one shared on-chain " +
                        "output, which is why spending one costs no fee and takes a second. " +
                        "The catch is the expiry: when the batch holding a VTXO runs out, the " +
                        "server may sweep it, so your wallet must come back online and refresh " +
                        "it into a newer batch before then. Coming online periodically is a " +
                        "real obligation in Ark, not an implementation detail.",
                    data: { count: views.length },
                }),
            },
            async () => (await this.wallet.getVtxos()).map(toVtxoView)
        );
    }

    /** Past payments, newest first. */
    async history(): Promise<PaymentView[]> {
        return this.narrator.track(
            {
                id: "wallet.history",
                title: "Reading your payment history",
                titleMessage: { key: "step.wallet.history.title" },
                after: (views: PaymentView[]) => ({
                    detail: `${views.length} entr${views.length === 1 ? "y" : "ies"}`,
                    detailMessage: plural("step.wallet.history.detail", views.length, [
                        views.length,
                    ]),
                    behindMessage: { key: "step.wallet.history.why" },
                    behindTheScenes:
                        "History is reconstructed from the Arkade indexer by scanning for the " +
                        "scripts this seed controls. Nothing is stored locally -- delete this " +
                        "app's data directory, restore the same twelve words, and the same " +
                        "history comes back.",
                }),
            },
            async () =>
                (await this.wallet.getTransactionHistory())
                    .map(toPaymentView)
                    // Newest first, and an entry with no timestamp is the
                    // newest there is: it has not been in a block yet.
                    .sort(
                        (a, b) =>
                            (b.createdAt ?? Number.POSITIVE_INFINITY) -
                            (a.createdAt ?? Number.POSITIVE_INFINITY)
                    )
        );
    }

    /**
     * Send sats off-chain to an arkade address.
     *
     * @param address - An `ark1...` address. Paying an on-chain address is a
     *   different operation -- see {@link offboard}.
     * @param amount - Whole satoshis.
     * @returns The Arkade transaction id.
     * @throws {PaymentError} if the amount or address is unusable, or the
     *   balance is too low. These checks run *before* anything is signed.
     */
    async send(address: string, amount: number): Promise<string> {
        assertSendableAmount(amount);
        assertArkadeAddress(address);

        const dust = Number(this.wallet.dustAmount);
        if (dust > 0 && amount < dust) {
            throw new PaymentError(
                `${sats(amount)} is below this network's dust limit of ${sats(dust)}. ` +
                    "Outputs smaller than the dust limit cost more to spend than they are " +
                    "worth, so the protocol refuses to create them.",
                { key: "err.belowDust", args: [satsArg(amount), satsArg(dust)] }
            );
        }

        const balance = toBalanceView(await this.wallet.getBalance());
        if (balance.available < amount) {
            throw new PaymentError(
                `You have ${sats(balance.available)} available but tried to send ${sats(amount)}.` +
                    (balance.boarding > 0
                        ? ` ${sats(balance.boarding)} is still on-chain -- run \`onboard\` to make it spendable.`
                        : ""),
                balance.boarding > 0
                    ? {
                          key: "err.insufficientWithBoarding",
                          args: [
                              satsArg(balance.available),
                              satsArg(amount),
                              satsArg(balance.boarding),
                          ],
                      }
                    : {
                          key: "err.insufficient",
                          args: [satsArg(balance.available), satsArg(amount)],
                      }
            );
        }

        return this.narrator.track(
            {
                id: "send.submit",
                title: `Sending ${sats(amount)}`,
                titleMessage: {
                    key: "step.send.submit.title",
                    args: [satsArg(amount)],
                },
                before: {
                    detail: `to ${short(address, 12, 8)}`,
                    detailMessage: {
                        key: "step.send.submit.before.detail",
                        args: [short(address, 12, 8)],
                    },
                    behindMessage: { key: "step.send.submit.before.why" },
                    behindTheScenes:
                        "Your wallet picks VTXOs worth at least the amount, builds an Arkade " +
                        "transaction that destroys them and creates new ones (the payment plus " +
                        "your change), and asks the server to co-sign. No block is involved.",
                },
                after: (txid: string) => ({
                    detail: `arkade txid ${short(txid)}`,
                    detailMessage: {
                        key: "step.send.submit.after.detail",
                        args: [short(txid)],
                    },
                    behindMessage: { key: "step.send.submit.after.why" },
                    behindTheScenes:
                        "Done. The recipient can spend that VTXO immediately, even though " +
                        "nothing has touched the blockchain. It stays preconfirmed until the " +
                        "next batch round folds it in and makes it settled -- and until then " +
                        "it rests on the server not colluding with the sender to double-spend. " +
                        "Settling retires that assumption: the old outputs get forfeited to " +
                        "the server, and the forfeit is built so it cannot be used unless the " +
                        "new batch actually confirms on-chain.",
                    data: { txid, amount, address },
                }),
            },
            () => this.wallet.sendBitcoin({ address, amount })
        );
    }

    /**
     * Turn confirmed on-chain funds sitting on the boarding address into VTXOs.
     *
     * This joins the next batch round, so it takes as long as one session
     * (about a minute on the public signet deployment) rather than a second.
     */
    async boardingUtxos(): Promise<BoardingUtxoView[]> {
        const utxos = await this.wallet.getBoardingUtxos();
        return utxos.map((utxo) => ({
            txid: utxo.txid,
            vout: utxo.vout,
            value: utxo.value,
            confirmed: utxo.status?.confirmed === true,
            outpoint: `${utxo.txid}:${utxo.vout}`,
        }));
    }

    /**
     * @param only - Outpoints to onboard. Omitted means every confirmed one.
     */
    async onboard(
        only?: readonly string[],
        onEvent?: (event: SettlementEvent) => void
    ): Promise<string> {
        const all = await this.wallet.getBoardingUtxos();
        const wanted = only ? new Set(only) : null;
        /*
         * Confirmed only, always.
         *
         * The server validates every boarding input against its own node and
         * rejects the whole batch if one is still in a mempool, so including an
         * unconfirmed output does not onboard it late -- it stops the confirmed
         * ones going through too.
         */
        const boardingUtxos = all.filter(
            (utxo) =>
                utxo.status?.confirmed === true &&
                (!wanted || wanted.has(`${utxo.txid}:${utxo.vout}`))
        );
        if (boardingUtxos.length === 0) {
            const waiting = all.length - boardingUtxos.length;
            throw waiting > 0
                ? new PaymentError(
                      "Nothing on your boarding address is confirmed yet. There is money " +
                          "there, but it is still in a mempool -- it can only join a batch " +
                          "round once it is in a block.",
                      { key: "err.boardingAllPending" }
                  )
                : new PaymentError(
                      "There is nothing on your boarding address to onboard. Send on-chain " +
                          "coins to the boarding address first, and wait for one confirmation.",
                      { key: "err.nothingToOnboard" }
                  );
        }
        const value = boardingUtxos.reduce((sum, utxo) => sum + utxo.value, 0);
        const info = await this.wallet.arkProvider.getInfo();

        return this.narrator.track(
            {
                id: "onboard.settle",
                title: `Bringing ${sats(value)} off-chain`,
                titleMessage: {
                    key: "step.onboard.settle.title",
                    args: [satsArg(value)],
                },
                before: {
                    detail: `${boardingUtxos.length} boarding output${boardingUtxos.length === 1 ? "" : "s"}`,
                    detailMessage: plural(
                        "step.onboard.settle.before.detail",
                        boardingUtxos.length,
                        [boardingUtxos.length]
                    ),
                    behindMessage: { key: "step.onboard.settle.before.why" },
                    behindTheScenes:
                        "Onboarding registers an intent with the Arkade server and waits for " +
                        "the next batch. The server builds one on-chain transaction covering " +
                        "everybody in that round, and your share becomes a leaf in the tree " +
                        "hanging off it. This is the only step in the whole flow that touches " +
                        "the blockchain, and its cost is split across everyone in the round.",
                },
                after: (txid: string) => ({
                    detail: `commitment txid ${short(txid)}`,
                    detailMessage: {
                        key: "step.commitment.detail",
                        args: [short(txid)],
                    },
                    behindMessage: { key: "step.onboard.settle.after.why" },
                    behindTheScenes:
                        "Your coins are now virtual. From here, payments are instant and free -- " +
                        "and you can always leave: `offboard` exits with the server's help, and " +
                        "a unilateral exit works even if the server never answers again. That " +
                        "escape hatch costs several on-chain transactions and needs other coins " +
                        "around to pay their fees, which is why the cooperative path is the one " +
                        "you normally take.",
                    data: { txid, value },
                }),
            },
            () => this.#onboardWhenSeen(info.fees, boardingUtxos, onEvent)
        );
    }

    /**
     * Onboard, waiting out the server's view of the chain.
     *
     * A boarding input the explorer calls confirmed can still be invisible to
     * the server, which watches through its own node. That is a lag, not a
     * failure, so it is waited out rather than handed to the user as an error
     * they can do nothing about but click again.
     *
     * Deliberately unrelated to the batch countdown: this check happens when
     * the intent is registered, before any round. Retrying does not cost you
     * the next round, and waiting for the next round would not fix it.
     */
    async #onboardWhenSeen(
        fees: Parameters<Ramps["onboard"]>[0],
        boardingUtxos: Parameters<Ramps["onboard"]>[1],
        onEvent?: (event: SettlementEvent) => void
    ): Promise<string> {
        for (let attempt = 1; ; attempt++) {
            try {
                return await this.#ramps.onboard(
                    fees,
                    boardingUtxos,
                    undefined,
                    onEvent
                );
            } catch (cause) {
                if (attempt >= RETRY_ATTEMPTS || !isUnseenBoarding(cause)) {
                    explainSettlement(cause);
                }
                await delay(RETRY_DELAY_MS);
            }
        }
    }

    /**
     * Fold preconfirmed money into a batch.
     *
     * An out-of-round payment leaves both sides preconfirmed -- the recipient's
     * coin and the sender's change alike. Preconfirmed money spends perfectly
     * well, but it rests on the server not signing a competing transfer, and it
     * belongs to a batch that eventually expires. Joining a round retires both
     * of those: the coins come out the other side as ordinary settled leaves.
     *
     * @returns the commitment transaction id of the round that took them.
     */
    async settle(onEvent?: (event: SettlementEvent) => void): Promise<string> {
        const before = toBalanceView(await this.wallet.getBalance());
        return this.narrator.track(
            {
                id: "settle.batch",
                title: `Settling ${sats(before.preconfirmed)} into a batch`,
                titleMessage: {
                    key: "step.settle.title",
                    args: [satsArg(before.preconfirmed)],
                },
                before: {
                    detail: "waiting for the next round",
                    detailMessage: { key: "step.settle.before.detail" },
                    behindMessage: { key: "step.settle.before.why" },
                    behindTheScenes:
                        "Preconfirmed coins were accepted by the server out of round. They " +
                        "spend immediately, but until a batch finalizes them they rest on " +
                        "the server not co-signing a competing transfer -- and they sit in " +
                        "a batch that expires. This round replaces them with settled leaves " +
                        "of a fresh batch, which is also how the expiry clock is reset.",
                },
                after: (txid: string) => ({
                    detail: `commitment txid ${short(txid)}`,
                    detailMessage: {
                        key: "step.commitment.detail",
                        args: [short(txid)],
                    },
                    behindMessage: { key: "step.settle.after.why" },
                    behindTheScenes:
                        "Nothing about the amount changed. What changed is what the coins " +
                        "rest on: a finalized batch rather than a promise.",
                    data: { txid },
                }),
            },
            () => this.#settlePreconfirmed(onEvent).catch(explainSettlement)
        );
    }

    /**
     * Settle the preconfirmed coins, and nothing else.
     *
     * `settle()` with no arguments lets the SDK choose the inputs, and what it
     * chooses is "boarding inputs *and/or* preconfirmed virtual outputs" -- so
     * a button offering to settle preconfirmed change would quietly sweep in
     * on-chain deposits the user never picked, and fail outright on any that
     * were still unconfirmed. Naming the inputs keeps the button honest.
     *
     * The output is the same total back to this wallet: settling moves coins
     * between states, it does not spend them. That assumes the round costs
     * nothing, which is true wherever the server advertises a zero fee rate; a
     * server that charged would reject this rather than silently take it out of
     * the amount, which is the failure worth having.
     */
    async #settlePreconfirmed(
        onEvent?: (event: SettlementEvent) => void
    ): Promise<string> {
        const preconfirmed = (await this.wallet.getSpendableVtxos()).filter(
            (vtxo) => vtxo.isPreconfirmed
        );
        if (preconfirmed.length === 0) {
            throw new PaymentError(
                "There is nothing preconfirmed to settle. Coins become preconfirmed when " +
                    "an Arkade payment creates them, and a round turns them into settled " +
                    "ones -- which has already happened here.",
                { key: "err.nothingToSettle" }
            );
        }

        const amount = preconfirmed.reduce((sum, vtxo) => sum + BigInt(vtxo.value), 0n);
        return this.wallet.settle(
            {
                inputs: preconfirmed,
                outputs: [{ address: await this.wallet.getAddress(), amount }],
            },
            onEvent
        );
    }

    /**
     * Leave Arkade cooperatively: convert VTXOs back into an ordinary on-chain
     * payment to `destination`.
     */
    async offboard(destination: string): Promise<string> {
        const info = await this.wallet.arkProvider.getInfo();
        return this.narrator.track(
            {
                id: "offboard.settle",
                title: "Withdrawing your funds on-chain",
                titleMessage: { key: "step.offboard.settle.title" },
                before: {
                    detail: `to ${short(destination, 12, 8)}`,
                    detailMessage: {
                        key: "step.offboard.settle.before.detail",
                        args: [short(destination, 12, 8)],
                    },
                    behindMessage: { key: "step.offboard.settle.before.why" },
                    behindTheScenes:
                        "A collaborative exit: you hand your VTXOs back in a batch round and the " +
                        "server pays you out on-chain in the same commitment transaction.",
                },
                after: (txid: string) => ({
                    detail: `commitment txid ${short(txid)}`,
                    detailMessage: {
                        key: "step.commitment.detail",
                        args: [short(txid)],
                    },
                    data: { txid },
                }),
            },
            () => this.#ramps.offboard(destination, info.fees).catch(explainSettlement)
        );
    }

    /**
     * Block until money arrives, or until `timeoutMs` elapses.
     *
     * @returns The funds that arrived, or `null` on timeout.
     */
    async waitForFunds(timeoutMs = 300_000): Promise<IncomingFundsLike | null> {
        return this.narrator.track(
            {
                id: "receive.wait",
                title: "Watching for incoming money",
                titleMessage: { key: "step.receive.wait.title" },
                before: {
                    behindMessage: { key: "step.receive.wait.before.why" },
                    behindTheScenes:
                        "The wallet subscribes to the Arkade server's event stream and is told " +
                        "the moment a VTXO locked to one of its scripts appears. There is no " +
                        "polling and no block to wait for.",
                },
                after: (funds: IncomingFundsLike | null) => {
                    if (!funds) {
                        return {
                            detail: "timed out -- nothing arrived",
                            detailMessage: { key: "step.receive.wait.timeout" },
                        };
                    }
                    if (funds.type === "vtxo") {
                        const total = funds.newVtxos.reduce((s, v) => s + v.value, 0);
                        return {
                            detail: `received ${sats(total)} off-chain (${btc(total)})`,
                            detailMessage: {
                                key: "step.receive.wait.vtxo.detail",
                                args: [satsArg(total), btcArg(total)],
                            },
                            behindMessage: { key: "step.receive.wait.vtxo.why" },
                            behindTheScenes:
                                "That arrived as a VTXO -- instantly, with no on-chain " +
                                "transaction and no fee. It is already yours to spend.",
                            data: { type: "vtxo", amount: total },
                        };
                    }
                    const total = funds.coins.reduce((s, c) => s + c.value, 0);
                    return {
                        detail: `received ${sats(total)} on-chain at the boarding address`,
                        detailMessage: {
                            key: "step.receive.wait.utxo.detail",
                            args: [satsArg(total)],
                        },
                        behindMessage: { key: "step.receive.wait.utxo.why" },
                        behindTheScenes:
                            "That is a normal Bitcoin payment sitting on your boarding address. " +
                            "Run `onboard` to convert it into VTXOs you can spend instantly.",
                        data: { type: "utxo", amount: total },
                    };
                },
            },
            () => this.#awaitFunds(timeoutMs)
        );
    }

    async #awaitFunds(timeoutMs: number): Promise<IncomingFundsLike | null> {
        let unsubscribe: (() => void) | undefined;
        // `ReturnType<typeof setTimeout>` rather than `NodeJS.Timeout`: this
        // file is compiled for the browser too, where that namespace does not
        // exist and the handle is a number.
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await new Promise<IncomingFundsLike | null>((resolve, reject) => {
                timer = setTimeout(() => resolve(null), timeoutMs);
                this.wallet
                    .notifyIncomingFunds((funds) => resolve(funds))
                    .then((off) => {
                        unsubscribe = off;
                    })
                    .catch(reject);
            });
        } finally {
            if (timer) clearTimeout(timer);
            unsubscribe?.();
        }
    }

    /** Release the wallet's subscriptions so the process can exit. */
    async close(): Promise<void> {
        await this.wallet.dispose();
    }
}

/**
 * Pick the singular or plural variant of a catalogue key.
 *
 * English needs two forms, and so do the five other languages this app ships,
 * so a `.none` / `.one` / `.many` trio is enough. A locale with more plural
 * categories would want `Intl.PluralRules` here instead.
 */
function plural(base: string, count: number, args: StepArg[]): StepMessage {
    if (count === 0) return { key: `${base}.none`, args };
    return { key: count === 1 ? `${base}.one` : `${base}.many`, args };
}

// --- mappers -------------------------------------------------------------
// Free functions, so they can be tested without constructing a wallet.

export function toBalanceView(balance: WalletBalance): BalanceView {
    return {
        available: balance.available,
        settled: balance.settled,
        preconfirmed: balance.preconfirmed,
        boarding: balance.boarding.total,
        recoverable: balance.recoverable,
        total: balance.total,
    };
}

export function toVtxoView(vtxo: VtxoRecord): VtxoView {
    const expiry = vtxo.virtualStatus.batchExpiry;
    return {
        txid: vtxo.txid,
        vout: vtxo.vout,
        value: vtxo.value,
        state: vtxo.virtualStatus.state,
        isPreconfirmed: vtxo.isPreconfirmed,
        isSwept: vtxo.isSwept,
        createdAt: vtxo.createdAt.getTime(),
        ...(expiry !== undefined ? { expiresAt: toMillis(expiry) } : {}),
    };
}

export function toPaymentView(tx: ArkTransaction): PaymentView {
    return {
        direction: tx.type === TxType.TxSent ? "sent" : "received",
        amount: Math.abs(tx.amount),
        settled: tx.settled,
        boarding: Boolean(tx.key.boardingTxid),
        ...(tx.createdAt > 0 ? { createdAt: tx.createdAt } : {}),
        id: tx.key.arkTxid || tx.key.commitmentTxid || tx.key.boardingTxid || "unknown",
        ...(tx.key.commitmentTxid || tx.key.boardingTxid
            ? { chainTxid: tx.key.commitmentTxid || tx.key.boardingTxid }
            : {}),
        ...(tx.key.boardingTxid ? { boardingTxid: tx.key.boardingTxid } : {}),
        ...(tx.key.commitmentTxid ? { commitmentTxid: tx.key.commitmentTxid } : {}),
    };
}

/** The indexer reports expiry in seconds; anything already in ms is passed through. */
export function toMillis(timestamp: number): number {
    return timestamp > 1e12 ? timestamp : timestamp * 1000;
}

// --- validation ----------------------------------------------------------

export function assertSendableAmount(amount: number): void {
    if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
        throw new PaymentError(
            `Amount must be a whole number of satoshis; got ${amount}. ` +
                "Bitcoin has no fractional satoshis.",
            { key: "err.amountNotInteger", args: [String(amount)] }
        );
    }
    if (amount <= 0) {
        throw new PaymentError("Amount must be greater than zero.", {
            key: "err.amountNotPositive",
        });
    }
}

/** The two halves an arkade address is made of. */
export interface AddressParts {
    /** The server that issued it, as 32 bytes of hex. */
    readonly serverKey: string;
    /** Your own taproot output key, as 32 bytes of hex. */
    readonly vtxoKey: string;
}

/**
 * Take an arkade address apart.
 *
 * An address is not an opaque token: it is the server's signing key and your
 * taproot key, bech32m-encoded together. Showing the two halves is the clearest
 * possible answer to why an address only works with the server that issued it,
 * and why paying across servers has no route -- the boundary is visible in the
 * string itself.
 *
 * @returns the halves, or `null` when the address does not decode.
 */
export function arkAddressParts(address: string): AddressParts | null {
    try {
        const decoded = ArkAddress.decode(address.trim());
        return {
            serverKey: toHex(decoded.serverPubKey),
            vtxoKey: toHex(decoded.vtxoTaprootKey),
        };
    } catch {
        return null;
    }
}

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function assertArkadeAddress(address: string): void {
    try {
        ArkAddress.decode(address.trim());
    } catch {
        throw new PaymentError(
            `"${short(address, 16, 8)}" is not a valid arkade address. ` +
                "Arkade addresses start with `ark1` on mainnet and `tark1` on test " +
                "networks. If you have a normal on-chain address (`bc1`, `tb1`), use " +
                "`offboard` instead -- that is a withdrawal, not an off-chain payment.",
            { key: "err.badAddress", args: [short(address, 16, 8)] }
        );
    }
}
