import {
    ChangeDetectionStrategy,
    Component,
    effect,
    inject,
    signal,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatIconModule } from "@angular/material/icon";
import { MatTooltipModule } from "@angular/material/tooltip";
import { toDataURL } from "qrcode";
import { type AddressParts, arkAddressParts } from "@firstsats/core";
import { ArkadeService } from "../core/arkade.service";
import { ChainService } from "../core/chain.service";
import { I18nService } from "../core/i18n.service";
import { Insight } from "../ui/insight";

/**
 * Receiving money.
 *
 * The two addresses are shown side by side and labelled by what they *do*
 * rather than what they are, because confusing them is the single most common
 * beginner mistake and no amount of protocol vocabulary prevents it.
 *
 * The boarding address carries a second warning that costs nothing to print and
 * saves an afternoon: signet, testnet3 and testnet4 all use the `tb1` prefix,
 * so the same address string is syntactically valid on three different chains.
 * Coins from a testnet faucet land on a chain this app does not watch, and the
 * balance stays at zero with nothing visibly wrong.
 */
@Component({
    selector: "app-receive",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatButtonModule,
        MatCardModule,
        MatIconModule,
        MatTooltipModule,
        Insight,
    ],
    template: `
        <mat-card appearance="outlined">
            <mat-card-header>
                <mat-card-title>{{ i18n.t("receive.heading") }}</mat-card-title>
            </mat-card-header>

            <mat-card-content>
                @if (arkade.addresses(); as addresses) {
                    <article class="addr">
                        <h3>
                            <mat-icon class="inline accent" aria-hidden="true">bolt</mat-icon>
                            {{ i18n.t("receive.arkadeLabel") }}
                            <app-insight [label]="i18n.t('insight.arkadeAddress.label')">
                                {{ i18n.t("insight.arkadeAddress") }}
                            </app-insight>
                        </h3>
                        <p class="subtle">{{ i18n.t("receive.arkadeHint") }}</p>
                        @if (arkadeQr(); as src) {
                            <img [src]="src" alt="" width="150" height="150" />
                        }
                        <div class="address">
                            <code>{{ addresses.arkade }}</code>
                            <button
                                matIconButton
                                class="copy"
                                [class.done]="copied() === addresses.arkade"
                                [matTooltip]="copyLabel(addresses.arkade)"
                                [attr.aria-label]="copyLabel(addresses.arkade)"
                                (click)="copy(addresses.arkade)"
                            >
                                <mat-icon>
                                    {{
                                        copied() === addresses.arkade
                                            ? "check"
                                            : "content_copy"
                                    }}
                                </mat-icon>
                            </button>
                        </div>

                        <!-- The address, taken apart. An arkade address is not
                             an opaque token: it is the server's key and yours,
                             encoded together. Showing both halves is the
                             clearest answer to why an address only works with
                             the server that issued it. -->
                        @if (parts(addresses.arkade); as inside) {
                            <details class="inside">
                                <summary>{{ i18n.t("receive.insideTitle") }}</summary>
                                <dl>
                                    <dt>{{ i18n.t("receive.insideServer") }}</dt>
                                    <dd class="mono">{{ inside.serverKey }}</dd>
                                    <dt>{{ i18n.t("receive.insideVtxo") }}</dt>
                                    <dd class="mono">{{ inside.vtxoKey }}</dd>
                                </dl>
                                <p class="subtle">{{ i18n.t("receive.insideNote") }}</p>
                            </details>
                        }
                    </article>

                    <article class="addr">
                        <h3>
                            <mat-icon class="inline accent" aria-hidden="true">link</mat-icon>
                            {{ i18n.t("receive.boardingLabel") }}
                            <app-insight [label]="i18n.t('insight.boardingAddress.label')">
                                {{ i18n.t("insight.boardingAddress") }}
                            </app-insight>
                        </h3>
                        <p class="subtle">{{ i18n.t("receive.boardingHint") }}</p>

                        <!--
                            The prefix trap. tb1 addresses are valid on signet,
                            testnet3 and testnet4 alike, so a faucet on the wrong
                            chain accepts this address happily and the coins land
                            somewhere this wallet will never look.
                        -->
                        <p class="chain-warning" role="note">
                            <mat-icon aria-hidden="true">warning</mat-icon>
                            <span>
                                {{ i18n.t("receive.chainWarning", arkade.network.name) }}
                            </span>
                        </p>

                        <div class="address">
                            <code>{{ addresses.boarding }}</code>
                            <button
                                matIconButton
                                class="copy"
                                [class.done]="copied() === addresses.boarding"
                                [matTooltip]="copyLabel(addresses.boarding)"
                                [attr.aria-label]="copyLabel(addresses.boarding)"
                                (click)="copy(addresses.boarding)"
                            >
                                <mat-icon>
                                    {{
                                        copied() === addresses.boarding
                                            ? "check"
                                            : "content_copy"
                                    }}
                                </mat-icon>
                            </button>
                            <!-- Rotation is automatic once an address is paid;
                                 this is for asking before that happens. -->
                            <button
                                matIconButton
                                class="copy"
                                [matTooltip]="i18n.t('receive.newAddress')"
                                [attr.aria-label]="i18n.t('receive.newAddress')"
                                (click)="arkade.freshBoardingAddress()"
                            >
                                <mat-icon>autorenew</mat-icon>
                            </button>
                        </div>
                        <p class="subtle reuse">
                            <mat-icon class="heading-icon" aria-hidden="true">shield</mat-icon>
                            <span>{{ i18n.t("receive.freshAddressNote") }}</span>
                        </p>
                    </article>

                    <!-- One control for both arrival paths. Off-chain
                         payments come from Arkade's event stream and on-chain
                         ones from a block explorer, but "tell me when money
                         turns up" is one intention and deserves one button. -->
                    <div class="watch">
                        @if (arkade.watching()) {
                            <span class="live" aria-live="polite">
                                <span class="pulse" aria-hidden="true"></span>
                                {{ i18n.t("receive.watching") }}
                            </span>
                            <button matButton (click)="stopWatching()">
                                <mat-icon>stop_circle</mat-icon>
                                {{ i18n.t("receive.stop") }}
                            </button>
                        } @else {
                            <button matButton="filled" (click)="startWatching()">
                                <mat-icon>notifications_active</mat-icon>
                                {{ i18n.t("receive.watch") }}
                            </button>
                            <app-insight [label]="i18n.t('insight.watch.label')">
                                {{ i18n.t("insight.watch") }}
                            </app-insight>
                        }
                    </div>

                    <p class="sr-only" role="status" aria-live="polite">
                        {{ copied() ? i18n.t("receive.copied") : "" }}
                    </p>

                    @if (result(); as message) {
                        <p class="result" role="status">
                            <mat-icon aria-hidden="true">check_circle</mat-icon>
                            <span>{{ message }}</span>
                        </p>
                    }
                } @else {
                    <p class="subtle">{{ i18n.t("common.loading") }}</p>
                }

                <!-- Inside this card, not beside it: where the coins come from
                     is part of receiving them, and a second card put a gap
                     between the address and the thing you paste it into. A
                     rule separates the two without spacing them apart. -->
                <section class="faucets-block">
                    <h3>
                        <mat-icon class="inline" aria-hidden="true">water_drop</mat-icon>
                        {{ i18n.t("chain.faucetsHeading") }}
                    </h3>
                    <p class="subtle">{{ i18n.t("chain.faucetsHint") }}</p>
                    <ul class="faucets">
                        @for (faucet of arkade.network.faucetUrls ?? []; track faucet) {
                            <li>
                                <mat-icon class="inline" aria-hidden="true">open_in_new</mat-icon>
                                <a [href]="faucet" target="_blank" rel="noopener noreferrer">
                                    {{ faucet }}
                                </a>
                            </li>
                        }
                    </ul>
                </section>
            </mat-card-content>
        </mat-card>
    `,
    styles: `
        .inside {
            margin-top: 12px;
            font-size: 13px;
        }

        .inside summary {
            cursor: pointer;
            color: var(--accent);
        }

        .inside dl {
            display: grid;
            gap: 2px 10px;
            margin: 10px 0;
        }

        .inside dt {
            font-weight: 600;
            color: var(--fg-muted);
        }

        .inside dd {
            margin: 0 0 8px;
            font-size: 12px;
            overflow-wrap: anywhere;
        }

        .inside p {
            margin: 0;
            line-height: 1.55;
        }

        .faucets-block {
            margin-top: 20px;
            padding-top: 16px;
            border-top: 1px solid var(--border);
        }

        .faucets {
            list-style: none;
            margin: 8px 0 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 6px;
            font-size: 13px;
        }

        .faucets li {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .faucets .mat-icon {
            color: var(--fg-subtle);
            flex: none;
        }

        .faucets a {
            color: var(--accent);
            overflow-wrap: anywhere;
        }

        :host {
            display: flex;
            flex-direction: column;
            gap: 18px;
        }

        h3 {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 14px;
            margin-bottom: 4px;
        }

        .mat-icon.accent {
            color: var(--accent);
        }

        .addr {
            padding: 16px;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            background: var(--surface);
            margin-bottom: 14px;
        }

        .addr img {
            display: block;
            margin: 12px 0;
            border-radius: var(--radius-sm);
            background: #ffffff;
            padding: 8px;
        }

        /*
         * The copy control lives in the address box rather than under it: it
         * acts on the string beside it, and a button a line below reads as a
         * step in the flow instead of an affordance on the value.
         */
        .address {
            display: flex;
            align-items: center;
            gap: 4px;
            margin: 10px 0 4px;
            padding: 4px 4px 4px 12px;
            border-radius: var(--radius-sm);
            background: var(--surface-raised);
            border: 1px solid var(--border);
        }

        .address code {
            flex: 1;
            min-width: 0;
            overflow-wrap: anywhere;
            line-height: 1.45;
        }

        .copy {
            flex: none;
            color: var(--fg-muted);
        }

        .copy:hover {
            color: var(--accent);
        }

        .copy.done {
            color: var(--success);
        }

        .sr-only {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
        }

        .reuse {
            display: flex;
            align-items: flex-start;
            gap: 6px;
            margin: 0;
            line-height: 1.5;
        }

        /*
         * Pinned to the text size rather than sized in em.
         *
         * An em-sized icon still carries Material's own 24px line-height, so
         * the glyph drew small inside a box far wider than itself and the
         * sentence started a quarter-inch away from it. Fixing all three axes
         * puts the shield right against the first word.
         */
        .reuse .mat-icon {
            flex: none;
            width: 16px;
            height: 16px;
            margin-top: 2px;
            font-size: 16px;
            line-height: 16px;
        }

        .chain-warning {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            margin: 12px 0 0;
            padding: 10px 12px;
            border-radius: var(--radius-sm);
            background: var(--warning-soft);
            color: var(--warning-on-soft);
            font-size: 12.5px;
            line-height: 1.5;
        }

        .chain-warning .mat-icon {
            flex: none;
            font-size: 18px;
            width: 18px;
            height: 18px;
            color: inherit;
        }

        .watch {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-top: 4px;
        }

        .live {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-size: 13.5px;
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

        .result {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 16px 0 0;
            padding: 12px 14px;
            border-radius: var(--radius-sm);
            background: var(--success-soft);
            color: var(--success-on-soft);
            font-size: 14px;
        }

        .result .mat-icon {
            color: inherit;
            flex: none;
        }
    `,
})
export class Receive {
    readonly arkade = inject(ArkadeService);
    readonly i18n = inject(I18nService);
    private readonly chain = inject(ChainService);

    readonly copied = signal<string | null>(null);
    readonly arkadeQr = signal<string | null>(null);

    constructor() {
        // Regenerate the QR whenever the address changes. QR generation is
        // async, hence the effect.
        effect(() => {
            const address = this.arkade.addresses()?.arkade;
            if (!address) {
                this.arkadeQr.set(null);
                return;
            }
            void toDataURL(address.toUpperCase(), {
                errorCorrectionLevel: "M",
                margin: 1,
                width: 300,
            })
                .then((url) => this.arkadeQr.set(url))
                .catch(() => this.arkadeQr.set(null));
        });
    }

    /**
     * Watch both arrival paths at once.
     *
     * `watchForFunds` resolves on money, on cancellation and on its own
     * timeout, so stopping the explorer poll in `finally` covers every way the
     * watch can end — the two never drift apart.
     */
    async startWatching(): Promise<void> {
        this.chain.start();
        try {
            await this.arkade.watchForFunds();
        } finally {
            this.chain.stop();
        }
    }

    stopWatching(): void {
        this.arkade.stopWatching();
        this.chain.stop();
    }

    /** Human-readable outcome of the last watch, or null while idle. */
    result(): string | null {
        const funds = this.arkade.lastReceived();
        if (funds === undefined) return null;
        if (funds === null) return this.i18n.t("receive.timeout");
        if (funds.type === "vtxo") {
            const total = funds.newVtxos.reduce((sum, v) => sum + v.value, 0);
            return this.i18n.t("receive.gotVtxo", this.i18n.sats(total));
        }
        const total = funds.coins.reduce((sum, c) => sum + c.value, 0);
        return this.i18n.t("receive.gotUtxo", this.i18n.sats(total));
    }

    /** Tooltip and accessible name for one address's copy control. */
    /** The server key and yours, as they sit inside the address. */
    parts(address: string): AddressParts | null {
        return arkAddressParts(address);
    }

    copyLabel(address: string): string {
        return this.copied() === address
            ? this.i18n.t("receive.copied")
            : this.i18n.t("receive.copy");
    }

    async copy(value: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(value);
            this.copied.set(value);
            setTimeout(() => this.copied.set(null), 2000);
        } catch {
            // Clipboard blocked; the address is selectable on screen anyway.
        }
    }
}
