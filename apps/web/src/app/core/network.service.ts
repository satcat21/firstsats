/**
 * Which Arkade deployment the app is talking to.
 *
 * The CLI takes this from the environment and never changes it mid-run. A
 * browser has no environment to read, so the web app was pinned to whatever
 * `resolveConfig` defaults to -- and a reader who wanted to see the same wallet
 * against a different deployment had no way to say so.
 *
 * Root-scoped and deliberately global rather than per wallet: two panes on
 * different networks could not pay each other, which is the one thing the split
 * view exists to show.
 */

import { Injectable, computed, signal } from "@angular/core";
import {
    DEFAULT_NETWORK,
    NETWORKS,
    type NetworkPreset,
    type PresetName,
} from "@firstsats/core";

const STORAGE_KEY = "firstsats.network.v1";

/** See {@link NetworkService.presets}. */
const OFFERED: readonly PresetName[] = ["mutinynet", "signet"];

@Injectable({ providedIn: "root" })
export class NetworkService {
    /**
     * The deployments a browser can actually reach, best first.
     *
     * Regtest is missing on purpose, even though the CLI supports it and
     * `NETWORKS` still carries it. Its server is `http://localhost:7070`, and
     * this app is served over HTTPS from GitHub Pages -- a browser blocks the
     * plain-HTTP request as mixed content before it leaves the page. Offering a
     * choice that cannot work would only fail silently. A local stack is
     * reached through the CLI, with FIRSTSATS_NETWORK=regtest.
     */
    readonly presets = OFFERED;

    private readonly selected = signal<PresetName>(load());

    readonly name = this.selected.asReadonly();

    readonly current = computed<NetworkPreset>(() => NETWORKS[this.selected()]);

    /**
     * Switch deployments.
     *
     * The page reloads rather than rewiring itself. Every wallet holds an open
     * connection, an event subscription and an IndexedDB handle bound to one
     * server; tearing all of that down correctly in place is a great deal of
     * lifecycle for a control used once in a session, and a reload is honest
     * about what is happening -- a different network is a different world.
     */
    select(name: PresetName): void {
        if (name === this.selected()) return;
        try {
            localStorage.setItem(STORAGE_KEY, name);
        } catch {
            // Private browsing. The choice will not survive, but the reload
            // below still lands on it for this session.
        }
        this.selected.set(name);
        location.reload();
    }

    // ---- when a deployment stops working -------------------------------

    /**
     * The network to offer instead, once this one has proved unreliable.
     *
     * Null until there is evidence. This exists because of a real outage: the
     * public signet deployment stopped completing batch rounds for days, and
     * every wallet pointed at it reported a failure that read as the reader's
     * own mistake. It is not, there is nothing to fix locally, and the only
     * useful next move is to try somewhere else.
     */
    readonly suggestion = computed<PresetName | null>(() => {
        if (!this.roundsFailed()) return null;
        return OFFERED.find((name) => name !== this.selected()) ?? null;
    });

    private readonly roundsFailed = signal(false);

    /**
     * Record a settlement that ran out of rounds to try.
     *
     * Called only after the retries are spent, so one call already means three
     * consecutive rounds went nowhere -- enough to stop blaming the wallet.
     */
    roundExhausted(): void {
        this.roundsFailed.set(true);
    }

    dismissSuggestion(): void {
        this.roundsFailed.set(false);
    }
}

/**
 * The stored choice, else the core's default -- shared with the CLI, so both
 * front ends land a first-time reader in the same place. Also the default for
 * `ng serve`: a local default that differs from the hosted one means never
 * seeing what a visitor sees.
 *
 * Checked against the offered presets rather than against `NETWORKS`, so a
 * value this app no longer offers -- a regtest saved before it was withdrawn --
 * falls back instead of pinning the wallet to a server the browser will refuse
 * to call, with a selector showing nothing to change it to.
 */
function load(): PresetName {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && OFFERED.includes(stored as PresetName)) {
            return stored as PresetName;
        }
    } catch {
        // Storage unavailable; fall through to the default.
    }
    return DEFAULT_NETWORK;
}
