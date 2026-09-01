import { Injectable, computed, signal } from "@angular/core";
import {
    type StepArg,
    type StepMessage,
    btc,
    duration,
    formatArg,
    sats,
} from "@firstsats/core";
import {
    LOCALES,
    LOCALE_CODES,
    type LocaleCode,
    type Messages,
} from "./messages";

const STORAGE_KEY = "firstsats.locale";

/**
 * Runtime translation, backed by a signal so every template that reads a
 * message re-renders the moment the locale changes.
 *
 * It also owns number formatting. Amounts, BTC values and durations are only
 * translated if they are rendered in the reader's locale — `1,234 sats` and
 * `2 days` are as English as the sentence around them — and the locale that
 * decides it lives here.
 */
@Injectable({ providedIn: "root" })
export class I18nService {
    private readonly current = signal<LocaleCode>(detectLocale());

    readonly locale = this.current.asReadonly();
    readonly locales = LOCALE_CODES.map((code) => ({
        code,
        label: LOCALES[code].label,
    }));

    private readonly messages = computed<Messages>(
        () => LOCALES[this.current()].messages
    );

    setLocale(code: LocaleCode): void {
        this.current.set(code);
        document.documentElement.lang = code;
        try {
            localStorage.setItem(STORAGE_KEY, code);
        } catch {
            // Private browsing, or storage disabled. The choice just will not persist.
        }
    }

    /**
     * Translate a key, substituting `{0}`, `{1}` ... with `args`.
     *
     * Returns the key itself if it is somehow missing, which makes a gap
     * visible in the UI rather than rendering an empty string.
     */
    t(key: keyof Messages, ...args: StepArg[]): string {
        return this.fill(this.messages()[key] ?? key, args);
    }

    /**
     * Translate a narrated line coming out of the shared core.
     *
     * The core emits both an English string and a {@link StepMessage}; this
     * prefers the catalogue and falls back to the English original, so a key
     * that has not been written yet degrades to a readable sentence rather than
     * to `step.send.submit.why`.
     */
    tMessage<F extends string | undefined>(
        message: StepMessage | undefined,
        fallback: F
    ): string | F {
        if (!message) return fallback;
        const template = this.messages()[message.key as keyof Messages];
        if (template === undefined) return fallback;
        return this.fill(template, message.args ?? []);
    }

    // --- locale-aware formatting ----------------------------------------

    /** `1234` -> `"1,234 sats"`, or `"1.234 sats"` for a German reader. */
    sats(value: number | bigint): string {
        return sats(value, this.current());
    }

    /** `150000000` -> `"1.50000000 BTC"`, or `"1,50000000 BTC"` in German. */
    btc(value: number | bigint): string {
        return btc(value, this.current());
    }

    /** `172800000` -> `"2 days"`, or `"2 Tage"` in German. */
    duration(ms: number): string {
        return duration(ms, this.current());
    }

    /** A date and time in the reader's locale. */
    dateTime(timestamp: number): string {
        return new Date(timestamp).toLocaleString(this.current(), {
            dateStyle: "medium",
            timeStyle: "short",
        });
    }

    /**
     * The SDK's VTXO state word (`settled`, `preconfirmed`, `swept`, `spent`).
     *
     * Unknown states fall through untranslated rather than disappearing — a new
     * state the SDK invents should still be visible.
     */
    vtxoState(state: string): string {
        const template = this.messages()[`vtxo.state.${state}` as keyof Messages];
        return template ?? state;
    }

    private fill(template: string, args: readonly StepArg[]): string {
        return args.reduce<string>(
            (text, value, index) =>
                text.replaceAll(`{${index}}`, formatArg(value, this.current())),
            template
        );
    }
}

/** Stored choice, else the browser's preferred language, else English. */
function detectLocale(): LocaleCode {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && isLocale(stored)) return stored;
    } catch {
        // Ignore and fall through to the navigator.
    }
    for (const tag of navigator.languages ?? []) {
        const base = tag.split("-")[0];
        if (base && isLocale(base)) return base;
    }
    return "en";
}

function isLocale(value: string): value is LocaleCode {
    return (LOCALE_CODES as string[]).includes(value);
}
