# The Angular web UI

The same wallet, in a browser, with buttons and tooltips instead of commands.

```bash
npm run web          # dev server on http://localhost:4200
npm run web:build    # production bundle into apps/web/dist
```

It runs against the same public Arkade deployments as the CLI — both default to
mutinynet — and it is the same code doing the work. Unlike the CLI, which reads
`FIRSTSATS_NETWORK` once at startup, the web app can switch between mutinynet and
signet at runtime from the header. Regtest is CLI-only: its server is on
`http://localhost`, and a page served over HTTPS cannot call it.

---

## Why browser-only, with no backend

The obvious alternative was an Angular front end talking to a small Node service
that wrapped the existing CLI core. That was rejected, for one reason: it would
have put the seed on a server. An app whose entire subject is *"nobody else holds
your money"* cannot demonstrate that by handing the keys to a backend.

Two facts made the browser-only route viable, and both were checked rather than
assumed:

1. **The Arkade endpoints allow cross-origin requests.** The Ark servers and
   their mempool instances — `mutinynet.arkade.sh`, `signet.arkade.sh` and the
   `mempool.*` hosts beside them — return `Access-Control-Allow-Origin: *`, so
   the page talks to them directly.
2. **The SDK is built for browsers.** It ships IndexedDB repositories, and a
   browser already has a native `EventSource`.

So there is no server component at all. The page is static files; the seed never
leaves the device.

## What is shared, and what is replaced

The point of the exercise was to prove the CLI's core was actually reusable. It
was — `FirstSatsAccount`, the narration stream, the network presets and the
formatters all cross over untouched.

| Concern | CLI | Web |
| --- | --- | --- |
| Account API, guardrails, narration | `src/account.ts`, `src/narrator.ts` | **the same files** |
| Network presets, formatters | `src/config.ts`, `src/format.ts` | **the same files** |
| Seed storage | `src/keystore.ts` (`node:fs`) | `core/browser-keystore.ts` (`localStorage`) |
| Wallet construction | `src/wallet.ts` (in-memory repos, `eventsource` shim) | `core/browser-wallet.ts` (IndexedDB repos, native SSE) |
| Rendering the narration | `src/cli/render.ts` (ANSI lines) | `ui/step-timeline.ts` (a timeline) |

[`src/browser.ts`](../src/browser.ts) is the browser-safe barrel — it re-exports
only the four modules with no Node globals, and `apps/web/tsconfig.app.json`
maps `@firstsats/core` to it.

Making that work needed three small changes to the core, each of which left the
CLI better anyway:

- Terminal styling moved out of `src/format.ts` into `src/cli/style.ts`. It read
  `process.stdout`, which a browser does not have — and it never belonged in a
  module named "format" to begin with.
- `resolveConfig` reads `process` off `globalThis` instead of as a bare
  identifier, so it compiles without Node type declarations.
- `NodeJS.Timeout` became `ReturnType<typeof setTimeout>`, which is correct in
  both runtimes.

**Validation is not duplicated.** The send form has no rules of its own: it calls
`FirstSatsAccount.send`, which checks the address, the amount, the dust limit and
the balance, and shows whatever error comes back. The browser cannot drift away
from what the terminal enforces, and the unit suite covers both at once.

## Architecture

```
apps/web/src/app/
  core/
    arkade.service.ts     the only stateful thing; wraps FirstSatsAccount
    browser-wallet.ts     Wallet.create with IndexedDB repositories
    browser-keystore.ts   the seed, in localStorage
    i18n.service.ts       runtime translation
    theme.service.ts      light / dark / system
    messages.ts           locale registry
    locales/              en, de, es, fr, it, pt
  features/
    onboarding.ts         create a wallet, reveal the phrase
    wallet-overview.ts    balance buckets, VTXOs, server parameters
    receive.ts            addresses, QR, live wait for funds
    send.ts               the payment form
    activity.ts           history
  ui/
    insight.ts            the info tooltip
    step-timeline.ts      the narration feed
  app.ts                  shell: header, tabs, layout
```

Everything is a standalone component with `OnPush` change detection, and all
state is signals. `ArkadeService` is the only place that holds any.

### The narration feed is the whole design

The timeline sits permanently beside whatever you are doing, rather than behind
a "details" toggle. You are meant to watch the protocol explain itself *while*
you use it.

This is the payoff from building `Narrator` as typed events rather than
`console.log` calls. The domain code emits steps; the terminal renders them as
ANSI lines and the browser renders them as a timeline, and neither renderer
knows the other exists. Both apply the same rule about dropping bare `start`
steps.

## Theming

The palette is Arkade Labs' own, taken from the ramps published in the
[Arkade wallet](https://github.com/arkade-os/wallet) (`src/tokens.css`). Brand
primary is `--purple-700: #391998`; `--purple-500: #7043f4` is the vivid accent.

Components never touch a ramp step directly. They use semantic tokens —
`--surface`, `--fg-muted`, `--accent`, `--success` — which is what makes dark
mode a matter of redefining about a dozen variables instead of auditing every
component.

The theme has three states, not two:

- `light` / `dark` stamp `data-theme` on the root element.
- `system` writes **no attribute at all**, letting the `prefers-color-scheme`
  media query decide.

The `[data-theme]` selectors are written after the media query so an explicit
choice always wins, in both directions.

## Internationalisation

Six languages: English, German, Spanish, French, Italian, Portuguese. The picker
switches instantly, with no reload.

**Everything is translated, including the tooltips.** That matters more than it
sounds: the explanatory text is the actual product here, so shipping it
English-only while translating the button labels would have missed the point
entirely. All 121 keys exist in all six locales.

That requirement is why this uses a **runtime dictionary rather than
`@angular/localize`**. Angular's official i18n compiles one bundle per locale;
switching means loading a different build from a different URL. For a teaching
tool where a reader may well want to compare how an explanation reads in two
languages, instant switching is worth more than the marginal bundle savings —
and all six locales together cost about 5 kB gzipped.

The safety comes from the type system:

```ts
export type Messages = Record<keyof typeof EN, string>;
```

English is the source of truth, and every other locale is typed as `Messages`.
Add a key to `en.ts` and the build fails until all six define it. There is no
silent fallback that renders an English string, or an empty one, in a Spanish
UI.

Keys are checked at the call site too, including composed ones — `navKey()` and
`themeKey()` in `app.ts` return template-literal types like
`` `nav.${Tab}` ``, so adding a tab without a translation is a compile error
rather than a blank button.

## The info tooltip

Every explanatory tooltip is one `<app-insight>` component, and it is built on
the native **Popover API** rather than an absolutely-positioned element. That
one decision solves three problems at once:

- **It cannot be clipped.** A popover renders in the browser's top layer, above
  the whole page. The balance buckets use `overflow: hidden` to get their
  rounded corners, which would cut off any normal tooltip opened inside one.
- **Light dismiss is free.** Clicking anywhere outside closes it, handled by the
  browser — and the click still reaches whatever was clicked, so dismissing
  never swallows the next interaction. A hand-rolled `document:click` listener
  gets this subtly wrong.
- **Escape closes it**, also free, which is what a keyboard user tries first.

The only thing left to do by hand is anchoring: the panel is positioned from the
trigger's bounding rect on open, clamped to the viewport, and flipped above the
trigger when there is no room below. CSS anchor positioning would remove even
that, but it is not yet available in every browser that supports popovers.

## Accessibility

- The tooltip trigger is a real `<button>` with `aria-expanded`, and the panel
  is adjacent content. That means it works from the keyboard, is announced by a
  screen reader, and survives on touch — none of which is true of a `title`
  attribute. It stays open until dismissed, because the content is a paragraph
  to read, not a label to glance at.
- Live regions (`role="status"`, `aria-live`) announce payment results and the
  incoming-funds watcher.
- Selects carry visually hidden labels; `:focus-visible` is styled globally.
- `prefers-reduced-motion` disables the pulse animation and all transitions.

## Security, and how this is worse than the CLI

The browser keystore writes the mnemonic to `localStorage` in cleartext.
**Anything that can run script on this origin can read it** — a compromised
dependency, an XSS bug, a malicious extension. That is a strictly weaker position
than the CLI's file, which at least requires filesystem access.

It is acceptable here for exactly one reason: the app only ever talks to test
networks, whose coins are worthless. Mainnet is not among the presets the browser
offers, and the header names the chain in its own colour with a tooltip saying
the coins have no value.

A real browser wallet would encrypt the seed under a user passphrase and store
only ciphertext, or keep it in a service worker that never exposes it to the
page. See [SECURITY.md](../SECURITY.md).

One thing the web build gets *right* that the CLI does not: it uses the SDK's
**persistent** IndexedDB repositories rather than in-memory ones. The data a
wallet holds includes the exit paths that make a unilateral exit possible, and a
wallet a person actually keeps should not be throwing those away on every run.

## Bundle size

About 1.96 MB raw, **~310 kB over the wire** gzipped — of which all six locales,
tooltips included, account for roughly 15 kB. That is secp256k1, a
descriptor parser, a CEL evaluator and a Bitcoin transaction signer — the actual
cost of doing self-custody in a page. The budget in `angular.json` is set to
match reality rather than to a number that would fail on the first honest build.

## What is not built

- **Importing an existing recovery phrase.** The core supports it
  (`createWallet({ mnemonic })`) and the CLI exposes it as `init --import`; the
  web UI only generates new wallets.
- **Offboarding.** `FirstSatsAccount.offboard` exists and the CLI uses it; there
  is no screen for it yet.
- **Unilateral exit.** The SDK exposes the primitives. Neither front end
  automates it.
