/**
 * The "show your work" layer.
 *
 * Every operation in this app is wrapped in a {@link Narrator}, which emits a
 * structured stream of {@link Step}s describing what is happening and — the
 * part that matters for learning — what the *protocol* is doing underneath.
 *
 * Making this a typed event stream rather than `console.log` calls buys three
 * things:
 *
 *  1. The CLI renders it, but a web UI could render the same stream differently.
 *  2. Tests can assert on the narration, so the explanations stay true as the
 *     code changes (see `test/account.test.ts`).
 *  3. Failures are narrated with the same shape as successes, so an error still
 *     tells you which stage of the flow you got to.
 */

import type { StepArg } from "./format.js";

export type StepStatus = "start" | "ok" | "fail" | "info";

/**
 * The translatable form of a narrated line.
 *
 * Every string a {@link Step} carries is also emitted as a key plus arguments,
 * so a front end with a catalogue can render the same sentence in the reader's
 * language. The plain-string fields stay authoritative for consumers that have
 * no catalogue -- the CLI renders those verbatim and never looks at these.
 *
 * Arguments are {@link StepArg}s rather than finished strings on purpose: an
 * amount or a duration has to be formatted in the target locale, which the code
 * emitting the step has no way to know.
 */
export interface StepMessage {
    /** A key into the front end's catalogue, e.g. `"step.send.submit.title"`. */
    readonly key: string;
    /** Positional substitutions for `{0}`, `{1}` ... in the template. */
    readonly args?: readonly StepArg[];
}

/** An error that knows how to say itself in another language. */
export interface TranslatableError extends Error {
    readonly i18n?: StepMessage;
}

export interface Step {
    /** Stable machine-readable id, e.g. `"send.submit"`. Tests match on this. */
    readonly id: string;
    readonly status: StepStatus;
    /** One line, plain language, no jargon. Written for someone new to Bitcoin. */
    readonly title: string;
    /** Concrete facts for this run: amounts, addresses, transaction ids. */
    readonly detail?: string;
    /** What the Arkade protocol actually did. This is the teaching material. */
    readonly behindTheScenes?: string;
    /** Translatable form of {@link title}. */
    readonly titleMessage?: StepMessage;
    /** Translatable form of {@link detail}. */
    readonly detailMessage?: StepMessage;
    /** Translatable form of {@link behindTheScenes}. */
    readonly behindMessage?: StepMessage;
    /** Structured payload for programmatic consumers. */
    readonly data?: Readonly<Record<string, unknown>>;
    /** Milliseconds the tracked operation took. Only set on `ok` / `fail`. */
    readonly durationMs?: number;
    readonly at: number;
}

/** Fields a caller supplies; `at` is stamped by the narrator. */
export type StepInput = Omit<Step, "at">;

export type StepListener = (step: Step) => void;

/**
 * Extra narration attached to a step once its result is known — the parts you
 * can only describe after the operation returns (a txid, a count, an amount).
 */
export interface StepOutcome {
    detail?: string;
    behindTheScenes?: string;
    detailMessage?: StepMessage;
    behindMessage?: StepMessage;
    /**
     * A title for the finished step, when the tracked one no longer fits.
     *
     * "Connecting to Signet" is right while it is happening and wrong once it
     * has; without this the only options are a permanent present tense or two
     * separate steps for one operation.
     */
    title?: string;
    titleMessage?: StepMessage;
    data?: Readonly<Record<string, unknown>>;
}

export interface TrackOptions<T> {
    readonly id: string;
    readonly title: string;
    /** Translatable form of {@link title}, carried onto all three steps. */
    readonly titleMessage?: StepMessage;
    /** Narration available before the work starts. */
    readonly before?: StepOutcome;
    /** Narration derived from the result. Runs only on success. */
    readonly after?: (result: T) => StepOutcome;
}

/** A clock, so tests can make durations deterministic. */
export type Clock = () => number;

export class Narrator {
    readonly #listeners = new Set<StepListener>();
    readonly #steps: Step[] = [];
    readonly #now: Clock;

    constructor(now: Clock = Date.now) {
        this.#now = now;
    }

    /** Subscribe to the step stream. Returns an unsubscribe function. */
    on(listener: StepListener): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    /** Emit one step. Listener errors are swallowed: narration must never break the flow. */
    emit(step: StepInput): Step {
        const full: Step = { ...step, at: this.#now() };
        this.#steps.push(full);
        for (const listener of this.#listeners) {
            try {
                listener(full);
            } catch {
                // A broken renderer must not fail a payment.
            }
        }
        return full;
    }

    /**
     * Emit a standalone informational note.
     *
     * The outcome is spread last, so it may carry its own `titleMessage` for a
     * localised front end while `title` stays the English original.
     */
    info(id: string, title: string, outcome: StepOutcome = {}): Step {
        return this.emit({ id, status: "info", title, ...outcome });
    }

    /**
     * Run `fn`, bracketing it with a `start` step and an `ok` or `fail` step.
     *
     * The original error is always rethrown — narration observes, it never
     * swallows.
     */
    async track<T>(options: TrackOptions<T>, fn: () => Promise<T>): Promise<T> {
        const { id, title, titleMessage, before, after } = options;
        const startedAt = this.#now();
        this.emit({ id, status: "start", title, ...titled(titleMessage), ...before });

        let result: T;
        try {
            result = await fn();
        } catch (error) {
            this.emit({
                id,
                status: "fail",
                title,
                ...titled(titleMessage),
                detail: describeError(error),
                ...translatedError(error),
                durationMs: this.#now() - startedAt,
            });
            throw error;
        }

        // The outcome is spread last so its own title, if it supplied one,
        // replaces the one the operation started under.
        this.emit({
            id,
            status: "ok",
            title,
            ...titled(titleMessage),
            ...(after?.(result) ?? {}),
            durationMs: this.#now() - startedAt,
        });
        return result;
    }

    /** Everything narrated so far, oldest first. */
    history(): readonly Step[] {
        return this.#steps;
    }

    /** All steps for one id — handy in tests. */
    stepsFor(id: string): readonly Step[] {
        return this.#steps.filter((s) => s.id === id);
    }
}

/** Spread helper: omit the key entirely when there is no translation. */
function titled(titleMessage: StepMessage | undefined): { titleMessage?: StepMessage } {
    return titleMessage ? { titleMessage } : {};
}

/**
 * Pick up a translatable message from a thrown error.
 *
 * Read structurally rather than by importing `PaymentError`: the narrator is
 * the bottom of the dependency graph and must not know about the account API.
 */
function translatedError(error: unknown): { detailMessage?: StepMessage } {
    const message = (error as Partial<TranslatableError> | null | undefined)?.i18n;
    return message ? { detailMessage: message } : {};
}

/** Turn anything thrown into a single readable line. */
export function describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

/** A narrator that records but never notifies — the default for library use. */
export const silentNarrator = (): Narrator => new Narrator();
