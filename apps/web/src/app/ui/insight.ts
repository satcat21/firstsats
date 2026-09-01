import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    input,
    signal,
    viewChild,
} from "@angular/core";
import { MatIconModule } from "@angular/material/icon";

let nextId = 0;

/**
 * The info tooltip.
 *
 * The native Popover API rather than `matTooltip`, because the content is a
 * paragraph to read rather than a label to glance at: a popover lives in the
 * top layer (the balance buckets clip their children, and a normal tooltip
 * inside one is cut off), dismisses on an outside click or Escape for free, and
 * stays open until dismissed.
 */
@Component({
    selector: "app-insight",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatIconModule],
    template: `
        <span class="wrap">
            <button
                #trigger
                type="button"
                class="trigger"
                [attr.popovertarget]="id"
                [attr.aria-expanded]="open()"
                [attr.aria-label]="label()"
            >
                <mat-icon>help</mat-icon>
            </button>
            <span
                #panel
                class="panel"
                role="note"
                popover
                [id]="id"
                (toggle)="onToggle($any($event))"
            >
                <ng-content />
            </span>
        </span>
    `,
    styles: `
        .wrap {
            position: relative;
            display: inline-flex;
            vertical-align: middle;
        }

        /*
         * Not a mat-icon-button: those carry a 40px touch target, and this sits
         * inline in a heading where a 40px block would break the line box. The
         * icon itself is a Material Symbol like every other icon in the app.
         */
        .trigger {
            width: 18px;
            height: 18px;
            border-radius: 50%;
            border: 0;
            background: none;
            color: var(--accent);
            line-height: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            margin-left: 4px;
            opacity: 0.75;
            transition: opacity 0.15s ease;
        }

        .trigger:hover,
        .trigger[aria-expanded="true"] {
            opacity: 1;
        }

        .trigger mat-icon {
            font-size: 17px;
            width: 17px;
            height: 17px;
        }

        /*
         * A popover is in the top layer, so it is positioned against the
         * viewport. The fixed-position coordinates are written by onToggle
         * from the trigger's rect. The user-agent default border and padding
         * are cleared because this element supplies its own.
         */
        .panel {
            position: fixed;
            margin: 0;
            inset: auto;
            width: max(260px, 22rem);
            max-width: min(78vw, 30rem);
            padding: 12px 14px;
            border-radius: var(--radius-sm);
            border: 1px solid var(--border-strong);
            background: var(--surface-raised);
            color: var(--fg-muted);
            box-shadow: var(--shadow);
            font-size: 13px;
            font-weight: 400;
            line-height: 1.5;
            text-align: left;
            white-space: normal;
            overflow: visible;
        }

        .panel:not(:popover-open) {
            display: none;
        }
    `,
})
export class Insight {
    /** Accessible name for the trigger, e.g. "What is a VTXO?". */
    readonly label = input("More information");

    readonly open = signal(false);
    readonly id = `insight-${nextId++}`;

    private readonly trigger =
        viewChild.required<ElementRef<HTMLButtonElement>>("trigger");
    private readonly panel =
        viewChild.required<ElementRef<HTMLElement>>("panel");

    /**
     * Place the panel under its trigger and keep it inside the viewport.
     *
     * Anchoring is done here rather than with CSS anchor positioning because
     * that is not yet available everywhere; a rect read on open works in every
     * browser that supports popovers at all.
     */
    onToggle(event: ToggleEvent): void {
        const isOpen = event.newState === "open";
        this.open.set(isOpen);
        if (!isOpen) return;

        const panel = this.panel().nativeElement;
        const rect = this.trigger().nativeElement.getBoundingClientRect();
        const gap = 8;

        // Measure after the browser has laid the panel out in the top layer.
        const width = panel.offsetWidth;
        const height = panel.offsetHeight;

        let left = rect.left + rect.width / 2 - width / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - width - 8));

        // Flip above the trigger when there is not room below.
        const below = rect.bottom + gap;
        const top =
            below + height > window.innerHeight - 8 && rect.top - gap - height > 8
                ? rect.top - gap - height
                : below;

        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
    }
}
