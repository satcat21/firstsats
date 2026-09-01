/**
 * When the next batch round starts.
 *
 * Onboarding and collaborative exits both wait for a round, and without this
 * the wait is a spinner with nothing behind it — you cannot tell a queue from a
 * hang. The server advertises its schedule as absolute Unix seconds, so this is
 * a real countdown rather than an estimate.
 *
 * Root-scoped and fetched once for the whole app: the schedule belongs to the
 * server, not to any wallet, so two panes watching the same clock must not ask
 * twice. It also works before a wallet exists, which a per-pane service could
 * not do.
 */

import { Injectable, computed, signal } from "@angular/core";
import { resolveConfig } from "@firstsats/core";

/** A scheduled round window, in epoch milliseconds. */
interface Session {
    readonly startsAt: number;
    readonly endsAt: number;
}

/** What the server sends back; every number arrives as a string. */
interface InfoResponse {
    readonly scheduledSession?: {
        readonly nextStartTime?: string;
        readonly nextEndTime?: string;
    };
}

@Injectable({ providedIn: "root" })
export class RoundClock {
    private readonly url = resolveConfig({}).network.arkServerUrl;

    private readonly session = signal<Session | null>(null);
    private readonly now = signal(Date.now());

    /** Guards against a slow fetch being started again every second. */
    private loading = false;

    /**
     * Milliseconds until the next round opens, or `null` when the server does
     * not advertise a schedule.
     *
     * Null rather than zero, so a server that says nothing renders nothing
     * instead of a countdown stuck at 0:00.
     */
    readonly untilStart = computed<number | null>(() => {
        const session = this.session();
        if (!session) return null;
        return Math.max(0, session.startsAt - this.now());
    });

    /** Whether a round is open right now, so a settlement can be picked up. */
    readonly running = computed(() => {
        const session = this.session();
        if (!session) return false;
        const now = this.now();
        return now >= session.startsAt && now < session.endsAt;
    });

    constructor() {
        void this.load();
        setInterval(() => {
            this.now.set(Date.now());
            // The advertised window is the *next* one, so once it has passed
            // the server has a new answer and this one is stale.
            const session = this.session();
            if (!session || Date.now() >= session.endsAt) void this.load();
        }, 1000);
    }

    private async load(): Promise<void> {
        if (this.loading) return;
        this.loading = true;
        try {
            const response = await fetch(`${this.url}/v1/info`);
            if (!response.ok) return;
            const body = (await response.json()) as InfoResponse;
            const startsAt = Number(body.scheduledSession?.nextStartTime ?? 0) * 1000;
            const endsAt = Number(body.scheduledSession?.nextEndTime ?? 0) * 1000;
            this.session.set(
                startsAt > 0 && endsAt > 0 ? { startsAt, endsAt } : null
            );
        } catch {
            // Offline, or the server is not answering. There is nothing useful
            // to say about the schedule and nothing for the user to fix.
        } finally {
            this.loading = false;
        }
    }
}

/** `m:ss`, which reads as a countdown where a spelled-out duration does not. */
export function countdownText(ms: number): string {
    const total = Math.ceil(ms / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
