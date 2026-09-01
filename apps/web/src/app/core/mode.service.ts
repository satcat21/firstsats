/**
 * Two rooms, not one app with a switch.
 *
 * Free mode and quest mode each own their users, wallets, tabs and guide
 * position outright. Entering quest mode does not touch what free mode holds,
 * and leaving puts free mode back exactly as it was — including a half-finished
 * run waiting for you on your next visit. That is why this is a *room* and not
 * a flag: a flag would have both modes fighting over one set of profiles.
 *
 * Isolation is done by namespacing storage, and switching reloads the page. The
 * reload is not laziness: profiles are read into signals at construction, panes
 * hold live wallets with open event streams, and there is no honest way to swap
 * all of that underneath a running app. Reloading is also what makes the switch
 * feel like walking through a door, which is the point.
 */

import { Injectable, signal } from "@angular/core";

export type Mode = "free" | "quest";

const MODE_KEY = "firstsats.mode";

/** Set on entering, consumed once the new room has painted. */
const WELCOME_KEY = "firstsats.quest.welcome";

/**
 * The current room, readable before Angular exists.
 *
 * A plain function rather than a service member because storage keys are module
 * constants evaluated at import time, and they need the answer first.
 */
export function currentMode(): Mode {
    try {
        return localStorage.getItem(MODE_KEY) === "quest" ? "quest" : "free";
    } catch {
        return "free";
    }
}

/**
 * The storage prefix owned by the current room.
 *
 * Free mode keeps the original, unprefixed keys, so everything anyone already
 * had stays exactly where it was and belongs to free mode.
 */
export function roomPrefix(): string {
    return currentMode() === "quest" ? "firstsats.quest-room" : "firstsats";
}

@Injectable({ providedIn: "root" })
export class ModeService {
    readonly mode = signal<Mode>(currentMode());

    readonly quest = signal<boolean>(currentMode() === "quest");

    constructor() {
        // A document-level fact, like the theme: it lets CSS shade the whole
        // page for the room without any component owning that decision.
        document.documentElement.setAttribute("data-mode", this.mode());
    }

    /**
     * Whether the welcome is owed, clearing it as it answers.
     *
     * Written before the reload and read after it, because the explanation
     * belongs in the room it describes, not on top of the one being left.
     */
    takeWelcome(): boolean {
        try {
            if (localStorage.getItem(WELCOME_KEY) !== "1") return false;
            localStorage.removeItem(WELCOME_KEY);
            return true;
        } catch {
            return false;
        }
    }

    enter(): void {
        this.go("quest", true);
    }

    leave(): void {
        this.go("free", false);
    }

    private go(mode: Mode, welcome: boolean): void {
        try {
            localStorage.setItem(MODE_KEY, mode);
            if (welcome) localStorage.setItem(WELCOME_KEY, "1");
        } catch {
            // Private browsing. The switch still happens for this session; it
            // simply will not be remembered, which is the best available.
        }
        location.reload();
    }
}
