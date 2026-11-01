import { useUnit } from 'effector-react';
import * as model from '@deffector-demo/shared';

export function CounterCard() {
  const { count, isEven, onIncrement, onDecrement } = useUnit(model.$$counter);
  return (
    <section className="card">
      <h2>Counter</h2>
      <div className="row">
        <button type="button" data-testid="dec" onClick={() => onDecrement()}>
          −
        </button>
        <b data-testid="count" className="count">
          {count}
        </b>
        <button type="button" data-testid="inc" onClick={() => onIncrement()}>
          +
        </button>
        <span className="muted">{isEven ? 'even' : 'odd'}</span>
      </div>
    </section>
  );
}
