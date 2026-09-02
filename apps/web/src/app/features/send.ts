import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatButtonToggleModule } from "@angular/material/button-toggle";
import { MatInputModule } from "@angular/material/input";
import { short } from "@firstsats/core";
import { ArkadeService } from "../core/arkade.service";
import { ChainService, type SettlementFacts } from "../core/chain.service";
import { I18nService } from "../core/i18n.service";
import { Insight } from "../ui/insight";

/**
 * Sending money.
 *
 * The address and amount are checked by `FirstSatsAccount.send` — the same code
 * the CLI runs — rather than by form validators here, so the browser cannot
 * drift away from the rules the terminal enforces. The form's own validation is
 * limited to what a form can know: that the fields are filled in at all.
 */
@Component({
    selector: "app-send",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        FormsModule,
        MatButtonModule,
        MatCardModule,
        MatFormFieldModule,
        MatIconModule,
        MatButtonToggleModule,
        MatInputModule,
        Insight,
    ],
    template: `
        <mat-card appearance="outlined">
            <mat-card-header>
                <mat-card-title>{{ i18n.t("send.heading") }}</mat-card-title>
            </mat-card-header>

            <mat-card-content>
                <!--
                    Two destinations, one form. Paying an arkade address and
                    withdrawing to an on-chain one are different operations with
                    different rules, and putting them behind one address field
                    is how people end up paying the wrong kind of address.
                -->
                <mat-button-toggle-group
                    class="mode"
                    [hideSingleSelectionIndicator]="true"
                    [value]="mode()"
                    (valueChange)="setMode($event)"
                    [attr.aria-label]="i18n.t('send.heading')"
                >
                    <mat-button-toggle value="offchain">
                        <mat-icon>bolt</mat-icon>
                        {{ i18n.t("send.modeOffchain") }}
                    </mat-button-toggle>
                    <mat-button-toggle value="withdraw">
                        <mat-icon>logout</mat-icon>
                        {{ i18n.t("send.modeWithdraw") }}
                    </mat-button-toggle>
                </mat-button-toggle-group>

                @if (sentTxid(); as txid) {
                    <div class="done" role="status">
                        <p class="headline">
                            <mat-icon class="ok" aria-hidden="true">task_alt</mat-icon>
                            {{
                                withdrawing()
                                    ? i18n.t("send.withdrawSuccess")
                                    : i18n.t("send.success", i18n.sats(amount()))
                            }}
                        </p>
                        <p class="subtle">{{ i18n.t("send.txid") }}</p>
                        <code>{{ txid }}</code>

                        <!-- The numbers a withdrawal is actually judged by. Only
                             once the explorer has the transaction: predicting
                             them beforehand would mean guessing at a fee the
                             round had not decided yet. -->
                        @if (settlement(); as facts) {
                            <dl class="facts">
                                <dt>{{ i18n.t("send.arrived") }}</dt>
                                <dd>{{ i18n.sats(facts.arrived) }}</dd>
                                <dt>{{ i18n.t("send.minerFee") }}</dt>
                                <dd>{{ i18n.sats(facts.fee) }}</dd>
                            </dl>
                            <p class="subtle note">{{ i18n.t("send.feeShared") }}</p>
                        }
                        <p class="subtle note">
                            {{
                                withdrawing()
                                    ? i18n.t("send.withdrawDone")
                                    : i18n.t("send.noFeeNote")
                            }}
                            <app-insight [label]="i18n.t('insight.freePayment.label')">
                                {{ i18n.t("insight.freePayment") }}
                            </app-insight>
                        </p>
                        <button matButton="outlined" (click)="reset()">
                            <mat-icon>replay</mat-icon>
                            {{ i18n.t("send.again") }}
                        </button>
                    </div>
                } @else {
                    <form (ngSubmit)="submit()">
                        <mat-form-field appearance="outline" class="field">
                            <mat-label>{{
                                withdrawing()
                                    ? i18n.t("send.withdrawLabel")
                                    : i18n.t("send.addressLabel")
                            }}</mat-label>
                            <mat-icon matPrefix class="prefix">alternate_email</mat-icon>
                            <input
                                matInput
                                name="address"
                                autocomplete="off"
                                spellcheck="false"
                                class="mono"
                                [placeholder]="
                                    withdrawing()
                                        ? i18n.t('send.withdrawPlaceholder')
                                        : i18n.t('send.addressPlaceholder')
                                "
                                [(ngModel)]="address"
                                [disabled]="sending()"
                            />
                            <mat-hint>
                                <app-insight [label]="i18n.t('insight.sendAddress.label')">
                                    {{ i18n.t("insight.sendAddress") }}
                                </app-insight>
                                {{
                                    withdrawing()
                                        ? i18n.t("send.withdrawHint")
                                        : i18n.t("send.addressHint")
                                }}
                            </mat-hint>
                        </mat-form-field>

                        @if (!withdrawing()) {
                        <mat-form-field appearance="outline" class="field">
                            <mat-label>{{ i18n.t("send.amountLabel") }}</mat-label>
                            <mat-icon matPrefix class="prefix">payments</mat-icon>
                            <input
                                matInput
                                name="amount"
                                type="number"
                                min="1"
                                step="1"
                                inputmode="numeric"
                                class="mono"
                                [(ngModel)]="amount"
                                [disabled]="sending()"
                            />
                            <span matTextSuffix class="suffix">
                                {{ i18n.t("common.sats") }}
                            </span>
                            <mat-hint>
                                <app-insight [label]="i18n.t('insight.satoshi.label')">
                                    {{ i18n.t("insight.satoshi") }}
                                </app-insight>
                                @if (arkade.balance(); as balance) {
                                    {{
                                        i18n.t(
                                            "send.availableNote",
                                            i18n.sats(balance.available)
                                        )
                                    }}
                                }
                            </mat-hint>
                        </mat-form-field>
                        } @else {
                            <!-- No icon of its own. The line above already
                                 carries the one informational affordance here,
                                 and a second glyph saying "this is a note" beside
                                 a note competed with it for the same job. -->
                            <p class="subtle whole">
                                {{
                                    i18n.t(
                                        arkade.boardingConfirmed() > 0
                                            ? "send.withdrawWholeIncludingBoarding"
                                            : "send.withdrawWhole",
                                        i18n.sats(withdrawable())
                                    )
                                }}
                            </p>
                        }

                        <button
                            matButton="filled"
                            class="submit"
                            type="submit"
                            [disabled]="sending() || !address() || (!withdrawing() && amount() <= 0)"
                        >
                            <!-- One icon node swapped by name; a mat-icon inside
                                 @if/@else beside text never reaches the slot. -->
                            <mat-icon [class.spin]="sending()">
                                {{
                                    sending()
                                        ? "progress_activity"
                                        : withdrawing()
                                          ? "logout"
                                          : "send"
                                }}
                            </mat-icon>
                            {{ submitLabel() }}
                        </button>
                    </form>

                    @if (arkade.errorFrom("send", "offboard"); as message) {
                        <p class="error" role="alert">
                            <mat-icon class="inline" aria-hidden="true">error</mat-icon>
                            <span>{{ message }}</span>
                        </p>
                    }
                }
            </mat-card-content>
        </mat-card>
    `,
    styles: `
        .mode {
            margin-bottom: 16px;
        }

        /*
         * The chosen rail wears the wallet's own colour, and the other stands
         * down. Material's tick is switched off at the group rather than hidden
         * in CSS -- with the colour carrying the choice the tick was saying the
         * same thing twice, and it stole the space the icon needed.
         *
         * Only the label greys out, never the border: a control that looks
         * disabled is a control people stop trying to press, and this one is
         * very much still live.
         */
        .mode .mat-button-toggle.mat-button-toggle-checked,
        .mode .mat-button-toggle.mat-button-toggle-checked .mat-button-toggle-button {
            background: var(--tint);
            color: var(--ink);
        }

        .mode .mat-button-toggle:not(.mat-button-toggle-checked),
        .mode
            .mat-button-toggle:not(.mat-button-toggle-checked)
            .mat-button-toggle-button {
            background: transparent;
            color: var(--fg-subtle);
        }

        .mode .mat-button-toggle:not(.mat-button-toggle-checked):hover,
        .mode
            .mat-button-toggle:not(.mat-button-toggle-checked):hover
            .mat-button-toggle-button {
            color: var(--fg-muted);
        }

        /*
         * Indented onto the same column as the field's hint above it.
         *
         * Material insets a hint by the form field's own horizontal padding, so
         * the hint starts under the input text while a sibling paragraph starts
         * at the card edge -- two lines of the same explanation beginning at two
         * different left margins. Matching that inset lines them up.
         */
        .whole {
            margin: 6px 0 0;
            padding-left: 16px;
            line-height: 1.5;
        }

        form {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-top: 8px;
        }

        .field {
            width: 100%;
        }

        /*
         * 18px, matching the inline size used on the Receive screen and in
         * every card heading. These carried Material's default 24px, which
         * against a 16px input read as the icon being the subject and the field
         * its caption.
         */
        .prefix {
            margin-right: 8px;
            color: var(--fg-subtle);
            font-size: 18px;
            width: 18px;
            height: 18px;
        }

        /* The mode toggles, on the same footing as the labels beside them. */
        mat-button-toggle .mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
            margin-right: 2px;
        }

        .suffix {
            color: var(--fg-subtle);
            font-size: 13px;
        }

        input.mono {
            font-family: var(--font-mono);
        }

        mat-hint {
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .submit {
            align-self: flex-start;
            margin-top: 14px;
        }

        .spin {
            animation: spin 1.1s linear infinite;
        }

        @keyframes spin {
            to {
                transform: rotate(360deg);
            }
        }

        .done .headline {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 4px 0 14px;
            font-size: 20px;
            font-weight: 700;
        }

        .mat-icon.ok {
            color: var(--success);
        }

        code {
            display: block;
            margin: 4px 0 14px;
            padding: 10px 12px;
            border-radius: var(--radius-sm);
            background: var(--surface);
            border: 1px solid var(--border);
            overflow-wrap: anywhere;
        }

        .note {
            margin-bottom: 16px;
        }

        .error {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            margin: 14px 0 0;
            color: var(--danger);
            font-size: 13.5px;
        }

        .error .mat-icon {
            color: var(--danger);
            flex: none;
        }
    `,
})
export class Send {
    readonly arkade = inject(ArkadeService);
    readonly chain = inject(ChainService);
    readonly i18n = inject(I18nService);

    /**
     * What the completed withdrawal delivered and cost, once known.
     *
     * Null while it is being fetched, and null for good if the explorer cannot
     * answer -- the withdrawal is no less successful for it.
     */
    readonly settlement = signal<SettlementFacts | null>(null);

    /**
     * Everything a withdrawal will actually move.
     *
     * Confirmed boarding funds are included because the withdrawal onboards
     * them first; unconfirmed ones are not, because the server would reject the
     * batch that carried them.
     */
    readonly withdrawable = computed(
        () => (this.arkade.balance()?.available ?? 0) + this.arkade.boardingConfirmed()
    );

    /** Off-chain payment, or a collaborative exit back to the chain. */
    readonly mode = signal<"offchain" | "withdraw">("offchain");
    readonly withdrawing = computed(() => this.mode() === "withdraw");

    readonly submitLabel = computed(() => {
        if (this.sending()) return this.i18n.t("send.sending");
        return this.i18n.t(
            this.withdrawing() ? "send.withdrawSubmit" : "send.submit"
        );
    });

    readonly address = signal("");
    readonly amount = signal(1000);
    readonly sending = signal(false);
    readonly sentTxid = signal<string | null>(null);

    readonly short = short;

    setMode(mode: "offchain" | "withdraw"): void {
        this.mode.set(mode);
        // The two take different kinds of address; carrying one over is the
        // mistake this split exists to prevent.
        this.address.set("");
    }

    async submit(): Promise<void> {
        this.sending.set(true);
        const destination = this.address();
        try {
            const txid = this.withdrawing()
                ? await this.arkade.offboard(destination)
                : await this.arkade.send(destination, this.amount());
            this.sentTxid.set(txid);

            /*
             * What it actually cost, once there is a transaction to read it
             * from. Not awaited: the withdrawal has already succeeded, and the
             * numbers are an explanation rather than a result -- a slow or
             * unindexed explorer should not hold the confirmation on screen.
             */
            if (this.withdrawing()) {
                void this.chain
                    .settlement(txid, destination)
                    .then((facts) => this.settlement.set(facts));
            }
        } catch {
            // Surfaced through arkade.errorFrom() in the template.
        } finally {
            this.sending.set(false);
        }
    }

    reset(): void {
        this.sentTxid.set(null);
        this.settlement.set(null);
        this.address.set("");
    }
}
