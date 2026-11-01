import { headers } from 'next/headers';
import { allSettled, fork, serialize } from 'effector';
import { EffectorNext } from '@effector/next';
import * as model from '@deffector-demo/shared';
import { registerScope } from '@deffector/agent/node';
import { App } from '../components/App';
import { Bridge } from '../components/Bridge';

export const dynamic = 'force-dynamic';

/**
 * The label has to come from the request, not from a module-level counter: Next
 * renders requests concurrently in one process, so module state is shared by all
 * of them and the names would interleave.
 */
async function requestLabel() {
  const requestHeaders = await headers();
  const id = requestHeaders.get('x-request-id') ?? crypto.randomUUID().slice(0, 8);
  return `request ${id}`;
}

export default async function Page() {
  // server: a scope per request, filled before render and serialized for the client
  const scope = fork();
  registerScope(scope, { name: await requestLabel() });
  // deliberately three separate allSettled calls: the demo wants three rows in
  // the Log. An app should prefer one `pageStarted` event and connect the rest
  // with `sample`, so the page does not drive the model's internals.
  await allSettled(model.email.changed, { scope, params: 'ssr@example.com' });
  await allSettled(model.incremented, { scope });
  await allSettled(model.incremented, { scope });
  return (
    <EffectorNext values={serialize(scope)}>
      <Bridge>
        <App />
      </Bridge>
    </EffectorNext>
  );
}
