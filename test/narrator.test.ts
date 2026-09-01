import { describe, expect, it, vi } from "vitest";
import { describeError, Narrator } from "../src/narrator.js";

/** A clock that advances 250ms per read, so durations are deterministic. */
function fakeClock(step = 250) {
    let t = 1_000;
    return () => {
        const now = t;
        t += step;
        return now;
    };
}

describe("Narrator", () => {
    it("brackets a successful operation with start and ok", async () => {
        const narrator = new Narrator();

        const result = await narrator.track(
            { id: "demo", title: "Doing the thing" },
            async () => 42
        );

        expect(result).toBe(42);
        expect(narrator.stepsFor("demo").map((s) => s.status)).toEqual(["start", "ok"]);
    });

    it("attaches result-derived narration only on success", async () => {
        const narrator = new Narrator();

        await narrator.track(
            {
                id: "demo",
                title: "Doing the thing",
                after: (n: number) => ({ detail: `got ${n}` }),
            },
            async () => 7
        );

        expect(narrator.stepsFor("demo").at(-1)?.detail).toBe("got 7");
    });

    it("narrates a failure and rethrows the original error", async () => {
        const narrator = new Narrator();
        const boom = new Error("boom");

        await expect(
            narrator.track({ id: "demo", title: "Doing the thing" }, async () => {
                throw boom;
            })
        ).rejects.toBe(boom);

        const steps = narrator.stepsFor("demo");
        expect(steps.map((s) => s.status)).toEqual(["start", "fail"]);
        expect(steps.at(-1)?.detail).toBe("boom");
    });

    it("does not call `after` when the operation failed", async () => {
        const narrator = new Narrator();
        const after = vi.fn();

        await expect(
            narrator.track({ id: "demo", title: "t", after }, async () => {
                throw new Error("no");
            })
        ).rejects.toThrow();

        expect(after).not.toHaveBeenCalled();
    });

    it("measures duration on the terminal step", async () => {
        const narrator = new Narrator(fakeClock(250));
        await narrator.track({ id: "demo", title: "t" }, async () => null);
        expect(narrator.stepsFor("demo").at(-1)?.durationMs).toBeGreaterThan(0);
    });

    it("notifies listeners and honours unsubscribe", () => {
        const narrator = new Narrator();
        const seen: string[] = [];
        const off = narrator.on((s) => seen.push(s.id));

        narrator.info("one", "One");
        off();
        narrator.info("two", "Two");

        expect(seen).toEqual(["one"]);
    });

    it("keeps working when a listener throws -- narration must not break a payment", async () => {
        const narrator = new Narrator();
        narrator.on(() => {
            throw new Error("bad renderer");
        });

        await expect(
            narrator.track({ id: "demo", title: "t" }, async () => "fine")
        ).resolves.toBe("fine");
    });

    it("records history in order", () => {
        const narrator = new Narrator();
        narrator.info("a", "A");
        narrator.info("b", "B");
        expect(narrator.history().map((s) => s.id)).toEqual(["a", "b"]);
    });
});

describe("describeError", () => {
    it("prefers an Error's message", () => {
        expect(describeError(new Error("nope"))).toBe("nope");
    });

    it("passes strings through", () => {
        expect(describeError("plain")).toBe("plain");
    });

    it("falls back to JSON for anything else", () => {
        expect(describeError({ code: 42 })).toBe('{"code":42}');
    });

    it("survives a value JSON cannot serialise", () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(describeError(cyclic)).toBe("[object Object]");
    });
});
