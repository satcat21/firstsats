# firstsats — web UI

The Angular front end. It is browser-only: no backend, and the recovery phrase
never leaves the device.

```bash
npm ci
npm start          # http://localhost:4200
npm run build      # production bundle into dist/
```

Or from the repository root: `npm run web` / `npm run web:build`.

This project imports the shared core from the repository root `src/` through the
`@firstsats/core` path alias — the same `FirstSatsAccount`, narration stream,
network presets and formatters the CLI uses.

Full write-up: [../../docs/04-web-ui.md](../../docs/04-web-ui.md).

> If `ng serve` reports a port you did not ask for, a `PORT` environment
> variable is set in your shell; Angular's dev server prefers it over `--port`.

## Troubleshooting

**`npm ci` fails with `EPERM: operation not permitted, unlink ... esbuild.exe`**

A previous `ng serve` left its esbuild service process running — it outlives the
terminal you started it from, and Windows will not let npm delete a running
binary. Stop it and retry:

```powershell
Get-Process esbuild -ErrorAction SilentlyContinue | Stop-Process -Force
npm ci
```

If a partly-cleaned install left stray directories behind (npm names them
`.win32-x64-<hash>`), remove them once the process is gone:

```powershell
Remove-Item -Recurse -Force node_modules\.vite-*, node_modules\@esbuild\.win32-x64-*
```

**`npm warn install-scripts 4 packages had install scripts blocked`**

Expected, and safe to leave alone. npm 12 blocks lifecycle scripts unless a
package is explicitly allowlisted — a supply-chain protection worth keeping.
All four packages (`esbuild`, `lmdb`, `msgpackr-extract`, `@parcel/watcher`)
ship their native binaries as prebuilt platform-specific optional dependencies
(`@esbuild/win32-x64` and friends), so the build works without ever running
their install scripts. Do not add them to `allowScripts` to silence the warning.
