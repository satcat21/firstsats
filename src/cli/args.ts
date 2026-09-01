/**
 * A very small argument parser.
 *
 * Deliberately hand-rolled: a reference application should be readable end to
 * end, and 60 lines here beats a dependency whose behaviour you have to go and
 * look up.
 */

export interface ParsedArgs {
    readonly command: string;
    /** Positional arguments after the command. */
    readonly positional: readonly string[];
    readonly flags: Readonly<Record<string, string | boolean>>;
}

export class ArgError extends Error {}

/**
 * Parse `["send", "ark1...", "5000", "--wallet", "alice", "--no-explain"]`.
 *
 * Supports `--flag`, `--flag=value`, `--flag value`, and `--no-flag` (false).
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
    const positional: string[] = [];
    const flags: Record<string, string | boolean> = {};

    for (let i = 0; i < argv.length; i++) {
        const token = argv[i] as string;

        if (!token.startsWith("--")) {
            positional.push(token);
            continue;
        }

        const body = token.slice(2);
        if (body.length === 0) {
            // Bare `--`: everything after it is positional.
            positional.push(...argv.slice(i + 1));
            break;
        }

        const eq = body.indexOf("=");
        if (eq !== -1) {
            flags[body.slice(0, eq)] = body.slice(eq + 1);
            continue;
        }

        if (body.startsWith("no-")) {
            flags[body.slice(3)] = false;
            continue;
        }

        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
            flags[body] = next;
            i++;
        } else {
            flags[body] = true;
        }
    }

    const [command = "help", ...rest] = positional;
    return { command, positional: rest, flags };
}

/** Read a flag as a string, or `undefined` when absent. */
export function stringFlag(args: ParsedArgs, name: string): string | undefined {
    const value = args.flags[name];
    return typeof value === "string" ? value : undefined;
}

/** Read a flag as a boolean, falling back to `fallback` when absent. */
export function boolFlag(args: ParsedArgs, name: string, fallback: boolean): boolean {
    const value = args.flags[name];
    return typeof value === "boolean" ? value : fallback;
}

/**
 * Parse a non-negative whole number from the command line.
 *
 * Accepts underscores and commas as separators (`50_000`, `50,000`) because
 * people type them, and rejects anything else loudly rather than coercing.
 */
export function parseInteger(input: string | undefined, label: string): number {
    if (input === undefined) {
        throw new ArgError(`Missing ${label}.`);
    }
    const cleaned = input.replaceAll("_", "").replaceAll(",", "").trim();
    if (!/^\d+$/.test(cleaned)) {
        throw new ArgError(`"${input}" is not a whole number (${label}).`);
    }
    return Number(cleaned);
}

/** Parse a satoshi amount. There are 100,000,000 satoshis in one bitcoin. */
export function parseSats(input: string | undefined): number {
    if (input === undefined) {
        throw new ArgError("Missing amount. Amounts are in satoshis, e.g. 5000.");
    }
    return parseInteger(input, "amount in satoshis");
}
