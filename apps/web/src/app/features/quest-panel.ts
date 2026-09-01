import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
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

                @if (quest.current(); as task) {
                    <div class="task" role="status">
                        <p class="step">
                            {{ i18n.t("quest.step", index() + 1, quests.length) }}
                            · +{{ task.points }}
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

                <ol class="ticks">
                    @for (task of quests; track task.id) {
                        <li
                            [class.on]="quest.done().has(task.id)"
                            [matTooltip]="i18n.t(titleKey(task.id))"
                        >
                            <mat-icon>
                                {{
                                    quest.done().has(task.id)
                                        ? "check_circle"
                                        : "radio_button_unchecked"
                                }}
                            </mat-icon>
                        </li>
                    }
                </ol>

                <button matButton class="reset" (click)="restart()">
                    <mat-icon>replay</mat-icon>
                    {{ i18n.t("quest.restart") }}
                </button>
            </mat-card-content>
        </mat-card>

        <app-confetti />
    `,
    styles: `
        :host {
            display: block;
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

        .task {
            margin-top: 16px;
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

        .ticks {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            list-style: none;
            margin: 18px 0 0;
            padding: 0;
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

        .reset {
            margin-top: 12px;
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
