/**
 * Several wallets, side by side.
 *
 * A payment needs two parties, and a teaching app that can only hold one wallet
 * can only ever show you half of one. Profiles are independent wallets — their
 * own seed, name, colour and light/dark choice — and two of them can be on
 * screen at once so a transfer can be watched from both ends.
 *
 * Each profile owns a *seed*, not a session: switching profiles is not logging
 * out, it is looking at a different wallet this browser also holds.
 */

import { Injectable, computed, signal } from "@angular/core";
import { createMnemonic, isValidMnemonic, normalizeMnemonic } from "./browser-keystore";
import { roomPrefix } from "./mode.service";
import { databaseFor } from "./browser-wallet";

/*
 * Namespaced by room, so quest mode's users are not free mode's.
 *
 * Free mode keeps the original key, which means everything anyone
 * already had stays where it is and belongs to free mode. Evaluated once
 * at import: the room only changes across a reload.
 */
const STORAGE_KEY = `${roomPrefix()}.profiles.v1`;

export interface Profile {
    readonly id: string;
    readonly name: string;
    /**
     * BIP-39 seed phrase, once this user has made a wallet.
     *
     * Absent to begin with, and deliberately so: a user arriving with a wallet
     * already made skips the one step this app exists to show. Creating it is
     * something you do, not something that has happened to you.
     */
    readonly mnemonic?: string;
    /** Which entry of {@link ACCENTS} this wallet is recognised by. */
    readonly accent: Accent;
    readonly createdAt: string;
    /**
     * Whether a person has ever changed this user's name or colour.
     *
     * Only quest mode reads it, and only to tell "made their own" apart from
     * "accepted the defaults" — which the values alone cannot say, since a
     * default name is a perfectly good choice someone might also pick.
     */
    readonly touched?: boolean;
    /**
     * Whether this user has ever taken money back on-chain.
     *
     * Recorded rather than derived, because after a withdrawal the balance is
     * zero — which looks exactly like a wallet that never held anything. Only
     * the fact that it happened separates the two, and it has to survive a
     * reload for the guide to keep the chapter ticked.
     */
    readonly withdrawn?: boolean;
}

/**
 * Identity colours.
 *
 * A pastel to recognise the wallet by and a dark ink to write with. Two values
 * rather than one because a single colour cannot do both jobs: a fill light
 * enough to tell apart at a glance is too light to carry white text, and one
 * dark enough for a button is too muddy to distinguish from its neighbours.
 *
 * Every pair clears WCAG AA in the combinations actually used — ink on tint for
 * the avatar, white on ink for buttons, tint on a dark ground for links.
 */
export interface Accent {
    /** Pastel. The wallet's face: avatar, pane tint, links in dark mode. */
    readonly tint: string;
    /** Dark. Buttons, and text on light grounds. */
    readonly ink: string;
}

export const ACCENTS: readonly Accent[] = [
    { tint: "#c4b5fd", ink: "#4c1d95" }, // violet
    { tint: "#99f6e4", ink: "#115e59" }, // teal
    { tint: "#fde68a", ink: "#92400e" }, // amber
    { tint: "#bae6fd", ink: "#075985" }, // sky
    { tint: "#fbcfe8", ink: "#9d174d" }, // pink
    { tint: "#d9f99d", ink: "#3f6212" }, // lime
];

const NAMES = [
    "Alice", "Bob", "Carol", "Dave", "Erin", "Frank", "Grace", "Heidi",
    "Ivan", "Judy", "Mallory", "Niaj", "Olivia", "Peggy", "Rupert", "Sybil",
];

@Injectable({ providedIn: "root" })
export class ProfileService {
    readonly profiles = signal<Profile[]>(load());

    /**
     * The profiles on screen: one normally, two in split view.
     *
     * Held as ids rather than objects so an edit to a profile does not have to
     * be mirrored here.
     */
    readonly visibleIds = signal<string[]>(loadVisible());

    readonly visible = computed(() => {
        const byId = new Map(this.profiles().map((p) => [p.id, p]));
        const ids = this.visibleIds()
            .map((id) => byId.get(id))
            .filter((p): p is Profile => p !== undefined);
        // Never show nothing: fall back to the first profile that exists.
        if (ids.length === 0) {
            const first = this.profiles()[0];
            return first ? [first] : [];
        }
        return ids;
    });

    readonly split = computed(() => this.visible().length > 1);

    /**
     * Whether the tour is docked beside the wallet rather than living in its
     * tab.
     *
     * Only offered with a single wallet on screen and only on a wide viewport:
     * three columns is one too many, and on a phone a docked pane would leave
     * neither half usable. There the tour stays a tab, which works.
     */
    readonly tourDocked = signal<boolean>(loadDocked());

    /**
     * Which tab each user is on.
     *
     * Held here rather than inside the pane because the docked tour lives
     * outside every pane and still has to be able to say "go to Receive".
     */
    private readonly tabs = signal<Record<string, string>>(loadTabs());

    tabFor(id: string): string | undefined {
        return this.tabs()[id];
    }

    setTab(id: string, tab: string): void {
        const next = { ...this.tabs(), [id]: tab };
        this.tabs.set(next);
        write(`${STORAGE_KEY}.tabs`, next);
    }

    /**
     * The guide chapter the reader last had open.
     *
     * Kept here rather than in the guide itself, which is destroyed every time
     * its tab is left — including by its own "go to Receive" button. Holding
     * the position in the component meant following that button and coming
     * back dropped you at the first unfinished chapter instead of the one you
     * were reading.
     *
     * `undefined` means never chosen, `null` means the reader closed them all.
     */
    private readonly chapter = signal<string | null | undefined>(loadChapter());

    readonly openChapter = this.chapter.asReadonly();

    setChapter(id: string | null): void {
        this.chapter.set(id);
        write(`${STORAGE_KEY}.chapter`, id ?? "");
    }

    /**
     * Which guide chapters have been opened.
     *
     * The reading chapters have nothing in the wallet to observe, so this is
     * the only honest evidence that one is finished. Before it existed they
     * were simply hardcoded complete, which put a tick on a chapter at the end
     * of the tour that the reader had plainly never opened.
     */
    private readonly visited = signal<ReadonlySet<string>>(loadVisited());

    readonly visitedChapters = this.visited.asReadonly();

    markVisited(id: string): void {
        if (this.visited().has(id)) return;
        const next = new Set(this.visited()).add(id);
        this.visited.set(next);
        write(`${STORAGE_KEY}.visited`, [...next]);
    }

    setTourDocked(docked: boolean): void {
        this.tourDocked.set(docked);
        write(`${STORAGE_KEY}.tourDocked`, docked);
    }

    /** Create a user. They have no wallet until they make one. */
    create(options: { name?: string; mnemonic?: string } = {}): Profile {
        const existing = this.profiles();
        const phrase = options.mnemonic
            ? normalizeMnemonic(options.mnemonic)
            : undefined;
        if (phrase !== undefined && !isValidMnemonic(phrase)) {
            throw new Error("That is not a valid twelve-word recovery phrase.");
        }

        const profile: Profile = {
            id: crypto.randomUUID(),
            name: options.name?.trim() || nextName(existing),
            ...(phrase ? { mnemonic: phrase } : {}),
            // Walk the palette in order so the second wallet never lands on the
            // first one's colour, which is the whole point of having one.
            accent: ACCENTS[existing.length % ACCENTS.length] ?? ACCENTS[0]!,
            createdAt: new Date().toISOString(),
        };

        this.persist([...existing, profile]);
        this.show(profile.id);
        return profile;
    }

    /**
     * Record that this user has exited to the chain.
     *
     * Writes directly rather than through `update`, which stamps `touched` —
     * withdrawing is not the same as personalising, and conflating them would
     * silently complete a different quest.
     */
    markWithdrawn(id: string): void {
        this.persist(
            this.profiles().map((p) => (p.id === id ? { ...p, withdrawn: true } : p))
        );
    }

    /**
     * Give a user a wallet.
     *
     * Separate from {@link create} because it is a separate act: the user
     * exists first, and then decides to hold money.
     */
    attachWallet(id: string, mnemonic?: string): Profile | undefined {
        const phrase = mnemonic ? normalizeMnemonic(mnemonic) : createMnemonic();
        if (!isValidMnemonic(phrase)) {
            throw new Error("That is not a valid twelve-word recovery phrase.");
        }
        this.persist(
            this.profiles().map((p) => (p.id === id ? { ...p, mnemonic: phrase } : p))
        );
        return this.byId(id);
    }

    update(id: string, changes: Partial<Omit<Profile, "id" | "mnemonic">>): void {
        this.persist(
            this.profiles().map((p) =>
                p.id === id ? { ...p, ...changes, touched: true } : p
            )
        );
    }

    remove(id: string): void {
        this.persist(this.profiles().filter((p) => p.id !== id));
        this.setVisible(this.visibleIds().filter((v) => v !== id));
    }

    /**
     * Delete every user, and the wallet database each one owns.
     *
     * Quest progress is read off real state rather than stored as a score, so
     * clearing the score alone changes nothing: the users are still there, and
     * the next evaluation re-earns every quest immediately. Starting the run
     * over has to mean starting the world over.
     */
    async removeAll(): Promise<void> {
        const ids = this.profiles().map((p) => p.id);
        this.persist([]);
        this.setVisible([]);
        this.tabs.set({});
        write(`${STORAGE_KEY}.tabs`, {});
        this.chapter.set(undefined);
        write(`${STORAGE_KEY}.chapter`, null);
        this.visited.set(new Set());
        write(`${STORAGE_KEY}.visited`, []);
        await Promise.all(ids.map((id) => dropDatabase(databaseFor(id))));
    }

    /** Show one profile on its own. */
    show(id: string): void {
        this.setVisible([id]);
    }

    /**
     * Take one profile off screen, leaving whatever else is showing.
     *
     * Guarded rather than trusting the caller: emptying the list would fall
     * back to showing the first profile that exists, so closing the only pane
     * would silently swap which wallet you were looking at.
     */
    hide(id: string): void {
        const rest = this.visibleIds().filter((v) => v !== id);
        if (rest.length > 0) this.setVisible(rest);
    }

    /** Swap the two visible profiles left-to-right. */
    swapSides(): void {
        this.setVisible([...this.visibleIds()].reverse());
    }

    /** Put a second profile beside the first, or drop back to one. */
    toggleSplit(id: string): void {
        const ids = this.visibleIds();
        if (ids.includes(id)) {
            this.setVisible(ids.filter((v) => v !== id));
        } else {
            this.setVisible([...ids, id].slice(-2));
        }
    }

    byId(id: string): Profile | undefined {
        return this.profiles().find((p) => p.id === id);
    }

    private persist(profiles: Profile[]): void {
        this.profiles.set(profiles);
        write(STORAGE_KEY, profiles);
    }

    private setVisible(ids: string[]): void {
        this.visibleIds.set(ids);
        write(`${STORAGE_KEY}.visible`, ids);
    }
}

/** `Alice`, then `Bob`, … skipping any already taken. */
function nextName(existing: readonly Profile[]): string {
    const taken = new Set(existing.map((p) => p.name));
    return NAMES.find((n) => !taken.has(n)) ?? `Wallet ${existing.length + 1}`;
}

function write(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Private browsing. The wallets last for this session only, which is
        // survivable for a demo and loudly wrong for a real wallet.
    }
}

function load(): Profile[] {
    const stored = read<Profile[]>(STORAGE_KEY);
    if (stored) {
        return stored
            // A user with no wallet yet is valid; one with a corrupt seed is not.
            .filter((p) => p?.id && (!p.mnemonic || isValidMnemonic(p.mnemonic)))
            .map((p, i) => ({
                ...p,
                // Profiles saved before the palette split carry a bare hex
                // string here; give them a real pair rather than crashing on
                // `accent.tint`.
                accent:
                    typeof p.accent === "object" && p.accent?.tint
                        ? p.accent
                        : ACCENTS[i % ACCENTS.length]!,
            }));
    }

    // A wallet from before profiles existed. Adopt it rather than stranding it.
    const legacy = read<{ mnemonic?: string; createdAt?: string }>(
        "firstsats.wallet.v1"
    );
    if (legacy?.mnemonic && isValidMnemonic(legacy.mnemonic)) {
        return [
            {
                id: crypto.randomUUID(),
                name: NAMES[0]!,
                mnemonic: legacy.mnemonic,
                accent: ACCENTS[0]!,
                createdAt: legacy.createdAt ?? new Date().toISOString(),
            },
        ];
    }
    return [];
}

function loadTabs(): Record<string, string> {
    return read<Record<string, string>>(`${STORAGE_KEY}.tabs`) ?? {};
}

/**
 * Delete one wallet's store, giving up rather than hanging.
 *
 * `deleteDatabase` blocks for as long as a connection to it is open, and the
 * panes holding those connections are torn down without disposing. Callers
 * reload the page straight after, which closes them regardless — so a blocked
 * request is not worth waiting on, and waiting forever would strand the reset.
 */
function dropDatabase(name: string): Promise<void> {
    return new Promise((resolve) => {
        let settled = false;
        const done = (): void => {
            if (settled) return;
            settled = true;
            resolve();
        };
        try {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = done;
            request.onerror = done;
            request.onblocked = done;
        } catch {
            done();
            return;
        }
        setTimeout(done, 1500);
    });
}

function loadVisited(): ReadonlySet<string> {
    return new Set(read<string[]>(`${STORAGE_KEY}.visited`) ?? []);
}

function loadChapter(): string | null | undefined {
    const stored = read<string>(`${STORAGE_KEY}.chapter`);
    // Missing is not the same as closed, so the empty string carries "closed"
    // — a stored `null` would be indistinguishable from nothing stored at all.
    if (stored === null) return undefined;
    return stored === "" ? null : stored;
}

function loadDocked(): boolean {
    return read<boolean>(`${STORAGE_KEY}.tourDocked`) ?? false;
}

function loadVisible(): string[] {
    return read<string[]>(`${STORAGE_KEY}.visible`) ?? [];
}

function read<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}
