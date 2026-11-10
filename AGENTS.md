# Working on deffector

deffector is an OSS debugger for effector applications: an in-app agent, framework providers,
a browser extension, and a standalone panel. Apply these instructions throughout the repository.
Use the existing implementation and configuration as the source of truth when details change.
Read `README.md` and `website/reference/contributing.md` for setup and contributor workflows.

## Repository map

This is an npm workspaces monorepo. Run commands from the repository root; use npm and keep
`package-lock.json` in sync with dependency changes. Node.js 22 is used by the GitHub workflows.

| Path                  | Responsibility                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol`   | Shared message types, transports, `$t`-tagged value encoding, trace format and compatibility checks. Private; bundled into published packages.                                      |
| `packages/agent`      | Inspector hooks, registry, transaction collection, history, time travel, replay, edits, diagnostics, framework adapters, browser and Node entries. Published as `@deffector/agent`. |
| `packages/panel`      | Shared React UI and its own external store, used by both extension and standalone.                                                                                                  |
| `packages/extension`  | MV3 extension: content script, background, DevTools panel and site permissions. Chrome/Edge and Firefox builds.                                                                     |
| `packages/standalone` | Panel host and WebSocket relay, published as `@deffector/standalone`.                                                                                                               |
| `demo/shared`         | Shared effector models, built with the effector Babel plugin.                                                                                                                       |
| `demo/*`              | React, Vue, Solid, global mode, no-plugin, Next.js, Node SSR and lab scenarios.                                                                                                     |
| `e2e`                 | Playwright tests using the real built Chromium extension and demos.                                                                                                                 |
| `website`             | VitePress documentation: English at the root, Russian under `ru/`.                                                                                                                  |

## Code conventions

- Follow `eslint.config.mjs` (Airbnb with documented project exceptions), `.prettierrc.json` and
  the relevant `tsconfig*.json`. Do not relax these configurations to make a change pass.
- Prettier owns formatting: two spaces, semicolons, single quotes in JS/TS, double quotes in JSX,
  trailing commas, parentheses around arrow parameters, LF, and a print width of 100.
- Use TypeScript and ES modules for application code; follow the existing `.mjs` convention for
  Node build scripts and servers. Keep strict typing. Prefer `unknown` with narrowing at external
  boundaries; keep casts for effector internals localized in `packages/agent/src/effector`.
- Prefer named exports, as the ESLint configuration explains. Preserve existing public default
  exports where they are part of adapter compatibility; configuration files may need them too.
- Follow neighboring code: camelCase functions, variables and helper modules; PascalCase types,
  classes and component files; UPPER_SNAKE_CASE constants where already used.
- Keep modules focused on one responsibility. Reuse existing helpers and feature-local `index.ts`
  exports. Put shared agent/panel contracts in `@deffector/protocol`, not in cross-package internals.
- Use guard clauses and `for...of` where appropriate. `continue` is allowed; `i++` is allowed in
  for-loop afterthoughts. Use `void promise` for deliberately unawaited promises.
- Mutating recorded transactions, effector nodes and scopes is intentional. Respect the exact
  `no-param-reassign` exceptions in ESLint rather than broadly disabling the rule.
- Write code identifiers, comments, documentation and commit messages in English. Comments should
  explain intent, compatibility constraints or kernel behavior; avoid restating the code.
- Keep changes scoped to the task. Avoid unrelated refactors, dependency upgrades and repository-wide
  formatting. Fix formatting in touched files with `npx prettier --write <files>`.

## Architecture and compatibility

- The panel uses `PanelStore` and `useSyncExternalStore` through `useStore`. Extend the existing
  store, commands and selectors; maintain version notifications when changing observable state.
  Keep host-specific APIs in the extension or standalone integration so the panel works in both.
- The agent must use the application's effector instance. Keep effector and framework bindings
  external in the agent build, and preserve the single shared agent across entry points/adapters.
- `setInspector` and `setGraphInspector` are single slots. Preserve inspector ownership and disposal
  behavior. Keep assumptions about effector's private graph, stack and scope shapes in the existing
  internal compatibility layer, with fallbacks for supported releases.
- Some upstream effector capabilities are optional and feature-detected. Normal operation must work
  without the proposed upstream changes; see `website/reference/upstream.md` and the upstream tests.
- Collector code runs on every kernel step. Avoid unnecessary allocations, closures and repeated
  graph work in hot paths. Preserve history bounds, recording pause behavior and the runaway guard.
- Preserve scoped and global modes, including their different time-travel behavior. Replay in a
  fresh scope must use recorded effect results rather than call the application's real network.
- Production exports must remain no-ops. Public API changes need matching no-op entries, types and
  export conditions. Keep `@deffector/source` resolution for local demos where used.
- Solid adapters ship JSX source for the consuming app's Solid compiler; their build emits types.
  Preserve the published source-file list and separate Solid TypeScript configuration. Solid props
  are reactive getters: do not apply React-style destructuring or hooks to them indiscriminately.
- Frameworks are optional peers. Keep framework imports in their adapters and preserve separate
  `/react` vs `/react-scope` and `/solid` vs `/solid-scope` provider contexts. Check declared peer
  ranges and documented requirements before introducing APIs from newer framework versions.
- For protocol/trace changes, update producers, consumers, encoding/decoding and compatibility checks
  together. Preserve secret masking and explicit lossy-value handling in exported traces.
- Extension changes must account for Chrome/Edge and Firefox and the existing per-site permission
  flow. Edit source manifests/build logic, not generated browser-specific output.

## UI and documentation

- Add agent and panel user-visible strings to their respective `src/i18n/en.ts` and `ru.ts` files.
  Keep keys and behavior in sync. Reuse the existing text accessors instead of hardcoding UI copy.
- Follow the panel's existing CSS, components, themes and accessibility conventions.
- Update English and Russian documentation together using matching paths under `website/` and
  `website/ru/`. For public API or setup changes, also check `README.md` and package READMEs.
- Documentation builds include a live React demo. Theme-aware screenshots use paired `dark-*` and
  `light-*` files in `website/public/screens/`.
- Do not edit or commit generated builds, caches, Playwright reports or demo output. See `.gitignore`
  and `.prettierignore` for the current paths.

## Validation

Choose checks that cover the changed behavior. For code changes, run lint, typecheck and relevant
unit tests; use the full build and e2e checks when integrations or packaging are affected. For a
documentation-only change, check formatting and build the docs when site content/configuration changes.
Report which checks ran and any failures or checks that could not run.

| Command                                            | Purpose                                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm ci`                                           | Install locked dependencies in a clean environment; the agent's prepare hook builds it.                  |
| `npm run lint`                                     | ESLint and repository-wide Prettier check.                                                               |
| `npm run typecheck`                                | Main and Solid TypeScript projects.                                                                      |
| `npm test`                                         | Vitest tests in `packages/*/test`.                                                                       |
| `npx vitest run packages/agent/test/agent.test.ts` | Example of a focused unit test run.                                                                      |
| `npm run build`                                    | Agent, shared demo model, Chrome/Edge extension, Firefox extension, standalone.                          |
| `npm run e2e`                                      | Playwright against the built extension and demos; run the build first.                                   |
| `npm run docs:build`                               | Shared demo model, live demo and VitePress site.                                                         |
| `npm run release:check`                            | Dry-run npm package contents for agent and standalone; build first for current artifacts.                |
| `npm run check:artifacts`                          | Manifest targets, relative imports and production no-op budgets of both published packages; build first. |

Install Chromium once with `npx playwright install chromium` before e2e. Playwright starts/reuses the
demo and standalone servers from `playwright.config.ts`. Its extension coverage is Chromium coverage;
Firefox-specific changes also need a Firefox build and an appropriate manual check.
For shared panel changes, verify both extension and standalone integration.

Add or update behavioral regression tests for fixes and nontrivial new behavior. Use existing
Vitest memory transports and Playwright fixtures rather than replacing the integration with mocks.
For changes to kernel collection or overhead, use the existing overhead tests and lab scenarios.
The `PERF` and `SHOTS` Playwright runs are opt-in artifact generation, not ordinary validation.
Run upstream validation only when a matching effector build is available:

```sh
EFFECTOR_DIST=/path/to/effector/npm/effector npx vitest run -c vitest.upstream.config.ts
```

## Git and releases

- Preserve the user's existing work. Inspect the diff before finishing; do not include unrelated files.
- Follow the existing commit history: `type: short imperative description` in English, normally one
  subject line with a lowercase opening and no final period. Existing types include `feat`, `fix`,
  `docs`, `test`, `build`, `ci` and `chore`. Example: `fix: preserve scope when replaying traces`.
- When committing agent-assisted work, keep the user as the author:
  `Maxim Vishnevsky <mxmvshnvsk@gmail.com>`. Add a blank line after the subject/body and the trailer
  `Co-authored-by: Codex <codex@openai.com>`. Do not replace the author with the assistant or change
  global Git identity. Creating this file does not itself request a commit.
- Reuse the existing release automation. Do not introduce a second publishing/deployment mechanism.
  Version bumps, release tags and publication should be part of a requested release task.
- `.github/workflows/release.yml`: pushing `v*` publishes agent and standalone to npm via Trusted
  Publishing. Both package versions must match the tag. The workflow runs lint, typecheck and unit
  tests; package `prepublishOnly` scripts build the artifacts.
- `.github/workflows/extension-release.yml`: pushing `extension-v*` (or dispatching an existing tag)
  builds both browsers, creates a GitHub release and submits to Firefox Add-ons and Chrome Web Store.
  The version comes from `packages/extension/static/manifest.json`, not the extension package version.
  Store review/publication is asynchronous; AMO versions cannot be reused for a new upload.
- `.github/workflows/docs.yml`: deploys GitHub Pages on matching path changes on `main`, or manual
  dispatch. It also watches agent/protocol and shared/React demo sources because the site hosts the
  live demo. Preserve the configurable `DOCS_BASE` and existing Pages deployment setup.
