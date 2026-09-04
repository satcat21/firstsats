import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatChipsModule } from "@angular/material/chips";
import { MatIconModule } from "@angular/material/icon";
import { short } from "@firstsats/core";
import { ArkadeService } from "../core/arkade.service";
import { I18nService } from "../core/i18n.service";
import { MatDialog } from "@angular/material/dialog";
import { Insight } from "../ui/insight";
import { PhraseDialog } from "../ui/phrase-dialog";
import { BoardingWatch } from "./boarding-watch";

/**
 * The dashboard: balance buckets, the VTXOs behind them, and the server's rules.
 *
 * The buckets get equal visual weight on purpose. A wallet that shows one big
 * number teaches you that a balance is one number, which is the misconception
 * this whole screen exists to correct.
 */
@Component({
    selector: "app-wallet-overview",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatButtonModule,
        MatCardModule,
        MatChipsModule,
        MatIconModule,
        Insight,
        BoardingWatch,
    ],
    template: `
        @if (arkade.balance(); as balance) {
            <mat-card appearance="outlined">
                <mat-card-header>
                    <mat-card-title>{{ i18n.t("wallet.heading") }}</mat-card-title>
                    <span class="head-actions">
                        @if (arkade.stored()?.mnemonic) {
                            <button matButton (click)="showPhrase()">
                                <mat-icon>key</mat-icon>
                                {{ i18n.t("wallet.showPhrase") }}
                            </button>
                        }
                        <!-- Only while a refresh is itself in flight. Reading the
                             balance is safe during a batch round, and a round now
                             takes minutes of waiting -- exactly when someone wants
                             to check whether anything has moved. -->
                        <button
                            matButton
                            class="refresh"
                            [disabled]="arkade.busy() === 'refresh'"
                            (click)="arkade.refresh()"
                        >
                            <mat-icon>refresh</mat-icon>
                            {{ i18n.t("wallet.refresh") }}
                        </button>
                    </span>
                </mat-card-header>

                <mat-card-content>
                    <p class="headline">{{ fmt(balance.available) }}</p>
                    <p class="subtle">
                        {{ i18n.t("wallet.available") }} · {{ asBtc(balance.available) }}
                        <app-insight [label]="i18n.t('insight.available.label')">
                            {{ i18n.t("insight.available") }}
                        </app-insight>
                    </p>

                    <dl class="buckets">
                        <div class="group">
                            <dt>{{ i18n.t("wallet.groupArk") }}</dt>
                        </div>
                        <div>
                            <dt>
                                <button
                                    class="bucket-toggle"
                                    [attr.aria-expanded]="isOpen('settled')"
                                    (click)="toggle('settled')"
                                >
                                    <mat-icon class="bucket-icon" aria-hidden="true">
                                        verified
                                    </mat-icon>
                                    {{ i18n.t("wallet.settled") }}
                                    <mat-icon class="chevron" aria-hidden="true">
                                        {{ isOpen("settled") ? "expand_less" : "expand_more" }}
                                    </mat-icon>
                                </button>
                                <app-insight [label]="i18n.t('insight.settled.label')">
                                    {{ i18n.t("insight.settled") }}
                                </app-insight>
                            </dt>
                            <dd>{{ fmt(balance.settled) }}</dd>
                        </div>

                        @if (isOpen("settled")) {
                            <div class="detail">
                                <p class="subtle detail-head">
                                    {{ i18n.t("wallet.vtxosHeading") }}
                                    <app-insight [label]="i18n.t('insight.vtxo.label')">
                                        {{ i18n.t("insight.vtxo") }}
                                    </app-insight>
                                </p>

                                @if (arkade.vtxos().length === 0) {
                                    <p class="subtle empty">
                                        <mat-icon class="inline" aria-hidden="true">
                                            savings
                                        </mat-icon>
                                        {{ i18n.t("wallet.vtxosEmpty") }}
                                    </p>
                                } @else {
                                    <ul class="vtxos">
                                        @for (
                                            vtxo of arkade.vtxos();
                                            track vtxo.txid + ":" + vtxo.vout
                                        ) {
                                            <li>
                                                <div class="row">
                                                    <span class="amount">
                                                        {{ fmt(vtxo.value) }}
                                                    </span>
                                                    <mat-chip-set>
                                                        <mat-chip
                                                            [class.chip-ok]="
                                                                !vtxo.isPreconfirmed &&
                                                                !vtxo.isSwept
                                                            "
                                                            [class.chip-warn]="
                                                                vtxo.isPreconfirmed
                                                            "
                                                            [class.chip-bad]="vtxo.isSwept"
                                                        >
                                                            {{ i18n.vtxoState(vtxo.state) }}
                                                        </mat-chip>
                                                    </mat-chip-set>
                                                </div>
                                                <p class="subtle mono">
                                                    {{ shorten(vtxo.txid) }}:{{ vtxo.vout }}
                                                </p>
                                                @if (expiry(vtxo.expiresAt); as remaining) {
                                                    <p class="expiry">
                                                        <mat-icon
                                                            class="inline"
                                                            aria-hidden="true"
                                                            >schedule</mat-icon
                                                        >
                                                        {{
                                                            i18n.t(
                                                                "wallet.expiresIn",
                                                                remaining
                                                            )
                                                        }}
                                                        <app-insight
                                                            [label]="
                                                                i18n.t('insight.expiry.label')
                                                            "
                                                        >
                                                            {{ i18n.t("insight.expiry") }}
                                                        </app-insight>
                                                    </p>
                                                }
                                            </li>
                                        }
                                    </ul>
                                }
                            </div>
                        }
                        <div>
                            <dt>
                                <button
                                    class="bucket-toggle"
                                    [attr.aria-expanded]="isOpen('preconfirmed')"
                                    (click)="toggle('preconfirmed')"
                                >
                                    <mat-icon class="bucket-icon" aria-hidden="true">
                                        bolt
                                    </mat-icon>
                                    {{ i18n.t("wallet.preconfirmed") }}
                                    <mat-icon class="chevron" aria-hidden="true">
                                        {{
                                            isOpen("preconfirmed")
                                                ? "expand_less"
                                                : "expand_more"
                                        }}
                                    </mat-icon>
                                </button>
                                <app-insight [label]="i18n.t('insight.preconfirmed.label')">
                                    {{ i18n.t("insight.preconfirmed") }}
                                </app-insight>
                            </dt>
                            <dd>{{ fmt(balance.preconfirmed) }}</dd>
                        </div>

                        @if (isOpen("preconfirmed")) {
                            <div class="detail">
                                <p class="subtle">{{ i18n.t("wallet.settleWhy") }}</p>
                                @if (balance.preconfirmed > 0) {
                                    <button
                                        matButton="filled"
                                        [disabled]="arkade.busy() !== null"
                                        (click)="settle()"
                                    >
                                        <mat-icon [class.spin]="arkade.busy() === 'settle'">
                                            {{
                                                arkade.busy() === "settle"
                                                    ? "progress_activity"
                                                    : "verified"
                                            }}
                                        </mat-icon>
                                        {{
                                            arkade.busy() === "settle"
                                                ? i18n.t("wallet.settling")
                                                : i18n.t(
                                                      "wallet.settleCta",
                                                      fmt(balance.preconfirmed)
                                                  )
                                        }}
                                    </button>
                                }
                            </div>
                        }
                        <div>
                            <dt>
                                <mat-icon class="bucket-icon" aria-hidden="true">
                                    restore_from_trash
                                </mat-icon>
                                {{ i18n.t("wallet.recoverable") }}
                                <app-insight [label]="i18n.t('insight.recoverable.label')">
                                    {{ i18n.t("wallet.recoverableHint") }}.
                                </app-insight>
                            </dt>
                            <dd>{{ fmt(balance.recoverable) }}</dd>
                        </div>
                        <div class="group">
                            <dt>{{ i18n.t("wallet.groupChain") }}</dt>
                        </div>
                        <div>
                            <dt>
                                <button
                                    class="bucket-toggle"
                                    [attr.aria-expanded]="isOpen('boarding')"
                                    (click)="toggle('boarding')"
                                >
                                    <mat-icon class="bucket-icon" aria-hidden="true">
                                        link
                                    </mat-icon>
                                    {{ i18n.t("wallet.boarding") }}
                                    <mat-icon class="chevron" aria-hidden="true">
                                        {{ isOpen("boarding") ? "expand_less" : "expand_more" }}
                                    </mat-icon>
                                </button>
                                <app-insight [label]="i18n.t('insight.boarding.label')">
                                    {{ i18n.t("insight.boarding") }}
                                </app-insight>
                            </dt>
                            <dd>{{ fmt(balance.boarding) }}</dd>
                        </div>

                        @if (isOpen("boarding")) {
                            <div class="detail">
                                <app-boarding-watch />
                            </div>
                        }
                        <div class="total">
                            <dt>{{ i18n.t("wallet.total") }}</dt>
                            <dd>{{ fmt(balance.total) }}</dd>
                        </div>
                    </dl>

                </mat-card-content>
            </mat-card>

        }

    `,
    styles: `
        :host {
            display: flex;
            flex-direction: column;
            gap: 18px;
        }

        mat-card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }

        .refresh {
            flex: none;
            color: var(--fg-muted);
        }

        /* Dark ink on a light page; on a dark one the pastel is what reads. */
        :host-context([data-theme="dark"]) .headline {
            color: var(--tint);
        }

        .headline {
            margin: 10px 0 2px;
            color: var(--ink);
            font-size: 34px;
            font-weight: 700;
            letter-spacing: -0.02em;
            font-variant-numeric: tabular-nums;
        }

        .head-actions {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
        }


        .buckets {
            margin: 20px 0 0;
            display: grid;
            gap: 0;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            overflow: hidden;
        }

        /*
         * Separators are real borders, not gaps with the background showing
         * through. The gap trick rounds to whole device pixels per row, so with
         * rows of differing height one hairline came out visibly thicker than
         * its neighbours. A border on each row after the first is exactly one
         * pixel wherever it lands.
         */
        .buckets > div + div {
            border-top: 1px solid var(--border);
        }

        .buckets > div {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 11px 14px;
            background: var(--surface-raised);
        }

        /*
         * Which side of the chain each bucket lives on.
         *
         * The bucket names are the protocol's own and stay that way -- settled
         * and preconfirmed are both inside Ark, so neither could be renamed to
         * say so without lying about the other. A band above them says it
         * instead, and costs the table nothing.
         */
        .buckets > div.group {
            justify-content: flex-start;
            padding: 7px 14px;
            background: var(--surface);
        }

        .buckets .group dt {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--fg-subtle);
        }

        .buckets dt {
            display: flex;
            align-items: center;
            gap: 7px;
            /*
             * A floor under the label so every question mark lands on the same
             * vertical line. These rows are separate flex containers, so unlike
             * the server table below there is no shared column to hang them
             * from -- and the labels are built differently row to row, some
             * with a toggle and a chevron, some with just an icon. A common
             * minimum gives them the one thing they need in common. A longer
             * label in some other language simply pushes its own mark out; it
             * does not break the row.
             */
            min-width: 190px;
            font-size: 13.5px;
            color: var(--fg-muted);
        }

        .buckets dt app-insight {
            margin-left: auto;
        }

        .bucket-icon {
            font-size: 17px;
            width: 17px;
            height: 17px;
            color: var(--fg-subtle);
        }

        /*
         * An amount is one word. Breaking after the number put the unit on a
         * line of its own and made a two-line row out of a figure nine
         * characters long.
         */
        .buckets dd {
            margin: 0;
            font-family: var(--font-mono);
            font-size: 13.5px;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
        }

        .buckets .total dt,
        .buckets .total dd {
            font-weight: 700;
            color: var(--fg);
        }

        .onboard {
            margin-top: 18px;
        }

        @media (max-width: 700px) {
            /*
             * The floor under the label comes out on a phone.
             *
             * 190px of label plus its question mark leaves a 360px screen --
             * already three cards deep by the time it gets here -- too little
             * for the amount, which then wrapped. Alignment between rows is
             * worth less than the row fitting on one line, and with the labels
             * this short the marks stay near enough to level anyway.
             */
            .buckets dt {
                min-width: 0;
            }

            .buckets > div {
                padding: 10px 11px;
            }

            /* The title and its two actions, stacked rather than crushed. */
            mat-card-header {
                flex-wrap: wrap;
                gap: 8px;
            }

            .headline {
                font-size: 28px;
            }
        }

        .spin {
            animation: spin 1.1s linear infinite;
        }

        @keyframes spin {
            to {
                transform: rotate(360deg);
            }
        }

        .empty {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 0;
        }

        /*
         * A bucket that can be opened. The row stays a row: the label becomes
         * the control, so the number beside it is never pushed around by a
         * chevron appearing.
         */
        .bucket-toggle {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 0;
            border: 0;
            background: none;
            color: inherit;
            font: inherit;
            cursor: pointer;
        }

        .bucket-toggle:hover {
            color: var(--accent);
        }

        .chevron {
            width: 18px;
            height: 18px;
            font-size: 18px;
            color: var(--fg-subtle);
        }

        /*
         * Opens as a full-width row of the same table.
         *
         * display:block is load-bearing here: .buckets > div is a
         * space-between flex row, which threw the heading to the left edge and
         * the list to the right with a gulf between them. As a block it simply
         * stacks, and the table's own hairline gap already separates it from
         * the row above -- no inset or extra border needed, so it lines up with
         * every other row on the page.
         */
        .buckets > div.detail {
            display: block;
            padding: 14px;
            background: var(--surface);
        }

        .detail-head {
            margin: 0 0 10px;
            font-weight: 600;
        }

        /*
         * Cards across the width rather than one per line: a VTXO is three
         * short facts, and stacking them left a column of mostly empty space.
         * auto-fill so a narrow pane drops to one column on its own.
         */
        .detail .vtxos {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
            gap: 8px;
        }

        .detail app-boarding-watch {
            display: block;
        }

        .vtxos {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .vtxos li {
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
        }

        .amount {
            font-weight: 700;
            font-family: var(--font-mono);
        }

        .vtxos p {
            margin: 4px 0 0;
            overflow-wrap: anywhere;
        }

        .expiry {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 12.5px;
            color: var(--warning);
        }

    `,
})
export class WalletOverview {
    readonly arkade = inject(ArkadeService);
    private readonly dialog = inject(MatDialog);

    /**
     * Which buckets are opened out.
     *
     * A set rather than one selection: the two panels answer different
     * questions, and closing one to read the other would make comparing them
     * a chore. Both start closed, so the dashboard still opens as a summary.
     */
    private readonly open = signal<ReadonlySet<string>>(new Set());

    isOpen(bucket: string): boolean {
        return this.open().has(bucket);
    }

    toggle(bucket: string): void {
        const next = new Set(this.open());
        if (!next.delete(bucket)) next.add(bucket);
        this.open.set(next);
    }

    readonly i18n = inject(I18nService);

    /**
     * Shared formatters, straight from the core — but rendered in the reader's
     * locale, so the grouping separator and the unit names follow the language
     * the rest of the page is in.
     */
    /**
     * Show the phrase this wallet is built from.
     *
     * Read from the profile rather than anything derived: the twelve words are
     * what was stored, and re-deriving them for display would only invite them
     * to differ from what a restore would actually need.
     */
    showPhrase(): void {
        const mnemonic = this.arkade.stored()?.mnemonic;
        if (!mnemonic) return;
        this.dialog.open(PhraseDialog, {
            width: "min(520px, calc(100vw - 32px))",
            data: { mnemonic, accent: this.arkade.stored()?.accent },
        });
    }

    /** Join the next round, turning preconfirmed coins into settled ones. */
    settle(): void {
        void this.arkade.settle();
    }

    fmt(value: number | bigint): string {
        return this.i18n.sats(value);
    }

    asBtc(value: number): string {
        return this.i18n.btc(value);
    }

    shorten(value: string, head = 10, tail = 8): string {
        return short(value, head, tail);
    }

    /** `undefined` when there is no expiry to show, so the template can skip it. */
    expiry(expiresAt: number | undefined): string | undefined {
        if (expiresAt === undefined) return undefined;
        return this.i18n.duration(expiresAt - Date.now());
    }
}
