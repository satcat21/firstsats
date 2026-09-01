/**
 * Test doubles.
 *
 * `FakeWallet` implements {@link WalletLike} — the narrow interface
 * `FirstSatsAccount` depends on — so the whole payment flow, guardrails and
 * narration included, can be exercised with no network and no coins.
 *
 * Where the SDK's types carry fields this app never reads (tapscripts, encoded
 * VTXO scripts), the builders below cast rather than fabricate them. Building a
 * structurally complete VTXO record would add noise without testing anything.
 */

import type {
    ArkInfo,
    ArkTransaction,
    ExtendedCoin,
    FeeInfo,
    SendBitcoinParams,
    WalletBalance,
} from "@arkade-os/sdk";
import { ArkAddress, TxType } from "@arkade-os/sdk";
import type {
    IncomingFundsLike,
    RampLike,
    VtxoRecord,
    WalletLike,
} from "../src/account.js";
import { NETWORKS, type NetworkPreset } from "../src/config.js";

export const TEST_NETWORK: NetworkPreset = NETWORKS.signet;

/**
 * Real arkade addresses, encoded here rather than hard-coded, so they carry a
 * valid bech32m checksum and actually survive `ArkAddress.decode`.
 */
export const VALID_ARK_ADDRESS = new ArkAddress(
    new Uint8Array(32).fill(1),
    new Uint8Array(32).fill(2),
    "tark"
).encode();

export const OTHER_ARK_ADDRESS = new ArkAddress(
    new Uint8Array(32).fill(1),
    new Uint8Array(32).fill(3),
    "tark"
).encode();

/** A perfectly good on-chain address — and exactly the wrong thing to `send` to. */
export const ONCHAIN_ADDRESS = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";

/** Sensible zeroed balance; spread over it to set the buckets a test cares about. */
export function balance(overrides: Partial<WalletBalance> = {}): WalletBalance {
    return {
        boarding: { confirmed: 0, unconfirmed: 0, total: 0 },
        settled: 0,
        preconfirmed: 0,
        available: 0,
        gated: 0,
        intentLocked: 0,
        recoverable: 0,
        pendingRecovery: 0,
        total: 0,
        assets: [],
        availableAssets: [],
        ...overrides,
    };
}

export interface VtxoSpec {
    txid?: string;
    vout?: number;
    value: number;
    state?: "preconfirmed" | "settled" | "swept" | "spent";
    createdAt?: Date;
    /** Batch expiry, in seconds since epoch, as the indexer reports it. */
    batchExpiry?: number;
}

export function vtxo(spec: VtxoSpec): VtxoRecord {
    const state = spec.state ?? "settled";
    return {
        txid: spec.txid ?? "a".repeat(64),
        vout: spec.vout ?? 0,
        value: spec.value,
        createdAt: spec.createdAt ?? new Date("2026-01-01T00:00:00Z"),
        isPreconfirmed: state === "preconfirmed",
        isSwept: state === "swept",
        isSpent: state === "spent",
        virtualStatus: {
            state,
            ...(spec.batchExpiry !== undefined
                ? { batchExpiry: spec.batchExpiry }
                : {}),
        },
    } as unknown as VtxoRecord;
}

/**
 * @param confirmed - In a block. Only confirmed outputs can join a round, so
 * the default matches the case the wallet is usually asked about.
 */
export function boardingUtxo(
    value: number,
    txid = "b".repeat(64),
    confirmed = true
): ExtendedCoin {
    return { txid, vout: 0, value, status: { confirmed } } as unknown as ExtendedCoin;
}

export function arkTx(
    overrides: Partial<ArkTransaction> & { amount: number }
): ArkTransaction {
    return {
        key: { boardingTxid: "", commitmentTxid: "", arkTxid: "c".repeat(64) },
        type: TxType.TxReceived,
        settled: true,
        createdAt: 1_767_225_600_000,
        ...overrides,
    };
}

export const FEE_INFO: FeeInfo = {
    intentFee: {
        offchainInput: "",
        offchainOutput: "",
        onchainInput: "",
        onchainOutput: "",
    },
    txFeeRate: "0",
};

export function arkInfo(overrides: Partial<ArkInfo> = {}): ArkInfo {
    return {
        version: "",
        signerPubkey: "02".padEnd(66, "b"),
        forfeitPubkey: "02".padEnd(66, "c"),
        forfeitAddress: "tb1qtest",
        checkpointTapscript: "51",
        network: "signet",
        sessionDuration: 60n,
        unilateralExitDelay: 172_544n,
        boardingExitDelay: 15_552_000n,
        dust: 330n,
        fees: FEE_INFO,
        deprecatedSigners: [],
        serviceStatus: {},
        digest: "d".repeat(64),
        ...overrides,
    } as unknown as ArkInfo;
}

export interface FakeWalletOptions {
    readonly address?: string;
    readonly boardingAddress?: string;
    readonly balance?: WalletBalance;
    readonly vtxos?: VtxoRecord[];
    readonly boardingUtxos?: ExtendedCoin[];
    readonly history?: ArkTransaction[];
    readonly dustAmount?: bigint;
    readonly sendTxid?: string;
    /** Make `sendBitcoin` reject, to exercise the failure narration. */
    readonly sendError?: Error;
    /** Funds to deliver to a `notifyIncomingFunds` subscriber. */
    readonly incoming?: IncomingFundsLike;
}

/** Records every call, so tests can assert on what the SDK was asked to do. */
export class FakeWallet implements WalletLike {
    readonly calls: Array<{ method: string; args: unknown[] }> = [];
    disposed = false;
    unsubscribed = false;

    /** Boarding addresses handed out so far; the last one is current. */
    readonly #boarding: string[] = [];

    readonly dustAmount: bigint;
    readonly arkProvider: { getInfo(): Promise<ArkInfo> };

    #options: FakeWalletOptions;

    constructor(options: FakeWalletOptions = {}) {
        this.#options = options;
        this.#boarding.push(
            options.boardingAddress ?? "tb1qboardingaddressfortests00000000000000"
        );
        this.dustAmount = options.dustAmount ?? 330n;
        this.arkProvider = {
            getInfo: async () => {
                this.calls.push({ method: "getInfo", args: [] });
                return arkInfo();
            },
        };
    }

    async getAddress(): Promise<string> {
        this.calls.push({ method: "getAddress", args: [] });
        return this.#options.address ?? VALID_ARK_ADDRESS;
    }

    async getBoardingAddress(): Promise<string> {
        this.calls.push({ method: "getBoardingAddress", args: [] });
        return this.#boarding.at(-1) ?? "";
    }

    async getBoardingAddresses(): Promise<string[]> {
        this.calls.push({ method: "getBoardingAddresses", args: [] });
        return [...this.#boarding];
    }

    async getNewBoardingAddress(): Promise<string> {
        this.calls.push({ method: "getNewBoardingAddress", args: [] });
        const next = `tb1qboardingaddressfortests${this.#boarding.length}`;
        this.#boarding.push(next);
        return next;
    }

    async getBalance(): Promise<WalletBalance> {
        this.calls.push({ method: "getBalance", args: [] });
        return this.#options.balance ?? balance();
    }

    async getVtxos(): Promise<VtxoRecord[]> {
        this.calls.push({ method: "getVtxos", args: [] });
        return this.#options.vtxos ?? [];
    }

    async getSpendableVtxos(): Promise<never[]> {
        // No test settles preconfirmed coins yet; the interface needs it.
        return [];
    }

    async getBoardingUtxos(): Promise<ExtendedCoin[]> {
        this.calls.push({ method: "getBoardingUtxos", args: [] });
        return this.#options.boardingUtxos ?? [];
    }

    async getTransactionHistory(): Promise<ArkTransaction[]> {
        this.calls.push({ method: "getTransactionHistory", args: [] });
        return this.#options.history ?? [];
    }

    async sendBitcoin(params: SendBitcoinParams): Promise<string> {
        this.calls.push({ method: "sendBitcoin", args: [params] });
        if (this.#options.sendError) throw this.#options.sendError;
        return this.#options.sendTxid ?? "e".repeat(64);
    }

    async settle(): Promise<string> {
        this.calls.push({ method: "settle", args: [] });
        return "f".repeat(64);
    }

    async notifyIncomingFunds(
        callback: (funds: IncomingFundsLike) => void
    ): Promise<() => void> {
        this.calls.push({ method: "notifyIncomingFunds", args: [] });
        if (this.#options.incoming) {
            const funds = this.#options.incoming;
            queueMicrotask(() => callback(funds));
        }
        return () => {
            this.unsubscribed = true;
        };
    }

    async dispose(): Promise<void> {
        this.calls.push({ method: "dispose", args: [] });
        this.disposed = true;
    }

    /** True if `method` was called at least once. */
    called(method: string): boolean {
        return this.calls.some((c) => c.method === method);
    }
}

/** A `Ramps` stand-in that records its arguments instead of settling anything. */
export class FakeRamps implements RampLike {
    onboarded: Array<{ feeInfo: FeeInfo; utxos?: ExtendedCoin[] }> = [];
    offboarded: Array<{ destination: string }> = [];

    constructor(
        private readonly onboardTxid = "1".repeat(64),
        private readonly offboardTxid = "2".repeat(64)
    ) {}

    async onboard(feeInfo: FeeInfo, utxos?: ExtendedCoin[]): Promise<string> {
        this.onboarded.push({ feeInfo, ...(utxos ? { utxos } : {}) });
        return this.onboardTxid;
    }

    async offboard(destination: string): Promise<string> {
        this.offboarded.push({ destination });
        return this.offboardTxid;
    }
}
