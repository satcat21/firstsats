import { describe, expect, it } from "vitest";
import {
    ArgError,
    boolFlag,
    parseArgs,
    parseInteger,
    parseSats,
    stringFlag,
} from "../src/cli/args.js";
import { nextStep } from "../src/cli/commands/tour.js";
import { renderStep, shouldRender } from "../src/cli/render.js";
import { paragraph } from "../src/cli/style.js";
import { btc, duration, sats, short } from "../src/format.js";
import type { Step } from "../src/narrator.js";

const step = (overrides: Partial<Step> = {}): Step => ({
    id: "demo",
    status: "ok",
    title: "Doing the thing",
    at: 0,
    ...overrides,
});

describe("parseArgs", () => {
    it("splits the command from its positional arguments", () => {
        const args = parseArgs(["send", "ark1abc", "5000"]);
        expect(args.command).toBe("send");
        expect(args.positional).toEqual(["ark1abc", "5000"]);
    });

    it("defaults to help with no arguments", () => {
        expect(parseArgs([]).command).toBe("help");
    });

    it("reads --flag value", () => {
        expect(stringFlag(parseArgs(["x", "--wallet", "alice"]), "wallet")).toBe(
            "alice"
        );
    });

    it("reads --flag=value", () => {
        expect(stringFlag(parseArgs(["x", "--wallet=alice"]), "wallet")).toBe("alice");
    });

    it("treats a trailing flag as boolean true", () => {
        expect(boolFlag(parseArgs(["x", "--json"]), "json", false)).toBe(true);
    });

    it("reads --no-flag as false", () => {
        expect(boolFlag(parseArgs(["x", "--no-explain"]), "explain", true)).toBe(false);
    });

    it("falls back when a flag is absent", () => {
        expect(boolFlag(parseArgs(["x"]), "explain", true)).toBe(true);
        expect(stringFlag(parseArgs(["x"]), "wallet")).toBeUndefined();
    });

    it("treats everything after a bare -- as positional", () => {
        const args = parseArgs(["send", "--", "--not-a-flag"]);
        expect(args.positional).toEqual(["--not-a-flag"]);
    });

    it("does not swallow the next flag as a value", () => {
        const args = parseArgs(["x", "--json", "--wallet", "alice"]);
        expect(boolFlag(args, "json", false)).toBe(true);
        expect(stringFlag(args, "wallet")).toBe("alice");
    });
});

describe("parseSats", () => {
    it("accepts plain digits", () => {
        expect(parseSats("5000")).toBe(5000);
    });

    it("accepts separators people actually type", () => {
        expect(parseSats("50_000")).toBe(50_000);
        expect(parseSats("50,000")).toBe(50_000);
    });

    it("rejects decimals rather than silently truncating", () => {
        expect(() => parseSats("0.5")).toThrow(ArgError);
    });

    it("rejects a missing amount with a usable hint", () => {
        expect(() => parseSats(undefined)).toThrow(/satoshis/);
    });

    it("labels the field it could not parse", () => {
        expect(() => parseInteger("abc", "timeout in seconds")).toThrow(
            /timeout in seconds/
        );
    });
});

describe("formatting", () => {
    it("groups satoshis", () => {
        expect(sats(1_234_567)).toBe("1,234,567 sats");
    });

    it("renders BTC from the integer, with all eight places", () => {
        expect(btc(150_000_000)).toBe("1.50000000 BTC");
        expect(btc(1)).toBe("0.00000001 BTC");
        expect(btc(0)).toBe("0.00000000 BTC");
    });

    it("shortens long identifiers but leaves short ones alone", () => {
        expect(short("a".repeat(64))).toBe(`${"a".repeat(8)}…${"a".repeat(6)}`);
        expect(short("abc")).toBe("abc");
    });

    it("describes durations coarsely", () => {
        expect(duration(1000)).toBe("1 second");
        expect(duration(90_000)).toBe("2 minutes");
        expect(duration(86_400_000)).toBe("1 day");
    });

    it("wraps prose to the requested width", () => {
        const wrapped = paragraph("one two three four five", 9, "");
        expect(wrapped.split("\n").every((line) => line.length <= 9)).toBe(true);
    });
});

describe("step rendering", () => {
    it("skips a bare start step, because the ok line says the same thing", () => {
        expect(shouldRender(step({ status: "start" }), true)).toBe(false);
    });

    it("renders a start step that explains something new", () => {
        expect(
            shouldRender(
                step({ status: "start", behindTheScenes: "why this matters" }),
                true
            )
        ).toBe(true);
    });

    it("skips that same step when explanations are turned off", () => {
        expect(
            shouldRender(
                step({ status: "start", behindTheScenes: "why this matters" }),
                false
            )
        ).toBe(false);
    });

    it("always renders terminal steps", () => {
        for (const status of ["ok", "fail", "info"] as const) {
            expect(shouldRender(step({ status }), true)).toBe(true);
        }
    });

    it("omits the explanation when asked to", () => {
        const lines = renderStep(
            step({ detail: "d", behindTheScenes: "why" }),
            false
        ).join("\n");
        expect(lines).toContain("d");
        expect(lines).not.toContain("why");
    });

    it("shows a duration only once it is worth mentioning", () => {
        expect(renderStep(step({ durationMs: 12 }), false).join()).not.toContain(
            "second"
        );
        expect(renderStep(step({ durationMs: 4000 }), false).join()).toContain(
            "4 seconds"
        );
    });
});

describe("tour", () => {
    const state = {
        arkadeAddress: "ark1abc",
        boardingAddress: "tb1abc",
        vtxoCount: 0,
        faucetUrl: "https://faucet.example/",
        balance: {
            available: 0,
            settled: 0,
            preconfirmed: 0,
            boarding: 0,
            recoverable: 0,
            total: 0,
        },
    };

    it("sends an empty wallet to get coins", () => {
        expect(nextStep(state).title).toContain("Step 2");
    });

    it("prioritises onboarding while money is still on-chain", () => {
        const step = nextStep({
            ...state,
            balance: { ...state.balance, boarding: 50_000, total: 50_000 },
        });
        expect(step.title).toContain("Step 3");
        expect(step.body).toContain("onboard");
    });

    it("moves on to sending once funds are spendable", () => {
        const step = nextStep({
            ...state,
            vtxoCount: 2,
            balance: { ...state.balance, available: 50_000, total: 50_000 },
        });
        expect(step.title).toContain("Step 4");
    });

    it("explains the awkward case where everything is tied up", () => {
        const step = nextStep({
            ...state,
            balance: { ...state.balance, recoverable: 300, total: 300 },
        });
        expect(step.title).toBe("Everything is tied up");
    });
});
