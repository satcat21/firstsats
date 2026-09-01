/**
 * The twelve words, on demand.
 *
 * A wallet you cannot read the phrase out of is a wallet you cannot back up,
 * and a teaching app that hides it teaches the wrong lesson: the phrase is not
 * a setting the app owns, it is the wallet, and it should always be there to
 * look at. It lives behind a button and a dialog rather than on the dashboard
 * so an incidental glance at someone's screen does not catch it.
 *
 * Read-only on purpose. Changing a phrase is not editing — it is switching to a
 * different wallet — and that belongs to creating one, where the consequences
 * are the point.
 */

import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MAT_DIALOG_DATA, MatDialogModule } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { I18nService } from "../core/i18n.service";
import type { Accent } from "../core/profile.service";

export interface PhraseData {
    readonly mnemonic: string;
    /** The wallet these words belong to, so the dialog wears its colour. */
    readonly accent?: Accent;
}

@Component({
    selector: "app-phrase-dialog",
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        "[class.user-accent]": "data.accent !== undefined",
        "[style.--tint]": "data.accent?.tint ?? null",
        "[style.--ink]": "data.accent?.ink ?? null",
    },
    imports: [MatButtonModule, MatDialogModule, MatIconModule],
    template: `
        <h2 mat-dialog-title>
            <mat-icon class="heading-icon" aria-hidden="true">key</mat-icon>
            {{ i18n.t("seed.title") }}
        </h2>

        <mat-dialog-content>
            <p class="warn">
                <mat-icon aria-hidden="true">warning</mat-icon>
                <span>{{ i18n.t("onboarding.seedWarning") }}</span>
            </p>

            <ol class="words">
                @for (word of words; track $index) {
                    <li>
                        <span class="n">{{ $index + 1 }}</span>
                        <span class="word">{{ word }}</span>
                    </li>
                }
            </ol>

            <p class="subtle note">{{ i18n.t("onboarding.seedClipboardNote") }}</p>
        </mat-dialog-content>

        <mat-dialog-actions align="end">
            <button matButton (click)="copy()">
                <mat-icon>{{ copied() ? "check" : "content_copy" }}</mat-icon>
                {{
                    copied()
                        ? i18n.t("onboarding.seedCopied")
                        : i18n.t("onboarding.seedCopy")
                }}
            </button>
            <button matButton="filled" cdkFocusInitial mat-dialog-close>
                {{ i18n.t("common.close") }}
            </button>
        </mat-dialog-actions>
    `,
    styles: `
        h2 {
            display: flex;
            align-items: center;
            gap: 9px;
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

        .words {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
            margin: 0 0 14px;
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
            padding: 7px 9px;
            border-radius: var(--radius-sm);
            border: 1px solid var(--border);
            background: var(--surface);
        }

        .n {
            flex: 0 0 16px;
            text-align: right;
            font-size: 11px;
            font-variant-numeric: tabular-nums;
            color: var(--fg-subtle);
        }

        .word {
            font-family: var(--font-mono);
            font-size: 13px;
            overflow-wrap: anywhere;
        }

        .note {
            margin: 0;
            line-height: 1.55;
        }
    `,
})
export class PhraseDialog {
    readonly i18n = inject(I18nService);
    /** Public because the host bindings above read the accent from it. */
    readonly data = inject<PhraseData>(MAT_DIALOG_DATA);

    readonly words = this.data.mnemonic.split(/\s+/).filter(Boolean);

    /** Reset by a timer, so the button reads "Copied" only briefly. */
    readonly copied = signal(false);

    async copy(): Promise<void> {
        try {
            await navigator.clipboard.writeText(this.data.mnemonic);
            this.copied.set(true);
            setTimeout(() => this.copied.set(false), 2000);
        } catch {
            // Clipboard denied, or an insecure context. The words are on screen
            // and selectable, so there is nothing to fix.
        }
    }
}
