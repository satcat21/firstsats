# Security Policy

## This is a demo. Do not put real money in it.

`arkade-firstsats` is a teaching tool. It is built to make the Arkade protocol
legible, not to protect funds, and it makes two deliberate trade-offs that
disqualify it from production use:

1. **Seeds are stored unencrypted.** `firstsats init` writes a BIP-39 mnemonic
   in cleartext to `.firstsats/<name>.wallet.json` (mode `0600`). Anyone who can
   read that file — or a backup, or a synced folder containing it — can spend
   every coin the wallet holds.
2. **`firstsats init` prints the mnemonic to stdout.** That means it lands in
   your shell history buffer, your terminal scrollback, and any CI log that ever
   runs it.

Both are safe *only* because the defaults point at Bitcoin **signet**, where
coins have no value. Do not repoint this at mainnet.

For a real wallet you would encrypt the seed at rest, keep it out of stdout, and
use a persistent repository (`SQLiteWalletRepository` or the IndexedDB ones) so
unilateral-exit data survives a restart.

## Supported versions

| Version | Supported |
| ------- | --------- |
| `0.1.x` | Yes       |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report privately, in order of preference:

1. **GitHub private vulnerability reporting** — on the repository, go to the
   **Security** tab → **Report a vulnerability**. This opens a private advisory
   visible only to the maintainer. It is the preferred channel because it keeps
   the report, the fix and the eventual disclosure in one place.
2. **Direct contact with the maintainer** — [@satcat21](https://github.com/satcat21).

Please include:

- what the issue is and which file or command it affects,
- the steps to reproduce it,
- what an attacker gains,
- the version or commit you tested,
- and whether you would like to be credited in the advisory.

### What to expect

| Stage | Target |
| ----- | ------ |
| Acknowledgement of your report | within 3 business days |
| Initial assessment and severity | within 7 business days |
| Fix or documented mitigation | depends on severity; you will get updates either way |

This is a single-maintainer educational project, not a funded product. Those
targets are honest intentions rather than a contractual SLA.

Please give a reasonable window for a fix before disclosing publicly. Reporters
who follow this process are credited in the advisory unless they ask not to be.

## In scope

- Anything that could expose or exfiltrate a seed beyond the two documented
  behaviours above.
- Path traversal or arbitrary file write through wallet names or the data
  directory.
- Incorrect validation in `src/account.ts` that would let a payment go somewhere
  the user did not intend.
- Dependency vulnerabilities reachable from this code — see below.
- CI configuration that could leak a secret or publish an unreviewed artifact.

## Out of scope

- The two documented demo trade-offs at the top of this file. They are known,
  intentional, and the reason this is signet-only.
- Vulnerabilities in [`@arkade-os/sdk`](https://github.com/arkade-os/ts-sdk) or
  in the Arkade server itself. Report those to
  [Ark Labs](https://github.com/arkade-os/ts-sdk/security/policy) — though we
  would appreciate a heads-up so this project can pin around them.
- Anything requiring an attacker who already has read access to your filesystem
  or shell history. See trade-off 1.
- Denial of service against public signet infrastructure.

## How dependencies are watched

- `npm audit --audit-level=high --omit=dev` gates every CI run on both GitLab
  and GitHub, so a high-severity advisory in the shipped dependency tree fails
  the build.
- Dev-dependency advisories are reported but non-fatal — they never reach a
  user.
- Dependabot opens pull requests for security and version updates
  (`.github/dependabot.yml`).
- CodeQL scans this repository's own code weekly and on every pull request
  (`.github/workflows/codeql.yml`).
