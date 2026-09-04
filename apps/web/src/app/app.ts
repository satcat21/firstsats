import {
    ChangeDetectionStrategy,
    Component,
    afterNextRender,
    computed,
    inject,
} from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatDialog } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatMenuModule } from "@angular/material/menu";
import { MatTooltipModule } from "@angular/material/tooltip";
import { NETWORKS, type PresetName } from "@firstsats/core";
import { I18nService } from "./core/i18n.service";
import { NetworkService } from "./core/network.service";
import { ModeService } from "./core/mode.service";
import type { LocaleCode, Messages } from "./core/messages";
import { type Profile, ProfileService } from "./core/profile.service";
import { QuestService } from "./core/quest.service";
import { QuestPanel } from "./features/quest-panel";
import { ThemeService } from "./core/theme.service";
import { ProfilePane } from "./features/profile-pane";
import { Tour } from "./features/tour";
import { NarrationToasts } from "./ui/narration-toasts";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { NetworkDialog } from "./ui/network-dialog";
import { firstValueFrom } from "rxjs";

/**
 * The shell: branding, language, and which wallets are on screen.
 *
 * It owns no wallet state of its own any more. Everything to do with a wallet
 * lives in a {@link ProfilePane}, and the shell's whole job is deciding which
 * panes exist — one normally, two when you want to watch a payment from both
 * ends at once.
 */
@Component({
    selector: "app-root",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatButtonModule,
        MatCardModule,
        MatIconModule,
        MatMenuModule,
        MatTooltipModule,
        ProfilePane,
        Tour,
        QuestPanel,
        NarrationToasts,
    ],
    template: `
        <header class="top">
            <div class="brand">
                <img class="mark" src="logo.svg" alt="" width="38" height="38" />
                <div>
                    <h1>{{ i18n.t("app.title") }}</h1>
                    <p>{{ i18n.t("app.tagline") }}</p>
                </div>
            </div>

            <!-- Centred on the page rather than parked in the control cluster:
                 which chain you are on is the one fact here that changes what
                 every number below it means. -->
            <div class="middle">
                <button
                    matButton="outlined"
                    class="net"
                    [attr.data-network]="networks.name()"
                    [matTooltip]="i18n.t('app.demoBadge', network().label)"
                    [attr.aria-label]="i18n.t('network.open')"
                    (click)="openNetwork()"
                >
                    <span class="net-dot"></span>
                    {{ network().label }}
                </button>
            </div>

            <div class="controls">
                <!-- Docking is toggled from the guide panel itself -- the
                     control belongs on the thing it moves, not in a header bar
                     shared with everything else. See the app-tour component. -->

                <!-- A menu, not a select. The outlined form field was the
                     widest thing in the row and the loudest, for a control
                     touched once a session; this says the same in a sixth of
                     the space and matches the avatar menu beside it.

                     The code, not a flag: languages are not countries, and the
                     one flag any of these could carry would tell half its
                     speakers they were not the audience. Windows renders no
                     flag emoji at all, besides. -->
                <button
                    matButton
                    class="lang"
                    [matMenuTriggerFor]="langMenu"
                    [matTooltip]="i18n.t('lang.label')"
                    [attr.aria-label]="i18n.t('lang.label')"
                >
                    <mat-icon>language</mat-icon>
                    {{ i18n.locale().toUpperCase() }}
                </button>

                <mat-menu #langMenu="matMenu">
                    @for (locale of i18n.locales; track locale.code) {
                        <!-- Named in its own language: somebody looking for
                             theirs should not have to read English to find it. -->
                        <button mat-menu-item (click)="setLocale(locale.code)">
                            <!-- Always rendered, so every label starts at the
                                 same x whether or not it is the current one. -->
                            <mat-icon
                                [style.opacity]="locale.code === i18n.locale() ? 1 : 0"
                                >check</mat-icon
                            >
                            {{ locale.label }}
                        </button>
                    }
                </mat-menu>

                <button
                    matIconButton
                    [matTooltip]="i18n.t(theme.theme() === 'dark' ? 'theme.light' : 'theme.dark')"
                    [attr.aria-label]="
                        i18n.t(theme.theme() === 'dark' ? 'theme.light' : 'theme.dark')
                    "
                    (click)="theme.toggle()"
                >
                    <mat-icon>
                        {{ theme.theme() === "dark" ? "dark_mode" : "light_mode" }}
                    </mat-icon>
                </button>

                @if (profiles.profiles().length) {
                    <!--
                        A plain button, not matIconButton. Material sizes an
                        icon button's state layer around a 24px icon, and a
                        34px avatar overflows that box — leaving the grey hover
                        circle visibly off-centre. The avatar is its own shape,
                        so it carries its own hover.
                    -->
                    <button
                        type="button"
                        class="who"
                        [matMenuTriggerFor]="menu"
                        [matTooltip]="i18n.t('profile.switch')"
                        [attr.aria-label]="i18n.t('profile.switch')"
                    >
                        <!--
                            One half per wallet on screen: with two up, the
                            avatar is split down the middle so the button says
                            whose screens these are, not just whose is first.
                        -->
                        <span class="avatar">
                            @for (profile of profiles.visible(); track profile.id) {
                                <span
                                    class="half"
                                    [style.background]="profile.accent.tint"
                                    [style.color]="profile.accent.ink"
                                >
                                    {{ initialOf(profile) }}
                                </span>
                            } @empty {
                                <span class="half">?</span>
                            }
                        </span>
                    </button>

                    <mat-menu #menu="matMenu" class="profile-menu">
                        <p class="menu-head">{{ i18n.t("profile.switch") }}</p>
                        <!--
                            On screen or not is shown by filling the row, not by
                            an extra icon: the row already carries the wallet's
                            dot, and a second glyph competing with it says the
                            same thing twice. Weight and opacity alone were too
                            quiet to pick the active user out at a glance.
                        -->
                        @for (profile of profiles.profiles(); track profile.id) {
                            <button
                                mat-menu-item
                                class="person"
                                [class.on]="isVisible(profile.id)"
                                (click)="profiles.show(profile.id)"
                            >
                                <span
                                    class="dot"
                                    [style.background]="profile.accent.tint"
                                    [style.border-color]="profile.accent.ink"
                                    aria-hidden="true"
                                ></span>
                                {{ profile.name }}
                            </button>
                        }
                        <hr />
                        @for (profile of profiles.profiles(); track profile.id) {
                            @if (!isVisible(profile.id)) {
                                <button
                                    mat-menu-item
                                    (click)="profiles.toggleSplit(profile.id)"
                                >
                                    <mat-icon>splitscreen_vertical_add</mat-icon>
                                    {{ i18n.t("profile.compareWith", profile.name) }}
                                </button>
                            }
                        }
                        @if (profiles.split()) {
                            <button mat-menu-item (click)="profiles.swapSides()">
                                <mat-icon>swap_horiz</mat-icon>
                                {{ i18n.t("profile.swapSides") }}
                            </button>
                            <button mat-menu-item (click)="profiles.show(first()!.id)">
                                <mat-icon>close_fullscreen</mat-icon>
                                {{ i18n.t("profile.exitSplit") }}
                            </button>
                        }
                        <hr />
                        <button mat-menu-item (click)="profiles.create()">
                            <mat-icon>person_add</mat-icon>
                            {{ i18n.t("profile.create") }}
                        </button>

                        <!--
                            Free play or a guided run. The quest never blocks
                            anything; it only says what to do next and notices
                            when you do. Entering and leaving are doors, not a
                            toggle: each is confirmed, and the label always
                            names where the button takes you rather than where
                            you are.
                        -->
                        <hr />
                        @if (quest.enabled()) {
                            <button mat-menu-item (click)="leaveQuest()">
                                <mat-icon>logout</mat-icon>
                                {{ i18n.t("quest.leave") }}
                            </button>
                        } @else {
                            <button mat-menu-item (click)="enterQuest()">
                                <mat-icon>explore</mat-icon>
                                {{ i18n.t("quest.enter") }}
                            </button>
                        }
                    </mat-menu>
                }
            </div>
        </header>

        <!-- Shown only after three rounds in a row went nowhere, which is a
             property of the deployment and not of anything the reader did. -->
        @if (networks.suggestion(); as alternative) {
            <div class="net-warning" role="status">
                <mat-icon aria-hidden="true">cloud_off</mat-icon>
                <p>{{ i18n.t("network.suggest", network().label) }}</p>
                <button matButton (click)="networks.select(alternative)">
                    {{ i18n.t("network.suggestAction", label(alternative)) }}
                </button>
                <button
                    matIconButton
                    [attr.aria-label]="i18n.t('toast.close')"
                    (click)="networks.dismissSuggestion()"
                >
                    <mat-icon>close</mat-icon>
                </button>
            </div>
        }

        @if (quest.enabled()) {
            <app-quest-panel />
        }

        <main [class.split]="profiles.split()" [class.docked]="tourDocked()">
            @if (tourDocked()) {
                <!-- The guide as a column of its own, so the instructions stay
                     put while the wallet beside them is used. -->
                <aside class="guide">
                    <app-tour />
                </aside>
            }
            @if (profiles.profiles().length === 0) {
                <mat-card appearance="outlined" class="welcome">
                    <mat-card-content>
                        <h2>{{ i18n.t("profile.firstHeading") }}</h2>
                        <p class="muted">{{ i18n.t("profile.firstBlurb") }}</p>
                        <button matButton="filled" (click)="profiles.create()">
                            <mat-icon>person_add</mat-icon>
                            {{ i18n.t("profile.create") }}
                        </button>
                    </mat-card-content>
                </mat-card>
            } @else {
                @for (profile of profiles.visible(); track profile.id) {
                    <app-profile-pane [profile]="profile" [docked]="tourDocked()" />
                }
            }

            @if (profiles.split()) {
                <!--
                    The gap between the panes, made useful. Absolutely
                    positioned so it takes no grid cell of its own.
                -->
                <div class="gutter">
                    <button
                        matButton="filled"
                        class="swap"
                        [matTooltip]="i18n.t('profile.swapSides')"
                        (click)="profiles.swapSides()"
                    >
                        <mat-icon>swap_horiz</mat-icon>
                        {{ i18n.t("profile.swapSides") }}
                    </button>
                </div>
            }
        </main>

        <!--
            Credit where it is due, and a way out to the source. A teaching app
            that shows its work should be readable in full, not just watched.
        -->
        <footer class="colophon">
            <p class="links">
                <a
                    href="https://github.com/satcat21/firstsats"
                    target="_blank"
                    rel="noopener noreferrer"
                    >{{ i18n.t("footer.source") }}</a
                >
                <span>
                    {{ i18n.t("footer.inspiredBy") }}
                    <a
                        href="https://github.com/arkade-os"
                        target="_blank"
                        rel="noopener noreferrer"
                        >arkade-os</a
                    >
                </span>
            </p>
            <p class="made">
                {{ i18n.t("footer.madeWith") }}
                <span class="heart" aria-hidden="true">♥</span>
                {{ i18n.t("footer.forCommunity") }}
            </p>
        </footer>

        <!--
            One lane per wallet, laid out on the same grid as the panes above,
            so a notification sits under the column it came from. Fixed to the
            viewport bottom rather than the page, so it stays put while
            scrolling; pointer-events are off except on the toasts themselves.
        -->
        <div
            class="lanes"
            [class.split]="profiles.split()"
            [class.docked]="tourDocked()"
        >
            @for (profile of profiles.visible(); track profile.id) {
                <app-narration-toasts [profileId]="profile.id" />
            }
        </div>
    `,
    styles: `
        /*
         * Sits below the toast lanes in source order but above them visually,
         * because the lanes are fixed to the viewport: the footer scrolls, the
         * toasts do not, and neither needs to know about the other.
         *
         * No bottom margin of its own -- the host's padding is the whole gap to
         * the page edge, so there is one number to change rather than two.
         */
        /*
         * Pushed to the bottom of the viewport when the page is short.
         *
         * An auto top margin against the host's flex column, not a fixed
         * position: a fixed footer would sit on top of the content once there
         * is enough of it to scroll, and the whole point of this line is that
         * it stays out of the way. This way it is the last item in normal flow,
         * and the spare height above it -- if there is any -- moves it down.
         */
        .colophon {
            margin: auto 0 0;
            padding-top: 28px;
            text-align: center;
            font-size: 12.5px;
            line-height: 1.7;
        }

        .colophon p {
            margin: 2px 0;
        }

        /*
         * Flex with a gap rather than punctuation between the two: the closing
         * tag of a link sits on its own line here, so the newline that would
         * have been the separating space collapses away and the items run
         * together. The gap does not depend on source formatting.
         */
        .colophon .links {
            display: flex;
            justify-content: center;
            flex-wrap: wrap;
            gap: 4px 12px;
        }

        .colophon a {
            color: var(--accent);
        }

        .heart {
            color: var(--danger);
        }

        /*
         * A column at least as tall as the viewport, so the colophon has spare
         * height to be pushed into. Without it a page holding one card left the
         * footer stranded halfway up, under the content rather than at the
         * bottom of the window.
         */
        :host {
            display: flex;
            flex-direction: column;
            min-height: 100vh;
            max-width: 860px;
            margin: 0 auto;
            /*
             * The small bottom padding puts the colophon near the page edge. It
             * used to be 64px, to keep the last card clear of the toast lanes
             * fixed at the viewport bottom -- now the footer is what sits there,
             * and a toast briefly covering a credit line costs nothing.
             */
            padding: 28px 20px 16px;
            transition: max-width 0.2s ease;
        }

        /* Two panes need the room; one does not, and a wide single column of
           text is harder to read than a narrow one. */
        :host(.wide) {
            max-width: 1500px;
        }

        :host(.docked) {
            max-width: 1280px;
        }

        /*
         * Three regions, not two.
         *
         * A grid rather than space-between, because the middle slot has to land
         * on the *page's* centre and not on whatever is left between a brand
         * and a control cluster of unequal width. Equal 1fr flanks put the auto
         * middle column exactly in the middle, whatever either side holds and
         * however long a translation runs.
         */
        .top {
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            align-items: flex-start;
            gap: 20px;
        }

        .middle {
            display: flex;
            justify-content: center;
            /* Matches the control row, so the button sits on the same line as
               the language field beside it rather than riding above it. */
            --control-height: 36px;
        }

        /*
         * Shrinks so the row keeps its line.
         *
         * The brand is what gives when the header runs out of room: a tagline
         * that reflows to two lines reads fine, and a squeezed control cluster
         * does not. German made this necessary, English never did. The
         * min-width is the whole trick -- a grid item, like a flex item,
         * refuses to go below its content width without it.
         */
        .brand {
            display: flex;
            gap: 11px;
            align-items: center;
            min-width: 0;
        }

        /* The text block is what actually has to give; without this the inner
           flex item refuses to go below the tagline's full width. */
        .brand > div {
            min-width: 0;
        }

        .mark {
            width: 38px;
            height: 38px;
            border-radius: 9px;
            flex: none;
        }

        h1 {
            font-size: 19px;
            line-height: 1.15;
        }

        .brand p {
            margin: 1px 0 0;
            font-size: 12px;
            line-height: 1.35;
            color: var(--fg-muted);
        }

        /*
         * Every control in this row is a different Material component with its
         * own idea of how tall it should be — 40px for an icon button, 36 for a
         * text button, 56 for a form field. Centring alone still reads as
         * ragged, so they are all pinned to one height.
         */
        /* Never squashed: the brand absorbs whatever has to give, because a
           reflowed tagline reads fine and a squeezed language picker does not. */
        .controls {
            display: flex;
            flex-wrap: wrap;
            justify-content: flex-end;
            gap: 8px;
            align-items: center;
            --control-height: 36px;
        }

        /*
         * Centred explicitly rather than by Material's padding, which is
         * computed as (state-layer - 24px) / 2 and so only lands the glyph in
         * the middle when the icon really is 24px. These are 20px, which left
         * them sitting up and to the left inside their circles.
         */
        .controls .mat-mdc-icon-button {
            --mat-icon-button-state-layer-size: var(--control-height);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: var(--control-height);
            height: var(--control-height);
            padding: 0;
        }

        .controls .mat-icon {
            font-size: 20px;
            width: 20px;
            height: 20px;
        }

        /* Quiet by default -- it is a preference, not an action, and it sat
           beside the one control in this row that should be loud. */
        .lang {
            height: var(--control-height);
            min-width: 0;
            padding: 0 10px;
            color: var(--fg-muted);
            --mdc-text-button-label-text-size: 13px;
            letter-spacing: 0.02em;
        }

        .lang:hover {
            color: var(--fg);
        }

        /*
         * The network, as a button rather than a select.
         *
         * A dropdown offered two words and no way to say what you were
         * choosing between; this opens the dialog that can. It carries the
         * chain's own colour, so which one you are on is answered before the
         * name is read.
         */
        .net {
            height: var(--control-height);
            --mdc-outlined-button-label-text-size: 13px;
        }

        .net[data-network="signet"] {
            --net-hue: #8e6fd8;
        }

        .net[data-network="mutinynet"] {
            --net-hue: #d6489b;
        }

        .net[data-network] {
            border-color: color-mix(in srgb, var(--net-hue) 50%, transparent);
            color: color-mix(in srgb, var(--net-hue) 80%, var(--fg));
        }

        .net-dot {
            width: 9px;
            height: 9px;
            margin-right: 7px;
            border-radius: 50%;
            background: var(--net-hue);
        }

        .who {
            display: inline-flex;
            padding: 0;
            border: 0;
            border-radius: 50%;
            background: none;
            line-height: 0;
            cursor: pointer;
        }

        .avatar {
            display: inline-flex;
            width: var(--control-height);
            height: var(--control-height);
            border-radius: 50%;
            /* Clips each half back into the circle it shares. */
            overflow: hidden;
            font-weight: 700;
            font-size: 14px;
            /* A ring rather than a backdrop: it is concentric with the avatar
               by construction, so it cannot drift out of alignment. */
            box-shadow: 0 0 0 0 var(--accent-soft);
            transition: box-shadow 0.15s ease;
        }

        /* One half fills the circle; two split it evenly. */
        .avatar .half {
            display: flex;
            flex: 1 1 0;
            min-width: 0;
            align-items: center;
            justify-content: center;
            background: var(--surface);
            color: var(--fg-muted);
        }

        /* Two initials in the space of one need to give some width back. */
        .avatar .half:not(:only-child) {
            font-size: 11px;
        }

        .who:hover .avatar,
        .who:focus-visible .avatar {
            box-shadow: 0 0 0 4px var(--accent-soft);
        }

        /* Material's menu label sits flush against the edge without this. */
        ::ng-deep .profile-menu .menu-head {
            margin: 0;
            padding: 12px 16px 6px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--fg-subtle);
        }

        ::ng-deep .profile-menu hr {
            margin: 6px 0;
            border: 0;
            border-top: 1px solid var(--border);
        }

        ::ng-deep .profile-menu .dot {
            box-sizing: border-box;
            display: inline-block;
            width: 12px;
            min-width: 12px;
            height: 12px;
            flex: 0 0 12px;
            margin-right: 12px;
            border-radius: 50%;
            border: 1.5px solid;
        }

        /* Off screen: still reachable, visibly not current. */
        ::ng-deep .profile-menu .person:not(.on) {
            opacity: 0.55;
        }

        /*
         * On screen: filled like a selected row, the same treatment the mode
         * toggles use. The text keeps full-strength foreground rather than
         * taking the accent colour, so it does not compete with the user's own
         * dot sitting beside it.
         */
        ::ng-deep .profile-menu .person.on {
            font-weight: 650;
            color: var(--fg);
            background: var(--accent-soft);
        }

        app-quest-panel {
            display: block;
            margin-bottom: 18px;
        }

        .welcome h2 {
            font-size: 18px;
            margin-bottom: 8px;
        }

        .welcome p {
            margin: 0 0 18px;
        }

        .demo-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin: 18px 0 22px;
            padding: 5px 12px 5px 10px;
            border-radius: 999px;
            background: var(--warning-soft);
            color: var(--warning-on-soft);
            font-size: 12.5px;
            font-weight: 600;
        }

        .demo-badge .mat-icon {
            color: inherit;
        }

        /*
         * There is no published colour standard for Bitcoin test networks --
         * mempool.space, which is the closest thing to a convention, tints its
         * own chrome per chain without naming the hues. So these are chosen
         * for the one job the badge has: two deployments that must never be
         * mistaken for each other, and neither of them mistaken for mainnet
         * orange.
         */
        .demo-badge[data-network] {
            background: color-mix(in srgb, var(--net-hue) 16%, transparent);
            color: var(--net-fg);
            /* Both glyphs take the badge's colour, not the app's accent. */
            --insight-ink: currentColor;
        }

        .demo-badge[data-network="signet"] {
            --net-hue: #8e6fd8;
            --net-fg: #6c4fbb;
            --net-fg-dark: #b8a1f0;
        }

        .demo-badge[data-network="mutinynet"] {
            --net-hue: #d6489b;
            --net-fg: #b52f7d;
            --net-fg-dark: #f18cc4;
        }

        /*
         * Inline, not a toast. A toast leaves, and this is a standing condition
         * -- the deployment stays down for as long as it stays down -- so it
         * sits under the badge naming the network it is about, and is dismissed
         * by hand.
         */
        .net-warning {
            display: flex;
            align-items: center;
            gap: 10px;
            margin: 0 0 22px;
            padding: 10px 8px 10px 14px;
            border-radius: var(--radius);
            border: 1px solid color-mix(in srgb, var(--warning) 40%, var(--border));
            background: color-mix(in srgb, var(--warning) 12%, var(--surface-raised));
        }

        .net-warning p {
            flex: 1;
            margin: 0;
            font-size: 13px;
            color: var(--fg-muted);
        }

        .net-warning > .mat-icon {
            flex: none;
            color: var(--warning);
        }

        /* Lifted for the dark ground, which swallows the print-weight hues. */
        :host-context([data-theme="dark"]) .demo-badge[data-network] {
            color: var(--net-fg-dark);
        }

        @media (prefers-color-scheme: dark) {
            :host-context(:root:not([data-theme="light"]))
                .demo-badge[data-network] {
                color: var(--net-fg-dark);
            }
        }

        /*
         * The gap under the header used to come from the demo badge sitting
         * between them. With the badge gone the panes came up flush against it,
         * so the spacing is now the layout's own rather than a side effect of
         * something that happened to be in the way.
         */
        main {
            position: relative;
            display: grid;
            gap: 18px;
            margin-top: 18px;
            grid-template-columns: minmax(0, 1fr);
        }

        /*
         * The hover strip between two panes.
         *
         * Exactly as wide as the grid gap, so it never covers a pane and never
         * swallows a click meant for one. The button inside is far wider and
         * overhangs both sides, which is harmless because it only exists while
         * the pointer is in the gutter — and hovering a child counts as
         * hovering the strip even where the child spills outside it.
         */
        .gutter {
            position: absolute;
            top: 0;
            bottom: 0;
            left: 50%;
            width: 18px;
            transform: translateX(-50%);
            display: flex;
            justify-content: center;
        }

        /*
         * Sticky rather than pinned to the top, so the button meets the pointer
         * wherever down the page the two panes are being compared.
         */
        .gutter .swap {
            position: sticky;
            top: 45vh;
            flex: none;
            white-space: nowrap;
            opacity: 0;
            pointer-events: none;
            transition: opacity 120ms ease;
        }

        /*
         * Gone the instant the pointer leaves, back only after it has stayed:
         * the delay is what stops the button flashing up every time the cursor
         * crosses the gap on its way somewhere else.
         */
        .gutter:hover .swap,
        .gutter .swap:focus-visible {
            opacity: 1;
            pointer-events: auto;
            transition-delay: 350ms;
        }

        .lanes {
            position: fixed;
            left: 0;
            right: 0;
            bottom: 16px;
            z-index: 1000;
            display: grid;
            /*
             * End-aligned rather than the default stretch. Stretched lanes are
             * all as tall
             * as the tallest, so expanding one wallet's toast grew the other
             * lane too and lifted its toast off the bottom. Each lane now hugs
             * the bottom edge and is only as tall as its own contents.
             */
            align-items: end;
            gap: 18px;
            grid-template-columns: minmax(0, 1fr);
            /* Mirrors the host's own box so the lanes line up with the panes. */
            max-width: 860px;
            margin: 0 auto;
            padding: 0 20px;
            pointer-events: none;
        }

        .lanes.split {
            max-width: 1500px;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        }

        /*
         * The docked layout, which the lanes did not know about.
         *
         * They mirrored the host box for one pane (860px) and for two (1500px)
         * but never for the guide-plus-wallet column pair, which is 1280px
         * wide. So while docked, the lane box was 860px centred inside 1280px
         * of content and its right edge fell some 200px short of the pane's --
         * putting the toast under the gutter between the two columns instead
         * of at the bottom-right of the wallet it belongs to.
         */
        .lanes.docked {
            max-width: 1280px;
            grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
        }

        /* Column two is the wallet; column one is the guide, which narrates
           nothing and should not have a lane sitting under it. */
        .lanes.docked > app-narration-toasts {
            grid-column: 2;
        }

        main.split,
        main.docked {
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        }

        /* The guide is the reference, the wallet is the work: give the work
           more room and let the guide scroll with its own header pinned. */
        main.docked {
            grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
        }

        .guide {
            position: sticky;
            top: 20px;
            max-height: calc(100vh - 40px);
            overflow-y: auto;
            min-width: 0;
        }

        /* Below this the tour cannot be a column, so it goes back to its tab. */
        /* Too narrow to hold both: stack them rather than crush the brand. */
        @media (max-width: 700px) {
            /*
             * Back the gutter off.
             *
             * 20px each side is a fifth of a 360px phone spent on nothing, and
             * every card below sits inside two more boxes that each add their
             * own. The page edge is the cheapest of the three to give up.
             */
            :host {
                padding: 20px 12px 14px;
            }

            .lanes {
                padding: 0 12px;
            }

            /*
             * Two rows rather than three.
             *
             * There is no page centre worth aiming at this narrow, so the
             * network chip stops being a centred region -- but given a row of
             * its own it left the controls on a third line, and the wallet
             * itself started below the fold. The chip is short in every
             * language and the control cluster is four small targets, so the
             * two share the second row: chip left, controls right.
             */
            .top {
                grid-template-columns: minmax(0, 1fr) auto;
                grid-template-areas:
                    "brand  brand"
                    "middle controls";
                align-items: center;
                gap: 12px;
            }

            .brand {
                grid-area: brand;
            }

            .middle {
                grid-area: middle;
                justify-content: flex-start;
                min-width: 0;
            }

            /*
             * Allowed to shrink into its line.
             *
             * The controls refuse to shrink by design, so on a phone they kept
             * their full desktop width, pushed the header past the viewport and
             * took the page's horizontal scroll with them -- their own
             * flex-wrap could never engage, because nothing ever made the box
             * narrower than its contents.
             *
             * Sharing a row with the network chip, they keep their line and let
             * the chip beside them be what gives.
             */
            .controls {
                grid-area: controls;
                justify-content: flex-end;
                flex-wrap: nowrap;
            }

            /* The chip, not the controls, absorbs a row too narrow for both. */
            .net {
                min-width: 0;
            }
        }

        @media (max-width: 900px) {
            main.split,
            main.docked,
            .lanes.split {
                grid-template-columns: minmax(0, 1fr);
            }

            .guide {
                display: none;
            }

            /* One column: there is no gutter to hover, and no hover either. */
            .gutter {
                display: none;
            }

            /* Stacked panes make two lanes meaningless; one is enough. */
            .lanes.split > app-narration-toasts:last-child {
                display: none;
            }
        }
    `,
    host: {
        "[class.wide]": "profiles.split()",
        "[class.docked]": "tourDocked()",
    },
})
export class App {
    readonly i18n = inject(I18nService);
    readonly profiles = inject(ProfileService);
    readonly theme = inject(ThemeService);
    readonly quest = inject(QuestService);

    readonly networks = inject(NetworkService);

    /**
     * The deployment on screen.
     *
     * Named in the badge rather than written into the sentence: the app runs on
     * three presets, and a badge that says "Signet" while connected to
     * mutinynet is the kind of wrong that a reader trusts.
     */
    readonly network = this.networks.current;
    private readonly modes = inject(ModeService);
    private readonly dialog = inject(MatDialog);

    /**
     * Docked only where there is room: one wallet, wide enough for two columns.
     *
     * And never in quest mode, which hides the guide outright. The stored
     * preference is left alone rather than cleared, so leaving quest mode puts
     * the guide back exactly where it was.
     */
    readonly tourDocked = computed(
        () =>
            this.profiles.tourDocked() &&
            !this.profiles.split() &&
            !this.quest.enabled()
    );

    readonly first = computed<Profile | undefined>(() => this.profiles.visible()[0]);
    initialOf(profile: Profile): string {
        return (profile.name || "?").charAt(0).toUpperCase();
    }

    isVisible(id: string): boolean {
        return this.profiles.visible().some((p) => p.id === id);
    }

    /** The preset's own name, which is not translated -- it is a proper noun. */
    label(preset: PresetName): string {
        return NETWORKS[preset].label;
    }

    /** The chain, what it is for, how it compares, and its server's parameters. */
    openNetwork(): void {
        this.dialog.open(NetworkDialog, {
            // Wide enough for the comparison table to stand without scrolling:
            // four columns, and the widest cell is a short sentence.
            width: "min(820px, calc(100vw - 32px))",
        });
    }

    constructor() {
        /*
         * The welcome belongs in the room it describes, so it waits for the
         * reload rather than opening over the room being left. `afterNextRender`
         * because a dialog opened during construction fights change detection.
         */
        afterNextRender(() => {
            if (!this.modes.takeWelcome()) return;
            this.dialog.open(ConfirmDialog, {
                width: "min(460px, calc(100vw - 32px))",
                data: {
                    title: this.i18n.t("quest.welcomeTitle"),
                    message: this.i18n.t("quest.welcomeBody"),
                    confirmLabel: this.i18n.t("quest.welcomeStart"),
                    icon: "explore",
                },
            });
        });
    }

    setLocale(code: LocaleCode): void {
        this.i18n.setLocale(code);
    }

    /**
     * Step into the quest room.
     *
     * Confirmed first, because the whole screen is about to be replaced by a
     * different set of users. Nothing is lost either way — free mode is still
     * there when you come back — and the dialog says so, since a warning that
     * sounds destructive would stop people trying it.
     */
    async enterQuest(): Promise<void> {
        const ok = await this.ask(
            "quest.enterTitle",
            "quest.enterConfirm",
            "quest.enterAction",
            "explore"
        );
        if (ok) this.modes.enter();
    }

    /** Step back out. The run stays where you left it. */
    async leaveQuest(): Promise<void> {
        const ok = await this.ask(
            "quest.leaveTitle",
            "quest.leaveConfirm",
            "quest.leaveAction",
            "logout"
        );
        if (ok) this.modes.leave();
    }

    private ask(
        title: keyof Messages,
        message: keyof Messages,
        confirmLabel: keyof Messages,
        icon: string
    ): Promise<boolean | undefined> {
        return firstValueFrom(
            this.dialog
                .open(ConfirmDialog, {
                    width: "min(460px, calc(100vw - 32px))",
                    data: {
                        title: this.i18n.t(title),
                        message: this.i18n.t(message),
                        confirmLabel: this.i18n.t(confirmLabel),
                        cancelLabel: this.i18n.t("common.cancel"),
                        icon,
                    },
                })
                .afterClosed()
        );
    }

}
