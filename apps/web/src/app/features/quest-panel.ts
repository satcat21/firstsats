import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    signal,
    viewChild,
} from "@angular/core";
import { firstValueFrom } from "rxjs";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatDialog } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatTooltipModule } from "@angular/material/tooltip";
import { I18nService } from "../core/i18n.service";
import type { Messages } from "../core/messages";
import { ACCENTS } from "../core/profile.service";
import { QUESTS, type QuestId, QuestService } from "../core/quest.service";
import { Confetti } from "../ui/confetti";
import { ConfirmDialog } from "../ui/confirm-dialog";

/**
 * The quest run.
 *
 * Shows one task at a time, because a list of ten is a wall and a single
 * instruction is a thing you can do. What is already done stays visible as
 * ticks, since the point of the run is watching the path fill in.
 *
 * Nothing here can mark a quest complete — the service decides that by watching
 * wallet state, and this only reports it.
 */
@Component({
    selector: "app-quest-panel",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatButtonModule,
        MatCardModule,
        MatIconModule,
        MatProgressBarModule,
        MatTooltipModule,
        Confetti,
    ],
    template: `
        <mat-card appearance="outlined" class="quest">
            <mat-card-content>
                <header>
                    <p class="lane">
                        <mat-icon class="heading-icon" aria-hidden="true">
                            flag
                        </mat-icon>
                        {{ i18n.t("quest.heading") }}
                    </p>
                    <p class="score">
                        <strong>{{ quest.points() }}</strong>
                        <span class="subtle">/ {{ quest.totalPoints }}</span>
                    </p>
                </header>

                <mat-progress-bar
                    mode="determinate"
                    [value]="percent()"
                    [attr.aria-label]="i18n.t('quest.heading')"
                />

                <!--
                    Backwards only. A solved task is worth re-reading -- the
                    explanation is the point of the run, and it scrolls away the
                    moment it is finished -- but reading ahead would hand over
                    the answer to a step judged by whether you worked it out.
                -->
                <div class="task-row">
                    <button
                        matIconButton
                        class="step-nav"
                        [disabled]="!canBack()"
                        [matTooltip]="i18n.t('quest.reviewPrev')"
                        [attr.aria-label]="i18n.t('quest.reviewPrev')"
                        (click)="back()"
                    >
                        <mat-icon>arrow_back</mat-icon>
                    </button>

                    @if (shownTask(); as task) {
                        <div class="task" role="status">
                            <p class="step">
                                {{ i18n.t("quest.step", shown() + 1, quests.length) }}
                                · +{{ task.points }}
                                @if (reviewing()) {
                                    <span class="reviewing">
                                        {{ i18n.t("quest.reviewing") }}
                                    </span>
                                }
                            </p>
                            <h3>{{ i18n.t(titleKey(task.id)) }}</h3>
                            <p class="hint">{{ i18n.t(hintKey(task.id)) }}</p>
                        </div>
                    } @else {
                        <div class="task done" role="status">
                            <h3>
                                <mat-icon class="heading-icon" aria-hidden="true">
                                    emoji_events
                                </mat-icon>
                                {{ i18n.t("quest.completeTitle") }}
                            </h3>
                            <p class="hint">{{ i18n.t("quest.completeBody") }}</p>
                        </div>
                    }

                    <button
                        matIconButton
                        class="step-nav"
                        [disabled]="!canForward()"
                        [matTooltip]="i18n.t('quest.reviewNext')"
                        [attr.aria-label]="i18n.t('quest.reviewNext')"
                        (click)="forward()"
                    >
                        <mat-icon>arrow_forward</mat-icon>
                    </button>
                </div>

                <!-- Restart and the step row share a line: stacked, they left a
                     band of empty card under a row of eleven small glyphs. -->
                <div class="foot">
                    <button matButton class="reset" (click)="restart()">
                        <mat-icon>replay</mat-icon>
                        {{ i18n.t("quest.restart") }}
                    </button>

                    <ol class="ticks">
                    @for (task of quests; track task.id; let i = $index) {
                        <!-- Tooltip on the item, not the button: a disabled
                             button receives no pointer events, and the steps
                             that cannot be opened are exactly the ones whose
                             tooltip has something to explain. -->
                        <li
                            [class.on]="quest.done().has(task.id)"
                            [class.here]="i === index()"
                            [class.looking]="i === shown() && reviewing()"
                            [matTooltip]="
                                i <= index()
                                    ? i18n.t(titleKey(task.id))
                                    : i18n.t('quest.locked')
                            "
                        >
                            <button
                                type="button"
                                class="tick"
                                [disabled]="i > index()"
                                [attr.aria-label]="i18n.t(titleKey(task.id))"
                                [attr.aria-current]="i === shown() ? 'step' : null"
                                (click)="goTo(i)"
                            >
                                <!-- Three states, three glyphs: done, the one to
                                     do now, and the ones not reached. A filled
                                     centre marks the live step without drawing
                                     anything around the icon. -->
                                <mat-icon>
                                    {{
                                        quest.done().has(task.id)
                                            ? "check_circle"
                                            : i === index()
                                              ? "radio_button_checked"
                                              : "radio_button_unchecked"
                                    }}
                                </mat-icon>
                            </button>
                        </li>
                    }
                    </ol>
                </div>
            </mat-card-content>
        </mat-card>

        <app-confetti />
    `,
    styles: `
        /*
         * Clear of the header, and no wider than its own contents need.
         *
         * The card used to take the full page width, which in a split view is
         * 1500px -- so a step title, one paragraph capped at 62ch and a row of
         * eleven glyphs sat in a band with half of it empty, and the emptiness
         * read as something missing rather than as margin. Capped and centred,
         * it is a banner about the whole run rather than a stretched panel.
         *
         * Above the single-pane width, so nothing changes when only one wallet
         * is on screen.
         */
        :host {
            display: block;
            max-width: 900px;
            margin: 18px auto 0;
        }

        header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 10px;
        }

        .lane {
            display: flex;
            align-items: center;
            gap: 7px;
            margin: 0;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--fg-muted);
        }

        .score {
            margin: 0;
            font-variant-numeric: tabular-nums;
        }

        .score strong {
            font-size: 20px;
            color: var(--accent);
        }

        mat-progress-bar {
            border-radius: 999px;
        }

        /*
         * Arrows on the outside edges, task between them. The task takes the
         * slack so the two buttons stay put as the text changes length -- an
         * arrow that moves when you press it is hard to press twice.
         */
        .task-row {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .task-row .step-nav {
            flex: none;
        }

        .task {
            flex: 1;
            min-width: 0;
            margin-top: 16px;
        }

        /*
         * Invisible at the ends rather than removed. There is nothing before
         * the first task or after the current one, so no arrow should be
         * offered -- but taking the button out of the flow would slide the text
         * sideways as you page through, and the other arrow would move under
         * the cursor between presses.
         */
        .step-nav:disabled {
            visibility: hidden;
        }

        .reviewing {
            margin-left: 6px;
            padding: 1px 7px;
            border-radius: 999px;
            background: var(--success-soft);
            color: var(--success-on-soft);
            letter-spacing: 0.04em;
        }

        .step {
            margin: 0 0 4px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--fg-subtle);
        }

        h3 {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 16px;
            margin-bottom: 6px;
        }

        .hint {
            margin: 0;
            color: var(--fg-muted);
            line-height: 1.6;
            max-width: 62ch;
        }

        /*
         * A centred row at its own size, not one column per task.
         *
         * Stretching eleven glyphs across the full card put a finger-width of
         * empty space between each, which reads as eleven unrelated marks
         * rather than as one run of steps. Left-aligning them instead left the
         * rest of the card conspicuously empty. Centred at natural width is
         * the version that looks deliberate at any card size, and it wraps
         * rather than crushing the spacing when the panel is narrow.
         */
        .ticks {
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 6px 10px;
            list-style: none;
            margin: 0;
            padding: 0;
        }

        /*
         * Restart left, steps centred, on one line.
         *
         * Equal 1fr flanks with the row in an auto middle column: the steps
         * stay on the card's centre rather than drifting with the width of a
         * translated button label. The third column is empty on purpose -- it
         * is what balances the first.
         */
        .foot {
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            align-items: center;
            gap: 12px;
            margin-top: 18px;
            /*
             * The measure the step row sizes itself against. The card is what
             * the row has to fit inside, and on a phone that is a good deal
             * narrower than the viewport -- three nested boxes narrower -- so
             * the viewport is the wrong thing to ask.
             */
            container-type: inline-size;
        }

        .foot .reset {
            justify-self: start;
        }

        @media (max-width: 620px) {
            /* No room for three regions; the steps take the line back. */
            .foot {
                grid-template-columns: minmax(0, 1fr);
                justify-items: center;
                gap: 10px;
            }

            .foot .reset {
                justify-self: center;
            }

            /*
             * One line, whatever the count.
             *
             * Eleven 20px glyphs with 10px between them want 320px, and a phone
             * card has about 310 -- so the row wrapped, and a single mark on a
             * second line reads as a twelfth step that went wrong rather than
             * as the end of the first line. Both the glyph and the gap are now
             * measured against the card, which keeps the run on one line here
             * and would keep a twelfth step on it too.
             */
            .ticks {
                flex-wrap: nowrap;
                gap: clamp(2px, 1.1cqi, 10px);
                width: 100%;
            }

            .ticks li {
                min-width: 0;
            }

            .ticks .mat-icon {
                font-size: clamp(14px, 5.8cqi, 20px);
                width: clamp(14px, 5.8cqi, 20px);
                height: clamp(14px, 5.8cqi, 20px);
            }
        }

        /* A button with none of a button's chrome: the glyph is the control. */
        .tick {
            display: block;
            padding: 0;
            border: 0;
            background: none;
            line-height: 0;
            cursor: pointer;
            color: inherit;
        }

        /* Still hoverable, so the tooltip can say why it does nothing. */
        .tick:disabled {
            cursor: default;
        }

        .tick:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 3px;
            border-radius: 50%;
        }

        .ticks .mat-icon {
            font-size: 20px;
            width: 20px;
            height: 20px;
            color: var(--fg-subtle);
        }

        .ticks li.on .mat-icon {
            color: var(--success);
        }

        /*
         * Where the run has got to. Colour and a filled centre rather than a
         * ring: a circle drawn around a circular glyph reads as a smudge, and
         * on a finished run -- every step green -- it was the only mark on the
         * row and looked like damage.
         */
        .ticks li.here .mat-icon {
            color: var(--accent);
        }

        /*
         * And where you have scrolled back to, which is a different question.
         * A disc behind the glyph, so it reads as the one picked out of the
         * row rather than as another kind of step.
         *
         * Not --accent-soft, which is tuned for filling a panel: at 16% over a
         * near-black ground it left the marker invisible in dark mode, and the
         * one thing this disc has to do is say where you are. An opaque mix
         * over the surface sits at the same weight in both themes, and the
         * ring gives it an edge on the ground it is closest to.
         */
        .ticks li.looking {
            border-radius: 50%;
            background: color-mix(in srgb, var(--accent) 22%, var(--surface));
            box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--accent) 60%, transparent);
            /* Negative margin keeps the row's spacing while the disc has room. */
            padding: 3px;
            margin: -3px;
        }

        .reset {
            color: var(--fg-muted);
        }
    `,
})
export class QuestPanel {
    readonly quest = inject(QuestService);
    readonly i18n = inject(I18nService);

    readonly quests = QUESTS;

    private readonly confetti = viewChild.required(Confetti);

    readonly index = computed(() => {
        const current = this.quest.current();
        return current ? QUESTS.findIndex((q) => q.id === current.id) : QUESTS.length;
    });

    /**
     * Which step is on screen, or null while it simply follows the run.
     *
     * Null rather than a copy of {@link index}, so finishing a task moves the
     * panel on by itself: a reader who never touches the arrows should never
     * find the panel stuck on a step they have already done.
     */
    private readonly viewing = signal<number | null>(null);

    /** The step being shown: the one under review, else the live one. */
    readonly shown = computed(() => Math.min(this.viewing() ?? this.index(), QUESTS.length));

    /** Null past the last step, which is the completed-run card. */
    readonly shownTask = computed(() => QUESTS[this.shown()] ?? null);

    /** Whether this is a look back rather than the step to be done now. */
    readonly reviewing = computed(() => this.shown() < this.index());

    readonly canBack = computed(() => this.shown() > 0);

    /** Never past the live step: reading ahead would give away the answer. */
    readonly canForward = computed(() => this.shown() < this.index());

    back(): void {
        this.viewing.set(Math.max(0, this.shown() - 1));
    }

    forward(): void {
        const next = this.shown() + 1;
        // Catching up hands control back to the run rather than pinning the
        // panel to the step that happens to be current right now.
        this.viewing.set(next >= this.index() ? null : next);
    }

    /**
     * Jump straight to a step from the row of ticks.
     *
     * Guarded as well as disabled in the template, because the row is the one
     * place the whole run is visible and a step that has not been reached is
     * exactly the thing not to give away.
     */
    goTo(position: number): void {
        if (position > this.index()) return;
        this.viewing.set(position >= this.index() ? null : position);
    }

    private readonly dialog = inject(MatDialog);

    readonly percent = computed(
        () => (this.quest.points() / this.quest.totalPoints) * 100
    );

    constructor() {
        effect(() => {
            if (!this.quest.justFinished()) return;
            this.confetti().burst(ACCENTS.map((a) => a.ink));
            this.quest.acknowledge();
        });
    }

    /**
     * Start the run again, users and all.
     *
     * Confirmed first and destructive for real: the quests are judged from
     * live state, so the only way to be back at zero is for the wallets to be
     * gone. Reloads afterwards rather than re-rendering an emptied app —
     * the panes are torn down without disposing their wallets, and a fresh
     * page is the one way to be sure nothing is still holding a connection or
     * an open event stream.
     */
    async restart(): Promise<void> {
        const confirmed = await firstValueFrom(
            this.dialog
                .open(ConfirmDialog, {
                    width: "min(440px, calc(100vw - 32px))",
                    data: {
                        title: this.i18n.t("quest.restartTitle"),
                        message: this.i18n.t("quest.restartConfirm"),
                        confirmLabel: this.i18n.t("quest.restartAction"),
                        cancelLabel: this.i18n.t("common.cancel"),
                        destructive: true,
                    },
                })
                .afterClosed()
        );
        if (!confirmed) return;
        await this.quest.reset();
        location.reload();
    }

    titleKey(id: QuestId): keyof Messages {
        return `quest.${id}.title` as keyof Messages;
    }

    hintKey(id: QuestId): keyof Messages {
        return `quest.${id}.hint` as keyof Messages;
    }
}
