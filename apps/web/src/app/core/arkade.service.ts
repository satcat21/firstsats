/**
 * The single facade the UI talks to.
 *
 * Everything below the signals is the *same* `FirstSatsAccount` the CLI drives
 * — imported from `@firstsats/core`, which is the repository-root `src/`. The
 * guardrails, the narration and the view types are shared verbatim; this file
 * only adapts them to Angular signals and owns the wallet lifecycle.
 */

import { Injectable, computed, inject, signal } from "@angular/core";
import type { Wallet } from "@arkade-os/sdk";
import {
    FirstSatsAccount,
    Narrator,
    PaymentError,
    type BoardingUtxoView,
    resolveConfig,
    sats,
    satsArg,
    type AddressView,
    type BalanceView,
    type IncomingFundsLike,
    type NetworkPreset,
    type PaymentView,
    type Step,
    type StepMessage,
    type VtxoView,
    type WalletLike,
} from "@firstsats/core";
import type { ArkInfo } from "@arkade-os/sdk";
import { I18nService } from "./i18n.service";
import { openBrowserWallet } from "./browser-wallet";
import { NarrationHub } from "./narration-hub";
import { WalletRegistry } from "./wallet-registry";
import { type Profile, ProfileService } from "./profile.service";

export type Status = "no-wallet" | "connecting" | "ready" | "error";

/**
 * A failure, kept in both forms.
 *
 * `text` is the English original — always present, and what a developer sees in
 * a log. `i18n` is set when the core knew how to say the same thing as a
 * catalogue key, which is what the reader actually gets.
 */
interface Failure {
    readonly text: string;
    readonly i18n?: StepMessage;
}

/** How long `watchForFunds` listens before giving up. */
const WATCH_TIMEOUT_MS = 300_000;

/**
 * How many narrated steps the timeline keeps.
 *
 * The feed is append-only and every refresh adds five steps, so without a cap
 * it grows without bound over a long session and the interesting line scrolls
 * away. Dropping the oldest keeps the panel self-maintaining; the `Clear`
 * button stays for deliberately starting a clean run.
 */
const MAX_STEPS = 60;

/**
 * How long to wait before re-reading balances after a settlement.
 *
 * Long enough for the commitment transaction to reach the indexer the wallet
 * reads, short enough that nobody is left looking at a stale bucket.
 */
const AFTER_SETTLE_MS = 4_000;

/**
 * How many rounds to try before giving up on one that keeps being dropped.
 *
 * The event log settled what this should be. A failing round reports
 * `stream_started -> batch_failed` with no `batch_started` in between, and the
 * stream is filtered to this wallet's own keys and outpoints -- so the batch
 * that failed was one this wallet had not been brought into. The failure
 * belongs to somebody else in it, this wallet's intent was never at fault, and
 * the next batch is a genuinely fresh start. Trying again is the remedy.
 */
const ROUND_ATTEMPTS = 3;

/**
 * Whether a failure is the round falling over rather than a refusal.
 *
 * Both of these mean the round this registration was in did not complete, for
 * reasons no client can influence, and both are answered by trying the next
 * one. Anything else is a real answer and must be shown.
 */
function isRoundRetryable(cause: unknown): boolean {
    if (!(cause instanceof PaymentError)) return false;
    const key = cause.i18n?.key;
    return key === "err.roundAbandoned" || key === "err.intentLost";
}

/**
 * One wallet's state.
 *
 * Deliberately *not* `providedIn: "root"`. It is provided by each profile pane,
 * so a split view holds two independent instances rather than one shared one.
 */
@Injectable()
export class ArkadeService {
    readonly network: NetworkPreset = resolveConfig({}).network;

    private readonly profiles = inject(ProfileService);
    private readonly hub = inject(NarrationHub);
    private readonly registry = inject(WalletRegistry);

    /**
     * The wallet this instance speaks for, set by {@link adopt}.
     *
     * Not injected: Angular sets a component's inputs *after* its providers are
     * constructed, so the pane cannot hand its profile to DI. An explicit
     * handover is the honest version of what a factory would only fake.
     */
    private profile: Profile | null = null;

    // ---- state ---------------------------------------------------------
    readonly status = signal<Status>("connecting");
    readonly busy = signal<string | null>(null);

    private readonly i18n = inject(I18nService);
    /**
      * The last failure, and which operation produced it.
      *
      * Tagged because one pane shares one service: an untagged failure from
      * onboarding was rendered by the Send tab's error slot, which showed a
      * boarding-confirmation message under a payment form that had done
      * nothing wrong.
      */
    private readonly failure = signal<{
        readonly label: string;
        readonly detail: Failure;
    } | null>(null);

    /**
     * The current error, in the reader's language.
     *
     * A `computed` rather than a plain string so that switching language
     * re-translates a message that is already on screen.
     */
    readonly error = computed<string | null>(() => {
        const current = this.failure();
        if (!current) return null;
        return this.i18n.tMessage(current.detail.i18n, current.detail.text);
    });

    /**
     * The current error, but only when one of `labels` caused it.
     *
     * A screen showing an error it cannot explain is worse than showing none,
     * so each one asks for the operations it is actually responsible for.
     */
    errorFrom(...labels: string[]): string | null {
        const current = this.failure();
        if (!current || !labels.includes(current.label)) return null;
        return this.i18n.tMessage(current.detail.i18n, current.detail.text);
    }

    /** The seed this pane is showing, once {@link adopt} has run. */
    readonly stored = signal<Profile | null>(null);
    readonly addresses = signal<AddressView | null>(null);
    readonly balance = signal<BalanceView | null>(null);
    readonly vtxos = signal<VtxoView[]>([]);
    readonly history = signal<PaymentView[]>([]);
    readonly serverInfo = signal<ArkInfo | null>(null);

    /**
     * Whether a settlement is in flight, for screens that want to say so.
     */
    readonly roundPhase = signal<"running" | null>(null);

    /** Which attempt is in flight, of {@link ROUND_ATTEMPTS}. */
    readonly roundAttempt = signal(1);

    /**
     * How far the current round has got, newest last.
     *
     * The server drives a round through a fixed sequence of events, and until
     * now the app threw all of them away and reported only the outcome -- which
     * left "not enough intent confirmations received" with no way to tell
     * whether this wallet had been asked to confirm and failed to, or had never
     * been asked at all. Those need completely different fixes.
     */
    readonly roundEvents = signal<string[]>([]);

    readonly roundAttempts = ROUND_ATTEMPTS;

    /**
     * The on-chain outputs waiting on boarding addresses, one by one.
     *
     * Held per output rather than as the balance's single `boarding` total,
     * which counts money still sitting in a mempool: offering to onboard that
     * builds a batch the server refuses outright.
     */
    readonly boarding = signal<BoardingUtxoView[]>([]);

    /** Only these can actually join a round. */
    readonly boardingConfirmed = computed(() =>
        this.boarding()
            .filter((utxo) => utxo.confirmed)
            .reduce((sum, utxo) => sum + utxo.value, 0)
    );
    readonly steps = signal<Step[]>([]);
    readonly watching = signal(false);
    readonly lastReceived = signal<IncomingFundsLike | null | undefined>(
        undefined
    );

    readonly hasWallet = computed(() => this.stored() !== null);
    readonly ready = computed(() => this.status() === "ready");

    private readonly narrator = new Narrator();
    private account: FirstSatsAccount | null = null;
    private wallet: Wallet | null = null;
    private stopWatch: (() => void) | null = null;
    /** Tears down the always-on incoming-funds subscription. */
    private stopListening: (() => void) | null = null;

    constructor() {
        this.narrator.on((step) => {
            this.steps.update((steps) => [...steps, step].slice(-MAX_STEPS));
            // Also to the shared hub, so the shell's toast stack can show
            // narration from either wallet without injecting a pane's service.
            if (this.profile) this.hub.publish(this.profile, step);
        });
    }

    /** Server URL plus who runs it, the supporting line under the title. */
    private detail(): string {
        const { arkServerUrl, deployment } = this.network;
        return deployment ? `${arkServerUrl} · ${deployment}` : arkServerUrl;
    }

    clearSteps(): void {
        this.steps.set([]);
    }

    // ---- lifecycle -----------------------------------------------------

    /**
     * Take ownership of a wallet and connect to it.
     *
     * Idempotent per profile, so a re-render cannot open a second connection to
     * the same seed; a *different* profile tears the old one down first.
     */
    async adopt(profile: Profile): Promise<void> {
        const sameUser = this.profile?.id === profile.id;
        const hadWallet = Boolean(this.profile?.mnemonic);

        this.profile = profile;
        this.stored.set(profile);

        // A user with no wallet has nothing to connect to. Once they make one,
        // the profile changes underneath us and this runs again with a seed.
        if (!profile.mnemonic) {
            if (!sameUser || hadWallet) await this.disconnect();
            this.status.set("no-wallet");
            return;
        }

        if (sameUser && hadWallet) return;
        if (!sameUser) await this.disconnect();
        await this.connect();
    }

    /** Connect the stored seed to the Arkade server and load initial state. */
    async connect(): Promise<void> {
        const stored = this.stored();
        const mnemonic = stored?.mnemonic;
        if (!stored || !mnemonic) {
            this.status.set("no-wallet");
            return;
        }

        this.status.set("connecting");
        this.failure.set(null);

        try {
            const wallet = await this.narrator.track(
                {
                    id: "session.open",
                    title: `Connecting to ${this.network.label}`,
                    titleMessage: {
                        key: "step.session.open.title",
                        args: [this.network.label],
                    },
                    before: {
                        detail: this.detail(),
                        detailMessage: {
                            key: "step.session.open.detail",
                            args: [this.network.arkServerUrl, this.network.deployment ?? ""],
                        },
                        behindMessage: { key: "step.session.open.why" },
                        behindTheScenes:
                            "Your wallet derives its keys in this browser, then asks the Arkade " +
                            "server for its parameters and the indexer for any coins belonging to " +
                            "those keys. The recovery phrase never leaves this device.",
                    },
                    after: () => ({
                        title: `Connected to ${this.network.label}`,
                        titleMessage: {
                            key: "step.session.open.done",
                            args: [this.network.label],
                        },
                        detail: this.detail(),
                        detailMessage: {
                            key: "step.session.open.detail",
                            args: [
                                this.network.arkServerUrl,
                                this.network.deployment ?? "",
                            ],
                        },
                    }),
                },
                () =>
                    openBrowserWallet({
                        id: stored.id,
                        mnemonic,
                        network: this.network,
                    })
            );

            this.wallet = wallet;
            this.account = new FirstSatsAccount({
                wallet: wallet as unknown as WalletLike,
                network: this.network,
                narrator: this.narrator,
            });

            this.status.set("ready");
            await this.refresh();
            await this.listen();
        } catch (error) {
            this.status.set("error");
            this.failure.set({ label: "connect", detail: describe(error) });
        }
    }

    /** Delete this profile's seed from the browser and tear the pane down. */
    async forget(): Promise<void> {
        // Wipe the wallet's own store before dropping the profile, or its
        // IndexedDB database outlives every reference to it.
        await this.wallet?.clear().catch(() => {
            // Nothing actionable: the profile is going away regardless.
        });
        await this.disconnect();
        if (this.profile) {
            this.registry.forget(this.profile.id);
            this.profiles.remove(this.profile.id);
        }
        this.profile = null;
        this.stored.set(null);
        this.addresses.set(null);
        this.balance.set(null);
        this.vtxos.set([]);
        this.boarding.set([]);
        this.history.set([]);
        this.serverInfo.set(null);
        this.clearSteps();
        this.status.set("no-wallet");
    }

    /**
     * Stay subscribed to incoming funds for as long as the wallet is open.
     *
     * The SDK's notification is already a server-pushed event stream — no
     * polling, no websocket to add. What was missing is that nothing subscribed
     * to it unless someone pressed "Watch", so a payment that arrived while you
     * were on another tab only showed up on a manual refresh. The subscription
     * also survives boarding-address rotation, which the SDK re-registers.
     */
    /**
     * Run something that needs a batch round, with everything a round needs.
     *
     * Three operations settle -- onboarding, withdrawing and refreshing
     * preconfirmed coins -- and every one of them has to cope with the same
     * three facts, so none of this belongs in whichever screen happens to start
     * it. Onboarding had all of it and the other two had none, which is why
     * withdrawing kept failing where onboarding had stopped.
     *
     * A dropped round is retried, and that is now all this does.
     *
     * It used to stop the wallet's notification stream first, on the theory
     * that a long-lived subscription might swallow the server's confirmation
     * prompt. That was a guess, it never helped, and the event log now points
     * the other way: a failing round reports `stream_started` and then
     * `batch_failed` with no `batch_started` between them, so the settlement's
     * own stream is connecting *after* the batch has opened and this wallet is
     * never invited into it. Tearing down a warm connection to the same server
     * immediately beforehand can only have made that race harder to win.
     *
     * An earlier version also waited for a gap between rounds before
     * registering, on the theory that arriving mid-round missed the
     * confirmation window. The schedule the server advertises turned out not to
     * govern when batches run -- three attempts once burned in twenty seconds
     * while the countdown still read five minutes -- so that wait only ever
     * added delay, and it is gone.
     */
    /**
     * Records one step of a round, and why it ended if it ended badly.
     *
     * `batch_failed` carries the server's own `reason`, which this threw away
     * for far too long -- leaving a chain of failures that said only *that* a
     * round had failed, never *why*, when the server had been saying so all
     * along.
     */
    private readonly notePhase = (event: {
        type: string;
        reason?: string;
    }): void => {
        const step = event.reason ? `${event.type}: ${event.reason}` : event.type;
        this.roundEvents.update((all) => [...all, step]);
    };

    private async settling<T>(work: () => Promise<T>): Promise<T> {
        this.roundEvents.set([]);
        try {
            for (let attempt = 1; ; attempt++) {
                this.roundAttempt.set(attempt);
                this.roundPhase.set("running");

                try {
                    return await work();
                } catch (cause) {
                    if (attempt >= ROUND_ATTEMPTS || !isRoundRetryable(cause)) {
                        throw cause;
                    }
                }
            }
        } finally {
            this.roundPhase.set(null);
            this.roundAttempt.set(1);
        }
    }


    private async listen(): Promise<void> {
        const wallet = this.wallet;
        if (!wallet || this.stopListening) return;

        try {
            this.stopListening = await wallet.notifyIncomingFunds((funds) => {
                this.announce(funds as IncomingFundsLike);
                void this.refresh();
            });
        } catch {
            // A wallet that cannot subscribe still works; it just needs the
            // refresh button, which is where this started.
        }
    }

    /**
     * Narrate money that turned up on its own.
     *
     * Refreshing silently would leave the balance changing with no explanation,
     * which is the opposite of what this app is for.
     */
    private announce(funds: IncomingFundsLike): void {
        // While `watchForFunds` is running, the `receive.wait` step is already on
        // screen and updates itself the moment money lands -- saying the same
        // thing again puts two toasts up for one payment. This subscription is
        // here for the other case: money that arrives when nobody is watching.
        if (this.watching()) return;

        const total =
            funds.type === "vtxo"
                ? funds.newVtxos.reduce((sum, v) => sum + v.value, 0)
                : funds.coins.reduce((sum, c) => sum + c.value, 0);
        if (total <= 0) return;

        const offchain = funds.type === "vtxo";
        this.narrator.info(
            "receive.arrived",
            `Received ${sats(total)}`,
            {
                titleMessage: {
                    key: "step.receive.arrived.title",
                    args: [satsArg(total)],
                },
                detailMessage: {
                    key: offchain
                        ? "step.receive.arrived.offchain"
                        : "step.receive.arrived.onchain",
                },
                behindMessage: {
                    key: offchain
                        ? "step.receive.wait.vtxo.why"
                        : "step.receive.wait.utxo.why",
                },
            }
        );
    }

    private async disconnect(): Promise<void> {
        this.stopListening?.();
        this.stopListening = null;
        this.stopWatching();
        const wallet = this.wallet;
        this.wallet = null;
        this.account = null;
        await wallet?.dispose().catch(() => {
            // Disposal failures are not actionable for the user.
        });
    }

    // ---- reads ---------------------------------------------------------

    /** Reload everything the dashboard shows. */
    async refresh(): Promise<void> {
        await this.run("refresh", async (account) => {
            this.addresses.set(await account.addresses());
            this.balance.set(await account.balance());
            this.vtxos.set(await account.vtxos());
            this.boarding.set(await account.boardingUtxos());
            this.history.set(await account.history());
            if (!this.serverInfo()) {
                this.serverInfo.set(await account.serverInfo());
            }
            this.publishSnapshot();
        });
    }

    /**
     * Summarise this wallet for anything that has to reason across wallets.
     *
     * The registry is the only way a root-level service can see two panes at
     * once; without it, quest mode could not tell that Bob received what Alice
     * sent, because neither pane can see the other.
     */
    private publishSnapshot(): void {
        const profile = this.profile;
        const balance = this.balance();
        if (!profile || !balance) return;

        const history = this.history();
        this.registry.publish({
            profileId: profile.id,
            available: balance.available,
            boarding: balance.boarding,
            total: balance.total,
            sent: history.filter((p) => p.direction === "sent").length,
            received: history.filter((p) => p.direction === "received").length,
        });
    }

    // ---- writes --------------------------------------------------------

    /**
     * Send sats off-chain.
     *
     * The address and amount checks live in `FirstSatsAccount.send` — shared
     * with the CLI — so the browser cannot drift away from the rules the
     * terminal enforces.
     *
     * @returns the Arkade transaction id.
     */
    async send(address: string, amount: number): Promise<string> {
        const txid = await this.run("send", (account) =>
            account.send(address.trim(), amount)
        );
        await this.refresh();
        return txid;
    }

    /**
     * Retire the current boarding address and advertise a fresh one.
     *
     * Not wrapped in `run`: rotation happens on a timer behind the scenes, and
     * flipping the global busy flag would disable buttons the user is reading.
     */
    async freshBoardingAddress(): Promise<void> {
        const account = this.account;
        if (!account) return;
        await account.freshBoardingAddress();
        this.addresses.set(await account.addresses());
    }

    /**
     * Leave Arkade: hand the VTXOs back and be paid out on-chain.
     *
     * Withdraws everything. The SDK takes an optional amount, but a partial
     * exit leaves a wallet split across two layers for no reason a beginner
     * would recognise, and "get my money out" is the question this answers.
     */
    /** Fold preconfirmed money into a batch, so it becomes settled. */
    async settle(): Promise<string> {
        const txid = await this.settling(() =>
            this.run("settle", (account) => account.settle(this.notePhase))
        );
        await this.refresh();
        setTimeout(() => void this.refresh(), AFTER_SETTLE_MS);
        return txid;
    }

    async offboard(destination: string): Promise<string> {
        const txid = await this.settling(() =>
            this.run("offboard", (account) => account.offboard(destination.trim()))
        );
        // Remembered on the profile: the balance is zero afterwards, so nothing
        // else distinguishes a wallet that exited from one that never had money.
        if (this.profile) this.profiles.markWithdrawn(this.profile.id);
        await this.refresh();
        return txid;
    }

    /**
     * Turn confirmed on-chain funds into VTXOs by joining the next batch.
     *
     * @param only - Outpoints chosen by the user. Omitted onboards them all.
     */
    async onboard(only?: readonly string[]): Promise<string> {
        const txid = await this.settling(() =>
            this.run("onboard", (account) => account.onboard(only, this.notePhase))
        );
        await this.refresh();
        /*
         * And again shortly after.
         *
         * The commitment transaction that spends the boarding UTXO has only
         * just been broadcast, and the indexer the wallet reads can still be
         * reporting that UTXO as unspent when the first refresh lands. Without
         * a second pass the boarding bucket keeps showing money that has
         * already moved, until something else happens to refresh it.
         */
        setTimeout(() => void this.refresh(), AFTER_SETTLE_MS);
        return txid;
    }

    /** Listen for incoming money until something arrives or the timeout lapses. */
    async watchForFunds(): Promise<void> {
        const account = this.account;
        if (!account || this.watching()) return;

        this.watching.set(true);
        this.lastReceived.set(undefined);
        this.failure.set(null);

        const cancelled = new Promise<null>((resolve) => {
            this.stopWatch = () => resolve(null);
        });

        try {
            const funds = await Promise.race([
                account.waitForFunds(WATCH_TIMEOUT_MS),
                cancelled,
            ]);
            this.lastReceived.set(funds);
            if (funds) await this.refresh();
        } catch (error) {
            this.failure.set({ label: "watch", detail: describe(error) });
        } finally {
            this.watching.set(false);
            this.stopWatch = null;
        }
    }

    stopWatching(): void {
        this.stopWatch?.();
    }

    // ---- plumbing ------------------------------------------------------

    /**
     * Run an account operation with the busy flag set and errors captured.
     *
     * `PaymentError` messages are written for a beginner, so they surface as-is;
     * anything else is reported generically but still logged for a developer.
     */
    private async run<T>(
        label: string,
        fn: (account: FirstSatsAccount) => Promise<T>
    ): Promise<T> {
        const account = this.account;
        if (!account) {
            throw new Error("No wallet is connected.");
        }
        this.busy.set(label);
        this.failure.set(null);
        try {
            return await fn(account);
        } catch (error) {
            this.failure.set({ label, detail: describe(error) });
            throw error;
        } finally {
            this.busy.set(null);
        }
    }
}

/**
 * `PaymentError` messages are written for a beginner and carry a catalogue key,
 * so they survive translation intact. Anything else has only its English text.
 */
function describe(error: unknown): Failure {
    if (error instanceof PaymentError) {
        return error.i18n
            ? { text: error.message, i18n: error.i18n }
            : { text: error.message };
    }
    if (error instanceof Error) return { text: error.message };
    return { text: String(error) };
}
