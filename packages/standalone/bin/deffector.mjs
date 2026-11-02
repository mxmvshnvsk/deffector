#!/usr/bin/env node
import { startServer } from '../server.mjs';

const DEFAULT_PORT = 8686;
const HELP = `deffector standalone — DevTools for effector outside a browser tab

  npx @deffector/standalone [--port ${DEFAULT_PORT}] [--host 127.0.0.1]

In your app (SSR server, Node script, React Native):
  import { attachDeffectorNode } from '@deffector/agent/node'
  attachDeffectorNode({ name: 'my-server' })      // ws://localhost:${DEFAULT_PORT}/agent
`;

const cliArguments = process.argv.slice(2);

/** The value after `--name`, if the flag is given. */
function readOption(name) {
  const index = cliArguments.indexOf(`--${name}`);
  return index >= 0 ? cliArguments[index + 1] : undefined;
}

if (cliArguments.includes('--help') || cliArguments.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}
const port = Number(readOption('port') ?? process.env.DEFFECTOR_PORT ?? DEFAULT_PORT);
const host = readOption('host') ?? '127.0.0.1';
const server = await startServer({ port, host });
console.log(
  `[deffector] panel: ${server.url}  ·  agents connect to ws://${host}:${server.port}/agent`,
);
