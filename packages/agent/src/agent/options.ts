/** keep in sync with package.json (a test checks it) */
export const AGENT_VERSION = '0.1.5';

export const DEFAULT_MAX_TRANSACTIONS = 1000;

export const DEFAULT_GRACE_MS = 10_000;

export type WhileClosed = 'pause' | 'record';

export interface AgentOptions {
  /** app name shown in the panel and written to traces */
  name?: string;
  /** build id (git sha) written to traces, used to warn when a trace comes from another build */
  build?: string;
  /** transactions kept in memory */
  maxTransactions?: number;
  /** steps per transaction before it is considered a runaway loop */
  maxSteps?: number;
  /**
   * What to do while no panel is attached. 'pause' (default) stops recording
   * after `graceMs` without a panel and resumes when one connects; 'record' keeps recording.
   */
  whileClosed?: WhileClosed;
  /** recording time after load before pausing without a panel, ms (default 10000) */
  graceMs?: number;
  /** steps in one synchronous kernel run after which propagation is cut (default 100000, false = off) */
  hardStop?: number | false;
  /** cover the page while it shows the past (default true) */
  lockPast?: boolean;
}

/** What the agent says about the app in `hello` and in traces. */
export interface AppInfo {
  name: string;
  url: string;
  build: string | undefined;
}
