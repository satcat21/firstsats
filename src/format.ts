/**
 * Pure presentation helpers.
 *
 * Deliberately free of `process`, `console` and any DOM API: this module is
 * imported by the browser build as well as the CLI, so anything Node-specific
 * lives in `src/cli/style.ts` instead.
 *
 * Every formatter takes an optional locale. The CLI never passes one and keeps
 * its English output; the web app passes the language the reader picked, so a
 * German reader sees `1.234 Sats` and `2 Tage` rather than `1,234 sats` and
 * `2 days`.
 */

const SATS_PER_BTC = 100_000_000;

/** What the CLI formats with. The web overrides it per render. */
export const DEFAULT_LOCALE = "en-US";

/** `12345` -> `"12,345 sats"`. Bitcoin amounts are integers; never use floats. */
export function sats(amount: number | bigint, locale: string = DEFAULT_LOCALE): string {
    const n = typeof amount === "bigint" ? amount : BigInt(Math.trunc(amount));
    return `${n.toLocaleString(locale)} sats`;
}

/** `150000000` -> `"1.50000000 BTC"`. Rendered from the integer, not via division of floats. */
export function btc(amount: number | bigint, locale: string = DEFAULT_LOCALE): string {
    const n = typeof amount === "bigint" ? amount : BigInt(Math.trunc(amount));
    const negative = n < 0n;
    const abs = negative ? -n : n;
    const whole = abs / BigInt(SATS_PER_BTC);
    const frac = (abs % BigInt(SATS_PER_BTC)).toString().padStart(8, "0");
    return `${negative ? "-" : ""}${whole}${decimalSeparator(locale)}${frac} BTC`;
}

/** Shorten a long identifier for display: `a3f9…21cd`. */
export function short(value: string, head = 8, tail = 6): string {
    if (value.length <= head + tail + 1) return value;
    return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** The coarse unit a duration is best described in, and how many of them. */
export interface DurationParts {
    /** A unit `Intl.NumberFormat` accepts with `style: "unit"`. */
    readonly unit: "day" | "hour" | "minute" | "second" | "millisecond";
    readonly count: number;
}

const UNITS: ReadonlyArray<readonly [DurationParts["unit"], number]> = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
    ["second", 1000],
];

/**
 * Split a duration into one coarse unit -- deliberately lossy; this is for
 * orientation, not accounting.
 *
 * Separate from {@link duration} because the pluralisation and the unit name
 * are the translator's business, and `Intl` already knows both for every
 * language. Handing it the pair rather than a finished string is what lets the
 * same number read as `2 days`, `2 Tage` or `2 giorni`.
 */
export function durationParts(ms: number): DurationParts {
    const abs = Math.abs(ms);
    for (const [unit, size] of UNITS) {
        if (abs >= size) return { unit, count: Math.round(abs / size) };
    }
    return { unit: "millisecond", count: abs };
}

/** `"3 minutes"`, `"2 days"`, and in German `"2 Tage"`. */
export function duration(ms: number, locale: string = DEFAULT_LOCALE): string {
    const { unit, count } = durationParts(ms);
    return new Intl.NumberFormat(locale, {
        style: "unit",
        unit,
        unitDisplay: "long",
    }).format(count);
}

// --- narration arguments -------------------------------------------------

/**
 * One substitution in a narrated message.
 *
 * A bare string or number is inserted as-is. The tagged forms carry an
 * *unformatted* value instead, so the amount inside `"3,000 sats available of
 * 5,000 sats total"` is rendered in the reader's language at display time
 * rather than baked into English by the code that emitted it.
 */
export type StepArg =
    | string
    | number
    | { readonly kind: "sats"; readonly value: number | bigint }
    | { readonly kind: "btc"; readonly value: number | bigint }
    | { readonly kind: "duration"; readonly ms: number };

/** Tag an amount in satoshis for locale-aware rendering. */
export const satsArg = (value: number | bigint): StepArg => ({ kind: "sats", value });

/** Tag an amount to be shown in BTC. */
export const btcArg = (value: number | bigint): StepArg => ({ kind: "btc", value });

/** Tag a millisecond duration. */
export const durationArg = (ms: number): StepArg => ({ kind: "duration", ms });

/** Render one {@link StepArg} in `locale`. */
export function formatArg(arg: StepArg, locale: string = DEFAULT_LOCALE): string {
    if (typeof arg === "string") return arg;
    if (typeof arg === "number") return arg.toLocaleString(locale);
    switch (arg.kind) {
        case "sats":
            return sats(arg.value, locale);
        case "btc":
            return btc(arg.value, locale);
        case "duration":
            return duration(arg.ms, locale);
    }
}

/** The locale's decimal mark, so BTC amounts read naturally outside English. */
function decimalSeparator(locale: string): string {
    const parts = new Intl.NumberFormat(locale).formatToParts(1.1);
    return parts.find((part) => part.type === "decimal")?.value ?? ".";
}
