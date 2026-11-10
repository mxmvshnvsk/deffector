# Upstream effector PRs

deffector works with effector as it is today (22.6+), on workarounds. Six small changes in effector
itself would make those workarounds unnecessary and the data more precise. They are implemented and
tested as branches against effector `master` 93dd907 (effector 23.4.4).

**Change 1 has landed upstream.** It was merged as
[effector/effector#1367](https://github.com/effector/effector/pull/1367) into
`release/effector/23_5_0`, so it ships in effector 23.5.0 — a separate implementation of the same
fix, which makes the `deffector/1-safe-inspector` branch below unnecessary. Five remain.

## The six changes

| #   | Change                                                        | What it adds                                                         | effector issues                   | deffector's workaround today                                                        |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | The inspector cannot break the kernel — **merged for 23.5.0** | `try/catch` around the inspector call in the kernel                  | [#1366][i1366], [PR #1367][p1367] | the agent wraps its own callback in `try/catch` anyway, for its own errors          |
| 2   | Message and transaction numbers                               | `seq`, `parentSeq`, `launchId`, `filtered`, `derived` in messages    | #977                              | its own counter, `WeakMap<Stack, step>` through `setInspector`                      |
| 3   | All scopes and their names                                    | `inspect({ scope: 'all' })`, `fork({ name })`, scope declarations    | #659, #911, #1144                 | `stack.scope` from `setInspector`, names through `registerScope`                    |
| 4   | Causality across boundaries                                   | `Message.cause` for effects and nested calls                         | #1324, #541, #771                 | `stack.meta.fxID` and a “the outer transaction continued” heuristic                 |
| 5   | Edges and disposal                                            | `inspectGraph({ links: true })`: `link` (with `reads`) and `dispose` | #91, #1200, PR #1334, #1353       | walking `node.next`, `family`, and `mov` steps from `store`                         |
| 6   | Step budget (optional)                                        | a step limit per root `launch`, an error with the cycle path         | #331, #1153                       | static cycle search and the [emergency stop](/reference/performance#emergency-stop) |

### 1. The inspector cannot break the kernel — merged

A bug fix, sent first. The kernel calls the inspector outside of its `tryRun`; an exception thrown by
an inspector unwinds `launch` past the state restore, `isRoot` stays `false` forever, and every later
deferred launch returns early — `await fx()` never finishes and `fx.pending` sticks at `true`. The patch
wraps the call in `try { … } catch (err) { console.error(err) }`. Two tests, both failing without the
fix.

Reported as [#1366][i1366] and merged as [PR #1367][p1367] on 8 November 2026, into
`release/effector/23_5_0` rather than `master` — so it arrives with effector 23.5.0, and #1366 stays
open until that branch reaches `master`. The patch is reachable from the public `inspect()` API, not
only from the `setInspector` slot deffector uses, so it fixes the same hang for effector-logger and
`@effector/redux-devtools-adapter`.

The wider version — one `try/catch` around the kernel's own state restore, which would cover every way
`launch` can unwind rather than this one path — was offered in the PR and declined for now. In
zerobias's words, the kernel has _a lot_ of stacks (scope, call stack, effect tracking, regions), so a
single guard needs careful planning; `try/catch` goes where it is needed meanwhile.

The agent keeps wrapping its own callback regardless: that `try/catch` also routes to
`onInternalError`, which is how a bug in deffector becomes a `[deffector] internal error` warning
instead of breaking the app. From 23.5 it stops being load-bearing for the kernel and stays as
deffector's own diagnostics.

### 2. Message and transaction numbers

`seq` (a running message number), `parentSeq` (the `seq` of `stack.parent`), `launchId` (the number of
the root `launch`), `filtered` (the node ran but the branch stopped) and the already existing `derived`
in the type definitions. `parentSeq` costs O(1), unlike `trace: true`, which adds 85% to the time of an
event. In the implementation a step that starts others (a watcher calling an event) gets its number
before them, because the kernel runs the nested `launch` right away; sorting by `seq` gives causal
order.

### 3. All scopes and their names

```ts
inspect({ scope: 'all', fn }); // Message.scope: { id: string; name?: string } | null
fork({ name: 'client' });
inspectGraph({ fn }); // { type: 'scope', id, name } on fork, { type: 'scope-dispose', id }
```

Today the scope filter is an exact match and scopes cannot be listed. `scope: null` in a message means
a call outside of any scope — exactly what the “call outside of scope” check needs (#1144).

### 4. Causality across boundaries

`Message.cause` — `{ kind: 'effect', fxID, callSeq }` or `{ kind: 'nested', seq }`. Effect runners and
`onSettled` are launched without a stack, so the trace breaks there; an event called from a watcher
starts a new root. With `cause`, replay does not duplicate nested calls, and “unit call from pure
function” can point at its source (#1324). In the implementation the effect part is computed entirely in
`inspect.ts`; the kernel only exposes `stack.caller`.

### 5. Edges and disposal

`inspectGraph({ links: true })` reports `{ type: 'link', id, op, from, to, reads, region, loc }` and
`{ type: 'dispose', id }`. It builds on the `link` format of PR #1334 and on reading links after
attachment from PR #1353, to be agreed with their authors. New from deffector: `reads` (`sample({ source })`
does not create a `next` edge from its source) and `dispose` (`clearNode` reports nothing today). Links
are sent on a microtask, because `sample` attaches its source after the node is created.

### 6. Step budget

The kernel loop has no limit, so a synchronous cycle through events hangs the tab. The implementation is
`limitSteps({ steps, fn })` from `effector/inspect`: a step limit per root `launch`, and on overflow a
stop with an error that names the most frequent nodes. Optional and debatable — the maintainers have
called cycle detection unsolvable before. deffector's own emergency stop works without it.

## Verification

| Branch                           | Based on                  | Tests                                                          |
| -------------------------------- | ------------------------- | -------------------------------------------------------------- |
| ~~`deffector/1-safe-inspector`~~ | —                         | superseded by [PR #1367][p1367], merged upstream               |
| `deffector/2-message-seq`        | `master`                  | +3                                                             |
| `deffector/3-all-scopes`         | `master`                  | +4                                                             |
| `deffector/4-cause`              | `deffector/2-message-seq` | +3                                                             |
| `deffector/5-links-dispose`      | `master`                  | +3                                                             |
| `deffector/6-step-budget`        | `master`                  | +3                                                             |
| `deffector/all`                  | all together              | 777 of 777 tests of the `effector` project; 13 files, +790/−24 |

The effector build (`node tools/build.js`) passes, and the deffector agent was run against it: 27 of 27
tests of `vitest.upstream.config.ts`, including a test that checks the exact `skip`, `caller` and
`fork({ name })`.

To run the agent's upstream tests against such a build:

```sh
EFFECTOR_DIST=…/npm/effector npx vitest run -c vitest.upstream.config.ts
```

## Plan

1. A discussion in effector/effector with a link to the deffector prototype.
2. ~~PR 1 right away.~~ Done: [#1366][i1366] → [PR #1367][p1367], merged for 23.5.0.
3. PRs 2–4 one by one, each with tests and a benchmark of 200 000 events; without an inspector there
   must be no difference.
4. PR 5 together with the authors of #1334 and #1353.
5. Target: a minor 23.x, then a port to `release/v24`.
6. deffector detects capabilities by the fields present in messages, not by the effector version, so it
   keeps working before and after.

[i1366]: https://github.com/effector/effector/issues/1366
[p1367]: https://github.com/effector/effector/pull/1367
