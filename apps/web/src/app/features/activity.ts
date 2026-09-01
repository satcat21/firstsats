import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    type OnDestroy,
} from "@angular/core";
import { MatCardModule } from "@angular/material/card";
import { MatChipsModule } from "@angular/material/chips";
import { MatIconModule } from "@angular/material/icon";
import { MatTooltipModule } from "@angular/material/tooltip";
import { type PaymentView, short } from "@firstsats/core";
import type { Messages } from "../core/messages";
import { ArkadeService } from "../core/arkade.service";
import { ChainService } from "../core/chain.service";
import { I18nService } from "../core/i18n.service";
import { Insight } from "../ui/insight";

/**
 * One thing that happened, as a reader would count it.
 *
 * The SDK reports a *payment* and lets its transaction ids record what became
 * of it, so a deposit that was later swept into Ark arrives as a single entry
 * carrying two transactions. Read literally that puts a deposit and the round
 * that consumed it on one line, and shows every deposit in a round under the
 * same commitment id. These are separate events at separate times, so they are
 * separated here.
 */
interface Action {
    readonly kind: "deposit" | "onboard" | "ark" | "sweep";
    readonly amount: number;
    /** Milliseconds since epoch, absent when nothing has dated it. */
    readonly at?: number;
    readonly txid: string;
    /** Whether the money is in Ark after this, which decides the colour. */
    readonly inArk: boolean;
    readonly state?: "settled" | "preconfirmed" | "waiting" | "unconfirmed";
    /** The boarding address a deposit landed in, once known. */
    readonly address?: string;
    readonly tone: "received" | "sent" | "moved";
    /** Stable across refreshes, so rows are not rebuilt on every poll. */
    readonly key: string;
}

/** How often to re-ask the explorer about a transaction with no block yet. */
const CHASE_MS = 20_000;

/** Past payments, newest first. */
@Component({
    selector: "app-activity",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatCardModule,
        MatChipsModule,
        MatIconModule,
        MatTooltipModule,
        Insight,
    ],
    template: `
        <mat-card appearance="outlined">
            <mat-card-header>
                <mat-card-title>
                    {{ i18n.t("activity.heading") }}
                    <app-insight [label]="i18n.t('insight.history.label')">
                        {{ i18n.t("insight.history") }}
                    </app-insight>
                </mat-card-title>
            </mat-card-header>

            <mat-card-content>
                @if (arkade.history().length === 0) {
                    <p class="subtle empty">
                        <mat-icon class="inline" aria-hidden="true">inbox</mat-icon>
                        {{ i18n.t("activity.empty") }}
                    </p>
                } @else {
                    <!-- Plain rows rather than mat-list: a list item locks its
                         height to its number of text lines and clips the rest,
                         and a chip is taller than a line. -->
                    <ul class="payments">
                        @for (action of actions(); track action.key) {
                            <li [class]="action.kind">
                                <div class="row">
                                    <span class="amount" [class]="action.tone">
                                        <mat-icon aria-hidden="true">
                                            {{ icon(action.kind) }}
                                        </mat-icon>
                                        {{ sign(action) }}{{ fmt(action.amount) }}
                                    </span>
                                    <mat-chip-set>
                                        <mat-chip
                                            class="venue"
                                            [class.mine]="action.inArk"
                                        >
                                            <!-- Icon and word in a box of our
                                                 own. Material nests projected
                                                 chip content in elements this
                                                 component cannot style without
                                                 reaching through ::ng-deep and
                                                 guessing at class names, and
                                                 two attempts at guessing left
                                                 the glyph riding above its
                                                 label. This owns the row. -->
                                            <span class="chip-inner">
                                                <mat-icon aria-hidden="true">
                                                    {{ action.inArk ? "bolt" : "link" }}
                                                </mat-icon>
                                                {{ i18n.t(kindLabel(action.kind)) }}
                                            </span>
                                        </mat-chip>
                                        @if (action.state; as state) {
                                            <mat-chip
                                                [class.chip-ok]="state === 'settled'"
                                                [class.chip-warn]="
                                                    state === 'preconfirmed' ||
                                                    state === 'unconfirmed'
                                                "
                                                [class.chip-neutral]="
                                                    state === 'waiting'
                                                "
                                            >
                                                {{ i18n.t(stateLabel(state)) }}
                                            </mat-chip>
                                        }
                                    </mat-chip-set>
                                </div>

                                @if (action.address; as address) {
                                    <p class="subtle into">
                                        {{ i18n.t("activity.paidInto") }}
                                        @if (explorerAddress(address); as url) {
                                            <a
                                                class="mono"
                                                [href]="url"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                >{{ shortAddr(address) }}</a
                                            >
                                        } @else {
                                            <span class="mono">{{ shortAddr(address) }}</span>
                                        }
                                    </p>
                                }

                                <p class="subtle when">
                                    <!-- No date on an entry nothing has dated:
                                         a preconfirmed payment has never been
                                         in a block, so no clock has seen it. -->
                                    @if (when(action.at); as at) {
                                        {{ at }} ·
                                    }
                                    @if (explorerFor(action); as url) {
                                        <a
                                            class="mono"
                                            [href]="url"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            [matTooltip]="i18n.t('activity.openExplorer')"
                                            >{{ shorten(action.txid)
                                            }}<mat-icon class="ext" aria-hidden="true"
                                                >open_in_new</mat-icon
                                            ></a
                                        >
                                    } @else {
                                        <span
                                            class="mono"
                                            [matTooltip]="i18n.t('activity.offchainOnly')"
                                            >{{ shorten(action.txid) }}</span
                                        >
                                    }
                                </p>
                            </li>
                        }
                    </ul>
                }
            </mat-card-content>
        </mat-card>
    `,
    styles: `
        .group-head {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 20px 0 8px;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--fg-subtle);
        }

        /* The first heading sits under the card title; it needs no gap. */
        .group-head:first-of-type {
            margin-top: 0;
        }

        .group-head .count {
            padding: 1px 7px;
            border-radius: 999px;
            background: var(--surface);
            border: 1px solid var(--border);
            font-size: 11px;
            letter-spacing: 0;
        }

        /*
         * A stripe down the side saying which world this happened in.
         *
         * Ark-side rows -- payments and onboardings -- take the wallet's own
         * colour, the same one its avatar and pane use, so a glance down the
         * list separates "inside Ark" from "on the chain" before any label is
         * read. Money arriving on-chain is neutral, and money leaving Ark for
         * the chain is marked out on its own: it is the one entry here that
         * ends with coins somewhere this app can no longer help you spend.
         */
        .payments > li {
            border-left: 3px solid var(--border-strong);
        }

        .payments > li.ark,
        .payments > li.onboard {
            border-left-color: var(--ink);
        }

        .payments > li.deposit {
            border-left-color: var(--fg-subtle);
        }

        .payments > li.sweep {
            border-left-color: var(--warning);
        }

        .venue.mine {
            background: var(--tint);
            --mat-chip-label-text-color: var(--ink);
        }

        .into,
        .stages {
            margin: 2px 0 0;
        }

        .stages {
            display: flex;
            flex-wrap: wrap;
            gap: 2px 14px;
        }

        .into a,
        .stages a {
            color: var(--accent);
        }

        .venue {
            --mat-chip-label-text-color: var(--fg-muted);
        }

        .chip-inner {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            line-height: 1;
        }

        .chip-inner .mat-icon {
            display: block;
            width: 15px;
            height: 15px;
            margin: 0;
            font-size: 15px;
            line-height: 15px;
        }

        .empty {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 0;
            font-style: italic;
        }

        .payments {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .payments li {
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

        .amount {
            display: flex;
            align-items: center;
            gap: 6px;
            font-family: var(--font-mono);
            font-weight: 700;
        }

        .amount .mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
        }

        .amount.received {
            color: var(--success);
        }

        .amount.sent {
            color: var(--fg);
        }

        /* An onboarding is a move, not an arrival: no green, no sign. */
        .amount.moved {
            color: var(--fg);
        }

        mat-chip-set {
            flex: none;
        }

        .when {
            margin: 6px 0 0;
            overflow-wrap: anywhere;
        }

        .when a {
            color: var(--accent);
        }

        .ext {
            font-size: 13px;
            width: 13px;
            height: 13px;
            vertical-align: -2px;
            margin-left: 3px;
        }
    `,
})
export class Activity implements OnDestroy {
    readonly arkade = inject(ArkadeService);
    private readonly chain = inject(ChainService);
    readonly i18n = inject(I18nService);

    private timer: ReturnType<typeof setInterval> | undefined;

    constructor() {
        /*
         * Ask the explorer what the SDK cannot say: which address a deposit
         * paid into, and when a round was mined.
         */
        effect(() => {
            this.chase();
        });

        /*
         * And keep asking, while this tab is open.
         *
         * A transaction that was in a mempool when first asked about has no
         * block time to give, and the history it belongs to may never change
         * again -- so nothing would ever re-ask, and a withdrawal that had long
         * since confirmed sat there reading "waiting for a block" for good. The
         * chain watcher cannot cover this: it only polls while the Receive tab
         * is actively watching for money.
         */
        this.timer = setInterval(() => this.chase(), CHASE_MS);
    }

    ngOnDestroy(): void {
        if (this.timer) clearInterval(this.timer);
    }

    /** Resolve anything on screen that is still missing a date or an address. */
    private chase(): void {
        for (const payment of this.arkade.history()) {
            if (payment.boardingTxid) {
                void this.chain.resolveTx(payment.boardingTxid);
            }
            if (payment.commitmentTxid) {
                void this.chain.resolveTx(payment.commitmentTxid);
            }
        }
    }

    /**
     * Every action, newest first.
     *
     * Deposits become their own entries, and each round becomes one entry of
     * its own carrying the total it swept in -- a round that took three
     * deposits is one onboarding, not three.
     */
    readonly actions = computed<Action[]>(() => {
        const out: Action[] = [];
        const rounds = new Map<string, { amount: number; at?: number }>();
        const addresses = this.chain.recipients();
        const times = this.chain.times();

        for (const payment of this.arkade.history()) {
            if (payment.boardingTxid) {
                const address = addresses[payment.boardingTxid];
                out.push({
                    kind: "deposit",
                    amount: payment.amount,
                    ...(payment.createdAt ? { at: payment.createdAt } : {}),
                    txid: payment.boardingTxid,
                    inArk: false,
                    ...(payment.commitmentTxid ? {} : { state: "waiting" as const }),
                    ...(address ? { address } : {}),
                    tone: "received",
                    key: `deposit:${payment.boardingTxid}`,
                });

                if (payment.commitmentTxid) {
                    const round = rounds.get(payment.commitmentTxid) ?? { amount: 0 };
                    rounds.set(payment.commitmentTxid, {
                        amount: round.amount + payment.amount,
                        // The round came after the last deposit it swept, which
                        // is the best guess until the explorer supplies its
                        // block time.
                        at: Math.max(round.at ?? 0, payment.createdAt ?? 0) || undefined,
                    });
                }
                continue;
            }

            if (payment.direction === "sent" && payment.commitmentTxid) {
                /*
                 * Dated from the commitment transaction, never from the SDK's
                 * `createdAt`, which for a withdrawal reports when the coins
                 * being spent came into being -- hours earlier, and nothing to
                 * do with when the withdrawal was made. No block, no date: an
                 * honest blank beats a confidently wrong timestamp.
                 */
                const mined = times[payment.commitmentTxid];
                out.push({
                    kind: "sweep",
                    amount: payment.amount,
                    ...(mined ? { at: mined } : {}),
                    txid: payment.commitmentTxid,
                    inArk: false,
                    // The VTXOs are gone either way, but the payment out is an
                    // ordinary on-chain transaction until a block takes it.
                    state: mined ? "settled" : "unconfirmed",
                    tone: "sent",
                    key: `sweep:${payment.commitmentTxid}`,
                });
                continue;
            }

            out.push({
                kind: "ark",
                amount: payment.amount,
                ...(payment.createdAt ? { at: payment.createdAt } : {}),
                txid: payment.id,
                inArk: true,
                state: payment.settled ? "settled" : "preconfirmed",
                tone: payment.direction === "sent" ? "sent" : "received",
                key: `ark:${payment.id}`,
            });
        }

        for (const [txid, round] of rounds) {
            const at = times[txid] ?? round.at;
            out.push({
                kind: "onboard",
                amount: round.amount,
                ...(at ? { at } : {}),
                txid,
                inArk: true,
                state: "settled",
                tone: "moved",
                key: `onboard:${txid}`,
            });
        }

        /*
         * Newest first, and where two entries share a moment, the later stage
         * wins.
         *
         * A round is dated from its own block time when the explorer has been
         * asked, and from its last deposit until then -- so an onboarding and
         * the deposit it swept routinely carry the same timestamp, and a stable
         * sort left them in the order they were built rather than the order
         * they happened. A deposit always precedes the round that consumed it.
         *
         * Undated entries float to the top: nothing has been in a block to date
         * them, so they are the newest thing that can have happened.
         */
        const rank = (action: Action): number => (action.kind === "deposit" ? 0 : 1);
        return out.sort((a, b) => {
            const byTime =
                (b.at ?? Number.MAX_SAFE_INTEGER) - (a.at ?? Number.MAX_SAFE_INTEGER);
            return byTime !== 0 ? byTime : rank(b) - rank(a);
        });
    });

    icon(kind: Action["kind"]): string {
        switch (kind) {
            case "deposit":
                return "arrow_downward";
            case "onboard":
                return "swap_horiz";
            case "sweep":
                return "arrow_upward";
            default:
                return "bolt";
        }
    }

    /** An onboarding moves money rather than changing how much there is. */
    sign(action: Action): string {
        if (action.kind === "onboard") return "";
        return action.tone === "sent" ? "\u2212" : "+";
    }

    kindLabel(kind: Action["kind"]): keyof Messages {
        return `activity.kind.${kind}` as keyof Messages;
    }

    stateLabel(state: NonNullable<Action["state"]>): keyof Messages {
        return `activity.${state}` as keyof Messages;
    }

    explorerAddress(address: string): string | null {
        return this.arkade.network.explorerAddressUrl?.(address) ?? null;
    }

    shortAddr(address: string): string {
        return `${address.slice(0, 10)}\u2026${address.slice(-8)}`;
    }

    /**
     * An explorer link, or null when there is nothing on a chain to link to.
     *
     * An Ark payment is the one entry here with no on-chain transaction at all
     * -- that is the point of it -- so linking its id sent the reader to an
     * explorer that could only shrug. Deposits, rounds and withdrawals all have
     * a real transaction behind them and keep their link.
     */
    explorerFor(action: Action): string | null {
        if (action.kind === "ark") return null;
        return this.arkade.network.explorerTxUrl?.(action.txid) ?? null;
    }

    fmt(value: number): string {
        return this.i18n.sats(value);
    }

    shorten(value: string): string {
        return short(value);
    }

    /** `undefined` when nothing has dated this yet. */
    when(timestamp: number | undefined): string | undefined {
        return timestamp ? this.i18n.dateTime(timestamp) : undefined;
    }
}
