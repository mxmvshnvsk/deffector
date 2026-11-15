# Contributing

deffector is an npm workspaces monorepo. Everything runs from the repository root.

```sh
git clone https://github.com/mxmvshnvsk/deffector.git
cd deffector
npm install
npm run build
```

## Repository layout

| Path                  | What is there                                                                                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol`   | message types, the `$t`-tagged value encoding, the trace format and the compatibility check                                                                                                                                |
| `packages/agent`      | runs in the page: hooks `setInspector` / `setGraphInspector`, groups steps into transactions, keeps snapshots, time travel, edits, replay, effect overrides, health checks; adapters for React, Vue, Solid; the Node entry |
| `packages/panel`      | the UI (React), shared by the extension and the standalone app; `src/i18n/` (`en.ts`, `ru.ts`) holds every text in English and Russian                                                                                     |
| `packages/extension`  | the MV3 extension for Chrome/Edge (`dist/`) and Firefox (`dist-firefox/`): content script ⇄ background ⇄ DevTools panel                                                                                                    |
| `packages/standalone` | `npx @deffector/standalone`: serves the panel and relays agents over WebSocket                                                                                                                                             |
| `demo/*`              | one effector model (`demo/shared`) in React, Vue, Solid, Next.js, Node SSR, global mode and without the plugin; `demo/lab` for big graphs and edge cases                                                                   |
| `e2e`                 | Playwright tests that load the extension and drive every demo                                                                                                                                                              |
| `assets/brand`        | the logo, icons and social preview                                                                                                                                                                                         |
| `website`             | this documentation (VitePress)                                                                                                                                                                                             |

## Scripts

| Command                                 | What it does                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run build`                         | agent, demo model, extension (Chrome and Firefox), standalone                                       |
| `npm run watch -w @deffector/extension` | rebuilds the extension on change                                                                    |
| `npm test`                              | unit tests (vitest), `packages/*/test`                                                              |
| `npx playwright install chromium`       | once, before the first e2e run                                                                      |
| `npm run e2e`                           | Playwright: starts the demos, loads the extension and drives every demo (run `npm run build` first) |
| `npm run lint`                          | ESLint (Airbnb rules for TypeScript, React, Vue) and `prettier --check`                             |
| `npm run lint:fix`                      | ESLint with `--fix`, then `prettier --write`                                                        |
| `npm run format`                        | `prettier --write .`                                                                                |
| `npm run typecheck`                     | `tsc --noEmit` for the main and the Solid projects                                                  |
| `npm run dev:react` … `npm run dev:lab` | the [demos](/reference/demos)                                                                       |
| `npm run standalone`                    | the standalone app on http://localhost:8686                                                         |
| `npm run docs:dev`                      | this site with hot reload                                                                           |
| `npm run docs:build`                    | builds this site into `website/.vitepress/dist`                                                     |

Two opt-in Playwright runs produce material rather than check behaviour:

```sh
PERF=perf.json npx playwright test e2e/perf.spec.ts     # overhead numbers, see Performance
SHOTS=shots npx playwright test e2e/screens.spec.ts     # panel screenshots in both themes
```

And one vitest config checks the agent against an effector build with the
[upstream changes](/reference/upstream):

```sh
EFFECTOR_DIST=/path/to/effector/npm/effector npx vitest run -c vitest.upstream.config.ts
```

## Working on the panel

The panel is plain React with its own small store (`packages/panel/src/store/`). Every user-visible
string lives in `packages/panel/src/i18n/` (and the agent's own texts — Health items, notes — in
`packages/agent/src/i18n/`); add both languages. The extension and the standalone app mount the same
panel, so check both: `npm run build`, reload the extension, and `npm run standalone`.

## Working on these docs

```sh
npm run docs:dev        # prints the address, e.g. http://localhost:5173/deffector/
```

Pages are Markdown in `website/` — English at the root, Russian under `website/ru/` with the same
file names. Keep the two in step. Screenshots live in `website/public/screens/` (`dark-*` and
`light-*` pairs switch with the site theme). The site is deployed to GitHub Pages by `.github/workflows/docs.yml`
(Settings → Pages → Source: GitHub Actions; for a custom domain set the `DOCS_BASE` variable to `/`).

## Releasing

`@deffector/agent` and `@deffector/standalone` are published to npm; the other packages are private.
The agent is built with tsup into `dist/` (ESM and bundled type declarations; `@deffector/protocol` is
inlined), and every entry has a no-op twin under the `production` export condition. Inside this
repository the demos read the agent from its sources through the `@deffector/source` condition.

```sh
npm run release:check   # what would be published (npm pack --dry-run)
npm run check:artifacts # and whether it matches the manifests (run after the build)
```

To release: bump `version` in both `packages/agent/package.json` and `packages/standalone/package.json`,
commit, then tag and push — `.github/workflows/release.yml` checks, tests and publishes:

```sh
git tag v0.1.1 && git push origin v0.1.1
```

The workflow uses npm Trusted Publishing, so the repository needs no npm token: on npmjs.com, each
package → Settings → Trusted publishing → GitHub Actions → `mxmvshnvsk` / `deffector` / `release.yml`.
The first version of a package is published by hand (`npm publish -w @deffector/agent -w @deffector/standalone`),
because Trusted publishing is configured on an existing package.

### The browser extension

The extension has its own version (`packages/extension/static/manifest.json`) and its own tag. Bump the
manifest version, commit, then tag and push:

```sh
git tag extension-v0.1.4 && git push origin extension-v0.1.4
```

`.github/workflows/extension-release.yml` builds it, creates a GitHub release with
`deffector-chrome-<version>.zip` and submits the version to both stores: the Firefox build with its
source code to addons.mozilla.org, the zip to the Chrome Web Store. Each store reviews the version and
publishes it once approved. The repository secrets it needs:

- `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` — addons.mozilla.org → Developer Hub → API keys;
- `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` — a Google OAuth client with the Chrome Web
  Store API enabled (`npx chrome-webstore-upload-keys` walks through it), and `CWS_PUBLISHER_ID` from the
  Chrome Web Store developer dashboard. Without them the Chrome step is skipped.

AMO accepts every version once, so each extension release needs a new version; a version already
uploaded to AMO by hand is skipped. To build an existing tag again, run the workflow by hand
(**Actions** → **extension release** → **Run workflow**) with that tag.
