/**
 * Which chain this app is talking to, what that chain is, and what the server
 * running on it says about itself.
 *
 * One dialog rather than three places. The choice used to be a dropdown in the
 * header that gave two words and no way to say what you were choosing between;
 * the server's parameters used to sit at the bottom of the wallet tab, which
 * put a global fact inside a per-wallet screen -- in a split view it rendered
 * twice, identically, under two wallets neither of which owned it.
 */

import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogModule } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { NETWORKS, type PresetName } from "@firstsats/core";
import { I18nService } from "../core/i18n.service";
import type { Messages } from "../core/messages";
import { NetworkService } from "../core/network.service";
import { RoundClock, countdownText } from "../core/round-clock";
import { Insight } from "./insight";

/** What each chain is, in a sentence. Shared with the badge in the header. */
const CHAIN_NOTES: Partial<Record<PresetName, keyof Messages>> = {
    mutinynet: "insight.chain.mutinynet",
    signet: "insight.chain.signet",
};

/** Block time per chain, for the comparison table. */
const BLOCK_TIMES: Partial<Record<PresetName, keyof Messages>> = {
    mutinynet: "netDlg.blocks.mutinynet",
    signet: "netDlg.blocks.signet",
};

@Component({
    selector: "app-network-dialog",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatButtonModule, MatDialogModule, MatIconModule, Insight],
    template: `
        <h2 mat-dialog-title>
            <mat-icon aria-hidden="true">hub</mat-icon>
            {{ i18n.t("netDlg.title") }}
        </h2>

        <mat-dialog-content>
            <p class="blurb">{{ i18n.t("netDlg.blurb") }}</p>

            <h3>{{ i18n.t("netDlg.chooseHeading") }}</h3>

            <!-- Rows rather than a select: the reason to pick one is the
                 sentence underneath it, which a dropdown has no room for. -->
            <ul class="choices">
                @for (preset of networks.presets; track preset) {
                    <li>
                        <button
                            type="button"
                            class="choice"
                            [attr.data-network]="preset"
                            [class.current]="preset === networks.name()"
                            [attr.aria-current]="preset === networks.name()"
                            (click)="choose(preset)"
                        >
                            <span class="dot"></span>
                            <span class="name">{{ label(preset) }}</span>
                            @if (preset === networks.name()) {
                                <span class="badge">{{ i18n.t("netDlg.inUse") }}</span>
                            }
                            <span class="note">{{ i18n.t(note(preset)) }}</span>
                        </button>
                    </li>
                }
            </ul>

            <p class="switch-note">{{ i18n.t("netDlg.switchNote") }}</p>

            <!-- Named, because a faucet only pays out on its own chain: coins
                 from the wrong one are sent to an address that looks valid and
                 never arrive. -->
            @if (faucet(); as url) {
                <a matButton="outlined" [href]="url" target="_blank" rel="noopener noreferrer">
                    <mat-icon>water_drop</mat-icon>
                    {{ i18n.t("netDlg.faucet", networks.current().label) }}
                </a>
            }

            <h3>{{ i18n.t("netDlg.compareHeading") }}</h3>

            <!-- Mainnet is a column, not a footnote. "Worth nothing" only means
                 something against the thing it is not. -->
            <div class="scroller">
                <table class="compare">
                    <thead>
                        <tr>
                            <th scope="col">{{ i18n.t("netDlg.col.property") }}</th>
                            @for (preset of networks.presets; track preset) {
                                <th scope="col">{{ label(preset) }}</th>
                            }
                            <th scope="col" class="mainnet">
                                {{ i18n.t("netDlg.col.mainnet") }}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <th scope="row">{{ i18n.t("netDlg.row.blocks") }}</th>
                            @for (preset of networks.presets; track preset) {
                                <td>{{ i18n.t(blockTime(preset)) }}</td>
                            }
                            <td class="mainnet">{{ i18n.t("netDlg.blocks.mainnet") }}</td>
                        </tr>
                        <tr>
                            <th scope="row">{{ i18n.t("netDlg.row.coins") }}</th>
                            @for (preset of networks.presets; track preset) {
                                <td>{{ i18n.t("netDlg.coins.test") }}</td>
                            }
                            <td class="mainnet">{{ i18n.t("netDlg.coins.mainnet") }}</td>
                        </tr>
                        <tr>
                            <th scope="row">{{ i18n.t("netDlg.row.mistakes") }}</th>
                            @for (preset of networks.presets; track preset) {
                                <td>{{ i18n.t("netDlg.mistakes.test") }}</td>
                            }
                            <td class="mainnet">{{ i18n.t("netDlg.mistakes.mainnet") }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Named, because the section sits under a switcher: without the
                 chain in the heading these parameters read as the app's, when
                 every one of them belongs to the deployment in use. -->
            <h3>{{ i18n.t("server.heading", networks.current().label) }}</h3>

            @if (clock.facts(); as info) {
                <dl class="server">
                    <dt>
                        {{ i18n.t("server.url") }}
                        <app-insight [label]="i18n.t('insight.serverUrl.label')">
                            {{ i18n.t("insight.serverUrl") }}
                        </app-insight>
                    </dt>
                    <dd>
                        <a
                            class="mono"
                            [href]="networks.current().arkServerUrl"
                            target="_blank"
                            rel="noopener noreferrer"
                            >{{ networks.current().arkServerUrl }}
                            <mat-icon class="inline" aria-hidden="true">open_in_new</mat-icon></a
                        >
                    </dd>

                    <dt>
                        {{ i18n.t("server.nextRound") }}
                        <app-insight [label]="i18n.t('insight.nextRound.label')">
                            {{ i18n.t("insight.nextRound") }}
                        </app-insight>
                    </dt>
                    <dd class="live">
                        @if (clock.running()) {
                            {{ i18n.t("server.roundNow") }}
                        } @else if (clock.untilStart(); as remaining) {
                            {{ countdown(remaining) }}
                        } @else {
                            —
                        }
                    </dd>

                    <dt>
                        {{ i18n.t("server.network") }}
                        <app-insight [label]="i18n.t('insight.network.label')">
                            {{ i18n.t("insight.network") }}
                        </app-insight>
                    </dt>
                    <dd>{{ info.network }}</dd>

                    <dt>
                        {{ i18n.t("server.dust") }}
                        <app-insight [label]="i18n.t('insight.dust.label')">
                            {{ i18n.t("insight.dust") }}
                        </app-insight>
                    </dt>
                    <dd>{{ sats(info.dust) }}</dd>

                    <dt>
                        {{ i18n.t("server.session") }}
                        <app-insight [label]="i18n.t('insight.session.label')">
                            {{ i18n.t("insight.session") }}
                        </app-insight>
                    </dt>
                    <dd>{{ i18n.t("server.sessionValue", number(info.sessionDuration)) }}</dd>

                    <dt>
                        {{ i18n.t("server.exit") }}
                        <app-insight [label]="i18n.t('insight.unilateralExit.label')">
                            {{ i18n.t("server.exitHint") }}
                        </app-insight>
                    </dt>
                    <dd>{{ exitDelay() }}</dd>

                    <dt>
                        {{ i18n.t("server.key") }}
                        <app-insight [label]="i18n.t('insight.signerKey.label')">
                            {{ i18n.t("insight.signerKey") }}
                        </app-insight>
                    </dt>
                    <!-- In full, and wrapping. Truncating it looked tidy but made
                         the one thing worth doing with it -- checking it against
                         the key inside your own address -- impossible. -->
                    <dd class="mono key">{{ info.signerPubkey }}</dd>
                </dl>
            } @else {
                <p class="subtle">{{ i18n.t("netDlg.noServer") }}</p>
            }
        </mat-dialog-content>

        <mat-dialog-actions>
            <button matButton mat-dialog-close>{{ i18n.t("netDlg.close") }}</button>
        </mat-dialog-actions>
    `,
    styles: `
        h2 {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        h3 {
            margin: 22px 0 10px;
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: var(--fg-subtle);
        }

        .blurb {
            margin: 0;
            color: var(--fg-muted);
            line-height: 1.6;
        }

        .choices {
            list-style: none;
            margin: 0;
            padding: 0;
            display: grid;
            gap: 8px;
        }

        /*
         * A row per network, laid out so the name and its badge share a line
         * and the sentence runs the full width underneath.
         */
        .choice {
            display: grid;
            grid-template-columns: auto auto 1fr;
            align-items: center;
            gap: 4px 8px;
            width: 100%;
            padding: 12px 14px;
            text-align: left;
            border-radius: var(--radius);
            border: 1px solid var(--border);
            background: var(--surface);
            color: inherit;
            cursor: pointer;
            font: inherit;
        }

        .choice:hover {
            border-color: var(--border-strong);
        }

        /* The chosen one carries its own colour, the same one the header uses. */
        .choice.current {
            border-color: color-mix(in srgb, var(--net-hue) 55%, transparent);
            background: color-mix(in srgb, var(--net-hue) 10%, var(--surface));
            cursor: default;
        }

        .choice[data-network="signet"] {
            --net-hue: #8e6fd8;
        }

        .choice[data-network="mutinynet"] {
            --net-hue: #d6489b;
        }

        .dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--net-hue);
        }

        .name {
            font-weight: 650;
        }

        .badge {
            justify-self: start;
            padding: 2px 8px;
            border-radius: 999px;
            background: color-mix(in srgb, var(--net-hue) 20%, transparent);
            color: color-mix(in srgb, var(--net-hue) 75%, var(--fg));
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.03em;
            text-transform: uppercase;
        }

        /* Spans all three columns, under the name rather than beside it. */
        .note {
            grid-column: 1 / -1;
            color: var(--fg-muted);
            font-size: 12.5px;
            line-height: 1.55;
        }

        .switch-note {
            margin: 10px 0 14px;
            color: var(--fg-subtle);
            font-size: 12.5px;
            line-height: 1.55;
        }

        /* A table is the one shape that survives a fourth column; it scrolls
           rather than making the dialog scroll sideways. */
        .scroller {
            overflow-x: auto;
        }

        .compare {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }

        .compare th,
        .compare td {
            padding: 8px 10px;
            text-align: left;
            border-bottom: 1px solid var(--border);
        }

        /*
         * Only the property names refuse to wrap. Holding every cell on one
         * line pushed the table past the dialog and put a scrollbar under a
         * comparison whose whole point is being seen at once; the values are
         * short phrases that read perfectly well over two lines when a
         * translation runs long.
         */
        .compare tbody th {
            white-space: nowrap;
            font-weight: 500;
            color: var(--fg-muted);
        }

        .compare thead th {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.03em;
            text-transform: uppercase;
            color: var(--fg-subtle);
        }

        /* Set apart, because it is the column you are not on. */
        .compare .mainnet {
            color: var(--fg-subtle);
            background: color-mix(in srgb, var(--fg-subtle) 6%, transparent);
        }

        .server {
            display: grid;
            grid-template-columns: auto 1fr;
            /*
             * Aligned on the text baseline, not the top of the box. The signing
             * key is set smaller so its 66 characters fit, and it wraps to two
             * lines -- both of which pushed its first line off the line its own
             * label sits on. Baselines put them back on the same line whatever
             * the value's size or height.
             */
            align-items: baseline;
            gap: 8px 20px;
            margin: 0;
            font-size: 13px;
        }

        /*
         * Every question mark on one vertical line.
         *
         * The labels already share a grid column, so pushing the insight to the
         * far edge of that column lands them all at the same x whatever the
         * label says -- which also survives translation, where the label
         * lengths change completely.
         */
        .server dt {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            color: var(--fg-muted);
        }

        .server dd {
            margin: 0;
            overflow-wrap: anywhere;
        }

        .server a {
            color: var(--accent);
            overflow-wrap: anywhere;
        }

        .live {
            font-variant-numeric: tabular-nums;
        }

        /* .mono, .inline and .subtle are global; only the size is local. */
        .key {
            font-size: 12px;
        }
    `,
})
export class NetworkDialog {
    readonly i18n = inject(I18nService);
    readonly networks = inject(NetworkService);
    readonly clock = inject(RoundClock);

    /** The preset's own name, which is not translated -- it is a proper noun. */
    label(preset: PresetName): string {
        return NETWORKS[preset].label;
    }

    note(preset: PresetName): keyof Messages {
        return CHAIN_NOTES[preset] ?? "insight.network";
    }

    blockTime(preset: PresetName): keyof Messages {
        return BLOCK_TIMES[preset] ?? "netDlg.blocks.mainnet";
    }

    /** Where to get coins for the network in use, when it has a faucet. */
    readonly faucet = computed(() => this.networks.current().faucetUrl);

    choose(preset: PresetName): void {
        this.networks.select(preset);
    }

    countdown(ms: number): string {
        return countdownText(ms);
    }

    /** The endpoint sends every number as a string. */
    sats(value: string | undefined): string {
        return this.i18n.sats(Number(value ?? 0));
    }

    number(value: string | undefined): number {
        return Number(value ?? 0);
    }

    /** Reads `i18n.locale()` through `duration`, so it re-renders on a switch. */
    readonly exitDelay = computed(() => {
        const delay = this.clock.facts()?.unilateralExitDelay;
        if (delay === undefined) return "";
        return this.i18n.duration(Number(delay) * 1000);
    });
}
