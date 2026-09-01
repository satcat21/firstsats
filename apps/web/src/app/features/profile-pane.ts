import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    input,
    signal,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatDialog } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatTabsModule } from "@angular/material/tabs";
import { MatTooltipModule } from "@angular/material/tooltip";
import { firstValueFrom } from "rxjs";
import { ArkadeService } from "../core/arkade.service";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { ChainService } from "../core/chain.service";
import { I18nService } from "../core/i18n.service";
import { QuestService } from "../core/quest.service";
import {
    ACCENTS,
    type Accent,
    type Profile,
    ProfileService,
} from "../core/profile.service";
import { WalletOverview } from "./wallet-overview";
import { Receive } from "./receive";
import { Send } from "./send";
import { Activity } from "./activity";
import { Onboarding } from "./onboarding";
import { Tour, type TourTarget } from "./tour";

export type Tab = "tour" | "wallet" | "receive" | "send" | "activity";

const ALL_TABS: Tab[] = ["tour", "wallet", "receive", "send", "activity"];

export { ALL_TABS as TABS };

const TAB_ICONS: Record<Tab, string> = {
    tour: "explore",
    wallet: "account_balance_wallet",
    receive: "call_received",
    send: "send",
    activity: "receipt_long",
};

/**
 * One wallet, with everything it owns.
 *
 * This is where the app stops being a singleton. `ArkadeService` and
 * `ChainService` are provided *here* rather than at the root, so each pane gets
 * its own connection, its own address set and its own narration — which is what
 * makes a split view two wallets rather than one wallet drawn twice.
 *
 * The profile's colour and light/dark choice are applied to this subtree, not
 * to the document, so the two panes can disagree about both.
 */
@Component({
    selector: "app-profile-pane",
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [ArkadeService, ChainService],
    imports: [
        MatButtonModule,
        MatCardModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatTabsModule,
        MatTooltipModule,
        WalletOverview,
        Receive,
        Send,
        Activity,
        Onboarding,
        Tour,
    ],
    template: `
<!--
            The wallet's colour, not its theme. Light/dark is a page-wide
            setting; what varies per pane is identity, and the two derived
            tokens below are what carry it into every child component.
        -->
        <section
            class="pane"
            [style.--tint]="shown().accent.tint"
            [style.--ink]="shown().accent.ink"
            [attr.aria-label]="shown().name"
        >
            <header class="who">
                <span class="avatar" aria-hidden="true">{{ initial() }}</span>
                <div class="name">
                    <strong>{{ shown().name }}</strong>
                    <span class="subtle">{{ balanceLine() }}</span>
                </div>
                <span class="tools">
                    <!-- A toggle: pressing it again closes the panel and puts
                         back whatever was there before it opened. -->
                    <button
                        matIconButton
                        [class.open]="draft() !== null"
                        [matTooltip]="i18n.t('profile.edit')"
                        [attr.aria-label]="i18n.t('profile.edit')"
                        [attr.aria-expanded]="draft() !== null"
                        (click)="toggleEdit()"
                    >
                        <mat-icon>tune</mat-icon>
                    </button>
                    <!-- Only with two panes up: closing the last one would
                         leave the screen empty, so there is nothing to offer. -->
                    @if (profiles.split()) {
                        <button
                            matIconButton
                            [matTooltip]="i18n.t('profile.hide', shown().name)"
                            [attr.aria-label]="i18n.t('profile.hide', shown().name)"
                            (click)="profiles.hide(profile().id)"
                        >
                            <mat-icon>close</mat-icon>
                        </button>
                    }
                </span>
            </header>

            @if (draft(); as pending) {
                <mat-card appearance="outlined" class="editor">
                    <mat-card-content>
                        <label class="lbl" [attr.for]="'name-' + profile().id">
                            {{ i18n.t("profile.name") }}
                        </label>
                        <input
                            class="text"
                            [id]="'name-' + profile().id"
                            [value]="pending.name"
                            (input)="setName($event)"
                        />

                        <p class="lbl">{{ i18n.t("profile.colour") }}</p>
                        <div class="swatches">
                            @for (colour of accents; track colour.tint) {
                                <button
                                    class="swatch"
                                    [style.background]="colour.tint"
                                    [style.border-color]="colour.ink"
                                    [class.on]="pending.accent.tint === colour.tint"
                                    [attr.aria-label]="colour.tint"
                                    (click)="setAccent(colour)"
                                ></button>
                            }
                        </div>

                        <!--
                            Deleting lives here, beside the name and colour of
                            the user it deletes — in a shared menu the same item
                            means a different person depending on who is on
                            screen. It sits apart from Save and Cancel on the
                            far side of the row, so the destructive action is
                            never the one next to the pointer.
                        -->
                        <div class="row">
                            <button
                                matButton="filled"
                                [class.dirty]="dirty()"
                                (click)="save()"
                            >
                                <mat-icon>check</mat-icon>
                                {{ i18n.t("profile.save") }}
                                @if (dirty()) {
                                    <span
                                        class="pip"
                                        [attr.aria-label]="i18n.t('profile.unsaved')"
                                    ></span>
                                }
                            </button>
                            <button matButton (click)="toggleEdit()">
                                {{ i18n.t("common.cancel") }}
                            </button>
                            <button matButton class="danger" (click)="remove()">
                                <mat-icon>delete_forever</mat-icon>
                                {{ i18n.t("profile.removeNamed", profile().name) }}
                            </button>
                        </div>
                    </mat-card-content>
                </mat-card>
            }

            @switch (arkade.status()) {
                @case ("no-wallet") {
                    <!-- The user exists; the wallet is theirs to make. -->
                    <app-onboarding [profileId]="profile().id" />
                }
                @case ("connecting") {
                    <mat-card appearance="outlined">
                        <mat-card-content class="loading">
                            <mat-spinner diameter="18" />
                            <span class="muted">{{ i18n.t("common.loading") }}</span>
                        </mat-card-content>
                    </mat-card>
                }
                @case ("error") {
                    <mat-card appearance="outlined">
                        <mat-card-content>
                            <p class="err">
                                <mat-icon class="heading-icon" aria-hidden="true">error</mat-icon>
                                {{ arkade.error() }}
                            </p>
                        </mat-card-content>
                        <mat-card-actions>
                            <button matButton="filled" (click)="arkade.connect()">
                                <mat-icon>refresh</mat-icon>
                                {{ i18n.t("error.retry") }}
                            </button>
                        </mat-card-actions>
                    </mat-card>
                }
                @default {
                    <nav mat-tab-nav-bar [tabPanel]="panel" [mat-stretch-tabs]="false">
                        @for (item of tabs(); track item) {
                            <a mat-tab-link [active]="tab() === item" (click)="select(item)">
                                <mat-icon class="tab-icon">{{ icon(item) }}</mat-icon>
                                {{ i18n.t(navKey(item)) }}
                            </a>
                        }
                    </nav>

                    <mat-tab-nav-panel #panel>
                        @switch (tab()) {
                            @case ("tour") {
                                <app-tour (go)="select($event)" />
                            }
                            @case ("wallet") {
                                <app-wallet-overview />
                            }
                            @case ("receive") {
                                <app-receive />
                            }
                            @case ("send") {
                                <app-send />
                            }
                            @case ("activity") {
                                <app-activity />
                            }
                        }
                    </mat-tab-nav-panel>
                }
            }
        </section>
    `,
    styles: `
        :host {
            display: block;
            min-width: 0;
        }

        /*
         * The pane paints its own ground. Without this the tokens would come
         * from the document and both panes would share one theme, which defeats
         * the point of letting each profile choose.
         */
        /*
         * The wallet's colour, resolved per theme.
         *
         * On a light ground the dark ink is the readable one; on a dark ground
         * the pastel is. The button fill stays ink in both, because it always
         * carries a white label.
         */
        .pane {
            --accent: var(--ink);
            --accent-soft: color-mix(in srgb, var(--tint) 45%, transparent);
            --btn-fill: var(--ink);
            --btn-label: #ffffff;

            display: flex;
            flex-direction: column;
            gap: 16px;
            padding: 14px;
            border-radius: var(--radius);
            border: 1px solid color-mix(in srgb, var(--tint) 60%, var(--border));
            background: var(--bg);
            color: var(--fg);
            min-width: 0;
        }

        :host-context([data-theme="dark"]) .pane {
            --accent: var(--tint);
            --accent-soft: color-mix(in srgb, var(--tint) 20%, transparent);
        }

        .who {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        /* Ink on tint: the one pairing that reads the same in both themes. */
        .avatar {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 34px;
            height: 34px;
            flex: none;
            border-radius: 50%;
            background: var(--tint);
            color: var(--ink);
            font-weight: 700;
            font-size: 15px;
        }

        .name {
            display: flex;
            flex-direction: column;
            line-height: 1.25;
            flex: 1;
            min-width: 0;
        }

        .name .subtle {
            font-size: 12px;
        }

        /* Kept tight against each other, away from the name's 10px gap. */
        .tools {
            display: flex;
            align-items: center;
            flex: none;
            gap: 2px;
        }

        /* Smaller than the default, to sit against a two-line header.
           Centring is handled globally for every round icon button. */
        .tools button {
            --mat-icon-button-state-layer-size: 36px;
            flex: 0 0 36px;
        }

        .tools button .mat-icon {
            width: 20px;
            height: 20px;
            font-size: 20px;
            line-height: 20px;
        }

        .editor .lbl {
            display: block;
            margin: 0 0 6px;
            font-size: 12.5px;
            font-weight: 600;
            color: var(--fg-muted);
        }

        /* Pushed to the far end of the row, away from Save and Cancel. */
        .danger {
            margin-left: auto;
            color: var(--danger);
        }

        .editor .row {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 20px;
        }

        /*
         * An unsaved change is easy to miss when the pane previews it live —
         * the colour already looks applied. The pip says it is not committed
         * yet. Reduced motion gets a static dot rather than nothing, since the
         * dot is the message and the pulse is only emphasis.
         */
        .pip {
            /*
             * A flex child in the button's label, so it needs its size pinned
             * on both axes and its own alignment. Left to stretch it becomes a
             * tall bar, and a border-radius on a bar is a rounded rectangle.
             */
            display: inline-block;
            flex: 0 0 8px;
            align-self: center;
            box-sizing: border-box;
            width: 8px;
            min-width: 8px;
            height: 8px;
            margin-left: 8px;
            border-radius: 50%;
            background: #ffffff;
            box-shadow: 0 0 0 0 rgb(255 255 255 / 70%);
            animation: pip 1.6s ease-out infinite;
        }

        @keyframes pip {
            70% {
                box-shadow: 0 0 0 7px rgb(255 255 255 / 0%);
            }
            100% {
                box-shadow: 0 0 0 0 rgb(255 255 255 / 0%);
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .pip {
                animation: none;
            }
        }

        /* Pressed-in while the panel is open, so the toggle reads as a state. */
        /* A true circle now that the box it rounds is square. */
        .who button.open {
            background: var(--accent-soft);
            color: var(--accent);
            border-radius: 50%;
        }

        .text {
            width: 100%;
            padding: 8px 10px;
            margin-bottom: 16px;
            border-radius: var(--radius-sm);
            border: 1px solid var(--border-strong);
            background: var(--surface);
            color: var(--fg);
            font: inherit;
            font-size: 14px;
        }

        .swatches {
            display: flex;
            gap: 8px;
        }

        .swatch {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            border: 2px solid transparent;
            cursor: pointer;
            padding: 0;
        }

        .swatch.on {
            outline: 2px solid var(--fg);
            outline-offset: 2px;
        }

        .tab-icon {
            margin-right: 8px;
            font-size: 19px;
            width: 19px;
            height: 19px;
        }

        /*
         * The open tab wears the wallet's own colour, filled.
         *
         * A two-pixel underline was the only thing marking it, which reads as
         * decoration rather than as "you are here" -- and in a split view, where
         * two panes each have their own open tab, there was nothing tying the
         * marker to the wallet it belonged to. Filling it with that wallet's
         * tint answers both: it is unmistakably selected, and unmistakably
         * this user's.
         */
        .mat-mdc-tab-link {
            border-radius: var(--radius-sm) var(--radius-sm) 0 0;
            color: var(--fg-muted);
        }

        .mat-mdc-tab-link:hover {
            background: color-mix(in srgb, var(--tint) 28%, transparent);
            color: var(--fg);
        }

        .mat-mdc-tab-link.mdc-tab--active {
            background: var(--tint);
            color: var(--ink);
            font-weight: 650;
        }

        /* Material's own indicator, which cannot be reached any other way. */
        .mat-mdc-tab-link.mdc-tab--active
            ::ng-deep
            .mdc-tab-indicator__content--underline {
            border-color: var(--ink);
        }

        /*
         * The pair swaps over in the dark.
         *
         * Each wallet's colour is a light pastel and a dark ink, chosen to pair
         * on a white page: tint behind, ink on top. On a dark ground that same
         * pastel fill is a slab of daylight, so the roles trade -- the ink
         * fills the tab and the pastel does the writing.
         */
        :host-context([data-theme="dark"]) .mat-mdc-tab-link.mdc-tab--active {
            background: var(--ink);
            color: var(--tint);
        }

        :host-context([data-theme="dark"])
            .mat-mdc-tab-link.mdc-tab--active
            ::ng-deep
            .mdc-tab-indicator__content--underline {
            border-color: var(--tint);
        }

        :host-context([data-theme="dark"]) .mat-mdc-tab-link:hover {
            background: color-mix(in srgb, var(--ink) 55%, transparent);
        }

        .loading {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .err {
            display: flex;
            align-items: center;
            gap: 6px;
            margin: 0;
            color: var(--danger);
        }
    `,
})
export class ProfilePane {
    readonly profile = input.required<Profile>();

    readonly arkade = inject(ArkadeService);
    readonly i18n = inject(I18nService);
    readonly profiles = inject(ProfileService);
    private readonly quest = inject(QuestService);
    private readonly dialog = inject(MatDialog);

    /**
     * The tour tab disappears while the guide is docked beside the wallet.
     *
     * Two copies of the same thing on screen at once is worse than either
     * arrangement alone.
     */
    readonly tabs = computed(() =>
        this.docked() || this.quest.enabled()
            ? ALL_TABS.filter((t) => t !== "tour")
            : ALL_TABS
    );

    /** Set by the shell when the tour has its own column. */
    readonly docked = input(false);
    readonly accents = ACCENTS;
    readonly tab = signal<Tab>("tour");

    /**
     * The settings being edited, or `null` when the panel is closed.
     *
     * A draft rather than live writes: the panel previews a colour on the whole
     * pane, which is only fair if closing it without saving puts the old one
     * back. Holding the pending values here is what makes "unsaved" a real
     * state rather than a label on changes that already happened.
     */
    readonly draft = signal<{ name: string; accent: Accent } | null>(null);

    /** What the pane paints: the draft while editing, else the saved profile. */
    readonly shown = computed(() => this.draft() ?? this.profile());

    /** Whether the draft differs from what is stored. */
    readonly dirty = computed(() => {
        const pending = this.draft();
        if (!pending) return false;
        const saved = this.profile();
        return (
            pending.name.trim() !== saved.name ||
            pending.accent.tint !== saved.accent.tint
        );
    });

    /** The opening tab is chosen once; after that the reader is in charge. */
    private settled = false;

    readonly initial = computed(() => this.profile().name.charAt(0).toUpperCase());

    readonly balanceLine = computed(() => {
        const balance = this.arkade.balance();
        return balance ? this.i18n.sats(balance.available) : "—";
    });

    constructor() {
        // Reacts to the input, so a pane reused for a different profile
        // reconnects rather than showing the previous wallet's state.
        effect(() => {
            void this.arkade.adopt(this.profile());
        });

        /*
         * Choose the opening tab once, and only once.
         *
         * This deliberately never reads `tab()`. An earlier version did, and
         * since it also wrote it, clicking Tour on a funded wallet re-ran the
         * effect and bounced straight back to the dashboard — the tab was
         * unreachable for exactly the wallets whose owners had questions.
         */
        effect(() => {
            if (this.settled || this.arkade.status() !== "ready") return;
            this.settled = true;

            const stored = this.profiles.tabFor(this.profile().id);
            const remembered = this.tabs().includes(stored as Tab)
                ? (stored as Tab)
                : null;
            if (remembered) {
                this.tab.set(remembered);
                return;
            }
            // No history: money means the dashboard, empty means the tour,
            // which is the only screen that explains why it is empty.
            if ((this.arkade.balance()?.total ?? 0) > 0) this.tab.set("wallet");
        });

        // Docking and quest mode both take the tour tab away, sometimes from
        // under your feet. Written through `select` so the store moves too:
        // leaving "tour" behind there would have the effect below immediately
        // steer this pane back onto a tab that no longer exists, and the two
        // would loop until Angular gave up. That is what crashed on dropping
        // from split back to one user.
        effect(() => {
            if (!this.tabs().includes(this.tab())) this.select("wallet");
        });

        // The store is the source of truth, so the docked guide can steer this
        // pane without reaching into it. Only ever to a tab that is on screen.
        effect(() => {
            const wanted = this.profiles.tabFor(this.profile().id);
            if (wanted && wanted !== this.tab() && this.tabs().includes(wanted as Tab)) {
                this.tab.set(wanted as Tab);
            }
        });
    }

    select(tab: Tab): void {
        this.tab.set(tab);
        this.profiles.setTab(this.profile().id, tab);
    }

    icon(tab: Tab): string {
        return TAB_ICONS[tab];
    }

    navKey(tab: Tab): `nav.${Tab}` {
        return `nav.${tab}`;
    }

    /** Open with a snapshot, or close and throw the snapshot away. */
    toggleEdit(): void {
        this.draft.set(
            this.draft()
                ? null
                : { name: this.profile().name, accent: this.profile().accent }
        );
    }

    setName(event: Event): void {
        const name = (event.target as HTMLInputElement).value;
        this.draft.update((d) => (d ? { ...d, name } : d));
    }

    setAccent(accent: Accent): void {
        this.draft.update((d) => (d ? { ...d, accent } : d));
    }

    /**
     * Delete this user and the wallet they hold.
     *
     * Goes through `ArkadeService.forget`, which clears the wallet's own
     * database before dropping the profile — deleting the profile alone would
     * leave an orphaned store behind.
     */
    async remove(): Promise<void> {
        const profile = this.profile();
        const confirmed = await firstValueFrom(
            this.dialog
                .open(ConfirmDialog, {
                    width: "min(440px, calc(100vw - 32px))",
                    data: {
                        title: this.i18n.t("profile.removeTitle", profile.name),
                        message: this.i18n.t("profile.removeConfirm", profile.name),
                        confirmLabel: this.i18n.t("profile.removeNamed", profile.name),
                        cancelLabel: this.i18n.t("common.cancel"),
                        destructive: true,
                    },
                })
                .afterClosed()
        );
        if (confirmed) await this.arkade.forget();
    }

    save(): void {
        const pending = this.draft();
        if (!pending) return;
        // An empty name would leave the wallet unidentifiable; keep the old one.
        const name = pending.name.trim() || this.profile().name;
        this.profiles.update(this.profile().id, { name, accent: pending.accent });
        this.draft.set(null);
    }
}
