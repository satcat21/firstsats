/**
 * The guided walkthrough.
 *
 * This is the web sibling of `firstsats tour`, and it keeps that command's one
 * good idea: it never tells you to do something you have already done. The
 * chapters are fixed, but which one is *current* is derived from real wallet
 * state — no wallet, empty wallet, money stuck on-chain, money spendable — so
 * the tour tracks what you actually did rather than counting button presses.
 *
 * An accordion renders it, not a stepper. A stepper header only ever *selects*:
 * clicking the open chapter does nothing, there is no closed state to return
 * to, and it relabels visited steps with a pencil. All three needed working
 * around. An expansion panel toggles, which is what these chapters actually do
 * — the step number and the completion mark are drawn in the header rather than
 * borrowed from a stepper's indicator.
 */

import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    output,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatExpansionModule } from "@angular/material/expansion";
import { MatIconModule } from "@angular/material/icon";
import { MatTooltipModule } from "@angular/material/tooltip";
import { I18nService } from "../core/i18n.service";
import type { Messages } from "../core/messages";
import { ProfileService } from "../core/profile.service";
import { QuestService } from "../core/quest.service";
import { WalletRegistry } from "../core/wallet-registry";
import {
    DiagramExit,
    DiagramNetwork,
    DiagramRails,
    DiagramSend,
    DiagramSettle,
    DiagramTransactions,
    DiagramTree,
} from "../ui/diagrams";

/** Which tab to send the reader to when a chapter has an action attached. */
export type TourTarget = "wallet" | "receive" | "send" | "activity";

/** The fixed chapters, in the order a newcomer should meet them. */
export type ChapterId =
    | "why"
    | "pieces"
    | "anatomy"
    | "wallet"
    | "receive"
    | "onboard"
    | "send"
    | "exit"
    | "network";

const CHAPTERS: readonly ChapterId[] = [
    "why",
    "pieces",
    "anatomy",
    "wallet",
    "receive",
    "onboard",
    "send",
    "exit",
    "network",
];

/** The Material Symbol on each chapter's call to action. */
const CHAPTER_ICONS: Record<ChapterId, string> = {
    why: "help_center",
    pieces: "account_tree",
    anatomy: "schema",
    wallet: "key",
    receive: "call_received",
    onboard: "swap_horiz",
    send: "send",
    exit: "logout",
    network: "hub",
};

/** The tab a chapter's button jumps to, or null for the reading chapters. */
const CHAPTER_TARGETS: Partial<Record<ChapterId, TourTarget>> = {
    wallet: "wallet",
    receive: "receive",
    // Onboarding lives in the boarding section of the wallet tab, not on
    // Receive: the reader is acting on coins they already hold, not waiting
    // for new ones.
    onboard: "wallet",
    send: "send",
};

/** Where the reader has got to, judged from the wallet rather than from clicks. */
export type Progress = "done" | "current" | "todo";

/**
 * Decide the state of every chapter from wallet state.
 *
 * Exported and pure so the rule is testable without an Angular harness, the
 * same way `nextStep` is on the CLI side.
 */
export function progressFor(state: {
    hasWallet: boolean;
    total: number;
    boarding: number;
    available: number;
    sentAnything: boolean;
    /** Whether this user has taken money back to the chain. */
    withdrew: boolean;
    /** Chapters the reader has opened at least once. */
    visited: ReadonlySet<ChapterId>;
}): Record<ChapterId, Progress> {
    const done = (value: boolean): Progress => (value ? "done" : "todo");
    // A reading chapter is finished when it has been read. Marking them
    // complete unconditionally was fine while they all sat at the front of the
    // tour and read as "already passed", and became wrong the moment one was
    // added at the end: a tick on the last chapter of a tour nobody had opened.
    const read = (id: ChapterId): Progress => done(state.visited.has(id));

    const progress: Record<ChapterId, Progress> = {
        why: read("why"),
        pieces: read("pieces"),
        anatomy: read("anatomy"),
        wallet: done(state.hasWallet),
        receive: done(state.total > 0),
        onboard: done(state.hasWallet && state.total > 0 && state.boarding === 0),
        send: done(state.sentAnything),
        // Only the cooperative exit can be completed here. A unilateral one
        // waits out the server's CSV delay — days on this deployment — so the
        // chapter teaches it and the tick tracks the exit you can actually do.
        exit: done(state.withdrew),
        network: read("network"),
    };

    // Exactly one chapter is "current": the first one still outstanding.
    const next = CHAPTERS.find((id) => progress[id] === "todo");
    if (next) progress[next] = "current";
    return progress;
}

@Component({
    selector: "app-tour",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatButtonModule,
        MatCardModule,
        MatExpansionModule,
        MatIconModule,
        MatTooltipModule,
        DiagramRails,
        DiagramTree,
        DiagramTransactions,
        DiagramSend,
        DiagramSettle,
        DiagramExit,
        DiagramNetwork,
    ],
    template: `
        <mat-card appearance="outlined">
            <mat-card-header>
                <mat-card-title>
                    <!-- Only as a column of its own. Inside a tab the tab is
                         already the label, and no other tab's card carries an
                         icon before its title -- one that did would look like a
                         different kind of panel rather than a distinguished
                         one. Docked, it stands alone beside the wallet and has
                         nothing else naming it. -->
                    @if (docked()) {
                        <mat-icon class="heading-icon" aria-hidden="true">explore</mat-icon>
                    }
                    {{ i18n.t("tour.heading") }}
                </mat-card-title>

                <!-- The control that moves this panel sits on the panel it
                     moves, rather than in the app's header bar, so it is where
                     you are looking when you decide you want the guide
                     somewhere else. In the card's own header row so it lines up
                     with the title rather than being positioned against the
                     card's corner. Absent with two wallets on screen: there is
                     no third column to dock into. -->
                @if (canDock()) {
                    <button
                        matIconButton
                        class="dock-toggle"
                        [matTooltip]="i18n.t(docked() ? 'tour.undock' : 'tour.dock')"
                        [attr.aria-label]="i18n.t(docked() ? 'tour.undock' : 'tour.dock')"
                        [attr.aria-pressed]="docked()"
                        (click)="toggleDock()"
                    >
                        <mat-icon>{{
                            docked() ? "close_fullscreen" : "vertical_split"
                        }}</mat-icon>
                    </button>
                }
            </mat-card-header>

            <mat-card-content>
                <p class="subtle blurb">
                    {{ i18n.t("tour.blurb", chapters.length) }}
                </p>

                <mat-accordion class="chapters" [multi]="false">
                    @for (id of chapters; track id) {
                        <mat-expansion-panel
                            [expanded]="opened() === id"
                            (opened)="pick(id)"
                            (closed)="onClosed(id)"
                        >
                            <mat-expansion-panel-header>
                                <mat-panel-title>
                                    <span class="num" [class]="progress()[id]">
                                        {{ index(id) + 1 }}
                                    </span>
                                    {{ i18n.t(titleKey(id)) }}
                                </mat-panel-title>
                                <mat-panel-description>
                                    @switch (progress()[id]) {
                                        @case ("done") {
                                            <mat-icon
                                                class="tick done"
                                                [attr.aria-label]="i18n.t('tour.done')"
                                                >check_circle</mat-icon
                                            >
                                        }
                                        @case ("current") {
                                            <mat-icon
                                                class="tick current"
                                                [attr.aria-label]="i18n.t('tour.current')"
                                                >radio_button_checked</mat-icon
                                            >
                                        }
                                        @default {
                                            <mat-icon
                                                class="tick todo"
                                                [attr.aria-label]="i18n.t('tour.todo')"
                                                >radio_button_unchecked</mat-icon
                                            >
                                        }
                                    }
                                </mat-panel-description>
                            </mat-expansion-panel-header>

                            <div class="chapter">
                                <p>{{ i18n.t(bodyKey(id)) }}</p>

                                @switch (id) {
                                    @case ("why") {
                                        <app-diagram-rails />
                                        <p>{{ i18n.t("tour.why.body2") }}</p>
                                    }
                                    @case ("pieces") {
                                        <app-diagram-tree />
                                        <p>{{ i18n.t("tour.pieces.body2") }}</p>
                                        <app-diagram-settle />
                                    }
                                    @case ("anatomy") {
                                        <app-diagram-transactions />
                                        <p>{{ i18n.t("tour.anatomy.body2") }}</p>
                                    }
                                    @case ("send") {
                                        <app-diagram-send />
                                    }
                                    @case ("network") {
                                        <p>{{ i18n.t("tour.network.body2") }}</p>
                                        <app-diagram-network />
                                        <p>{{ i18n.t("tour.network.body3") }}</p>
                                        <p>{{ i18n.t("tour.network.body4") }}</p>
                                    }
                                    @case ("exit") {
                                        <app-diagram-exit />
                                        <p>{{ i18n.t("tour.exit.body2") }}</p>
                                        <p>{{ i18n.t("tour.exit.body3") }}</p>
                                    }
                                }

                                <div class="actions">
                                    @if (target(id); as tab) {
                                        <button matButton="filled" (click)="goTo(tab)">
                                            <mat-icon>{{ icon(id) }}</mat-icon>
                                            {{ i18n.t(ctaKey(id)) }}
                                        </button>
                                    }
                                    @if (index(id) > 0) {
                                        <button matButton (click)="step(id, -1)">
                                            <mat-icon>arrow_back</mat-icon>
                                            {{ i18n.t("tour.prev") }}
                                        </button>
                                    }
                                    @if (index(id) < chapters.length - 1) {
                                        <button matButton (click)="step(id, 1)">
                                            <mat-icon iconPositionEnd>arrow_forward</mat-icon>
                                            {{ i18n.t("tour.next") }}
                                        </button>
                                    }
                                </div>
                            </div>
                        </mat-expansion-panel>
                    }
                </mat-accordion>
            </mat-card-content>
        </mat-card>
    `,
    styles: `
        :host {
            display: block;
        }

        /*
         * The header is the row, so the toggle sits on the title's line by
         * construction. Absolute positioning against the card's corner put it
         * near the title without ever being level with it.
         */
        mat-card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }

        /* Never squeezed by a title long enough to wrap. */
        .dock-toggle {
            flex: none;
        }

        .blurb {
            margin: 6px 0 14px;
        }

        .chapters {
            display: block;
        }

        mat-expansion-panel {
            background: var(--surface);
            border: 1px solid var(--border);
            box-shadow: none !important;
            margin-bottom: 8px;
        }

        mat-panel-title {
            display: flex;
            align-items: center;
            gap: 10px;
            font-weight: 600;
        }

        /*
         * Right-aligned and only as wide as the mark it holds. The right margin
         * is Material's own default and has to stay: it is the gap between this
         * mark and the expand chevron, which sits immediately after it.
         */
        mat-panel-description {
            flex-grow: 0;
            justify-content: flex-end;
            margin-right: 16px;
        }

        /* The step number, drawn here rather than borrowed from a stepper. */
        .num {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: none;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: var(--surface-raised);
            border: 1px solid var(--border-strong);
            color: var(--fg-muted);
            font-size: 12px;
            font-weight: 700;
        }

        .num.done {
            background: var(--success-soft);
            border-color: var(--success);
            color: var(--success-on-soft);
        }

        .num.current {
            background: var(--btn-fill);
            border-color: var(--btn-fill);
            color: var(--btn-label);
        }

        .tick {
            font-size: 18px;
            width: 18px;
            height: 18px;
        }

        .tick.done {
            color: var(--success);
        }

        .tick.current {
            color: var(--accent);
        }

        .tick.todo {
            color: var(--fg-subtle);
        }

        .chapter {
            min-width: 0;
        }

        .chapter p {
            margin: 0 0 12px;
            color: var(--fg-muted);
            line-height: 1.6;
            max-width: 62ch;
        }

        .actions {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 18px;
            padding-top: 14px;
            border-top: 1px solid var(--border);
        }
    `,
})
export class Tour {
    readonly i18n = inject(I18nService);
    private readonly profiles = inject(ProfileService);
    private readonly quest = inject(QuestService);
    private readonly wallets = inject(WalletRegistry);

    /**
     * Whether docking is on offer at all.
     *
     * A desktop, single-wallet affordance: with two wallets side by side the
     * guide has no third column to move into, and quest mode owns the layout.
     */
    readonly canDock = computed(() => !this.profiles.split() && !this.quest.enabled());

    /** Where this panel currently is, mirroring the app shell's own test. */
    readonly docked = computed(() => this.profiles.tourDocked() && this.canDock());

    toggleDock(): void {
        this.profiles.setTourDocked(!this.profiles.tourDocked());
    }

    readonly chapters = CHAPTERS;

    /** Emitted when a chapter's call to action should switch tabs. */
    readonly go = output<TourTarget>();

    /**
     * Send the reader to the screen a chapter is about.
     *
     * Writes the tab through the profile store as well as emitting, so it works
     * whether the guide is a tab inside a pane or a column beside it.
     */
    goTo(tab: TourTarget): void {
        const profile = this.focus();
        if (profile) this.profiles.setTab(profile.id, tab);
        this.go.emit(tab);
    }

    /**
     * The wallet this guide is describing: the first one on screen.
     *
     * Read from the shared registry rather than from a pane's `ArkadeService`,
     * because the guide can be docked in the shell where no pane injector
     * exists. Injecting one there threw NG0201 and rendered nothing at all.
     */
    private readonly focus = computed(() => this.profiles.visible()[0]);

    private readonly snapshot = computed(() => {
        const profile = this.focus();
        return profile ? this.wallets.get(profile.id) : undefined;
    });

    readonly progress = computed(() => {
        const wallet = this.snapshot();
        return progressFor({
            hasWallet: Boolean(this.focus()?.mnemonic),
            total: wallet?.total ?? 0,
            boarding: wallet?.boarding ?? 0,
            available: wallet?.available ?? 0,
            sentAnything: (wallet?.sent ?? 0) > 0,
            withdrew: Boolean(this.focus()?.withdrawn),
            visited: this.profiles.visitedChapters() as ReadonlySet<ChapterId>,
        });
    });

    /**
     * The reader's choice: a chapter, `null` for all closed, `undefined` for
     * "has not chosen yet".
     *
     * Three states rather than two, because closing the last open chapter has
     * to stick. With only a chapter-or-nothing signal, `null` would fall back
     * to the wallet-derived chapter and the panel would spring open again.
     *
     * Stored outside this component so it survives the guide being unmounted,
     * which happens on every tab change away from it.
     */
    readonly picked = computed<ChapterId | null | undefined>(() => {
        const stored = this.profiles.openChapter();
        if (stored === undefined || stored === null) return stored;
        return CHAPTERS.includes(stored as ChapterId)
            ? (stored as ChapterId)
            : undefined;
    });

    pick(id: ChapterId): void {
        this.profiles.setChapter(id);
        this.profiles.markVisited(id);
    }

    /** Which chapter is open, or `null` when the reader has closed them all. */
    readonly opened = computed<ChapterId | null>(() => {
        const picked = this.picked();
        if (picked !== undefined) return picked;
        return CHAPTERS.find((id) => this.progress()[id] === "current") ?? "why";
    });

    /**
     * Clear only if this panel is still the open one.
     *
     * Opening another chapter closes this one, and that `closed` event fires
     * after the new `opened` — clearing unconditionally would shut the panel
     * the reader just asked for.
     */
    onClosed(id: ChapterId): void {
        if (this.opened() === id) this.profiles.setChapter(null);
    }

    step(from: ChapterId, delta: number): void {
        const next = CHAPTERS[this.index(from) + delta];
        if (next) this.pick(next);
    }

    index(id: ChapterId): number {
        return CHAPTERS.indexOf(id);
    }

    icon(id: ChapterId): string {
        return CHAPTER_ICONS[id];
    }

    titleKey(id: ChapterId): keyof Messages {
        return `tour.${id}.title` as keyof Messages;
    }

    bodyKey(id: ChapterId): keyof Messages {
        return `tour.${id}.body` as keyof Messages;
    }

    ctaKey(id: ChapterId): keyof Messages {
        return `tour.${id}.cta` as keyof Messages;
    }

    target(id: ChapterId): TourTarget | null {
        return CHAPTER_TARGETS[id] ?? null;
    }
}
