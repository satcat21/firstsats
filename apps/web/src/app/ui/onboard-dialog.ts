/**
 * Choosing what to bring off-chain, and then waiting for the round.
 *
 * Two jobs, in order, because both were missing.
 *
 * The choosing exists because a wallet routinely holds confirmed and
 * unconfirmed boarding outputs at once, and only confirmed ones can join a
 * round. Offering the combined total built a batch the server rejected
 * outright — an unconfirmed input does not simply arrive late, it takes the
 * confirmed ones down with it. So the outputs are listed individually, the
 * confirmed ones pre-ticked, the rest shown but not on offer, each linked to
 * the explorer so it can be checked rather than taken on trust.
 *
 * The waiting exists because an onboarding registers an intent and then sits
 * until the server's next batch round, a fixed schedule nobody can hurry. A
 * spinner says none of that and reads as a hang, so the countdown lives here,
 * beside the sentence that explains it. Closing is allowed throughout: the work
 * is already running and finishes whether this is on screen or not.
 */

import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatCheckboxModule } from "@angular/material/checkbox";
import {
    MAT_DIALOG_DATA,
    MatDialog,
    MatDialogModule,
} from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import type { BoardingUtxoView } from "@firstsats/core";
import { I18nService } from "../core/i18n.service";
import type { Accent } from "../core/profile.service";
import { RoundClock, countdownText } from "../core/round-clock";

export interface OnboardData {
    /** The wallet whose coins these are, so the dialog wears its colour. */
    readonly accent?: Accent;
    /**
     * Every output on a boarding address, confirmed or not.
     *
     * A function, like everything else here: outputs confirm while the dialog
     * is open, and that is the event it exists to wait for.
     */
    readonly utxos: () => readonly BoardingUtxoView[];
    /** Block-explorer link for a transaction, when the network has one. */
    readonly explorer: (txid: string) => string | null;
    /** Onboards the chosen outpoints and resolves with the commitment txid. */
    readonly run: (only: string[]) => Promise<string>;
    /** Which attempt is in flight, and how many there will be. */
    readonly attempt: () => number;
    readonly attempts: number;
    /** The round's own events, in order, for when it goes wrong. */
    readonly events: () => string[];
}

@Component({
    selector: "app-onboard-dialog",
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "[class.user-accent]": "data.accent !== undefined",
        "[style.--tint]": "data.accent?.tint ?? null",
        "[style.--ink]": "data.accent?.ink ?? null",
    },
    imports: [
        MatButtonModule,
        MatCheckboxModule,
        MatDialogModule,
        MatIconModule,
        MatProgressBarModule,
    ],
    template: `
        <h2 mat-dialog-title>
            <mat-icon class="heading-icon" aria-hidden="true">swap_horiz</mat-icon>
            {{ i18n.t("onboardDlg.heading") }}
        </h2>

        <mat-dialog-content>
            @switch (state()) {
                @case ("choosing") {
                    <p>{{ i18n.t("onboardDlg.choose") }}</p>

                    <ul class="utxos">
                        @for (utxo of utxos(); track utxo.outpoint) {
                            <li [class.waiting]="!utxo.confirmed">
                                <mat-checkbox
                                    [disabled]="!utxo.confirmed"
                                    [checked]="picked().has(utxo.outpoint)"
                                    (change)="toggle(utxo.outpoint)"
                                >
                                    <span class="sats">{{ i18n.sats(utxo.value) }}</span>
                                </mat-checkbox>

                                <span class="tag">
                                    {{
                                        utxo.confirmed
                                            ? i18n.t("onboardDlg.confirmed")
                                            : i18n.t("onboardDlg.waiting")
                                    }}
                                </span>

                                @if (data.explorer(utxo.txid); as url) {
                                    <a
                                        class="mono"
                                        [href]="url"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        >{{ short(utxo.txid) }}
                                        <mat-icon class="inline" aria-hidden="true"
                                            >open_in_new</mat-icon
                                        ></a
                                    >
                                } @else {
                                    <span class="mono">{{ short(utxo.txid) }}</span>
                                }
                            </li>
                        }
                    </ul>

                    @if (nothingConfirmed()) {
                        <p class="bad">
                            <mat-icon aria-hidden="true">error</mat-icon>
                            <span>{{ i18n.t("onboardDlg.noneConfirmed") }}</span>
                        </p>
                    }
                }
                @case ("running") {
                    <p class="subject">
                        {{ i18n.t("onboardDlg.subject", i18n.sats(chosenValue())) }}
                    </p>
                    <p>{{ i18n.t("onboardDlg.registered") }}</p>

                    <p class="clock">
                        @if (clock.running()) {
                            <mat-icon class="inline" aria-hidden="true">autorenew</mat-icon>
                            {{ i18n.t("round.running") }}
                        } @else if (clock.untilStart(); as remaining) {
                            <mat-icon class="inline" aria-hidden="true">schedule</mat-icon>
                            {{ i18n.t("round.next", countdown(remaining)) }}
                        }
                    </p>

                    @if (data.attempt() > 1) {
                        <p class="clock">
                            <mat-icon class="inline" aria-hidden="true">replay</mat-icon>
                            {{
                                i18n.t(
                                    "onboardDlg.attempt",
                                    data.attempt(),
                                    data.attempts
                                )
                            }}
                        </p>
                    }

                    <mat-progress-bar mode="indeterminate" />
                }
                @case ("done") {
                    <p class="ok">
                        <mat-icon aria-hidden="true">check_circle</mat-icon>
                        <span>{{ i18n.t("onboardDlg.done") }}</span>
                    </p>
                    @if (txid(); as id) {
                        <p class="txid mono">{{ id }}</p>
                    }
                }
                @default {
                    <p class="bad">
                        <mat-icon aria-hidden="true">error</mat-icon>
                        <span>{{ failure() }}</span>
                    </p>

                    <!-- What the round actually did before it failed. Without
                         this, "not enough confirmations" cannot be told apart
                         from never having been asked to confirm. -->
                    @if (data.events().length) {
                        <p class="phases mono">{{ data.events().join(" → ") }}</p>
                    }
                }
            }
        </mat-dialog-content>

        <mat-dialog-actions align="end">
            @if (state() === "choosing") {
                <button matButton mat-dialog-close>{{ i18n.t("common.cancel") }}</button>
                <button
                    matButton="filled"
                    cdkFocusInitial
                    [disabled]="picked().size === 0"
                    (click)="start()"
                >
                    <mat-icon>swap_horiz</mat-icon>
                    {{ i18n.t("wallet.onboardCta", i18n.sats(chosenValue())) }}
                </button>
            } @else {
                @if (state() === "failed") {
                    <button matButton (click)="start()">
                        <mat-icon>refresh</mat-icon>
                        {{ i18n.t("error.retry") }}
                    </button>
                }
                <button matButton="filled" cdkFocusInitial mat-dialog-close>
                    {{ i18n.t("common.close") }}
                </button>
            }
        </mat-dialog-actions>
    `,
    styles: `
        h2 {
            display: flex;
            align-items: center;
            gap: 9px;
        }

        p {
            margin: 0 0 14px;
            color: var(--fg-muted);
            line-height: 1.6;
        }

        .utxos {
            list-style: none;
            margin: 0 0 14px;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .utxos li {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 4px 10px;
            padding: 7px 10px;
            border-radius: var(--radius-sm);
            border: 1px solid var(--border);
        }

        /* Still in a mempool: listed, so the money is not simply missing from
           the list, but plainly not on offer. */
        .utxos li.waiting {
            opacity: 0.65;
        }

        .sats {
            font-weight: 600;
            color: var(--fg);
        }

        .utxos .tag {
            flex: 1 1 auto;
            font-size: 12px;
            color: var(--fg-muted);
        }

        /* Narrow enough that the txid cannot share the line: give it its own. */
        @media (max-width: 480px) {
            .utxos a,
            .utxos .mono {
                flex: 1 0 100%;
            }
        }

        .utxos a,
        .utxos .mono {
            font-size: 12px;
            color: var(--accent);
            text-decoration: none;
            white-space: nowrap;
        }

        .utxos a:hover {
            text-decoration: underline;
        }

        .utxos .mat-icon {
            width: 13px;
            height: 13px;
            font-size: 13px;
            vertical-align: 0;
        }

        .subject {
            color: var(--fg);
            font-weight: 600;
        }

        .clock {
            display: flex;
            align-items: center;
            gap: 7px;
            color: var(--fg);
            font-variant-numeric: tabular-nums;
        }

        .ok,
        .bad {
            display: flex;
            align-items: flex-start;
            gap: 9px;
            margin-bottom: 10px;
        }

        .ok {
            color: var(--success);
        }

        .bad {
            color: var(--danger);
        }

        .ok mat-icon,
        .bad mat-icon {
            flex: none;
            width: 20px;
            height: 20px;
            font-size: 20px;
        }

        .phases {
            font-size: 11px;
            color: var(--fg-subtle);
            overflow-wrap: anywhere;
        }

        .txid {
            font-size: 12px;
            word-break: break-all;
        }
    `,
})
export class OnboardDialog {
    readonly i18n = inject(I18nService);
    readonly clock = inject(RoundClock);
    readonly data = inject<OnboardData>(MAT_DIALOG_DATA);

    readonly state = signal<"choosing" | "running" | "done" | "failed">(
        "choosing"
    );
    readonly txid = signal<string | null>(null);
    readonly failure = signal("");

    /**
     * The outputs, read live rather than captured when the dialog opened.
     *
     * A boarding output confirms on its own schedule, and waiting for that is
     * the normal case here -- so a snapshot meant a dialog opened a moment too
     * early showed nothing tickable and a permanently disabled button, and no
     * amount of waiting with it open would change that.
     */
    readonly utxos = computed(() => this.data.utxos());

    /**
     * What the reader has explicitly unticked.
     *
     * Held as the exception rather than the selection, so that "everything
     * confirmed" stays the default as outputs confirm underneath -- a plain set
     * of picks could only ever describe the outputs that existed when it was
     * built.
     */
    private readonly unticked = signal<ReadonlySet<string>>(new Set());

    /** Everything confirmed, minus what the reader took out. */
    readonly picked = computed(() => {
        const out = this.unticked();
        return new Set(
            this.utxos()
                .filter((utxo) => utxo.confirmed && !out.has(utxo.outpoint))
                .map((utxo) => utxo.outpoint)
        );
    });

    readonly chosenValue = computed(() =>
        this.utxos()
            .filter((utxo) => this.picked().has(utxo.outpoint))
            .reduce((sum, utxo) => sum + utxo.value, 0)
    );

    readonly nothingConfirmed = computed(() =>
        this.utxos().every((utxo) => !utxo.confirmed)
    );

    toggle(outpoint: string): void {
        const next = new Set(this.unticked());
        if (!next.delete(outpoint)) next.add(outpoint);
        this.unticked.set(next);
    }

    /** Both ends of the txid; the middle of one tells you nothing. */
    short(txid: string): string {
        return `${txid.slice(0, 8)}…${txid.slice(-6)}`;
    }

    async start(): Promise<void> {
        this.state.set("running");
        try {
            this.txid.set(await this.data.run([...this.picked()]));
            this.state.set("done");
        } catch (cause) {
            this.failure.set(cause instanceof Error ? cause.message : String(cause));
            this.state.set("failed");
        }
    }

    countdown(ms: number): string {
        return countdownText(ms);
    }

}

/**
 * Open it. The dialog runs the work and owns the outcome.
 *
 * Callers pass the operation rather than awaiting it, so a failure is caught
 * inside and shown in place — with a retry — instead of leaving a rejected
 * promise for a click handler that has nowhere to put it.
 */
export function openOnboardDialog(dialog: MatDialog, data: OnboardData): void {
    dialog.open(OnboardDialog, { width: "min(500px, calc(100vw - 32px))", data });
}
