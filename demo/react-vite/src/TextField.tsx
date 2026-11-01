import { useId } from 'react';
import { useUnit } from 'effector-react';
import type { FormField } from '@deffector-demo/shared';

interface TextFieldProps {
  label: string;
  type: 'text' | 'password';
  field: FormField<string>;
  testId: string;
}

/** An input bound to a field from the shared model's `createField` factory. */
export function TextField({ label, type, field, testId }: TextFieldProps) {
  const inputId = useId();
  const { value, error, touched, onChange } = useUnit(field.$$input);
  const shownError = touched ? error : null;
  return (
    <label className="field" htmlFor={inputId}>
      <span>{label}</span>
      <input
        id={inputId}
        data-testid={testId}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={!!shownError}
      />
      {shownError && <small className="err">{shownError}</small>}
    </label>
  );
}
