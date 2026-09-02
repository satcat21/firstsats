import {
    ChangeDetectionStrategy,
    Component,
    OnDestroy,
    effect,
    inject,
    input,
    signal,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import type { Step, StepStatus } from "@firstsats/core";
import { type HubStep, NarrationHub } from "../core/narration-hub";
import { I18nService } from "../core/i18n.service";

/**
 * Icons for the few steps whose status says less than the event does.
 *
 * Money turning up is not "information"; it is the thing the reader is waiting
 * for, and a generic info glyph beside it undersells it.
 */
const STEP_ICONS: Record<string, string> = {
    "receive.arrived": "savings",
    // Change is money moving within one wallet, not money arriving at it.
    "send.change": "swap_horiz",
};

/** The Material Symbol standing in for each step status. */
const STATUS_ICONS: Record<StepStatus, string> = {
    start: "pending",
    ok: "check_circle",
    fail: "error",
    info: "info",
};

/**
 * Steps that happen constantly and mean nothing on their own.
 *
 * Every refresh reads the server parameters, the addresses, the balance, the
 * VTXOs and the history. Narrating all five is what made the old permanent feed
 * unreadable: the one line worth seeing was buried under four that fire on a
 * timer. They are still narrated — the CLI prints them, and the Tour explains
 * the same ideas properly — they just do not interrupt anyone here.
 */
const ROUTINE = new Set([
    "server.info",
    "wallet.addresses",
    "wallet.balance",
    "wallet.vtxos",
    "wallet.history",
]);

/** How long an untouched toast stays up. */
const LIFETIME_MS = 15_000;

/** At most this many at once; the oldest goes to make room. */
const MAX_VISIBLE = 4;

interface Toast {
    /** Wallet plus operation. Two wallets doing the same thing get two toasts. */
    readonly key: string;
    readonly step: Step;
    readonly profileName: string;
    readonly accent: { readonly tint: string; readonly ink: string };
    /** Expanded shows the "behind the scenes" paragraph. */
    expanded: boolean;
    /** Once touched, it stays until dismissed by hand. */
    pinned: boolean;
}

/**
 * Narration as transient notifications.
 *
 * A payment is worth explaining at the moment it happens, which is not the same
 * as being worth a permanent panel. These appear top-right when something
 * actually occurs, say what it was in one line, and leave. Expanding one
 * reveals what the protocol did underneath and pins it, so reading never races
 * a timer.
 */
@Component({
    selector: "app-narration-toasts",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatButtonModule, MatIconModule],
    template: `
        <!-- aria-live rather than role="alert": these are informative, and
             should not interrupt whatever a screen reader is already saying. -->
        <div class="stack" role="status" aria-live="polite">
            @for (toast of toasts(); track toast.key) {
                <div
                    class="toast"
                    [class]="toast.step.status"
                    [class.expanded]="toast.expanded"
                    [style.--tint]="toast.accent.tint"
                    [style.--ink]="toast.accent.ink"
                >
                    <div class="body">
                        <p class="who">
                            <span class="dot"></span>
                            {{ toast.profileName }}
                        </p>
                        <p class="title">
                            <mat-icon class="heading-icon" aria-hidden="true">
                                {{ icon(toast.step) }}
                            </mat-icon>
                            {{ title(toast.step) }}
                        </p>
                        @if (detail(toast.step); as text) {
                            <p class="detail mono">{{ text }}</p>
                        }

                        @if (why(toast.step); as text) {
                            @if (toast.expanded) {
                                <p class="why">{{ text }}</p>
                            }
                            <button
                                matButton
                                class="more"
                                (click)="toggle(toast)"
                            >
                                <mat-icon>
                                    {{ toast.expanded ? "expand_less" : "expand_more" }}
                                </mat-icon>
                                {{
                                    toast.expanded
                                        ? i18n.t("toast.less")
                                        : i18n.t("toast.more")
                                }}
                            </button>
                        }
                    </div>

                    <button
                        matIconButton
                        class="close"
                        [attr.aria-label]="i18n.t('toast.close')"
                        (click)="dismiss(toast.key)"
                    >
                        <mat-icon>close</mat-icon>
                    </button>
                </div>
            }
        </div>
    `,
    styles: `
        /*
         * Bottom-right, not top-right: in a split view the top-right corner is
         * the second wallet header, and an opaque toast stack sitting on it
         * hides the pane you are trying to watch.
         */
        /*
         * Positioned by the lane that hosts it, not by the viewport. In a split
         * view each wallet gets its own lane under its own column, so a
         * notification appears where the wallet it belongs to is.
         */
        .stack {
            display: flex;
            flex-direction: column-reverse;
            gap: 10px;
            width: 100%;
            max-width: 380px;
            margin-left: auto;
            pointer-events: none;
        }

        /*
         * A toast is not a card, and looked like one.
         *
         * Two things separate it now. It sits on its own ground — the wallet's
         * pastel mixed into the surface, which reads darker than the page in
         * light mode and lighter in dark, so it lifts either way. And a bar
         * down the left in that wallet's colour says whose news it is before
         * the name is read.
         */
        .toast {
            pointer-events: auto;
            display: grid;
            grid-template-columns: 1fr 32px;
            gap: 8px;
            padding: 12px 10px 12px 14px;
            border-radius: var(--radius);
            border: 1px solid color-mix(in srgb, var(--ink) 35%, var(--border-strong));
            border-left: 4px solid var(--ink);
            background: color-mix(in srgb, var(--tint) 30%, var(--surface-raised));
            box-shadow: var(--shadow);
            animation: slide-in 0.18s ease-out;
        }

        :host-context([data-theme="dark"]) .toast {
            border-color: color-mix(in srgb, var(--tint) 30%, var(--border-strong));
            border-left-color: var(--tint);
            background: color-mix(in srgb, var(--tint) 14%, var(--surface-raised));
        }

        @keyframes slide-in {
            from {
                opacity: 0;
                transform: translateX(12px);
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .toast {
                animation: none;
            }
        }

        .body {
            min-width: 0;
        }

        /*
         * Which wallet spoke. Redundant with one, essential with two.
         *
         * Ink on a light ground, pastel on a dark one — the same rule the panes
         * use, so a wallet looks like itself wherever it appears.
         */
        .who {
            color: var(--ink);
        }

        :host-context([data-theme="dark"]) .who {
            color: var(--tint);
        }

        :host-context([data-theme="dark"]) .why {
            background: color-mix(in srgb, var(--tint) 22%, var(--surface-raised));
        }

        .who {
            display: flex;
            align-items: center;
            gap: 6px;
            margin: 0 0 4px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }

        .dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--tint);
            border: 1px solid var(--ink);
        }

        /*
         * Icon and title are one unit: the status colours the whole line, and
         * the icon takes its size from it.
         *
         * Aligned to the start, not centred: a title long enough to wrap makes the row
         * two lines tall, and centring floats the icon into the gap between
         * them instead of leaving it beside the words it belongs to.
         */
        .title {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            margin: 0;
            font-weight: 650;
            font-size: 15px;
            line-height: 1.4;
            color: var(--fg-muted);
        }

        .title .mat-icon {
            font-size: 1.2em;
            width: 1.2em;
            height: 1.2em;
            /* Optically centred on the first line, not on the block. */
            margin-top: 1px;
        }

        .toast.ok .title {
            color: var(--success);
        }

        .toast.fail .title {
            color: var(--danger);
        }

        .toast.info .title {
            color: var(--accent);
        }

        /* Indent past the icon so the body reads as one block under the title. */
        .detail {
            margin: 5px 0 0 26px;
            color: var(--fg-muted);
            font-size: 12.5px;
            overflow-wrap: anywhere;
        }

        /*
         * No rule down the side. The toast already has one on its own left
         * edge, and a second one a few pixels inside it read as a quotation
         * rather than as the panel's own aside. The tinted ground is enough to
         * set this apart from the line above it.
         */
        .why {
            margin: 8px 0 0 26px;
            padding: 10px 12px;
            background: color-mix(in srgb, var(--tint) 45%, var(--surface-raised));
            border-radius: var(--radius-sm);
            color: var(--fg-muted);
            font-size: 12.5px;
            line-height: 1.55;
        }

        .more {
            margin: 6px 0 0 18px;
            font-size: 12.5px;
            color: var(--accent);
        }

        /*
         * The state-layer size has to match the column this sits in. Material
         * defaults an icon button to a 40px target; in a 32px cell the circle
         * overflows and reads as off-centre against the 24px glyph.
         */
        .close {
            --mat-icon-button-state-layer-size: 32px;
            align-self: start;
            color: var(--fg-subtle);
        }
    `,
})
export class NarrationToasts implements OnDestroy {
    /** Show only this wallet's narration. Unset shows every wallet's. */
    readonly profileId = input<string | null>(null);

    private readonly hub = inject(NarrationHub);
    readonly i18n = inject(I18nService);

    readonly toasts = signal<Toast[]>([]);

    /** The highest hub sequence number already turned into a toast. */
    private consumed = -1;
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor() {
        effect(() => {
            // The hub is capped, so its sequence numbers — not array indices —
            // are what say which entries are new.
            const mine = this.profileId();
            const entries = this.hub.steps();
            for (const entry of entries) {
                if (entry.seq <= this.consumed) continue;
                this.consumed = entry.seq;
                if (mine && entry.profileId !== mine) continue;
                if (worthShowing(entry.step)) this.show(entry);
            }
        });
    }

    ngOnDestroy(): void {
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
    }

    icon(step: Step): string {
        return STEP_ICONS[step.id] ?? STATUS_ICONS[step.status];
    }

    title(step: Step): string {
        return this.i18n.tMessage(step.titleMessage, step.title);
    }

    detail(step: Step): string | undefined {
        return this.i18n.tMessage(step.detailMessage, step.detail);
    }

    why(step: Step): string | undefined {
        return this.i18n.tMessage(step.behindMessage, step.behindTheScenes);
    }

    /** Expanding pins: reading the explanation must not race the timer. */
    toggle(toast: Toast): void {
        this.cancel(toast.key);
        this.toasts.update((list) =>
            list.map((t) =>
                t.key === toast.key
                    ? { ...t, expanded: !t.expanded, pinned: true }
                    : t
            )
        );
    }

    dismiss(key: string): void {
        this.cancel(key);
        this.toasts.update((list) => list.filter((t) => t.key !== key));
    }

    /**
     * Show a step, or update the toast that operation already owns.
     *
     * An operation narrates twice — once as it starts and once with its result
     * — and those are the same event to a reader. Keying on the step id turns
     * the pair into one notification that changes from pending to a green tick
     * in place, instead of two stacked cards saying nearly the same thing.
     */
    private show(entry: HubStep): void {
        const { step, profileName, accent } = entry;
        // Scoped by wallet: in a split view both sides narrate the same
        // operation ids, and they must not overwrite each other's toast.
        const key = `${entry.profileId}:${step.id}`;

        this.toasts.update((list) => {
            const at = list.findIndex((t) => t.key === key);
            if (at !== -1) {
                const next = [...list];
                // Keep whatever the reader did with it; replace only the step.
                next[at] = { ...next[at]!, step };
                return next;
            }

            const grown = [
                ...list,
                { key, step, profileName, accent, expanded: false, pinned: false },
            ];
            // Trim from the front, but never drop one somebody is reading.
            while (grown.length > MAX_VISIBLE) {
                const victim = grown.findIndex((t) => !t.pinned);
                if (victim === -1) break;
                this.cancel(grown[victim]!.key);
                grown.splice(victim, 1);
            }
            return grown;
        });

        // The clock restarts on an update, so a result always gets its full
        // reading time rather than inheriting what was left of the start's.
        const pinned = this.toasts().find((t) => t.key === key)?.pinned;
        this.cancel(key);
        if (!pinned) {
            this.timers.set(key, setTimeout(() => this.dismiss(key), LIFETIME_MS));
        }
    }

    private cancel(key: string): void {
        const timer = this.timers.get(key);
        if (timer) clearTimeout(timer);
        this.timers.delete(key);
    }
}

/**
 * Whether a step deserves to interrupt the reader.
 *
 * A bare `start` carries nothing the matching `ok` will not repeat — the same
 * rule the terminal renderer uses — and the routine reads fire on every
 * refresh. A failure always shows, whatever its id.
 */
function worthShowing(step: Step): boolean {
    if (step.status === "fail") return true;
    if (ROUTINE.has(step.id)) return false;
    if (step.status === "start") {
        return Boolean(step.detail) || Boolean(step.behindTheScenes);
    }
    return true;
}
