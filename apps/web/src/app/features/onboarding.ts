import {
    ChangeDetectionStrategy,
    Component,
    inject,
    input,
    signal,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatDialog } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { I18nService } from "../core/i18n.service";
import { ProfileService } from "../core/profile.service";
import { Insight } from "../ui/insight";
import { SeedDialog } from "../ui/seed-dialog";
import { firstValueFrom } from "rxjs";

/**
 * Step one: create a wallet.
 *
 * The screen makes one pedagogical point and makes it hard to miss — pressing
 * the button contacts nothing. The wallet exists before any server has heard of
 * it. That is the single most surprising property of Bitcoin for someone
 * arriving from bank apps, and it is free to demonstrate.
 *
 * The phrase is shown as soon as the wallet exists, because seeing the twelve
 * words *are* the wallet is the lesson — hiding them behind a reveal taught
 * that they are a secret to be filed away, which is true of mainnet money and
 * beside the point for worthless signet coins. The hide button stays for
 * screen-sharing. Copying is offered too: withholding it would be theatre when
 * the demo already keeps the phrase in `localStorage` unencrypted.
 */
@Component({
    selector: "app-onboarding",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatButtonModule, MatCardModule, MatIconModule, Insight],
    template: `
        <mat-card appearance="outlined" class="intro">
          <mat-card-content>
            <h1>{{ i18n.t("onboarding.heading") }}</h1>
            <p class="muted">{{ i18n.t("onboarding.blurb") }}</p>

            @if (!phrase()) {
                <button matButton="filled" [disabled]="creating()" (click)="create()">
                    <mat-icon [class.spin]="creating()">
                        {{ creating() ? "progress_activity" : "add_circle" }}
                    </mat-icon>
                    {{
                        creating()
                            ? i18n.t("onboarding.creating")
                            : i18n.t("onboarding.create")
                    }}
                </button>
                <p class="subtle nothing">
                    <mat-icon class="inline" aria-hidden="true">cloud_off</mat-icon>
                    {{ i18n.t("onboarding.nothingSent") }}
                    <app-insight [label]="i18n.t('insight.noServer.label')">
                        {{ i18n.t("insight.noServer") }}
                    </app-insight>
                </p>
            } @else {
                <div class="seed">
                    <h2>
                        <mat-icon class="inline" aria-hidden="true">key</mat-icon>
                        {{ i18n.t("onboarding.seedHeading") }}
                    </h2>
                    <p class="warning">
                        <mat-icon aria-hidden="true">warning</mat-icon>
                        <span>{{ i18n.t("onboarding.seedWarning") }}</span>
                    </p>

                    @if (revealed()) {
                        <ol class="words">
                            @for (word of words(); track $index) {
                                <li><span class="n">{{ $index + 1 }}</span>{{ word }}</li>
                            }
                        </ol>
                    } @else {
                        <div class="masked">
                            <mat-icon aria-hidden="true">lock</mat-icon>
                            <span>{{ i18n.t("onboarding.seedHidden") }}</span>
                        </div>
                    }

                    <div class="actions">
                        <button matButton="outlined" (click)="revealed.set(!revealed())">
                            <mat-icon>
                                {{ revealed() ? "visibility_off" : "visibility" }}
                            </mat-icon>
                            {{
                                revealed()
                                    ? i18n.t("onboarding.seedHide")
                                    : i18n.t("onboarding.seedReveal")
                            }}
                        </button>
                        @if (revealed()) {
                            <button matButton="outlined" (click)="copyPhrase()">
                                <mat-icon>
                                    {{ copied() ? "check" : "content_copy" }}
                                </mat-icon>
                                {{
                                    copied()
                                        ? i18n.t("onboarding.seedCopied")
                                        : i18n.t("onboarding.seedCopy")
                                }}
                            </button>
                        }
                        <button matButton="filled" (click)="done.set(true)">
                            <mat-icon>check</mat-icon>
                            {{ i18n.t("onboarding.continue") }}
                        </button>
                    </div>
                    @if (revealed()) {
                        <p class="subtle clipboard-note">
                            {{ i18n.t("onboarding.seedClipboardNote") }}
                        </p>
                    }
                </div>
            }

            @if (error(); as message) {
                <p class="error" role="alert">
                    <mat-icon class="inline" aria-hidden="true">error</mat-icon>
                    {{ message }}
                </p>
            }
          </mat-card-content>
        </mat-card>
    `,
    styles: `
        .intro {
            max-width: 640px;
        }

        h1 {
            font-size: 24px;
            margin-bottom: 10px;
        }

        h2 {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 16px;
            margin-bottom: 8px;
        }

        .spin {
            animation: spin 1.1s linear infinite;
        }

        @keyframes spin {
            to {
                transform: rotate(360deg);
            }
        }

        p {
            margin: 0 0 18px;
        }

        .nothing {
            margin: 14px 0 0;
        }

        .seed {
            margin-top: 8px;
        }

        .warning {
            display: flex;
            align-items: flex-start;
            gap: 9px;
            padding: 12px 14px;
            border-radius: var(--radius-sm);
            background: var(--warning-soft);
            color: var(--warning-on-soft);
            font-size: 13.5px;
            line-height: 1.55;
        }

        .warning .mat-icon {
            flex: none;
            color: inherit;
        }

        .words {
            list-style: none;
            margin: 0 0 18px;
            padding: 16px;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
            gap: 8px 16px;
            border: 1px solid var(--border-strong);
            border-radius: var(--radius-sm);
            background: var(--surface);
            font-family: var(--font-mono);
            font-size: 14px;
        }

        .words .n {
            display: inline-block;
            width: 22px;
            color: var(--fg-subtle);
            font-size: 12px;
        }

        .masked {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 28px 16px;
            margin-bottom: 18px;
            border: 1px dashed var(--border-strong);
            border-radius: var(--radius-sm);
            background: var(--surface);
            color: var(--fg-muted);
            font-size: 13.5px;
        }

        .actions {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }

        .clipboard-note {
            margin: 12px 0 0;
            line-height: 1.5;
        }

        .nothing {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .error {
            display: flex;
            align-items: center;
            gap: 6px;
            margin: 16px 0 0;
            color: var(--danger);
            font-size: 13.5px;
        }
    `,
})
export class Onboarding {
    /** The user this wallet will belong to. */
    readonly profileId = input.required<string>();

    readonly i18n = inject(I18nService);
    private readonly profiles = inject(ProfileService);
    private readonly dialog = inject(MatDialog);

    /** Surfaced in the template; creation is local, so failures are rare. */
    readonly error = signal<string | null>(null);

    readonly creating = signal(false);
    // Shown by default: this screen exists to teach what a seed phrase is.
    readonly revealed = signal(true);
    readonly phrase = signal<string | null>(null);
    /** Set once the user confirms they have written the phrase down. */
    readonly done = signal(false);

    /** Reset by a timer, so the button reads "Copied" only briefly. */
    readonly copied = signal(false);

    words(): string[] {
        return this.phrase()?.split(" ") ?? [];
    }

    async copyPhrase(): Promise<void> {
        const phrase = this.phrase();
        if (!phrase) return;
        try {
            await navigator.clipboard.writeText(phrase);
            this.copied.set(true);
            setTimeout(() => this.copied.set(false), 2000);
        } catch {
            // Clipboard denied (insecure context, or the user said no). The
            // words are on screen and selectable, so there is nothing to fix.
        }
    }

    /**
     * Make a wallet.
     *
     * Goes through the seed dialog rather than minting silently: the twelve
     * words *are* the wallet, and being handed them by a button teaches that
     * far less well than choosing them, rolling them again, or typing a set of
     * your own. Nothing here talks to the network either way — that is the
     * whole point of the copy on this screen.
     */
    async create(): Promise<void> {
        const chosen = await firstValueFrom(
            this.dialog.open(SeedDialog, { width: "min(560px, calc(100vw - 32px))" }).afterClosed()
        );
        // Dismissed. Not an error, and not a wallet.
        if (!chosen) return;

        this.creating.set(true);
        try {
            const profile = this.profiles.attachWallet(this.profileId(), chosen);
            this.phrase.set(profile?.mnemonic ?? null);
        } catch (cause) {
            this.error.set(cause instanceof Error ? cause.message : String(cause));
        } finally {
            this.creating.set(false);
        }
    }
}
