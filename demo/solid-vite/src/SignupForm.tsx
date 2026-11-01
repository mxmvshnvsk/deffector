import { createUniqueId, For, Show } from 'solid-js';
import { useUnit } from 'effector-solid';
import * as model from '@deffector-demo/shared';
import { TextField } from './TextField';

export function SignupForm() {
  const termsId = createUniqueId();
  const form = useUnit(model.$$signupForm);
  return (
    <section class="card">
      <h2>Sign up</h2>
      <TextField label="Email" type="text" field={model.email} testId="email" />
      <Show when={form.suggestions().length}>
        <div class="sugg">
          <For each={form.suggestions()}>
            {(suggestion) => (
              <button type="button" onClick={() => form.onSuggestionPick(suggestion)}>
                {suggestion}
              </button>
            )}
          </For>
        </div>
      </Show>
      <TextField label="Password" type="password" field={model.password} testId="password" />
      <TextField label="Name" type="text" field={model.name} testId="name" />
      <label class="check" for={termsId}>
        <input
          id={termsId}
          type="checkbox"
          data-testid="terms"
          checked={form.terms()}
          onChange={() => form.onTermsToggle()}
        />{' '}
        I accept the terms
      </label>
      <div class="row">
        <button
          type="button"
          data-testid="submit"
          classList={{ pri: form.canSubmit() }}
          onClick={() => form.onSubmit()}
        >
          {form.submitting() ? 'Sending…' : 'Create account'}
        </button>
        <button type="button" onClick={() => form.onReset()}>
          Reset
        </button>
        <span class="muted">
          attempts: {form.attempts()} · initials: {form.initials() || '—'}
        </span>
      </div>
      <Show when={form.serverError()}>
        <p class="err" data-testid="server-error">
          {form.serverError()}
        </p>
      </Show>
      <Show when={form.user()}>
        {(user) => (
          <p class="ok" data-testid="user">
            Welcome, {user().name} ({user().id})
          </p>
        )}
      </Show>
    </section>
  );
}
