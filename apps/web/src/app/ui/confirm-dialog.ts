import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";

export interface ConfirmData {
    readonly title: string;
    readonly message: string;
    readonly confirmLabel: string;
    /** Omitted for a dialog that only has something to say, not to ask. */
    readonly cancelLabel?: string;
    /** Colours the confirm button as destructive and picks a warning icon. */
    readonly destructive?: boolean;
    /**
     * Overrides the heading glyph.
     *
     * A dialog opened by a button should wear that button's icon: the compass
     * carrying through from "Quest mode" into "Enter quest mode?" says the two
     * are the same act, where a generic question mark makes it a new one.
     */
    readonly icon?: string;
}

/**
 * A yes/no dialog.
 *
 * Replaces `window.confirm`, which cannot be styled, ignores the page's theme,
 * and on some platforms offers to suppress itself forever — a bad property for
 * the one prompt standing between a user and an unrecoverable wallet.
 *
 * Cancel is focused on open, so the destructive action is never one stray
 * keypress away.
 */
@Component({
    selector: "app-confirm-dialog",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatButtonModule, MatDialogModule, MatIconModule],
    template: `
        <h2 mat-dialog-title [class.destructive]="data.destructive">
            <mat-icon class="heading-icon" aria-hidden="true">
                {{ data.icon ?? (data.destructive ? "warning" : "help") }}
            </mat-icon>
            {{ data.title }}
        </h2>

        <mat-dialog-content>
            <p>{{ data.message }}</p>
        </mat-dialog-content>

        <mat-dialog-actions align="end">
            <!--
                Two branches rather than one button with a bound focus flag:
                cdkFocusInitial is a plain directive and cannot be switched on
                and off. Cancel takes focus whenever it exists, so a destructive
                action is never one stray keypress away; with nothing to cancel
                the only button takes it instead.
            -->
            @if (data.cancelLabel; as cancel) {
                <button matButton cdkFocusInitial [mat-dialog-close]="false">
                    {{ cancel }}
                </button>
                <button
                    matButton="filled"
                    [class.destructive]="data.destructive"
                    [mat-dialog-close]="true"
                >
                    {{ data.confirmLabel }}
                </button>
            } @else {
                <button matButton="filled" cdkFocusInitial [mat-dialog-close]="true">
                    {{ data.confirmLabel }}
                </button>
            }
        </mat-dialog-actions>
    `,
    styles: `
        /* The icon inherits from here, so colouring the heading colours both. */
        h2 {
            display: flex;
            align-items: center;
            gap: 9px;
        }

        h2.destructive {
            color: var(--danger);
        }

        p {
            margin: 0;
            color: var(--fg-muted);
            line-height: 1.6;
        }

        .destructive {
            --mat-button-filled-container-color: var(--danger);
            --mat-button-filled-label-text-color: #ffffff;
            --mat-button-filled-state-layer-color: #ffffff;
        }
    `,
})
export class ConfirmDialog {
    readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
    readonly ref = inject<MatDialogRef<ConfirmDialog, boolean>>(MatDialogRef);
}
