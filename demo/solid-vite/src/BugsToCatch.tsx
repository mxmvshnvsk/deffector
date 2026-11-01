import { useUnit } from 'effector-solid';
import * as model from '@deffector-demo/shared';

const ANN = { email: 'ann@example.com', password: 'secret-pass', name: 'Ann Lee' };

/** Each button reproduces a classic effector mistake from the shared model. */
export function BugsToCatch() {
  const bugs = useUnit(model.$$bugs);
  return (
    <section class="card">
      <h2>Bugs to catch</h2>
      <p class="muted">
        Each button reproduces a classic effector mistake. Open DevTools → deffector and watch the
        Log and Health tabs.
      </p>
      <div class="row">
        <button
          type="button"
          data-testid="greet-bug"
          onClick={() => bugs.onGreetLater({ name: bugs.name(), fixed: false })}
        >
          Greet later (no scopeBind)
        </button>
        <button type="button" onClick={() => bugs.onGreetLater({ name: bugs.name(), fixed: true })}>
          Greet later (fixed)
        </button>
      </div>
      <p>
        Greeting: <b data-testid="greeting">{bugs.greeting() || '—'}</b>
      </p>
      <div class="row">
        <button type="button" data-testid="quick-fill" onClick={() => bugs.onQuickFill(ANN)}>
          Quick fill (double update)
        </button>
        <span class="muted">strength: {bugs.strength()}</span>
      </div>
      <div class="row">
        <button type="button" onClick={() => bugs.onNameChange('crash')}>
          Name = “crash” (throws in .map)
        </button>
      </div>
    </section>
  );
}
