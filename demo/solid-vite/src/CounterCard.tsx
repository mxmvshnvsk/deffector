import { useUnit } from 'effector-solid';
import * as model from '@deffector-demo/shared';

export function CounterCard() {
  const { count, isEven, onIncrement, onDecrement } = useUnit(model.$$counter);
  return (
    <section class="card">
      <h2>Counter</h2>
      <div class="row">
        <button type="button" data-testid="dec" onClick={() => onDecrement()}>
          −
        </button>
        <b data-testid="count" class="count">
          {count()}
        </b>
        <button type="button" data-testid="inc" onClick={() => onIncrement()}>
          +
        </button>
        <span class="muted">{isEven() ? 'even' : 'odd'}</span>
      </div>
    </section>
  );
}
