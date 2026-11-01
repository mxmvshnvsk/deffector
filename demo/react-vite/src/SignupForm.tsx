import { useId } from 'react';
import { useUnit } from 'effector-react';
import * as model from '@deffector-demo/shared';
import { TextField } from './TextField';

export function SignupForm() {
  const termsId = useId();
  const form = useUnit(model.$$signupForm);
  return (
    <section className="card">
      <h2>Sign up</h2>
      <TextField label="Email" type="text" field={model.email} testId="email" />
      {form.suggestions.length > 0 && (
        <div className="sugg">
          {form.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => form.onSuggestionPick(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
      <TextField label="Password" type="password" field={model.password} testId="password" />
      <TextField label="Name" type="text" field={model.name} testId="name" />
      <label className="check" htmlFor={termsId}>
        <input
          id={termsId}
          type="checkbox"
          data-testid="terms"
          checked={form.terms}
          onChange={() => form.onTermsToggle()}
        />{' '}
        I accept the terms
      </label>
      <div className="row">
        <button
          type="button"
          data-testid="submit"
          onClick={() => form.onSubmit()}
          className={form.canSubmit ? 'pri' : ''}
        >
          {form.submitting ? 'Sending…' : 'Create account'}
        </button>
        <button type="button" onClick={() => form.onReset()}>
          Reset
        </button>
        <span className="muted">
          attempts: {form.attempts} · initials: {form.initials || '—'}
        </span>
      </div>
      {form.serverError && (
        <p className="err" data-testid="server-error">
          {form.serverError}
        </p>
      )}
      {form.user && (
        <p className="ok" data-testid="user">
          Welcome, {form.user.name} ({form.user.id})
        </p>
      )}
    </section>
  );
}
