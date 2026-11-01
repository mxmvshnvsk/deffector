import { combine, createEffect, createEvent, createStore, sample, scopeBind } from 'effector';
import { createField } from './field';
import { signupRequest, suggestRequest, type SignupParams, type User } from './api';

export type { SignupParams, User };
export type { FormField } from './field';

// ------------------------------------------------------------------ form

export const email = createField('', (value) =>
  /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? null : 'Enter a valid email',
);
export const password = createField('', (value) =>
  value.length >= 8 ? null : 'At least 8 characters',
);
export const name = createField('', (value) => (value.trim() ? null : 'Required'));

export const termsToggled = createEvent();
export const $terms = createStore(false).on(termsToggled, (accepted) => !accepted);

export const submitPressed = createEvent();
export const formReset = createEvent();

export const signupFx = createEffect(signupRequest);
export const $submitting = signupFx.pending;

export const $errors = combine({
  email: email.$error,
  password: password.$error,
  name: name.$error,
});
export const $canSubmit = combine(
  $errors,
  $terms,
  $submitting,
  (errors, termsAccepted, submitting) =>
    !errors.email && !errors.password && !errors.name && termsAccepted && !submitting,
);
export const $user = createStore<User | null>(null)
  .on(signupFx.doneData, (_, user) => user)
  .reset(formReset);
export const $serverError = createStore<string | null>(null)
  .on(signupFx.failData, (_, error) => error.message)
  .reset(signupFx, formReset);
export const $attempts = createStore(0).on(signupFx, (attempts) => attempts + 1);

// blocked by filter when the form is invalid: deffector shows "filter = false"
sample({
  clock: submitPressed,
  source: { email: email.$value, password: password.$value, name: name.$value },
  filter: $canSubmit,
  target: signupFx,
});

sample({ clock: formReset, target: [email.reset, password.reset, name.reset] });
$terms.reset(formReset);

// ------------------------------------------------------------------ suggestions (race demo)

export const suggestFx = createEffect(suggestRequest);
export const $suggestions = createStore<string[]>([]).on(
  suggestFx.doneData,
  (_, suggestions) => suggestions,
);
sample({ clock: email.changed, filter: (value) => value.length > 0, target: suggestFx });

// ------------------------------------------------------------------ deliberate bugs

/**
 * Bug 1 — out of scope. The effect calls an event from a setTimeout callback
 * without scopeBind, so in a forked app the update goes to the global graph and
 * the UI never sees it. Toggle `fixed` to compare with scopeBind.
 */
export const greetingShown = createEvent<string>();
export const $greeting = createStore('')
  .on(greetingShown, (_, greeting) => greeting)
  .reset(formReset);
export const greetLaterFx = createEffect((params: { name: string; fixed: boolean }) => {
  const showGreeting = params.fixed ? scopeBind(greetingShown, { safe: true }) : greetingShown;
  setTimeout(() => showGreeting(`Welcome, ${params.name || 'stranger'}!`), 300);
});

/**
 * Bug 2 — double update. $profileStrength is declared before the samples that
 * fill its sources, so one click recomputes it twice and a watcher sees a
 * half-updated value first.
 */
export const quickFill = createEvent<{ email: string; password: string; name: string }>();
export const $hasEmail = createStore(false);
export const $hasPassword = createStore(false);
export const $profileStrength = combine(
  $hasEmail,
  $hasPassword,
  (hasEmail, hasPassword) => Number(hasEmail) + Number(hasPassword),
);
sample({ clock: quickFill, fn: (profile) => profile.email, target: email.changed });
sample({ clock: quickFill, fn: (profile) => profile.password, target: password.changed });
sample({ clock: quickFill, fn: (profile) => profile.name, target: name.changed });
sample({ clock: email.$value, fn: (value) => value.length > 0, target: $hasEmail });
sample({ clock: password.$value, fn: (value) => value.length > 0, target: $hasPassword });

/** Bug 3 — an exception in a pure function: typing "crash" as the name throws in .map */
export const $nameInitials = name.$value.map((fullName) => {
  if (fullName.trim().toLowerCase() === 'crash') throw new Error('initials: cannot handle "crash"');
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase())
    .join('');
});

// ------------------------------------------------------------------ counter (simplest possible case)

export const incremented = createEvent();
export const decremented = createEvent();
export const $count = createStore(0)
  .on(incremented, (count) => count + 1)
  .on(decremented, (count) => count - 1);
export const $isEven = $count.map((count) => count % 2 === 0);

// ------------------------------------------------------------------ binding shapes

/**
 * What a component binds with one `useUnit`. Events keep their fact names in the
 * model (`submitPressed`) and are exposed to the UI as `on*` handlers, so a
 * component never names a fact and never touches a unit directly.
 *
 * The same shape serves React, Vue and Solid: only the way their `useUnit`
 * returns values differs (`value`, `.value`, `()`), not the map itself.
 */
export const $$signupForm = {
  terms: $terms,
  canSubmit: $canSubmit,
  submitting: $submitting,
  user: $user,
  serverError: $serverError,
  attempts: $attempts,
  suggestions: $suggestions,
  initials: $nameInitials,
  onTermsToggle: termsToggled,
  onSubmit: submitPressed,
  onReset: formReset,
  onSuggestionPick: email.changed,
};

export const $$counter = {
  count: $count,
  isEven: $isEven,
  onIncrement: incremented,
  onDecrement: decremented,
};

export const $$bugs = {
  greeting: $greeting,
  strength: $profileStrength,
  name: name.$value,
  onGreetLater: greetLaterFx,
  onQuickFill: quickFill,
  onNameChange: name.changed,
};
