import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnDestroy,
    viewChild,
} from "@angular/core";

interface Piece {
    x: number;
    y: number;
    vx: number;
    vy: number;
    spin: number;
    angle: number;
    size: number;
    colour: string;
}

const GRAVITY = 0.16;
const DRAG = 0.995;

/**
 * A short burst of confetti.
 *
 * Hand-rolled rather than a library: it is forty lines of canvas, and the
 * alternative is a dependency the offline build would have to vendor anyway.
 *
 * It draws nothing at all when the visitor has asked for reduced motion. A
 * celebration is the clearest case of decoration — there is no information in
 * it that the points and the tick do not already carry.
 */
@Component({
    selector: "app-confetti",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<canvas #canvas aria-hidden="true"></canvas>`,
    styles: `
        :host {
            position: fixed;
            inset: 0;
            z-index: 2000;
            pointer-events: none;
        }

        canvas {
            width: 100%;
            height: 100%;
            display: block;
        }
    `,
})
export class Confetti implements OnDestroy {
    private readonly canvasRef =
        viewChild.required<ElementRef<HTMLCanvasElement>>("canvas");

    private frame = 0;
    private pieces: Piece[] = [];

    /** Throw a burst from the middle of the viewport. */
    burst(colours: readonly string[]): void {
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

        const canvas = this.canvasRef().nativeElement;
        const dpr = devicePixelRatio || 1;
        canvas.width = innerWidth * dpr;
        canvas.height = innerHeight * dpr;

        const context = canvas.getContext("2d");
        if (!context) return;
        context.scale(dpr, dpr);

        this.pieces = Array.from({ length: 90 }, () => {
            const angle = Math.random() * Math.PI * 2;
            const speed = 4 + Math.random() * 7;
            return {
                x: innerWidth / 2,
                y: innerHeight * 0.42,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 4,
                spin: (Math.random() - 0.5) * 0.3,
                angle: Math.random() * Math.PI,
                size: 5 + Math.random() * 6,
                colour: colours[Math.floor(Math.random() * colours.length)] ?? "#888",
            };
        });

        cancelAnimationFrame(this.frame);
        this.tick(context);
    }

    ngOnDestroy(): void {
        cancelAnimationFrame(this.frame);
    }

    private tick(context: CanvasRenderingContext2D): void {
        context.clearRect(0, 0, innerWidth, innerHeight);

        let alive = false;
        for (const piece of this.pieces) {
            piece.vy += GRAVITY;
            piece.vx *= DRAG;
            piece.x += piece.vx;
            piece.y += piece.vy;
            piece.angle += piece.spin;

            if (piece.y < innerHeight + 40) alive = true;

            context.save();
            context.translate(piece.x, piece.y);
            context.rotate(piece.angle);
            context.fillStyle = piece.colour;
            context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
            context.restore();
        }

        if (alive) {
            this.frame = requestAnimationFrame(() => this.tick(context));
        } else {
            context.clearRect(0, 0, innerWidth, innerHeight);
            this.pieces = [];
        }
    }
}
