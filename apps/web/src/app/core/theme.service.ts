import { Injectable, signal } from "@angular/core";

export type ThemeChoice = "light" | "dark";

const STORAGE_KEY = "firstsats.theme";

/**
 * Light or dark, for the whole page.
 *
 * Deliberately not per profile. A split view with one light pane and one dark
 * one is possible — the tokens are scoped to a subtree, not the document — but
 * it reads as a rendering fault rather than a setting, and it makes the two
 * wallets harder to compare rather than easier. Identity is carried by colour
 * instead, which works the same in both themes.
 */
@Injectable({ providedIn: "root" })
export class ThemeService {
    private readonly current = signal<ThemeChoice>(load());
    readonly theme = this.current.asReadonly();

    constructor() {
        this.apply(this.current());
    }

    set(choice: ThemeChoice): void {
        this.current.set(choice);
        this.apply(choice);
        try {
            localStorage.setItem(STORAGE_KEY, choice);
        } catch {
            // Private browsing; the choice lasts for this session only.
        }
    }

    toggle(): void {
        this.set(this.current() === "dark" ? "light" : "dark");
    }

    private apply(choice: ThemeChoice): void {
        document.documentElement.setAttribute("data-theme", choice);
    }
}

/** A stored choice if there is one, else whatever the OS asks for. */
function load(): ThemeChoice {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === "light" || stored === "dark") return stored;
    } catch {
        // Ignore and fall through to the OS preference.
    }
    return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}
