/**
 * "Did the faucet actually pay me?"
 *
 * Arkade's event stream cannot see a transaction still sitting in a mempool, so
 * between hitting a faucet and the next block the app can only say "nothing
 * yet" — which a newcomer cannot tell apart from the faucet ignoring them. This
 * asks Esplora directly and reports the three states that differ: nothing seen,
 * seen but unconfirmed, confirmed. A new transaction raises a snackbar.
 *
 * Several faucets are listed because they rate-limit per IP, not per address: a
 * second address on the same faucet achieves nothing, a different faucet has
 * its own limit.
 */

import {
    ChangeDetectionStrategy,
    Component,
    OnDestroy,
    computed,
    effect,
    inject,
} from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatChipsModule } from "@angular/material/chips";
import { MatIconModule } from "@angular/material/icon";
import { MatTooltipModule } from "@angular/material/tooltip";
import { MatDialog } from "@angular/material/dialog";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatSnackBar } from "@angular/material/snack-bar";
import { ArkadeService } from "../core/arkade.service";
import { ChainService } from "../core/chain.service";
import { I18nService } from "../core/i18n.service";
import { RoundClock, countdownText } from "../core/round-clock";
import { openOnboardDialog } from "../ui/onboard-dialog";

@Component({
    selector: "app-boarding-watch",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        NgTemplateOutlet,
        MatButtonModule,
        MatCardModule,
        MatChipsModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
    ],
    template: `
        <mat-card appearance="outlined">
            <mat-card-header>
                <mat-card-title>
                    <mat-icon class="inline" aria-hidden="true">travel_explore</mat-icon>
                    {{ i18n.t("chain.heading") }}
                </mat-card-title>
                @if (chain.status() === "watching") {
                    <span class="live">
                        <span class="pulse" aria-hidden="true"></span>
                        {{ i18n.t("chain.live") }}
                    </span>
                }
            </mat-card-header>

            <mat-card-content>
                <p class="subtle blurb">{{ i18n.t("chain.blurb") }}</p>

                <!-- aria-live so the answer is announced when it changes, which
                     is the entire reason for watching. -->
                <p class="status" role="status" aria-live="polite">
                    <mat-chip-set>
                        @switch (state()) {
                            @case ("error") {
                                <mat-chip class="chip-bad">
                                    <mat-icon matChipAvatar>cloud_off</mat-icon>
                                    {{ i18n.t("chain.unreachable") }}
                                </mat-chip>
                            }
                            @case ("awaiting") {
                                <mat-chip class="chip-warn">
                                    <mat-icon matChipAvatar>check_circle</mat-icon>
                                    {{ i18n.t("chain.confirmed") }}
                                </mat-chip>
                            }
                            @case ("pending") {
                                <mat-chip class="chip-warn">
                                    <mat-icon matChipAvatar>schedule</mat-icon>
                                    {{ i18n.t("chain.inMempool") }}
                                </mat-chip>
                            }
                            @case ("done") {
                                <mat-chip class="chip-ok">
                                    <mat-icon matChipAvatar>task_alt</mat-icon>
                                    {{ i18n.t("chain.done") }}
                                </mat-chip>
                            }
                            @default {
                                <mat-chip class="chip-neutral">
                                    <mat-icon matChipAvatar>hourglass_empty</mat-icon>
                                    {{ i18n.t("chain.nothing") }}
                                </mat-chip>
                            }
                        }
                    </mat-chip-set>
                    <span class="detail">{{ statusHint() }}</span>
                </p>

                <!-- The answer to "so what do I do now?" put where the question
                     is asked, rather than as a sentence pointing at another
                     tab. Same action as the Wallet tab's button. -->
                <!-- Always rendered, disabled until there is something to onboard.
                     The guide tells the reader to press this button, and a button
                     that is simply absent reads as a broken instruction; a
                     disabled one that says what is missing teaches the rule.
                     Tooltip on the wrapper, because a disabled button receives no
                     pointer events and would never show it. -->
                <span
                    class="onboard-wrap"
                    [matTooltip]="i18n.t('wallet.onboardNeedsCoins')"
                    [matTooltipDisabled]="awaitingOnboard()"
                >
                    <button
                        matButton="filled"
                        class="onboard"
                        [disabled]="!awaitingOnboard() || arkade.busy() !== null"
                        (click)="onboard()"
                    >
                        <mat-icon [class.spin]="arkade.busy() === 'onboard'">
                            {{
                                arkade.busy() === "onboard"
                                    ? "progress_activity"
                                    : "swap_horiz"
                            }}
                        </mat-icon>
                        {{
                            arkade.busy() === "onboard"
                                ? i18n.t("wallet.onboarding")
                                : awaitingOnboard()
                                  ? i18n.t(
                                        "wallet.onboardCta",
                                        i18n.sats(arkade.boardingConfirmed())
                                    )
                                  : i18n.t("wallet.onboardEmptyCta")
                        }}
                    </button>
                </span>

                @if (awaitingOnboard()) {
                    <!-- The wait has a length, so say it. A batch round is the
                         one part of this flow nobody can hurry, and a spinner
                         with no clock behind it looks the same as a hang. -->
                    @if (clock.running()) {
                        <p class="subtle round">
                            <mat-icon class="inline" aria-hidden="true">autorenew</mat-icon>
                            {{ i18n.t("round.running") }}
                        </p>
                    } @else if (clock.untilStart(); as remaining) {
                        <p class="subtle round">
                            <mat-icon class="inline" aria-hidden="true">schedule</mat-icon>
                            {{ i18n.t("round.next", countdown(remaining)) }}
                        </p>
                    }
                }

                <!-- The diagnosis, not just the symptom. If nothing arrived on
                     the configured chain but the same address is holding money
                     on a look-alike one, say so outright: no amount of waiting
                     will bring those coins here. -->
                @if (chain.misdirected(); as wrong) {
                    @if (wrong.length) {
                        <div class="misdirected" role="alert">
                            <mat-icon aria-hidden="true">wrong_location</mat-icon>
                            <div>
                                <p class="head">
                                    {{
                                        i18n.t(
                                            "chain.wrongChain",
                                            arkade.network.name
                                        )
                                    }}
                                </p>
                                <ul>
                                    @for (found of wrong; track found.chain) {
                                        <li>
                                            <strong>{{ i18n.sats(found.sats) }}</strong>
                                            {{ i18n.t("chain.wrongChainOn", found.chain) }}
                                        </li>
                                    }
                                </ul>
                                <p class="hint">{{ i18n.t("chain.wrongChainHint") }}</p>
                            </div>
                        </div>
                    }
                }

                <!--
                    Rotation makes the address on screen only the newest of
                    several. Anything that has held money, holds it now, or has
                    a payment in flight stays listed here: the wallet still
                    watches all of them and can still spend what lands there.
                -->
                @if (chain.usedAddresses().length) {
                    <h3>
                        <mat-icon class="heading-icon" aria-hidden="true">history</mat-icon>
                        {{ i18n.t("chain.usedHeading") }}
                    </h3>
                    <p class="subtle">{{ i18n.t("chain.usedHint") }}</p>
                    <ul class="addresses">
                        @for (group of addressGroups(); track group.entry.address) {
                            <li [class.current]="group.entry.current">
                                <div class="row">
                                    @if (explorerAddress(group.entry.address); as url) {
                                        <a
                                            class="mono addr"
                                            [href]="url"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            [matTooltip]="i18n.t('chain.openAddress')"
                                        >
                                            {{ shortAddr(group.entry.address) }}
                                            <mat-icon class="inline" aria-hidden="true"
                                                >open_in_new</mat-icon
                                            >
                                        </a>
                                    } @else {
                                        <span class="mono addr">{{
                                            shortAddr(group.entry.address)
                                        }}</span>
                                    }
                                    <mat-chip-set>
                                        @if (group.entry.pending > 0) {
                                            <mat-chip class="chip-warn">
                                                {{
                                                    i18n.t(
                                                        "chain.addrPending",
                                                        i18n.sats(group.entry.pending)
                                                    )
                                                }}
                                            </mat-chip>
                                        }
                                        @if (group.entry.balance > 0) {
                                            <mat-chip class="chip-ok">
                                                {{
                                                    i18n.t(
                                                        "chain.addrBalance",
                                                        i18n.sats(group.entry.balance)
                                                    )
                                                }}
                                            </mat-chip>
                                        } @else if (group.entry.received > 0) {
                                            <mat-chip class="chip-neutral">
                                                {{
                                                    i18n.t(
                                                        "chain.addrSpent",
                                                        i18n.sats(group.entry.received)
                                                    )
                                                }}
                                            </mat-chip>
                                        }
                                    </mat-chip-set>
                                </div>
                                @if (group.entry.current) {
                                    <p class="subtle note">{{ i18n.t("chain.addrCurrent") }}</p>
                                }
                                <!-- The payments behind the chips above, nested rather
                                     than listed again below: one inbound payment used
                                     to draw twice, once as a chip on its address and
                                     once as a card of its own saying the same amount. -->
                                @if (group.txs.length) {
                                    <ul class="nested-txs">
                                        @for (tx of group.txs; track tx.txid) {
                                            <li>
                                                <ng-container
                                                    [ngTemplateOutlet]="txRow"
                                                    [ngTemplateOutletContext]="{ $implicit: tx }"
                                                ></ng-container>
                                            </li>
                                        }
                                    </ul>
                                }
                            </li>
                        }
                    </ul>

                    @if (chain.retiredAddresses(); as retired) {
                        <p class="subtle retired">
                            <mat-icon class="inline" aria-hidden="true">history</mat-icon>
                            {{ i18n.t("chain.retired", retired) }}
                        </p>
                    }
                }

                <!-- Payments whose address has since been emptied, so it is no
                     longer in the list above and they would otherwise vanish. -->
                @if (otherTxs().length) {
                    <!-- Plain rows, same reason as the Activity list: a
                         mat-list-item clips anything past its fixed height. -->
                    <ul class="txs">
                        @for (tx of otherTxs(); track tx.txid) {
                            <li>
                                <ng-container
                                    [ngTemplateOutlet]="txRow"
                                    [ngTemplateOutletContext]="{ $implicit: tx }"
                                ></ng-container>
                            </li>
                        }
                    </ul>
                }

                <!-- One definition of a payment row, rendered either nested under
                     its address or standalone above. -->
                <ng-template #txRow let-tx>
                    <div class="row">
                        <span class="amount">
                            <!-- Spinning while unconfirmed: a static glyph beside
                                 "in mempool" looks like a state nobody is working
                                 on, when in fact the panel is polling and a block
                                 is being waited for. -->
                            <mat-icon
                                aria-hidden="true"
                                [class.ok]="tx.confirmed"
                                [class.spin]="!tx.confirmed"
                            >
                                {{ tx.confirmed ? "check_circle" : "progress_activity" }}
                            </mat-icon>
                            {{ i18n.sats(tx.value) }}
                        </span>
                        <mat-chip-set>
                            <mat-chip
                                [class.chip-ok]="tx.confirmed"
                                [class.chip-warn]="!tx.confirmed"
                            >
                                {{
                                    tx.confirmed
                                        ? i18n.t("chain.txConfirmed", tx.blockHeight ?? 0)
                                        : i18n.t("chain.txPending")
                                }}
                            </mat-chip>
                        </mat-chip-set>
                    </div>
                    <p class="subtle txid">
                        @if (explorer(tx.txid); as url) {
                            <a class="mono" [href]="url" target="_blank" rel="noopener noreferrer">{{
                                shortId(tx.txid)
                            }}</a>
                        } @else {
                            <span class="mono">{{ shortId(tx.txid) }}</span>
                        }
                    </p>
                </ng-template>

                @if (chain.checkedAt(); as at) {
                    <p class="subtle when">
                        {{ i18n.t("chain.lastChecked", i18n.dateTime(at)) }}
                    </p>
                }

            </mat-card-content>
        </mat-card>
    `,
    styles: `
        mat-card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }

        h3 {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            margin: 22px 0 4px;
        }

        .blurb {
            margin: 6px 0 16px;
        }

        .round {
            margin: 8px 0 0;
            font-variant-numeric: tabular-nums;
        }

        .onboard {
            margin-top: 16px;
        }

        .spin {
            animation: spin 1.1s linear infinite;
        }

        @keyframes spin {
            to {
                transform: rotate(360deg);
            }
        }

        .live {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            flex: none;
            font-size: 12.5px;
            color: var(--fg-muted);
        }

        .pulse {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--success);
            animation: pulse 1.4s ease-in-out infinite;
        }

        @keyframes pulse {
            0%,
            100% {
                opacity: 0.25;
            }
            50% {
                opacity: 1;
            }
        }

        .status {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 10px;
            margin: 0;
            font-size: 13px;
            color: var(--fg-muted);
        }

        .status .detail {
            flex: 1 1 220px;
        }

        .misdirected {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            margin: 16px 0 0;
            padding: 12px 14px;
            border-radius: var(--radius-sm);
            background: var(--danger-soft);
            color: var(--danger-on-soft);
            font-size: 13px;
            line-height: 1.55;
        }

        .misdirected .mat-icon {
            flex: none;
            color: inherit;
        }

        .misdirected p {
            margin: 0;
        }

        .misdirected .head {
            font-weight: 650;
        }

        .misdirected ul {
            margin: 6px 0;
            padding-left: 18px;
        }

        .misdirected .hint {
            opacity: 0.9;
        }

        /* Reads as a link, and keeps the icon riding the address text. */
        a.addr {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            color: var(--accent);
            text-decoration: none;
        }

        a.addr:hover {
            text-decoration: underline;
        }

        a.addr .mat-icon {
            width: 14px;
            height: 14px;
            font-size: 14px;
            vertical-align: 0;
        }

        .retired {
            display: flex;
            align-items: center;
            gap: 6px;
            margin: 10px 0 0;
        }

        .addresses {
            list-style: none;
            margin: 10px 0 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .addresses li {
            padding: 10px 12px;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            background: var(--surface);
        }

        .addresses li.current {
            border-color: var(--accent);
            background: var(--accent-soft);
        }

        .addr {
            font-size: 12.5px;
            overflow-wrap: anywhere;
        }

        .note {
            margin: 5px 0 0;
        }

        .txs {
            list-style: none;
            margin: 14px 0 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        /*
         * Nested inside an address card, so no border of its own: a rule and the
         * card's own padding are enough to read as "these belong to the address
         * above", where a second box would read as a second thing.
         */
        .nested-txs {
            list-style: none;
            margin: 10px 0 0;
            padding: 10px 0 0;
            border-top: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .nested-txs a {
            color: var(--accent);
            overflow-wrap: anywhere;
        }

        /* Carries the tooltip for the disabled button it wraps, so it must not
           change how that button lays out. */
        .onboard-wrap {
            display: inline-block;
        }

        .txs li {
            padding: 12px 14px;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            background: var(--surface);
        }

        .row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            flex-wrap: wrap;
        }

        mat-icon.ok {
            color: var(--success);
        }

        .amount {
            display: flex;
            align-items: center;
            gap: 6px;
            font-family: var(--font-mono);
            font-weight: 700;
            font-size: 13px;
        }

        .amount .mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
        }

        .txid {
            margin: 6px 0 0;
            overflow-wrap: anywhere;
        }

        .when {
            margin: 12px 0 0;
        }

        .txs a {
            color: var(--accent);
            overflow-wrap: anywhere;
        }
    `,
})
export class BoardingWatch implements OnDestroy {
    readonly arkade = inject(ArkadeService);
    readonly chain = inject(ChainService);
    readonly i18n = inject(I18nService);
    readonly clock = inject(RoundClock);
    private readonly dialog = inject(MatDialog);

    /**
     * Each watched address with the payments that explain its chips.
     *
     * The two used to be rendered as sibling lists, so a single inbound payment
     * appeared twice -- once as `10,000 sats on the way` against the address,
     * and again as its own card reading `10,000 sats, in mempool`. Grouping puts
     * the transaction inside the address it paid, where the amount is a detail
     * of the address rather than a second claim.
     */
    readonly addressGroups = computed(() => {
        const txs = this.chain.transactions();
        return this.chain.usedAddresses().map((entry) => ({
            entry,
            txs: txs.filter((tx) => tx.address === entry.address),
        }));
    });

    /**
     * Payments with no address left to nest under.
     *
     * `usedAddresses` only lists addresses still holding or expecting money, so
     * a payment to an address that has since been onboarded has nowhere to go.
     * It still belongs on screen -- money that arrived is money that arrived.
     */
    readonly otherTxs = computed(() => {
        const shown = new Set(this.chain.usedAddresses().map((entry) => entry.address));
        return this.chain.transactions().filter((tx) => !shown.has(tx.address));
    });

    /**
     * Hand the wait to a dialog that can explain it.
     *
     * The button only starts the work; what follows is a scheduled wait, and
     * the countdown belongs beside the sentence that says why you are waiting.
     */
    onboard(): void {
        openOnboardDialog(this.dialog, {
            accent: this.arkade.stored()?.accent,
            utxos: this.arkade.boarding(),
            explorer: (txid) => this.explorer(txid),
            run: (only) => this.arkade.onboard(only),
            attempt: () => this.arkade.roundAttempt(),
            attempts: this.arkade.roundAttempts,
            events: () => this.arkade.roundEvents(),
        });
    }

    countdown(ms: number): string {
        return countdownText(ms);
    }


    private readonly snackBar = inject(MatSnackBar);

    constructor() {
        // One look on arrival, so the panel opens showing the truth rather than
        // "nothing yet" until somebody presses Watch.
        void this.chain.check();

        /*
         * Keep polling while anything is still settling.
         *
         * The Receive card starts the poll for its watch and stops it in a
         * `finally` -- but `waitForFunds` resolves the moment money *arrives*,
         * which is while it is still in a mempool. Polling therefore stopped one
         * step before the confirmation that turns those coins into boarding
         * funds, so `boardingConfirmed` stayed zero and the onboard button never
         * enabled on its own. Here the panel owns the question it asks: poll
         * until nothing is unconfirmed, then stop.
         *
         * Left alone while the Receive watch is running, so the two cannot
         * fight over the same timer.
         */
        effect(() => {
            const settling =
                this.chain.pending() ||
                this.arkade.boarding().some((utxo) => !utxo.confirmed);

            if (settling) this.chain.start();
            else if (!this.arkade.watching()) this.chain.stop();
        });

        // The notification. `seenInMempool` is set only for a txid the watcher
        // has not reported before, so a poll that keeps returning the same
        // pending payment does not re-announce it every ten seconds.
        effect(() => {
            const found = this.chain.seenInMempool();
            if (!found) return;
            // Taken, not just read: the signal outlives this component, and
            // without this the same payment is announced again every time the
            // Receive tab is opened.
            this.chain.acknowledge();
            this.snackBar.open(
                this.announcement(found.confirmed, this.i18n.sats(found.value)),
                this.i18n.t("chain.toastDismiss"),
                { duration: 10_000, horizontalPosition: "end", verticalPosition: "bottom" }
            );
        });
    }

    /** Polling costs a request every ten seconds; do not leave it running. */
    ngOnDestroy(): void {
        this.chain.stop();
    }

    /**
     * On-chain money Ark cannot spend yet.
     *
     * The one honest trigger for "there is a step left". A confirmed payment in
     * the explorer is not it: that record survives the onboarding that consumed
     * it, and reading it as unfinished business made this panel keep asking for
     * an onboarding that had already happened.
     */
    /**
     * Whether there is anything that can be onboarded *now*.
     *
     * Confirmed only. The balance's `boarding` bucket counts outputs still in
     * a mempool, and offering those built a batch the server threw out whole.
     */
    readonly awaitingOnboard = computed(() => this.arkade.boardingConfirmed() > 0);

    /**
     * One verdict for the whole wallet, not for one address.
     *
     * Rotation retires an address as soon as it is paid, so the address on
     * screen is usually the empty new one. Judging the panel by that address
     * produced the contradiction of "nothing has reached a mempool" printed
     * directly above a button offering to onboard the money that had.
     */
    readonly state = computed<"error" | "awaiting" | "pending" | "done" | "empty">(
        () => {
            if (this.chain.error()) return "error";
            if (this.awaitingOnboard()) return "awaiting";
            if (this.chain.addresses().some((a) => a.pending > 0)) return "pending";
            // Retired ones count here: money that arrived and was onboarded is
            // still money that arrived, and the empty state must not claim
            // otherwise now that emptied addresses leave the list above.
            const everPaid =
                this.chain.usedAddresses().length > 0 ||
                this.chain.retiredAddresses() > 0;
            return everPaid ? "done" : "empty";
        }
    );

    statusHint(): string {
        switch (this.state()) {
            case "error":
                return this.chain.error() ?? "";
            case "awaiting":
                return this.i18n.t("chain.confirmedHint");
            case "pending":
                return this.i18n.t("chain.inMempoolHint");
            case "done":
                return this.i18n.t("chain.doneHint");
            default:
                return this.i18n.t("chain.nothingHint");
        }
    }

    /**
     * What to say about a payment that just turned up.
     *
     * Three states, not two: still in a mempool, confirmed but not yet
     * spendable in Ark, and confirmed with nothing left to do — which is where
     * a payment lands when the wallet onboarded it on its own.
     */
    private announcement(confirmed: boolean, amount: string): string {
        if (!confirmed) return this.i18n.t("chain.toastMempool", amount);
        return this.awaitingOnboard()
            ? this.i18n.t("chain.toastConfirmed", amount)
            : this.i18n.t("chain.toastReady", amount);
    }

    shortId(txid: string): string {
        return `${txid.slice(0, 10)}…${txid.slice(-8)}`;
    }

    shortAddr(address: string): string {
        return `${address.slice(0, 14)}…${address.slice(-10)}`;
    }

    /**
     * The address page, where a payment waiting for a block can be seen.
     *
     * Its own link rather than the transaction one: the list above is of
     * addresses, and this panel does not hold the txids for any address but the
     * one it is currently watching.
     */
    explorerAddress(address: string): string | null {
        return this.arkade.network.explorerAddressUrl?.(address) ?? null;
    }

    explorer(txid: string): string | null {
        return this.arkade.network.explorerTxUrl?.(txid) ?? null;
    }
}
