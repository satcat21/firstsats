/**
 * Turning the narration stream into terminal output.
 *
 * This is the only file that decides what a {@link Step} *looks* like. Swap it
 * for a React component and the rest of the app is unchanged -- which is the
 * point of making narration a typed stream in the first place.
 */

import { duration } from "../format.js";
import type { Step } from "../narrator.js";
import { paragraph, style } from "./style.js";

export interface RenderOptions {
    /** Print the "behind the scenes" explanations. On by default. */
    readonly explain?: boolean;
    /** Suppress step output entirely; only command results are printed. */
    readonly quiet?: boolean;
    /** Sink for output lines. Defaults to `console.log`; tests pass an array push. */
    readonly write?: (line: string) => void;
}

const MARK: Record<Step["status"], string> = {
    start: style.dim("..."),
    ok: style.green(" ok"),
    fail: style.red("!! "),
    info: style.blue(" --"),
};

/**
 * A `start` step is worth printing only when it carries narration the matching
 * `ok` line will not repeat. Otherwise printing both is noise.
 */
export function shouldRender(step: Step, explain: boolean): boolean {
    if (step.status !== "start") return true;
    return Boolean(step.detail) || (explain && Boolean(step.behindTheScenes));
}

/** Render one step to an array of lines. Pure, so it is straightforward to test. */
export function renderStep(step: Step, explain: boolean): string[] {
    const took =
        step.durationMs !== undefined && step.durationMs >= 1000
            ? style.dim(` (${duration(step.durationMs)})`)
            : "";

    const lines = [`${MARK[step.status]}  ${step.title}${took}`];
    if (step.detail) lines.push(style.dim(`     ${step.detail}`));
    if (explain && step.behindTheScenes) {
        lines.push("");
        lines.push(style.cyan("     behind the scenes"));
        lines.push(style.dim(paragraph(step.behindTheScenes, 66, "     ")));
        lines.push("");
    }
    return lines;
}

/** Build a step listener that prints to the terminal. */
export function createStepRenderer(options: RenderOptions = {}): (step: Step) => void {
    const explain = options.explain ?? true;
    const quiet = options.quiet ?? false;
    const write = options.write ?? ((line: string) => console.log(line));

    return (step: Step): void => {
        if (quiet || !shouldRender(step, explain)) return;
        for (const line of renderStep(step, explain)) write(line);
    };
}
