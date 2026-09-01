/**
 * The protocol, drawn.
 *
 * Ark's awkward ideas are all structural — a tree hanging off one output, two
 * spending paths in one script, a forfeit that only becomes valid once a later
 * transaction confirms — and structure is what prose is worst at.
 *
 * Every drawing is inline SVG using theme tokens, so it follows light/dark with
 * the rest of the page, and carries a `<title>`: a diagram that is the
 * explanation must not be hidden from readers who cannot see it.
 */

import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { ArkadeService } from "../core/arkade.service";
import { I18nService } from "../core/i18n.service";

/** Shared chrome: type, box and connector styling for every diagram. */
const DIAGRAM_STYLES = `
    /*
     * The drawing is wider than a narrow column can show, so the host scrolls
     * it. max-width and min-width:0 are both needed: without them the host
     * grows to the SVG's min-width instead of clipping, and pushes out of
     * whatever laid it out.
     */
    :host {
        display: block;
        max-width: 100%;
        min-width: 0;
        overflow-x: auto;
        overflow-y: hidden;
        margin: 14px 0;
    }

    svg {
        display: block;
        min-width: 420px;
        width: 100%;
        height: auto;
        font-family: var(--font-sans);
    }

    /*
     * A lower floor on a phone. These scroll inside their own box rather than
     * pushing the page sideways, but a 420px floor meant every diagram scrolled
     * on a 390px screen; at 320 the simpler ones fit outright.
     */
    @media (max-width: 520px) {
        svg {
            min-width: 320px;
        }
    }

    /*
     * non-scaling-stroke because these drawings scale to whatever column they
     * land in: without it a 640-unit viewBox rendered 900px wide multiplies
     * every stroke by 1.4, and the same file looks different on every screen.
     * With it, 2 means two device pixels everywhere.
     */
    .box,
    .link,
    .rule {
        vector-effect: non-scaling-stroke;
    }

    .box {
        fill: var(--surface-raised);
        stroke: var(--border-strong);
        stroke-width: 2;
    }

    .box.accent {
        fill: var(--accent-soft);
        stroke: var(--accent);
    }

    .box.good {
        fill: var(--success-soft);
        stroke: var(--success);
    }

    .box.warn {
        fill: var(--warning-soft);
        stroke: var(--warning);
    }

    .box.ghost {
        fill: none;
        stroke: var(--border-strong);
        stroke-dasharray: 5 4;
    }

    text {
        fill: var(--fg);
        font-size: 12px;
        dominant-baseline: middle;
    }

    text.label {
        font-weight: 650;
    }

    text.note {
        fill: var(--fg-muted);
        font-size: 11px;
    }

    /* The missing bridge: stated in the warning colour, not drawn as a line. */
    text.note.gap {
        fill: var(--warning);
        font-weight: 650;
    }

    text.lane {
        fill: var(--fg-muted);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
    }

    text.mono {
        font-family: var(--font-mono);
        font-size: 11px;
        fill: var(--fg-muted);
    }

    .link {
        stroke: var(--fg-muted);
        stroke-width: 2;
        fill: none;
    }

    .link.accent {
        stroke: var(--accent);
    }

    .link.dashed {
        stroke-dasharray: 5 4;
    }

    .rule {
        stroke: var(--border-strong);
        stroke-width: 1.5;
    }
`;

/**
 * On-chain vs Lightning vs Ark: the comparison people need before "what is a
 * VTXO". Each lane is the same payment and what it costs — a block, a funded
 * channel, or a co-signature.
 */
@Component({
    selector: "app-diagram-rails",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <svg viewBox="-4 -4 648 308" role="img" [attr.aria-label]="i18n.t('diagram.rails.alt')">
            <title>{{ i18n.t("diagram.rails.alt") }}</title>

            <!-- Each lane is three boxes on one row with its cost on the row
                 below. Putting the cost beside the boxes clipped it: at this
                 type size the longest one does not fit in what is left of 640. -->

            <!-- on-chain -->
            <text class="lane" x="0" y="12">{{ i18n.t("diagram.rails.onchain") }}</text>
            <rect class="box" x="0" y="24" width="130" height="34" rx="7" />
            <text class="label" x="65" y="41" text-anchor="middle">{{ i18n.t("diagram.you") }}</text>
            <path class="link" d="M130 41 H240" marker-end="url(#arrow)" />
            <rect class="box warn" x="240" y="24" width="220" height="34" rx="7" />
            <text x="350" y="41" text-anchor="middle">{{ i18n.t("diagram.rails.block") }}</text>
            <path class="link" d="M460 41 H570" marker-end="url(#arrow)" />
            <rect class="box" x="570" y="24" width="70" height="34" rx="7" />
            <text class="label" x="605" y="41" text-anchor="middle">{{ i18n.t("diagram.them") }}</text>
            <text class="note" x="0" y="76">{{ i18n.t("diagram.rails.onchainCost") }}</text>

            <line class="rule" x1="0" y1="92" x2="640" y2="92" />

            <!-- lightning -->
            <text class="lane" x="0" y="112">{{ i18n.t("diagram.rails.lightning") }}</text>
            <rect class="box" x="0" y="124" width="130" height="34" rx="7" />
            <text class="label" x="65" y="141" text-anchor="middle">{{ i18n.t("diagram.you") }}</text>
            <path class="link" d="M130 141 H240" marker-end="url(#arrow)" />
            <rect class="box ghost" x="240" y="124" width="220" height="34" rx="7" />
            <text x="350" y="141" text-anchor="middle">{{ i18n.t("diagram.rails.route") }}</text>
            <path class="link" d="M460 141 H570" marker-end="url(#arrow)" />
            <rect class="box" x="570" y="124" width="70" height="34" rx="7" />
            <text class="label" x="605" y="141" text-anchor="middle">{{ i18n.t("diagram.them") }}</text>
            <text class="note" x="0" y="176">{{ i18n.t("diagram.rails.lightningCost") }}</text>

            <line class="rule" x1="0" y1="192" x2="640" y2="192" />

            <!-- ark -->
            <text class="lane" x="0" y="212">{{ i18n.t("diagram.rails.ark") }}</text>
            <rect class="box accent" x="0" y="224" width="130" height="34" rx="7" />
            <text class="label" x="65" y="241" text-anchor="middle">{{ i18n.t("diagram.you") }}</text>
            <path class="link accent" d="M130 241 H240" marker-end="url(#arrow-accent)" />
            <rect class="box accent" x="240" y="224" width="220" height="34" rx="7" />
            <text x="350" y="241" text-anchor="middle">{{ i18n.t("diagram.rails.cosign") }}</text>
            <path class="link accent" d="M460 241 H570" marker-end="url(#arrow-accent)" />
            <rect class="box accent" x="570" y="224" width="70" height="34" rx="7" />
            <text class="label" x="605" y="241" text-anchor="middle">{{ i18n.t("diagram.them") }}</text>
            <text class="note" x="0" y="276">{{ i18n.t("diagram.rails.arkCost") }}</text>

            <defs>
                <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0 0 L8 4 L0 8 z" fill="var(--fg-subtle)" />
                </marker>
                <marker id="arrow-accent" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0 0 L8 4 L0 8 z" fill="var(--accent)" />
                </marker>
            </defs>
        </svg>
    `,
    styles: DIAGRAM_STYLES,
})
export class DiagramRails {
    readonly i18n = inject(I18nService);
}

/**
 * One on-chain output, a tree of pre-signed transactions, your VTXO at a leaf.
 *
 * The picture that makes "spending costs no fee" stop sounding like a claim:
 * the fee was already paid, once, by everybody in the round.
 */
@Component({
    selector: "app-diagram-tree",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <svg viewBox="-4 -4 648 258" role="img" [attr.aria-label]="i18n.t('diagram.tree.alt')">
            <title>{{ i18n.t("diagram.tree.alt") }}</title>

            <text class="lane" x="0" y="14">{{ i18n.t("diagram.tree.chainLane") }}</text>
            <rect class="box warn" x="200" y="26" width="240" height="40" rx="7" />
            <text class="label" x="320" y="41" text-anchor="middle">{{ i18n.t("diagram.tree.commitment") }}</text>
            <text class="note" x="320" y="56" text-anchor="middle">{{ i18n.t("diagram.tree.commitmentNote") }}</text>

            <path class="link" d="M320 66 V90" />
            <path class="link" d="M170 90 H470" />
            <path class="link" d="M170 90 V112" marker-end="url(#t-arrow)" />
            <path class="link" d="M470 90 V112" marker-end="url(#t-arrow)" />

            <text class="lane" x="0" y="104">{{ i18n.t("diagram.tree.offchainLane") }}</text>
            <rect class="box" x="100" y="118" width="140" height="32" rx="7" />
            <text x="170" y="134" text-anchor="middle">{{ i18n.t("diagram.tree.branch") }}</text>
            <rect class="box" x="400" y="118" width="140" height="32" rx="7" />
            <text x="470" y="134" text-anchor="middle">{{ i18n.t("diagram.tree.branch") }}</text>

            <path class="link" d="M135 150 V176" marker-end="url(#t-arrow)" />
            <path class="link accent" d="M205 150 V176" marker-end="url(#t-arrow-accent)" />
            <path class="link" d="M435 150 V176" marker-end="url(#t-arrow)" />
            <path class="link" d="M505 150 V176" marker-end="url(#t-arrow)" />

            <rect class="box" x="80" y="182" width="110" height="32" rx="7" />
            <text class="mono" x="135" y="198" text-anchor="middle">VTXO</text>
            <rect class="box accent" x="200" y="182" width="110" height="32" rx="7" />
            <text class="label" x="255" y="198" text-anchor="middle">{{ i18n.t("diagram.tree.yours") }}</text>
            <rect class="box" x="380" y="182" width="110" height="32" rx="7" />
            <text class="mono" x="435" y="198" text-anchor="middle">VTXO</text>
            <rect class="box" x="500" y="182" width="110" height="32" rx="7" />
            <text class="mono" x="555" y="198" text-anchor="middle">VTXO</text>

            <text class="note" x="0" y="236">{{ i18n.t("diagram.tree.caption") }}</text>

            <defs>
                <marker id="t-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0 0 L8 4 L0 8 z" fill="var(--fg-subtle)" />
                </marker>
                <marker id="t-arrow-accent" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0 0 L8 4 L0 8 z" fill="var(--accent)" />
                </marker>
            </defs>
        </svg>
    `,
    styles: DIAGRAM_STYLES,
})
export class DiagramTree {
    readonly i18n = inject(I18nService);
}

/**
 * What signing a payment does: two signatures, two new outputs, nothing
 * broadcast. Drawn because "the server co-signs" is the sentence people nod at
 * without picturing — and the picture is what makes the caveat land later.
 */
@Component({
    selector: "app-diagram-send",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <svg viewBox="-4 -4 648 218" role="img" [attr.aria-label]="i18n.t('diagram.send.alt')">
            <title>{{ i18n.t("diagram.send.alt") }}</title>

            <rect class="box accent" x="0" y="70" width="130" height="46" rx="7" />
            <text class="label" x="65" y="87" text-anchor="middle">{{ i18n.t("diagram.send.input") }}</text>
            <text class="note" x="65" y="103" text-anchor="middle">{{ i18n.t("diagram.send.inputNote") }}</text>

            <path class="link accent" d="M130 93 H240" marker-end="url(#s-arrow)" />

            <rect class="box" x="240" y="52" width="160" height="82" rx="7" />
            <text class="label" x="320" y="72" text-anchor="middle">{{ i18n.t("diagram.send.tx") }}</text>
            <text class="note" x="320" y="92" text-anchor="middle">{{ i18n.t("diagram.send.sigYou") }}</text>
            <text class="note" x="320" y="110" text-anchor="middle">{{ i18n.t("diagram.send.sigServer") }}</text>

            <path class="link accent" d="M400 93 H470 V52 H510" marker-end="url(#s-arrow)" />
            <path class="link accent" d="M400 93 H470 V134 H510" marker-end="url(#s-arrow)" />

            <rect class="box good" x="510" y="34" width="130" height="36" rx="7" />
            <text x="575" y="52" text-anchor="middle">{{ i18n.t("diagram.send.payment") }}</text>
            <rect class="box" x="510" y="116" width="130" height="36" rx="7" />
            <text x="575" y="134" text-anchor="middle">{{ i18n.t("diagram.send.change") }}</text>

            <text class="note" x="0" y="180">{{ i18n.t("diagram.send.caption") }}</text>
            <text class="note" x="0" y="198">{{ i18n.t("diagram.send.caption2") }}</text>

            <defs>
                <marker id="s-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0 0 L8 4 L0 8 z" fill="var(--accent)" />
                </marker>
            </defs>
        </svg>
    `,
    styles: DIAGRAM_STYLES,
})
export class DiagramSend {
    readonly i18n = inject(I18nService);
}

/**
 * Preconfirmed becoming settled. Ark's whole trust assumption lives in the gap
 * between those two columns, so the drawing puts the gap on the page instead of
 * leaving it in a subordinate clause.
 */
@Component({
    selector: "app-diagram-settle",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <svg viewBox="-4 -4 648 238" role="img" [attr.aria-label]="i18n.t('diagram.settle.alt')">
            <title>{{ i18n.t("diagram.settle.alt") }}</title>

            <rect class="box warn" x="0" y="30" width="180" height="60" rx="7" />
            <text class="label" x="90" y="50" text-anchor="middle">{{ i18n.t("diagram.settle.pre") }}</text>
            <text class="note" x="90" y="70" text-anchor="middle">{{ i18n.t("diagram.settle.preNote") }}</text>

            <path class="link dashed" d="M180 60 H260" marker-end="url(#f-arrow)" />
            <text class="note" x="220" y="44" text-anchor="middle">{{ i18n.t("diagram.settle.wait") }}</text>

            <rect class="box" x="260" y="20" width="180" height="80" rx="7" />
            <text class="label" x="350" y="40" text-anchor="middle">{{ i18n.t("diagram.settle.round") }}</text>
            <text class="note" x="350" y="60" text-anchor="middle">{{ i18n.t("diagram.settle.forfeit") }}</text>
            <text class="note" x="350" y="80" text-anchor="middle">{{ i18n.t("diagram.settle.newTree") }}</text>

            <path class="link" d="M440 60 H520" marker-end="url(#f-arrow)" />

            <rect class="box good" x="520" y="30" width="120" height="60" rx="7" />
            <text class="label" x="580" y="50" text-anchor="middle">{{ i18n.t("diagram.settle.settled") }}</text>
            <text class="note" x="580" y="70" text-anchor="middle">{{ i18n.t("diagram.settle.settledNote") }}</text>

            <line class="rule" x1="0" y1="126" x2="640" y2="126" />
            <text class="lane" x="0" y="148">{{ i18n.t("diagram.settle.trustLane") }}</text>
            <text class="note" x="0" y="172">{{ i18n.t("diagram.settle.trustBefore") }}</text>
            <text class="note" x="0" y="192">{{ i18n.t("diagram.settle.trustAfter") }}</text>
            <text class="note" x="0" y="212">{{ i18n.t("diagram.settle.trustWhy") }}</text>

            <defs>
                <marker id="f-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0 0 L8 4 L0 8 z" fill="var(--fg-subtle)" />
                </marker>
            </defs>
        </svg>
    `,
    styles: DIAGRAM_STYLES,
})
export class DiagramSettle {
    readonly i18n = inject(I18nService);
}

/**
 * The two spending paths in every arkade address. Ark's entire safety argument
 * is one taproot script with two leaves: the fast path needs the server, the
 * slow one does not, and the slow one is why the fast one is safe.
 */
@Component({
    selector: "app-diagram-exit",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <svg viewBox="-4 -4 648 218" role="img" [attr.aria-label]="i18n.t('diagram.exit.alt')">
            <title>{{ i18n.t("diagram.exit.alt") }}</title>

            <rect class="box accent" x="180" y="14" width="280" height="46" rx="7" />
            <text class="label" x="320" y="31" text-anchor="middle">{{ i18n.t("diagram.exit.script") }}</text>
            <text class="note" x="320" y="47" text-anchor="middle">{{ i18n.t("diagram.exit.scriptNote") }}</text>

            <path class="link" d="M320 60 V80" />
            <path class="link" d="M150 80 H490" />
            <path class="link accent" d="M150 80 V106" marker-end="url(#e-arrow-accent)" />
            <path class="link" d="M490 80 V106" marker-end="url(#e-arrow)" />

            <rect class="box good" x="20" y="112" width="260" height="76" rx="7" />
            <text class="label" x="150" y="132" text-anchor="middle">{{ i18n.t("diagram.exit.coop") }}</text>
            <text class="note" x="150" y="152" text-anchor="middle">{{ i18n.t("diagram.exit.coopWho") }}</text>
            <text class="note" x="150" y="170" text-anchor="middle">{{ i18n.t("diagram.exit.coopWhen") }}</text>

            <rect class="box warn" x="360" y="112" width="260" height="76" rx="7" />
            <text class="label" x="490" y="132" text-anchor="middle">{{ i18n.t("diagram.exit.unilateral") }}</text>
            <text class="note" x="490" y="152" text-anchor="middle">{{ i18n.t("diagram.exit.unilateralWho") }}</text>
            <text class="note" x="490" y="170" text-anchor="middle">{{ i18n.t("diagram.exit.unilateralWhen", delay()) }}</text>

            <defs>
                <marker id="e-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0 0 L8 4 L0 8 z" fill="var(--fg-subtle)" />
                </marker>
                <marker id="e-arrow-accent" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0 0 L8 4 L0 8 z" fill="var(--accent)" />
                </marker>
            </defs>
        </svg>
    `,
    styles: DIAGRAM_STYLES,
})
export class DiagramExit {
    readonly i18n = inject(I18nService);
    private readonly arkade = inject(ArkadeService);

    /**
     * The live delay from the connected server, when there is one.
     *
     * A diagram that says "after the delay" teaches less than one that says
     * "after 2 days", and the real number is already in `serverInfo`. Before
     * the wallet connects there is nothing truthful to print, so it falls back
     * to the generic phrase rather than inventing a plausible number.
     */
    delay(): string {
        const info = this.arkade.serverInfo();
        if (!info) return this.i18n.t("diagram.exit.delayUnknown");
        return this.i18n.duration(Number(info.unilateralExitDelay) * 1000);
    }
}


/**
 * The four transactions Ark is built from.
 *
 * Join, round, forfeit and exit are the whole protocol, and every other idea in
 * it is a consequence of how they fit together. The app names them nowhere
 * else — the UI speaks in onboarding and settling, which is right for someone
 * spending money and useless for someone trying to understand the machine.
 *
 * The bottom line is the one that is hardest to get from prose: forfeit works
 * because of a race. Both parties can spend the old output, but the server can
 * do it instantly with your co-signature while you must wait out the timelock,
 * so publishing a stale exit only loses you the money.
 */
@Component({
    selector: "app-diagram-transactions",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <svg
            viewBox="-4 -4 648 556"
            role="img"
            [attr.aria-label]="i18n.t('diagram.tx.alt')"
        >
            <title>{{ i18n.t("diagram.tx.alt") }}</title>

            <!--
                One column, not two. SVG text does not wrap, so a box is only as
                usable as its widest translation: at half width the German lines
                ran straight out through the border.

                The vertical rhythm is deliberate — text is middle-baselined, so
                every gap here is measured from the baseline and the box needs
                roughly six units more than it looks like it does. The viewBox
                likewise ends clear of the last line's descenders.
            -->

            <rect class="box warn" x="0" y="0" width="640" height="100" rx="8" />
            <text class="label" x="20" y="26">
                1 · {{ i18n.t("diagram.tx.join") }}
            </text>
            <text class="note" x="20" y="50">{{ i18n.t("diagram.tx.joinIo") }}</text>
            <text class="note" x="20" y="68">{{ i18n.t("diagram.tx.joinSign") }}</text>
            <text class="note" x="20" y="86">{{ i18n.t("diagram.tx.onchain") }}</text>

            <rect class="box" x="0" y="110" width="640" height="100" rx="8" />
            <text class="label" x="20" y="136">
                2 · {{ i18n.t("diagram.tx.exit") }}
            </text>
            <text class="note" x="20" y="160">{{ i18n.t("diagram.tx.exitIo") }}</text>
            <text class="note" x="20" y="178">{{ i18n.t("diagram.tx.exitSign") }}</text>
            <text class="note" x="20" y="196">{{ i18n.t("diagram.tx.offchain") }}</text>

            <rect class="box warn" x="0" y="220" width="640" height="100" rx="8" />
            <text class="label" x="20" y="246">
                3 · {{ i18n.t("diagram.tx.round") }}
            </text>
            <text class="note" x="20" y="270">{{ i18n.t("diagram.tx.roundIo") }}</text>
            <text class="note" x="20" y="288">{{ i18n.t("diagram.tx.roundSign") }}</text>
            <text class="note" x="20" y="306">{{ i18n.t("diagram.tx.onchain") }}</text>

            <rect class="box" x="0" y="330" width="640" height="100" rx="8" />
            <text class="label" x="20" y="356">
                4 · {{ i18n.t("diagram.tx.forfeit") }}
            </text>
            <text class="note" x="20" y="380">{{ i18n.t("diagram.tx.forfeitIo") }}</text>
            <text class="note" x="20" y="398">{{ i18n.t("diagram.tx.forfeitSign") }}</text>
            <text class="note" x="20" y="416">{{ i18n.t("diagram.tx.onlyIfCheated") }}</text>

            <line class="rule" x1="0" y1="452" x2="640" y2="452" />

            <text class="lane" x="0" y="476">{{ i18n.t("diagram.tx.raceLane") }}</text>
            <text class="note" x="0" y="502">{{ i18n.t("diagram.tx.raceServer") }}</text>
            <text class="note" x="0" y="520">{{ i18n.t("diagram.tx.raceYou") }}</text>
            <text class="note" x="0" y="538">{{ i18n.t("diagram.tx.raceWhy") }}</text>
        </svg>
    `,
    styles: DIAGRAM_STYLES,
})
export class DiagramTransactions {
    readonly i18n = inject(I18nService);
}


/**
 * Many Arks, one Bitcoin.
 *
 * The drawing that answers "who am I actually trusting". Every server anchors
 * its rounds to the same chain, and the pre-signed exit is what stops any of
 * them holding your money. What is missing is the line *between* them: a VTXO
 * is co-signed by the server that created it, so paying across servers has no
 * native route.
 *
 * That gap is drawn as a gap rather than tidied away, because it is the honest
 * state of the protocol and the whole point of the chapter.
 */
@Component({
    selector: "app-diagram-network",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <svg
            viewBox="-4 -4 648 298"
            role="img"
            [attr.aria-label]="i18n.t('diagram.net.alt')"
        >
            <title>{{ i18n.t("diagram.net.alt") }}</title>

            <rect class="box warn" x="0" y="0" width="640" height="48" rx="8" />
            <text class="label" x="20" y="20">{{ i18n.t("diagram.net.bitcoin") }}</text>
            <text class="note" x="20" y="38">{{ i18n.t("diagram.net.bitcoinNote") }}</text>

            <path class="link" d="M95 48 V96" marker-end="url(#n-arrow)" />
            <path class="link" d="M320 48 V96" marker-end="url(#n-arrow)" />
            <path class="link" d="M545 48 V96" marker-end="url(#n-arrow)" />

            <rect class="box accent" x="0" y="100" width="190" height="84" rx="8" />
            <text class="label" x="16" y="124">{{ i18n.t("diagram.net.serverA") }}</text>
            <text class="note" x="16" y="146">Alice · Dave</text>
            <text class="note" x="16" y="166">{{ i18n.t("diagram.net.ownTree") }}</text>

            <rect class="box accent" x="225" y="100" width="190" height="84" rx="8" />
            <text class="label" x="241" y="124">{{ i18n.t("diagram.net.serverB") }}</text>
            <text class="note" x="241" y="146">Bob · Carol</text>
            <text class="note" x="241" y="166">{{ i18n.t("diagram.net.ownTree") }}</text>

            <rect class="box accent" x="450" y="100" width="190" height="84" rx="8" />
            <text class="label" x="466" y="124">{{ i18n.t("diagram.net.serverC") }}</text>
            <text class="note" x="466" y="146">Erin · Frank</text>
            <text class="note" x="466" y="166">{{ i18n.t("diagram.net.ownTree") }}</text>

            <!-- The absent bridge, drawn absent. -->
            <path class="link dashed" d="M190 142 H225" />
            <path class="link dashed" d="M415 142 H450" />
            <text class="note gap" x="0" y="204">{{ i18n.t("diagram.net.noBridge") }}</text>

            <line class="rule" x1="0" y1="226" x2="640" y2="226" />
            <text class="note" x="0" y="250">{{ i18n.t("diagram.net.point1") }}</text>
            <text class="note" x="0" y="268">{{ i18n.t("diagram.net.point2") }}</text>
            <text class="note" x="0" y="286">{{ i18n.t("diagram.net.point3") }}</text>

            <defs>
                <marker
                    id="n-arrow"
                    viewBox="0 0 8 8"
                    refX="7"
                    refY="4"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto"
                >
                    <path d="M0 0 L8 4 L0 8 z" fill="var(--fg-muted)" />
                </marker>
            </defs>
        </svg>
    `,
    styles: DIAGRAM_STYLES,
})
export class DiagramNetwork {
    readonly i18n = inject(I18nService);
}

/** Every diagram, for hosts that just want to import one thing. */
export const DIAGRAMS = [
    DiagramRails,
    DiagramTree,
    DiagramTransactions,
    DiagramSend,
    DiagramSettle,
    DiagramExit,
    DiagramNetwork,
] as const;
