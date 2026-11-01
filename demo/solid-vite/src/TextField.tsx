import { createUniqueId, Show } from 'solid-js';
import { useUnit } from 'effector-solid';
import type { FormField } from '@deffector-demo/shared';

interface TextFieldProps {
  label: string;
  type: 'text' | 'password';
  field: FormField<string>;
  testId: string;
}

/** An input bound to a field from the shared model's `createField` factory. */
export function TextField(props: TextFieldProps) {
  const inputId = createUniqueId();
  const { value, error, touched, onChange } = useUnit(props.field.$$input);
  const shownError = () => (touched() ? error() : null);
  return (
    <label class="field" for={inputId}>
      <span>{props.label}</span>
      <input
        id={inputId}
        data-testid={props.testId}
        type={props.type}
        value={value()}
        onInput={(event) => onChange(event.currentTarget.value)}
        aria-invalid={!!shownError()}
      />
      <Show when={shownError()}>
        <small class="err">{shownError()}</small>
      </Show>
    </label>
  );
}
