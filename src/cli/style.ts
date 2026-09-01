/**
 * Terminal styling. CLI-only -- it reads `process.env` and `process.stdout`,
 * which is exactly why it does not live in `src/format.ts`.
 */

const useColor =
    !process.env.NO_COLOR &&
    process.env.TERM !== "dumb" &&
    Boolean(process.stdout.isTTY);

const wrap = (open: string) => (text: string) =>
    useColor ? `[${open}m${text}[0m` : text;

export const style = {
    bold: wrap("1"),
    dim: wrap("2"),
    green: wrap("32"),
    yellow: wrap("33"),
    blue: wrap("34"),
    red: wrap("31"),
    cyan: wrap("36"),
};

/**
 * Render aligned `label  value` rows.
 *
 * @param pairs - `[label, value]` pairs. Empty labels render as spacers.
 */
export function rows(pairs: Array<[string, string]>, indent = "  "): string {
    const width = Math.max(0, ...pairs.map(([label]) => label.length));
    return pairs
        .map(([label, value]) =>
            label
                ? `${indent}${style.dim(label.padEnd(width))}  ${value}`
                : `${indent}${" ".repeat(width)}  ${value}`
        )
        .join("\n");
}

/** Wrap prose to `width` columns, preserving a leading indent. */
export function paragraph(text: string, width = 68, indent = "  "): string {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
        if (line && line.length + 1 + word.length > width) {
            lines.push(line);
            line = word;
        } else {
            line = line ? `${line} ${word}` : word;
        }
    }
    if (line) lines.push(line);
    return lines.map((l) => indent + l).join("\n");
}
