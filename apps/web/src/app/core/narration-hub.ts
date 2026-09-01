import { Injectable, signal } from "@angular/core";
import type { Step } from "@firstsats/core";
import type { Accent, Profile } from "./profile.service";

/** A narrated step, plus which wallet it came from. */
export interface HubStep {
    readonly step: Step;
    readonly profileId: string;
    readonly profileName: string;
    readonly accent: Accent;
    /** Monotonic, so a consumer can tell what it has already seen. */
    readonly seq: number;
}

/** Keep the feed bounded; toasts only ever read the tail of it. */
const MAX = 60;

/**
 * One place every wallet's narration arrives.
 *
 * Narration used to belong to the single `ArkadeService`, which stopped working
 * the moment there could be two of them: the toast stack lives in the shell and
 * has no pane to inject. Panes publish here instead, tagged with whose wallet
 * spoke — which the split view needs anyway, since "sent 1,000 sats" means very
 * different things depending on which side said it.
 */
@Injectable({ providedIn: "root" })
export class NarrationHub {
    readonly steps = signal<HubStep[]>([]);
    private seq = 0;

    publish(profile: Profile, step: Step): void {
        const entry: HubStep = {
            step,
            profileId: profile.id,
            profileName: profile.name,
            accent: profile.accent,
            seq: this.seq++,
        };
        this.steps.update((list) => [...list, entry].slice(-MAX));
    }

    clear(): void {
        this.steps.set([]);
    }
}
