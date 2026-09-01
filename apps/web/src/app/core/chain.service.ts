/**
 * Watching the boarding address on the blockchain itself.
 *
 * The Arkade server's event stream tells you about VTXOs, which is everything
 * you need once you are off-chain. It cannot tell you about a payment that is
 * still sitting in a mempool, because from Arkade's point of view that payment
 * does not exist yet.
 *
 * That gap is exactly where a newcomer gets stuck: they hit a faucet, nothing
 * happens, and they have no way to tell "the faucet ignored me" from "the
 * faucet paid and the block has not arrived". So this service asks Esplora
 * directly and reports the honest three-state answer — nothing / in the mempool
 * / confirmed — and says the moment the middle one becomes true.
 */

import { Injectable, computed, inject, signal } from "@angular/core";
import { ArkadeService } from "./arkade.service";

/** How often to ask, while watching. Esplora is a shared public service. */
const POLL_MS = 10_000;

/** How often to re-ask about a transaction that has not been mined yet. */
const RETRY_TX_MS = 30_000;

/** One payment to the boarding address, as Esplora reports it. */
export interface ChainTx {
    readonly txid: string;
    /**
     * The boarding address it paid into.
     *
     * Kept so the panel can show a payment beside the address whose balance it
     * explains, rather than as a separate row repeating the same amount.
     */
    readonly address: string;
    /** Satoshis paid *to* the watched address by this transaction. */
    readonly value: number;
    /** `false` while it is still only in a mempool. */
    readonly confirmed: boolean;
    /** Set once mined. */
    readonly blockHeight?: number;
}

export type ChainStatus = "idle" | "watching" | "error";

/** Money found at this address on a chain the app does not use. */
export interface MisdirectedFunds {
    /** e.g. `"testnet4"`. */
    readonly chain: string;
    readonly sats: number;
}

/** The shape of the Esplora `/address/:addr/txs` entries this reads. */
interface EsploraTx {
    txid: string;
    status: { confirmed: boolean; block_height?: number };
    vout: Array<{ scriptpubkey_address?: string; value: number }>;
}

/** Esplora's `/address/:addr` summary. One request answers everything below. */
interface EsploraAddress {
    chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
    mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
}

/** What the explorer knows about one transaction that this app needs. */
interface TxFacts {
    /** The boarding address of this wallet it paid into, if any. */
    readonly address?: string;
    /** Block time in milliseconds, absent while unconfirmed. */
    readonly time?: number;
}

/** What one boarding address is holding, has held, or is expecting. */
export interface BoardingAddressState {
    readonly address: string;
    /** The one currently offered for copying. */
    readonly current: boolean;
    /** Confirmed and still unspent. */
    readonly balance: number;
    /** Everything ever paid in, spent or not. */
    readonly received: number;
    /** Seen in a mempool, not yet in a block. */
    readonly pending: number;
}

/** Has this address been used, in any sense that rules out handing it out again? */
export function isUsed(state: BoardingAddressState): boolean {
    return state.received > 0 || state.pending > 0;
}

/**
 * Provided per pane alongside `ArkadeService`, not at the root: the addresses
 * it watches belong to one wallet.
 */
@Injectable()
export class ChainService {
    private readonly arkade = inject(ArkadeService);

    readonly status = signal<ChainStatus>("idle");
    readonly error = signal<string | null>(null);

    /** Everything Esplora knows about the boarding address, newest first. */
    readonly transactions = signal<ChainTx[]>([]);

    /**
     * Set once for each newly seen transaction, and cleared by whoever
     * announces it.
     *
     * This service is a singleton, so a plain "latest" signal would keep its
     * value forever and re-announce the same payment every time the Receive
     * tab is rebuilt. Consumers call {@link acknowledge} to take it.
     */
    readonly seenInMempool = signal<ChainTx | null>(null);

    /** True once at least one payment exists but none has confirmed yet. */
    readonly pending = computed(() =>
        this.transactions().some((tx) => !tx.confirmed)
    );

    /** Whether the last check actually reached Esplora. */
    readonly checkedAt = signal<number | null>(null);

    /**
     * Every boarding address this wallet has handed out, with its state.
     *
     * Rotation means the address on screen is rarely the only one that matters:
     * money can be sitting at a previous one, or on its way to it. Anything
     * that ever received a payment stays in this list.
     */
    readonly addresses = signal<BoardingAddressState[]>([]);

    /** Addresses worth showing: holding, once held, or expecting. */
    /**
     * The addresses with something at stake right now.
     *
     * Deliberately not every address that has ever been paid. Once an address
     * has been swept off-chain it is history, and history belongs in Activity;
     * leaving it here made a list of live positions read as a filing cabinet
     * and buried the one row that still needed watching.
     */
    readonly usedAddresses = computed(() =>
        this.addresses().filter((state) => state.balance > 0 || state.pending > 0)
    );

    /**
     * How many addresses have been paid and already emptied.
     *
     * Counted rather than listed: the reassurance worth giving is that older
     * addresses keep working, not the addresses themselves.
     */
    readonly retiredAddresses = computed(
        () =>
            this.addresses().filter(
                (state) => isUsed(state) && state.balance === 0 && state.pending === 0
            ).length
    );

    /**
     * Coins found at this address on a look-alike chain.
     *
     * The single most confusing thing that can happen to someone starting out:
     * `tb1` addresses are valid on signet, testnet3 and testnet4 alike, so a
     * faucet on the wrong network pays out happily and the wallet shows zero
     * forever. Rather than leave that as a silent dead end, the app goes and
     * looks — but only once the configured chain has come back empty, so the
     * normal path costs no extra requests.
     */
    readonly misdirected = signal<MisdirectedFunds[]>([]);

    /**
     * Which of this wallet's boarding addresses each deposit paid into.
     *
     * The SDK's history reports transaction ids, not addresses, so a row saying
     * "+2,500 on-chain" could not say *where* it landed -- the first thing
     * anyone wants to know once several addresses are in play.
     *
     * One request per deposit, on demand, remembered afterwards. Fetching every
     * address's transaction list on every poll would answer the same question
     * at many times the cost.
     */
    private readonly txFacts = signal<Record<string, TxFacts>>({});

    readonly recipients = computed(() => {
        const out: Record<string, string> = {};
        for (const [txid, facts] of Object.entries(this.txFacts())) {
            if (facts.address) out[txid] = facts.address;
        }
        return out;
    });

    /** When a transaction was mined, for entries the SDK cannot date. */
    readonly times = computed(() => {
        const out: Record<string, number> = {};
        for (const [txid, facts] of Object.entries(this.txFacts())) {
            if (facts.time) out[txid] = facts.time;
        }
        return out;
    });

    /**
     * When each transaction was last asked about.
     *
     * Not a "done" set: a transaction still in a mempool has no block time to
     * report, and treating that first answer as final left a withdrawal reading
     * "waiting for a block" long after it had landed in one. Undated
     * transactions are asked again, at this interval, until they are dated.
     */
    private readonly askedAt = new Map<string, number>();

    private timer: ReturnType<typeof setInterval> | undefined;
    private known = new Set<string>();
    /**
     * Whether the first scan has happened.
     *
     * Everything already on-chain when the page loads is old news. Without
     * this, the opening scan finds a payment from an earlier session, sees a
     * txid it has never recorded, and announces it as if it had just arrived.
     */
    private primed = false;
    /** Guards against two overlapping polls both burning an HD index. */
    private rotating = false;

    /**
     * Find which boarding address a deposit paid into.
     *
     * Does nothing until the address scan has run: with no addresses to match
     * against, a lookup can only miss, and caching that miss would fix the
     * wrong answer in place.
     */
    async resolveTx(txid: string): Promise<void> {
        /*
         * Two halves with different prerequisites, so they are judged apart.
         *
         * The block time needs nothing but the transaction. The address needs
         * this wallet's own addresses to match against, and asking before the
         * scan has run can only miss. Gating both on the address scan -- as
         * this did -- meant a withdrawal never learned it had been mined,
         * because a wallet with nothing on a boarding address has no scan.
         */
        const facts = this.txFacts()[txid];
        const wantTime = !facts?.time;
        const wantAddress = !facts?.address && this.addresses().length > 0;
        if (!wantTime && !wantAddress) return;

        const asked = this.askedAt.get(txid) ?? 0;
        if (Date.now() - asked < RETRY_TX_MS) return;
        this.askedAt.set(txid, Date.now());

        try {
            const base = this.arkade.network.esploraUrl.replace(/\/+$/, "");
            const response = await fetch(`${base}/tx/${txid}`);
            if (!response.ok) return;
            const body = (await response.json()) as {
                status?: { block_time?: number };
                vout: Array<{ scriptpubkey_address?: string }>;
            };

            const ours = new Set(this.addresses().map((state) => state.address));
            const address = body.vout.find(
                (out) => out.scriptpubkey_address && ours.has(out.scriptpubkey_address)
            )?.scriptpubkey_address;
            const time = body.status?.block_time;

            this.txFacts.update((all) => ({
                ...all,
                [txid]: {
                    ...all[txid],
                    ...(address ? { address } : {}),
                    ...(time ? { time: time * 1000 } : {}),
                },
            }));
        } catch {
            // Offline, or the explorer is unhappy. Rows keep their ids, which
            // are still the whole story, just less conveniently.
        }
    }

    /** One-shot check. Safe to call whether or not a watch is running. */
    async check(): Promise<void> {
        const address = this.arkade.addresses()?.boarding;
        if (!address) return;

        try {
            const found = await fetchAddressTxs(
                this.arkade.network.esploraUrl,
                address
            );
            this.error.set(null);
            this.checkedAt.set(Date.now());
            this.transactions.set(found);

            // Announce only genuinely new txids, so a poll that returns the
            // same pending payment does not re-notify every ten seconds.
            const fresh = found.find((tx) => !this.known.has(tx.txid));
            for (const tx of found) this.known.add(tx.txid);
            if (fresh && this.primed) this.seenInMempool.set(fresh);
            this.primed = true;

            // Once something confirms, the wallet's own view is stale: the
            // coins are now boarding funds it can onboard.
            if (found.some((tx) => tx.confirmed)) await this.arkade.refresh();

            if (found.length === 0) {
                await this.findMisdirected(address);
            } else {
                this.misdirected.set([]);
            }

            await this.scanAddresses(address);

            // Chase the block time of anything still unmined. The throttle in
            // `resolveTx` keeps this to one request per transaction per cycle.
            for (const [txid, facts] of Object.entries(this.txFacts())) {
                if (!facts.time) void this.resolveTx(txid);
            }
        } catch (cause) {
            this.error.set(cause instanceof Error ? cause.message : String(cause));
            this.status.set("error");
        }
    }

    /**
     * Summarise every boarding address, and retire the current one if used.
     *
     * The rotation rule is the point: an address that has ever been paid, or
     * that has a payment in flight, must not be offered again. Rotating exactly
     * once per used address keeps the HD index from running away — a poll every
     * ten seconds would otherwise burn one each time.
     */
    private async scanAddresses(current: string): Promise<void> {
        const all = this.arkade.addresses()?.boardingHistory ?? [current];
        const base = this.arkade.network.esploraUrl;

        const states = await Promise.all(
            all.map(async (address): Promise<BoardingAddressState> => {
                try {
                    return await fetchAddressState(base, address, address === current);
                } catch {
                    // An explorer hiccup must not erase an address from the
                    // list; report it as empty and let the next poll correct it.
                    return {
                        address,
                        current: address === current,
                        balance: 0,
                        received: 0,
                        pending: 0,
                    };
                }
            })
        );
        this.addresses.set(states);

        const live = states.find((state) => state.current);
        if (live && isUsed(live) && !this.rotating) {
            this.rotating = true;
            try {
                await this.arkade.freshBoardingAddress();
            } finally {
                this.rotating = false;
            }
        }
    }

    /** Take the pending announcement, so it is delivered exactly once. */
    acknowledge(): void {
        this.seenInMempool.set(null);
    }

    /** Poll until stopped. Idempotent — starting twice keeps one timer. */
    start(): void {
        if (this.timer) return;
        this.status.set("watching");
        this.seenInMempool.set(null);
        void this.check();
        this.timer = setInterval(() => void this.check(), POLL_MS);
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        if (this.status() === "watching") this.status.set("idle");
    }

    /** Forget what has been seen, so a new faucet attempt announces itself. */
    reset(): void {
        this.known = new Set();
        this.primed = false;
        this.seenInMempool.set(null);
        this.transactions.set([]);
        this.misdirected.set([]);
        this.addresses.set([]);
        this.checkedAt.set(null);
    }

    /**
     * Ask the look-alike chains whether they are holding this address's money.
     *
     * Failures are swallowed: these are third-party explorers consulted purely
     * to produce a better error message, and one of them being down must not
     * turn "nothing yet" into "something broke".
     */
    private async findMisdirected(address: string): Promise<void> {
        const chains = this.arkade.network.lookalikeChains ?? [];
        if (chains.length === 0) return;

        const results = await Promise.all(
            chains.map(async (chain) => {
                try {
                    const found = await fetchAddressTxs(chain.esploraUrl, address);
                    const sats = found.reduce((sum, tx) => sum + tx.value, 0);
                    return sats > 0 ? { chain: chain.label, sats } : null;
                } catch {
                    return null;
                }
            })
        );

        this.misdirected.set(results.filter((r): r is MisdirectedFunds => r !== null));
    }
}

/**
 * One address's balance, lifetime receipts and in-flight payments.
 *
 * Esplora's address summary answers all three in a single request, which is
 * what makes fanning out over a growing list of rotated addresses affordable.
 */
async function fetchAddressState(
    esploraUrl: string,
    address: string,
    current: boolean
): Promise<BoardingAddressState> {
    const base = esploraUrl.replace(/\/+$/, "");
    const response = await fetch(`${base}/address/${address}`);
    if (!response.ok) {
        throw new Error(`Esplora returned ${response.status} for ${address}`);
    }

    const body = (await response.json()) as EsploraAddress;
    const confirmed =
        body.chain_stats.funded_txo_sum - body.chain_stats.spent_txo_sum;
    /*
     * The mempool figure runs both ways.
     *
     * Positive is money arriving that has not been mined. Negative means a
     * *confirmed* output here is already being spent by an unconfirmed
     * transaction -- an onboarding, usually. Esplora keeps that spend out of
     * `chain_stats` until it is mined, so reading the confirmed figure alone
     * reported coins as available for minutes after they had been committed to
     * a batch, which had this list contradicting the balance above it.
     */
    const inFlight =
        body.mempool_stats.funded_txo_sum - body.mempool_stats.spent_txo_sum;

    return {
        address,
        current,
        balance: Math.max(0, confirmed + Math.min(0, inFlight)),
        received: body.chain_stats.funded_txo_sum,
        pending: Math.max(0, inFlight),
    };
}

/**
 * Ask Esplora what has been paid *to* `address`.
 *
 * Two filters, both load-bearing:
 *
 * Only outputs to the watched address count towards `value` — a faucet
 * transaction also carries its own change, and counting that would report a
 * number the reader never receives.
 *
 * And Esplora's address endpoint returns every transaction that *touches* the
 * address, spends included. Onboarding spends the boarding UTXO, so it comes
 * back with no output to the address and a value of zero; left in, it shows up
 * here as an incoming payment of 0 sats and, while unconfirmed, makes the whole
 * panel claim money is on its way. This question is only ever "what arrived",
 * so anything that paid nothing in is dropped.
 */
async function fetchAddressTxs(
    esploraUrl: string,
    address: string
): Promise<ChainTx[]> {
    const base = esploraUrl.replace(/\/+$/, "");
    const response = await fetch(`${base}/address/${address}/txs`);
    if (!response.ok) {
        throw new Error(`Esplora returned ${response.status} for ${address}`);
    }

    const body = (await response.json()) as EsploraTx[];
    return body
        .map((tx) => ({
            txid: tx.txid,
            address,
            value: tx.vout
                .filter((out) => out.scriptpubkey_address === address)
                .reduce((sum, out) => sum + out.value, 0),
            confirmed: tx.status.confirmed,
            ...(tx.status.block_height !== undefined
                ? { blockHeight: tx.status.block_height }
                : {}),
        }))
        .filter((tx) => tx.value > 0);
}
