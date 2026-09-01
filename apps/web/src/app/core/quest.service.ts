import { Injectable, computed, effect, inject, signal } from "@angular/core";
import { ModeService } from "./mode.service";
import { NarrationHub } from "./narration-hub";
import { ProfileService } from "./profile.service";
import { WalletRegistry } from "./wallet-registry";

export type QuestId =
    | "user"
    | "personalise"
    | "wallet"
    | "faucet"
    | "confirmed"
    | "onboard"
    | "second"
    | "send"
    | "receive"
    | "withdraw"
    | "split";

export interface Quest {
    readonly id: QuestId;
    readonly points: number;
}

/**
 * The run, in order.
 *
 * It is the real onboarding path, not a tour of the UI: every step is something
 * a person actually has to do to move money through Ark once, and the app can
 * only mark it done by observing that it happened.
 */
export const QUESTS: readonly Quest[] = [
    { id: "user", points: 10 },
    { id: "personalise", points: 10 },
    { id: "wallet", points: 20 },
    { id: "faucet", points: 20 },
    { id: "confirmed", points: 20 },
    { id: "onboard", points: 30 },
    { id: "second", points: 20 },
    { id: "split", points: 10 },
    { id: "send", points: 40 },
    { id: "receive", points: 30 },
    { id: "withdraw", points: 30 },
];

const STORAGE_KEY = "firstsats.quest.v1";

interface Saved {
    readonly done: QuestId[];
}

/**
 * Quest mode.
 *
 * The free mode lets you poke at everything and learn nothing in particular.
 * This is the opposite: one ordered path from no wallet to a completed payment,
 * where each step is marked off by *watching the app's own state*, never by a
 * "mark as done" button. That makes the run an end-to-end test of the whole
 * flow as much as an onboarding — if a quest cannot be completed, something is
 * genuinely broken.
 */
@Injectable({ providedIn: "root" })
export class QuestService {
    private readonly profiles = inject(ProfileService);
    private readonly wallets = inject(WalletRegistry);
    private readonly hub = inject(NarrationHub);

    private readonly modes = inject(ModeService);

    private readonly saved = load();

    /**
     * Quest mode is the room you are in, not a setting inside a room.
     *
     * Kept as a read of the mode rather than its own flag: two sources of truth
     * for "is this a run?" would drift the moment one of them was written
     * without the other.
     */
    readonly enabled = this.modes.quest.asReadonly();

    readonly done = signal<ReadonlySet<QuestId>>(new Set(this.saved.done));

    /** Set for one beat when a quest completes, so the UI can celebrate. */
    readonly justFinished = signal<Quest | null>(null);

    readonly points = computed(() =>
        QUESTS.filter((q) => this.done().has(q.id)).reduce(
            (sum, q) => sum + q.points,
            0
        )
    );

    readonly totalPoints = QUESTS.reduce((sum, q) => sum + q.points, 0);

    /** The first quest not yet done, or null when the run is complete. */
    readonly current = computed(
        () => QUESTS.find((q) => !this.done().has(q.id)) ?? null
    );

    readonly complete = computed(() => this.current() === null);

    constructor() {
        // Watching, not asking. Every predicate below reads state the app
        // maintains for its own reasons, so a quest cannot be completed by
        // anything other than really doing it.
        effect(() => {
            if (!this.enabled()) return;
            const satisfied = this.evaluate();
            const already = this.done();

            const fresh = QUESTS.filter(
                (q) => satisfied.has(q.id) && !already.has(q.id)
            );
            // `evaluate` can also drop quests whose subject was deleted, so a
            // run with nothing new can still need writing back.
            const lost = [...already].some((id) => !satisfied.has(id));
            if (fresh.length === 0 && !lost) return;

            this.done.set(satisfied);
            this.persist(satisfied);

            // The last one wins the celebration; several completing at once is
            // rare and one burst reads better than three. Nothing to celebrate
            // when the write was a pruning rather than a completion.
            const won = fresh[fresh.length - 1];
            if (won) this.justFinished.set(won);
        });
    }

    /**
     * Wipe progress and start the run again.
     *
     * Takes the users with it. Every quest is judged from live state, so a run
     * that kept its users would re-award the whole board on the next tick and
     * "start over" would look like it had done nothing at all.
     */
    async reset(): Promise<void> {
        this.done.set(new Set());
        this.justFinished.set(null);
        this.persist(new Set());
        await this.profiles.removeAll();
        this.wallets.clear();
    }

    acknowledge(): void {
        this.justFinished.set(null);
    }

    /**
     * Which quests the current state satisfies.
     *
     * Monotonic within a run: a quest already earned is never taken back by a
     * *value* changing, so spending the money you received does not un-complete
     * "get paid".
     *
     * It is not monotonic across the subject being deleted, which is a
     * different thing entirely. Carrying the set forward unconditionally meant
     * removing every user and starting again kept the old board — a brand new
     * user with no wallet showed "send a payment" and "watch it arrive" already
     * ticked, scored for a run that no longer existed.
     */
    private evaluate(): Set<QuestId> {
        const profiles = this.profiles.profiles();
        const snapshots = this.wallets.snapshots();
        const withWallet = profiles.filter((p) => p.mnemonic);

        // Whether what earned a quest is still here to have earned it.
        const stillTrue = (id: QuestId): boolean => {
            switch (id) {
                case "user":
                    return profiles.length >= 1;
                case "personalise":
                    // `touched` is only ever set, never cleared, so losing it
                    // means the profile that carried it was deleted.
                    return profiles.some((p) => p.touched);
                case "split":
                    return profiles.length >= 2;
                case "second":
                    return withWallet.length >= 2;
                default:
                    // Everything else is about moving money, which needs a
                    // wallet to have moved it.
                    return withWallet.length >= 1;
            }
        };

        const satisfied = new Set<QuestId>([...this.done()].filter(stillTrue));

        if (profiles.length >= 1) satisfied.add("user");
        if (profiles.some((p) => p.touched)) satisfied.add("personalise");
        if (withWallet.length >= 1) satisfied.add("wallet");
        if (withWallet.length >= 2) satisfied.add("second");
        if (this.profiles.split()) satisfied.add("split");

        // Money seen on-chain at all, confirmed or not.
        if (this.hub.steps().some((s) => s.step.id === "chain.seen")) {
            satisfied.add("faucet");
        }
        if (snapshots.some((w) => w.boarding > 0)) {
            satisfied.add("faucet");
            satisfied.add("confirmed");
        }
        // Spendable off-chain money means an onboarding happened.
        if (snapshots.some((w) => w.available > 0)) {
            satisfied.add("faucet");
            satisfied.add("confirmed");
            satisfied.add("onboard");
        }
        if (snapshots.some((w) => w.sent > 0)) satisfied.add("send");
        // Recorded on the profile rather than read from the narration feed,
        // which is capped and would forget a withdrawal after enough activity.
        if (profiles.some((p) => p.withdrawn)) satisfied.add("withdraw");
        // Someone other than the sender holding a payment.
        if (snapshots.filter((w) => w.received > 0).length >= 1 && satisfied.has("send")) {
            satisfied.add("receive");
        }

        return satisfied;
    }

    private persist(done: ReadonlySet<QuestId>): void {
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({ done: [...done] } satisfies Saved)
            );
        } catch {
            // Private browsing; progress lasts for this session only.
        }
    }
}

function load(): Saved {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<Saved>;
            return { done: Array.isArray(parsed.done) ? parsed.done : [] };
        }
    } catch {
        // Fall through to a fresh run.
    }
    return { done: [] };
}
