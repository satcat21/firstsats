import { Injectable, computed, signal } from "@angular/core";

/** What one wallet looks like right now, flattened for cross-wallet questions. */
export interface WalletSnapshot {
    readonly profileId: string;
    readonly available: number;
    readonly boarding: number;
    readonly total: number;
    readonly sent: number;
    readonly received: number;
}

/**
 * Every open wallet's state, in one place.
 *
 * Each pane owns its own `ArkadeService`, which is what makes two wallets
 * possible and also means nothing can see both. Questions that span wallets —
 * "has anyone been paid yet?" — need somewhere neutral to look, so panes
 * publish a snapshot here on every refresh.
 *
 * Deliberately a summary, not a handle: the registry is for asking questions
 * about wallets, never for driving one.
 */
@Injectable({ providedIn: "root" })
export class WalletRegistry {
    private readonly byId = signal<Record<string, WalletSnapshot>>({});

    readonly snapshots = computed(() => Object.values(this.byId()));

    publish(snapshot: WalletSnapshot): void {
        this.byId.update((all) => ({ ...all, [snapshot.profileId]: snapshot }));
    }

    /** Drop every snapshot, for a reset that removes all the wallets. */
    clear(): void {
        this.byId.set({});
    }

    forget(profileId: string): void {
        this.byId.update((all) => {
            const { [profileId]: _gone, ...rest } = all;
            return rest;
        });
    }

    get(profileId: string): WalletSnapshot | undefined {
        return this.byId()[profileId];
    }
}
