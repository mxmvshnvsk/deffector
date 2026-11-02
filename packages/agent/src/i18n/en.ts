/** English texts the agent produces (diagnostics, step notes, the past overlay). */
export const en = {
  noteSame: 'same value (===): update skipped',
  noteUndefined: 'undefined: update skipped',
  noteFiltered: 'filter returned false: the target was not called',
  outOfScopeTitle: (unit: string) => `Call outside of scope: ${unit}`,
  outOfScopeDetail: (unit: string) =>
    `${unit} was called outside of any scope while the app uses fork(). The change went to the global graph; the app reads its own scope and does not see it. Usually a call from setTimeout, a socket or a third-party callback, or a direct call instead of useUnit.`,
  outOfScopeFix: (unit: string) =>
    `Bind it before leaving the effect: const fn = scopeBind(${unit}), or call it through useUnit`,
  doubleTitle: (unit: string) => `${unit} updated more than once in one transaction`,
  doubleDetail:
    'The store was recomputed twice in one propagation. effector orders combine and sample steps by declaration order, not by graph topology, so a consumer declared before its sources reads a stale value first.',
  doubleFix: (unit: string) =>
    `Declare ${unit} after the units that feed it, or derive it with combine instead of a chain of sample`,
  blockedTitle: (unit: string) => `${unit} stopped by filter`,
  blockedDetail:
    'filter returned false and the target was not called. Open the transaction to see the source and filter values.',
  errorTitle: (unit: string) => `Exception in ${unit}`,
  errorDetail: (message: string) =>
    `${message}. effector logs it and stops only this branch: sibling branches have already committed, so derived stores can be out of sync with their sources.`,
  errorFix: 'Keep reducers and mapping functions pure and total; move risky code to an effect',
  failTitle: (unit: string) => `${unit} failed`,
  limitTitle: (unit: string) => `${unit} ran more steps than deffector records`,
  limitDetail: (stepLimit: number) =>
    `The transaction passed ${stepLimit} steps, so the rest of its step tree was not recorded. Store changes are still kept, so the Stores tab and time travel stay right. A synchronous loop that never ends is reported separately, by the emergency stop.`,
  limitFix: 'Raise the limit with attachDeffector({ maxSteps }) to record the whole tree',
  noSidTitle: (count: number, total: number) => `${count} of ${total} stores have no sid`,
  noSidDetail: (names: string) =>
    `${names}. serialize(scope) skips them silently, and a recorded trace can match them only by name. Time travel still works within this page.`,
  noSidFix: 'Add effector/babel-plugin or @effector/swc-plugin for these files',
  dupTitle: (sid: string) => `Duplicate sid ${sid}`,
  dupDetail: (names: string) =>
    `${names} share one sid: serialize, hydration and handler mocking will mix them up. Usually a factory missing from the plugin's factories list, or the plugin applied twice.`,
  dupFix: "Add the factory to the plugin's factories option",
  globalTitle: 'Global mode: no fork() scope',
  globalDetail:
    'Time travel writes values in place with launch: watchers, samples and effects react to it, so the result is not guaranteed. Replay mocks effect handlers globally.',
  globalFix: 'Prefer fork() and render the app inside <DeffectorProvider value={scope}>',
  noAdapterTitle: 'A scope is used, but the app is not wrapped in DeffectorProvider',
  noAdapterDetail:
    'Without an adapter deffector cannot render a past scope, so jumps write values into the live scope in place.',
  noAdapterFix:
    "Use DeffectorProvider from '@deffector/agent/react' (or /vue, /solid) instead of effector's Provider",
  conflictTitle: 'Another tool took over the effector inspector',
  conflictDetail:
    'effector has a single inspector slot. effector/inspect (used by effector-logger and @effector/redux-devtools-adapter) was loaded after deffector and replaced it: new transactions are not recorded.',
  conflictFix:
    'Remove the other tool in development, or import it before @deffector/agent. "Reclaim" in the panel takes the slot back.',
  okCycles: 'No runaway transactions',
  okCyclesDetail: (stepLimit: number) => `No transaction ran more than ${stepLimit} steps.`,
  unknownStep: (unit: string) => `unknown unit ${unit}: step skipped`,
  silentEdit: 'fork({values}) and scope swap: watchers and effects did not run',
  replayLabel: (who: string) => `replay: ${who}`,
  jumpScope: (name: string, id: number) => `${name} @ #${id}`,
  pastTitle: (transactionId: number) => `deffector: the app shows transaction #${transactionId}`,
  pastBack: 'Back to present',
  pastUnlock: 'Allow clicks',
  pastHint: 'clicks are blocked so the past does not change',
  pausedTitle: 'History before the panel opened was not recorded',
  pausedDetail: (seconds: number) =>
    `The agent pauses when DevTools is closed (it records during the first ${seconds} s after load, so opening DevTools and reloading keeps the start of the page).`,
  pausedFix:
    'Keep DevTools open and reload the page to record from the start, or set attachDeffector({ whileClosed: "record" })',
  stopTitle: 'deffector stopped an infinite loop',
  stopDetail: (stepCount: number, names: string) =>
    `One synchronous kernel run passed ${stepCount} steps. deffector cut the propagation to keep the tab alive; the state may be partially updated. Hottest units: ${names}.`,
  stopFix:
    'Find the cycle in Graph (it goes through these units) and break it with a filter or by moving the call out of the watcher',
  eventCycleTitle: (names: string) => `Cycle through events only: ${names}`,
  eventCycleDetail:
    'Events re-trigger each other without a store in between. Unless a filter stops it, one call loops forever and freezes the tab.',
  eventCycleFix:
    'Add a filter, or route the loop through a store (a store stops when the value stops changing)',
  storeCycleTitle: (names: string) => `Cycle through a store: ${names}`,
  storeCycleDetail:
    'It ends when the store value stops changing. Fine for convergent logic; a value that changes every time (a counter, a new object) loops until the step limit.',
  sidMismatchTitle: (count: number) =>
    `${count} value(s) from the server have no store on the client`,
  sidMismatchDetail: (sids: string) =>
    `fork({ values }) / hydrate received sids the client does not know: ${sids}. Either the server and client builds compile the model differently (plugin options, factories), or the module is not loaded yet.`,
  sidMismatchFix:
    'Use the same babel/swc plugin config on server and client; list factories in the plugin options',
  derivedWriteTitle: (unit: string) => `Derived store ${unit} is written directly`,
  derivedWriteDetail:
    'A map/combine store got a value from sample or an event. effector deprecates it: the next source update overwrites the value, and the two disagree in between.',
  derivedWriteFix: (unit: string) =>
    `Make ${unit} a regular store (createStore + .on/sample), or write to its sources instead`,
  staleReadTitle: (reader: string, store: string) =>
    `${reader} read ${store} before it was updated`,
  staleReadDetail: (store: string) =>
    `In the same transaction ${store} changed after the sample had already taken its value, so the sample used the old one. effector orders samples by declaration and priority, not by data flow.`,
  staleReadFix: (store: string) =>
    `Trigger the sample from ${store} (clock: ${store}) or declare it after the units that update ${store}`,
  inconsistentTitle: (count: number) => `${count} derived store(s) disagree with their sources`,
  inconsistentDetail: (names: string) =>
    `${names}: the value differs from recomputing it from the current sources. Usually after an exception in a map/combine, or a derived store written directly.`,
  inconsistentFix: 'Look at the last transaction with an error; fix the throwing function',
  consistentTitle: 'Derived stores match their sources',
  leakTitle: (unit: string, count: number) => `${unit} created ${count} times`,
  leakDetail: (where: string) =>
    `Units from ${where} are created again after the app started. Units made in a component, a watcher or an effect are never garbage-collected and break SSR (new sids).`,
  leakFix:
    'Create the model once at module level, or with a factory instance kept outside render (useMemo is not enough under StrictMode)',
  lateTitle: (count: number) => `${count} unit(s) created after start`,
  lateDetail: (files: string) =>
    `${files}. Lazy-loaded chunks do this once and are fine; repeated creation is reported separately.`,
  skippedChildren: (names: string) => `Did not run because of the exception: ${names}`,
};

export type Texts = typeof en;
