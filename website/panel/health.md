# Health

The **Health** tab is a runtime lint for the problems that keep coming up in effector issues. Every item
says what happened, where (a file link that opens the Sources panel at the line), and how to fix it.

<Shot name="health" alt="The Health tab: Call outside of scope, $errors updated more than once, a sample stopped by filter, and No runaway transactions" />

## Reading the list

Items are sorted by level: errors (red `!`), warnings (yellow `!`), information (`i`), and passed
checks (`✓`). The tab label shows the number of errors, or of warnings when there are no errors.

- `×3 · last #8` — how many times it happened and the last transaction;
- **click** an item to open that transaction in the Log (or the store in Stores);
- **Show in Graph** focuses the units involved (cycles, stale reads, double updates, writes to derived
  stores, the emergency stop);
- **Check derived stores** (top of the tab) runs the [consistency check](#derived-stores-disagree-with-their-sources)
  on demand.

Items that come from transactions are cleared with the log; items about units and scopes stay.

![Health in the lab demo: deffector stopped an infinite loop, Exception in $divisor.map, Call outside of scope ×3, a stale read, Derived stores match their sources](/screens/x-health-lab.png){.screen}

## Checks from transactions

### Call outside of scope

**Error** · `Call outside of scope: greetingShown`

The unit was called outside of any scope while the app uses `fork()`. The change went to the global
graph; the app reads its own scope and does not see it. Usually a call from `setTimeout`, a socket or a
third-party callback, or a direct call instead of `useUnit`. The row in the Log is red with a
`no scope` badge.

**Fix:** bind it before leaving the effect — `const fn = scopeBind(greetingShown)` — or call it through
`useUnit`.

### Updated more than once in one transaction

**Warning** · `$errors updated more than once in one transaction`

The store was recomputed twice in one propagation. effector orders `combine` and `sample` steps by
declaration order, not by graph topology, so a consumer declared before its sources reads a stale value
first. The Log shows a `2× $errors` badge.

**Fix:** declare the store after the units that feed it, or derive it with `combine` instead of a chain
of `sample`.

### Stopped by filter

**Info** · `sample(…) stopped by filter`

`filter` returned `false` and the target was not called. Not a bug by itself — but when a button “does
nothing”, this is usually why. Open the transaction to see the source and filter values.

### Exception in a pure function

**Error** · `Exception in $divisor.map → $divisor → *`

A reducer, `map`, `combine` or `filter` threw. effector logs it and stops only this branch: sibling
branches have already committed, so derived stores can be out of sync with their sources. The detail
lists what did not run because of the exception.

**Fix:** keep reducers and mapping functions pure and total; move risky code to an effect.

### Read before it was updated (stale read)

**Warning** · `sample($price, $qty → totalLogged) read $qty before it was updated`

![A stale read in the Log: priceChanged with a stale read badge and the explanation in Why](/screens/x-stale-read.png){.screen}

In the same transaction the store changed _after_ the `sample` had already taken its value, so the
`sample` used the old one. effector orders samples by declaration and priority, not by data flow.

**Fix:** trigger the sample from that store (`clock: $qty`) or declare it after the units that update
the store.

### Derived store written directly

**Warning** · `Derived store $x is written directly`

A `map`/`combine` store got a value from `sample` or an event. effector deprecates it: the next source
update overwrites the value, and the store and its sources disagree in between.

**Fix:** make it a regular store (`createStore` + `.on` / `sample`), or write to its sources instead.

### Effect failed

**Info** · `signupFx failed`

An effect rejected; the detail is the error message. Useful to spot failures that the UI swallows.

### More steps than deffector records

**Info** · `loopStart ran more steps than deffector records`

One transaction passed `maxSteps` steps (5000 by default), so the rest of its step tree was not
recorded. Store changes are still kept, so the Stores tab and time travel stay right.

This is a recording limit, not a diagnosis: a few hundred list items with a model each, or a store
feeding a few hundred derived ones, reach it while finishing perfectly well. A synchronous loop that
really does not end is reported by [the emergency stop](#deffector-stopped-an-infinite-loop)
instead, with the units it was looping through.

**Fix:** raise the limit with `attachDeffector({ maxSteps })` to record the whole tree.

### deffector stopped an infinite loop

**Error** · `deffector stopped an infinite loop`

One synchronous kernel run passed `hardStop` steps (100 000 by default). deffector **cut the
propagation** to keep the tab alive: every node that runs past the limit stops passing values on, the
kernel drains its queue, and on the next microtask the links are restored. The state may be partially updated; the transaction
is marked `stopped`. The detail names the hottest units.

**Fix:** find the cycle in Graph (it goes through these units) and break it with a `filter`, or move the
call out of the watcher. See [Performance](/reference/performance#emergency-stop).

### No runaway transactions

**Passed** · `No runaway transactions` — no transaction ran more than `maxSteps` steps.

## Checks of units and scopes

### Stores without sid

**Warning** · `3 of 20 stores have no sid`

Without a `sid`, `serialize(scope)` silently skips a store, hydration cannot reach it, and a recorded
trace can match it only by name. Time travel still works within the page.

**Fix:** add `effector/babel-plugin` or `@effector/swc-plugin` for these files.

### Duplicate sid

**Error** · `Duplicate sid 2r0u4d|xz7n29`

Several units share one sid: `serialize`, hydration and handler mocking will mix them up. Usually a
factory missing from the plugin's `factories` list, or the plugin applied twice. (Units created again
after start are reported as a [leak](#created-n-times) instead.)

**Fix:** add the factory to the plugin's `factories` option.

### Global mode

**Warning** · `Global mode: no fork() scope`

The app works with the global graph. Time travel writes values in place with `launch`: watchers, samples
and effects react to it, so the result is not guaranteed. Replay mocks effect handlers globally.

**Fix:** prefer `fork()` and render the app inside `<DeffectorProvider value={scope}>`.

### Scope without an adapter

**Warning** · `A scope is used, but the app is not wrapped in DeffectorProvider`

Without an adapter deffector cannot render a past scope, so jumps write values into the live scope in
place.

**Fix:** use `DeffectorProvider` from `@deffector/agent/react` (or `/vue`, `/solid`) instead of
effector's `Provider`.

### Values from the server without a store

**Warning** · `2 value(s) from the server have no store on the client`

`fork({ values })` or hydration received sids the client does not know. Either the server and client
builds compile the model differently (plugin options, factories), or the module is not loaded yet. Try
it in the lab demo with `?hydrate`.

**Fix:** use the same babel/swc plugin config on server and client; list factories in the plugin
options.

### Created N times

**Warning** · `$field created 12 times`

Units from the same source location are created again and again after the app started. Units made in a
component, a watcher or an effect are never garbage-collected and break SSR (new sids each time).
Reported once a location has created units at least three times.

**Fix:** create the model once at module level, or keep the factory instance outside render
(`useMemo` is not enough under StrictMode).

### Units created after start

**Info** · `14 unit(s) created after start`

Lists the files that created units after the app started. Lazy-loaded chunks do this once and are fine;
repeated creation is reported separately as above.

### Cycle through events only

**Warning** · `Cycle through events only: loopStart → loopNext → …`

Found in the static graph: events re-trigger each other without a store in between. Unless a filter
stops it, one call loops forever and freezes the tab.

**Fix:** add a `filter`, or route the loop through a store (a store stops when the value stops
changing).

### Cycle through a store

**Info** · `Cycle through a store: clamp → $clamped → …`

It ends when the store value stops changing. Fine for convergent logic; a value that changes every time
(a counter, a new object) loops until the step limit.

### History before the panel opened

**Info** · `History before the panel opened was not recorded`

The agent pauses when DevTools is closed: it records during the first 10 s after load (`graceMs`), so
opening DevTools and reloading keeps the start of the page.

**Fix:** keep DevTools open and reload the page to record from the start, or set
`attachDeffector({ whileClosed: 'record' })`.

### Another tool took over the inspector

**Error** · `Another tool took over the effector inspector`

effector has a single inspector slot. `effector/inspect` (used by effector-logger and
`@effector/redux-devtools-adapter`) was loaded after deffector and replaced it: new transactions are not
recorded. deffector checks the slot every few seconds while the panel is open.

**Fix:** remove the other tool in development, or import it before `@deffector/agent`. The **Reclaim**
button on the item takes the slot back.

## Derived stores disagree with their sources

**Check derived stores** recomputes every derived store from the current values of the writable stores
in a throwaway `fork()` and compares the result with what the app holds.

- **Passed** · `Derived stores match their sources`;
- **Warning** · `2 derived store(s) disagree with their sources` — usually after an exception in a
  `map`/`combine`, or a derived store written directly. **Fix:** look at the last transaction with an
  error and fix the throwing function.

It is on demand because it runs every derived computation once more. It is also in the
[command palette](/panel/palette).
