/**
 * Choosing the twelve words, rather than being handed them.
 *
 * Pressing one button and having a wallet appear teaches nothing: the phrase is
 * the wallet, and that only lands if you have handled the words once. So this
 * shows all twelve in numbered fields, lets you roll a different set, and lets
 * you type or paste your own — the three things anyone will actually have to do
 * with a real wallet, met here where the coins are worthless.
 *
 * Editable fields rather than a read-only list precisely because they are
 * editable in a real recovery too. The warning is prominent for the same
 * reason: the one dangerous thing a beginner can do on this screen is bring a
 * phrase that holds real money into a demo that keeps it unencrypted.
 */

import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import {
    createMnemonic,
    isValidMnemonic,
    normalizeMnemonic,
} from "../core/browser-keystore";
import { I18nService } from "../core/i18n.service";

const WORD_COUNT = 12;

@Component({
    selector: "app-seed-dialog",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatButtonModule, MatDialogModule, MatIconModule],
    template: `
        <h2 mat-dialog-title>
            <mat-icon class="heading-icon" aria-hidden="true">key</mat-icon>
            {{ i18n.t("seed.title") }}
        </h2>

        <mat-dialog-content>
            <p class="blurb">{{ i18n.t("seed.blurb") }}</p>

            <p class="warn">
                <mat-icon aria-hidden="true">warning</mat-icon>
                <span>{{ i18n.t("seed.warning") }}</span>
            </p>

            <ol class="words">
                @for (word of words(); track $index) {
                    <li>
                        <span class="n">{{ $index + 1 }}</span>
                        <input
                            class="word"
                            autocomplete="off"
                            autocapitalize="none"
                            spellcheck="false"
                            [value]="word"
                            [attr.aria-label]="i18n.t('seed.word', $index + 1)"
                            (input)="setWord($index, $event)"
                            (paste)="onPaste($index, $event)"
                        />
                    </li>
                }
            </ol>

            <p class="state" [class.bad]="!valid()">
                <mat-icon class="inline" aria-hidden="true">
                    {{ valid() ? "check_circle" : "error" }}
                </mat-icon>
                {{ valid() ? i18n.t("seed.valid") : i18n.t("seed.invalid") }}
            </p>
        </mat-dialog-content>

        <mat-dialog-actions align="end">
            <button matButton (click)="roll()">
                <mat-icon>autorenew</mat-icon>
                {{ i18n.t("seed.roll") }}
            </button>
            <span class="spacer"></span>
            <button matButton cdkFocusInitial [mat-dialog-close]="null">
                {{ i18n.t("common.cancel") }}
            </button>
            <button
                matButton="filled"
                [disabled]="!valid()"
                [mat-dialog-close]="phrase()"
            >
                <mat-icon>add_circle</mat-icon>
                {{ i18n.t("seed.create") }}
            </button>
        </mat-dialog-actions>
    `,
    styles: `
        h2 {
            display: flex;
            align-items: center;
            gap: 9px;
        }

        .blurb {
            margin: 0 0 14px;
            color: var(--fg-muted);
            line-height: 1.6;
        }

        .warn {
            display: flex;
            align-items: flex-start;
            gap: 9px;
            margin: 0 0 18px;
            padding: 11px 13px;
            border-radius: var(--radius-sm);
            border: 1px solid var(--warning);
            background: var(--warning-soft);
            color: var(--warning-on-soft);
            line-height: 1.55;
        }

        .warn mat-icon {
            flex: none;
            width: 20px;
            height: 20px;
            font-size: 20px;
        }

        /*
         * Three columns rather than one long list: twelve words read as a
         * block you could copy down, which is how they are met in the wild.
         */
        .words {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
            margin: 0 0 16px;
            padding: 0;
            list-style: none;
        }

        @media (max-width: 520px) {
            .words {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
        }

        .words li {
            display: flex;
            align-items: center;
            gap: 7px;
            min-width: 0;
        }

        .n {
            flex: 0 0 18px;
            text-align: right;
            font-size: 11px;
            font-variant-numeric: tabular-nums;
            color: var(--fg-subtle);
        }

        .word {
            width: 100%;
            min-width: 0;
            padding: 7px 9px;
            border-radius: var(--radius-sm);
            border: 1px solid var(--border-strong);
            background: var(--surface);
            color: var(--fg);
            font-family: var(--font-mono);
            font-size: 13px;
        }

        .word:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 1px;
        }

        .state {
            display: flex;
            align-items: center;
            gap: 7px;
            margin: 0;
            font-size: 13px;
            color: var(--success);
        }

        .state.bad {
            color: var(--danger);
        }

        /* Pushes Roll to the left, away from the two decision buttons. */
        .spacer {
            flex: 1 1 auto;
        }
    `,
})
export class SeedDialog {
    readonly i18n = inject(I18nService);
    private readonly ref =
        inject<MatDialogRef<SeedDialog, string | null>>(MatDialogRef);

    readonly words = signal<string[]>(createMnemonic().split(" "));

    readonly phrase = computed(() => normalizeMnemonic(this.words().join(" ")));

    readonly valid = computed(() => isValidMnemonic(this.phrase()));

    roll(): void {
        this.words.set(createMnemonic().split(" "));
    }

    setWord(index: number, event: Event): void {
        const value = (event.target as HTMLInputElement).value;
        this.words.update((all) => all.map((w, i) => (i === index ? value : w)));
    }

    /**
     * Pasting a whole phrase fills the whole grid.
     *
     * Anyone restoring a wallet has twelve words on the clipboard as one line,
     * and making them paste it word by word would be a puzzle rather than a
     * lesson. A single word pastes normally.
     */
    onPaste(index: number, event: ClipboardEvent): void {
        const text = event.clipboardData?.getData("text") ?? "";
        const parts = normalizeMnemonic(text).split(" ").filter(Boolean);
        if (parts.length < 2) return;
        event.preventDefault();
        this.words.update((all) =>
            all.map((word, i) =>
                i >= index && parts[i - index] !== undefined
                    ? (parts[i - index] as string)
                    : word
            )
        );
    }
}

/** How many words the grid holds, for anyone rendering a placeholder. */
export const SEED_WORDS = WORD_COUNT;
