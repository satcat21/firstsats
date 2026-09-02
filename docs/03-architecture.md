# Architecture

The repository is small on purpose. If you are here to learn the SDK, read
[`src/account.ts`](../src/account.ts) first — everything else is plumbing
around it.

```
src/               shared core -- no Node globals except where noted
  account.ts       The teachable API over the SDK's Wallet   <- start here
  narrator.ts      The "show your work" event stream
  config.ts        Network presets (mutinynet by default) + env overrides
  format.ts        Pure presentation helpers
  browser.ts       Barrel of the four modules above, for the web build
  index.ts         Node entry point (adds the three below)
  keystore.ts      [node] BIP-39 mnemonic on disk
  wallet.ts        [node] The two things Node needs that a browser does not
  session.ts       [node] config + keystore + wallet + account, wired together
  cli/
    args.ts        A 100-line argument parser, no dependency
    style.ts       Terminal colours. CLI-only: it reads process.stdout
    render.ts      Narration -> terminal. The only file that decides how it looks
    context.ts     Shared plumbing + session lifecycle
    commands/      One thin file per group of commands
test/
  *.test.ts        Unit tests against a fake wallet. No network, milliseconds
  e2e/             Integration against live signet. Opt-in
apps/web/          Angular front end -- see docs/04-web-ui.md
docs/              The prose you are reading
```

`src/` is shared by both front ends. The three files marked `[node]` are the
only ones a browser cannot use, and each has a browser counterpart in
`apps/web/src/app/core/`.

## The three ideas worth stealing

### 1. Narration is a typed event stream, not `console.log`

Every operation runs inside `Narrator.track()`, which emits a `start` step, then
an `ok` or `fail` step carrying the result. Each step has a stable machine id, a
plain-language `title`, a factual `detail`, and a `behindTheScenes` explanation
of what the protocol did.

```ts
return this.narrator.track(
    {
        id: "send.submit",
        title: `Sending ${sats(amount)}`,
        after: (txid) => ({
            detail: `arkade txid ${short(txid)}`,
            behindTheScenes: "Done. The recipient can spend that VTXO immediately…",
        }),
    },
    () => this.wallet.sendBitcoin({ address, amount })
);
```

This buys three things:

- The CLI renders it ([`cli/render.ts`](../src/cli/render.ts)) as ANSI lines and
  the web app renders it as a timeline. Neither renderer knows the other exists.
- **Tests assert on the narration.** The explanations are covered by the suite,
  so they cannot silently drift out of date as the code changes.
- Failures narrate with the same shape as successes, so an error still tells you
  which stage you reached.

`track` always rethrows. Narration observes; it never swallows.

### 2. Depend on a narrow interface, not the SDK's concrete class

[`WalletLike`](../src/account.ts) declares only the dozen members this app
actually uses. The SDK's `Wallet` satisfies it structurally — no adapter, no
wrapper class.

That one decision is what makes `npm test` run the entire payment flow,
including the guardrails and every narration string, in milliseconds against
`FakeWallet` in [`test/fakes.ts`](../test/fakes.ts) — with no server, no coins,
and no flakiness. The live path is covered separately by the opt-in e2e suite.

### 3. Validate before you sign, and explain *why* it failed

`PaymentError` messages are written for someone who has never used Bitcoin:

> `"tb1qxy…8s2m" is not a valid arkade address. Arkade addresses start with
> `ark1` on mainnet and `tark1` on test networks. If you have a normal on-chain
> address (`bc1`, `tb1`), use `offboard` instead — that is a withdrawal, not an
> off-chain payment.`

Every check runs before anything is signed or sent.

## Node-specific SDK setup

Two things a browser gives you for free and Node does not. Both live in
[`src/wallet.ts`](../src/wallet.ts):

**`EventSource`.** The SDK follows batch settlement over Server-Sent Events.
Node has no global `EventSource`, so we hand the SDK a factory:

```ts
import { EventSource } from "eventsource";
import { configureEventSource } from "@arkade-os/sdk";

configureEventSource((url) => new EventSource(url));
```

Without it, settlement fails with a typed `EventSourceUnavailableError`.

**Repositories.** The SDK's browser default is IndexedDB, which does not exist
here. This app uses the in-memory repositories, so state is rebuilt from the
Arkade indexer on every run and the only thing on disk is the seed.

That is the right call for a teaching tool — it proves the seed is sufficient —
but it is *not* what a production wallet should do. Your exit data is what lets
you leave without the server's help, and losing it means losing that guarantee
(see [How Ark works](./01-how-ark-works.md)). For a real application use
`SQLiteWalletRepository` in Node or the IndexedDB repositories in a browser.

## One SDK default this app turns off

Both wallet builders — [`src/wallet.ts`](../src/wallet.ts) and its browser
counterpart — pass `settlementConfig: false`.

Left undefined, the SDK runs a background poll that auto-settles new boarding
inputs into Ark roughly every minute. For a production wallet that is a sensible
default. Here it is wrong twice over. Onboarding is the step this app exists to
show, and a step that happens by itself teaches nothing. Worse, the automatic
settle races an explicit one for the same boarding output: both register an
intent, the server honours neither, and the round fails with `no matching intents
found for intent proof`.

Worth knowing if you copy the wallet setup out of this repo — with the poll on,
you get onboarding for free and no control over when it happens.

## Testing strategy

| Suite | Command | Needs network | Runtime |
|---|---|---|---|
| Unit | `npm test` | no | < 1s |
| End-to-end | `FIRSTSATS_E2E=1 npm run test:e2e` | yes, live signet | ~10s |

The unit suite covers narration content, guardrails, view mapping, config
resolution, keystore round-trips, argument parsing and formatting. The e2e suite
checks the assumptions the fakes are built on: that the live server responds,
that addresses derive, and that a fresh wallet reports a zero balance.

CI runs the unit suite on every push. The e2e suite is opt-in because a failing
third-party deployment should not turn the build red.

## Adding a command

1. Write the operation on `FirstSatsAccount` in `src/account.ts`, wrapped in
   `narrator.track` with a `behindTheScenes` explanation.
2. Add a case to `test/account.test.ts` asserting both the result *and* the
   narration.
3. Add a thin command in `src/cli/commands/` that calls it and prints.
4. Register it in the `COMMANDS` map in `src/cli/index.ts` — that map is also
   the help text, so there is nothing to keep in sync.

## The web UI

There is one, and it validated the claim above: `FirstSatsAccount`, `Narrator`,
`config.ts` and `format.ts` are imported unchanged by an Angular app in
`apps/web`, which swaps in `localStorage` for the seed, IndexedDB repositories
for state, and a timeline component for the terminal renderer.

Making that work needed three small changes here, each an improvement in its own
right: terminal styling moved out of `format.ts` into `cli/style.ts`,
`resolveConfig` reads `process` off `globalThis`, and `NodeJS.Timeout` became
`ReturnType<typeof setTimeout>`. [`src/browser.ts`](../src/browser.ts) is the
barrel of everything free of Node globals.

See [The Angular web UI](./04-web-ui.md).
