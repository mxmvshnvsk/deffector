<script setup lang="ts">
import { useUnit } from 'effector-vue/composition';
import * as model from '@deffector-demo/shared';

const ANN = { email: 'ann@example.com', password: 'secret-pass', name: 'Ann Lee' };

// each button reproduces a classic effector mistake from the shared model
const bugs = useUnit(model.$$bugs);
</script>

<template>
  <section class="card">
    <h2>Bugs to catch</h2>
    <p class="muted">
      Each button reproduces a classic effector mistake. Open DevTools → deffector and watch the Log
      and Health tabs.
    </p>
    <div class="row">
      <button
        type="button"
        data-testid="greet-bug"
        @click="bugs.onGreetLater({ name: bugs.name.value, fixed: false })"
      >
        Greet later (no scopeBind)
      </button>
      <button type="button" @click="bugs.onGreetLater({ name: bugs.name.value, fixed: true })">
        Greet later (fixed)
      </button>
    </div>
    <p>
      Greeting: <b data-testid="greeting">{{ bugs.greeting.value || '—' }}</b>
    </p>
    <div class="row">
      <button type="button" data-testid="quick-fill" @click="bugs.onQuickFill(ANN)">
        Quick fill (double update)
      </button>
      <span class="muted">strength: {{ bugs.strength.value }}</span>
    </div>
    <div class="row">
      <button type="button" @click="bugs.onNameChange('crash')">
        Name = “crash” (throws in .map)
      </button>
    </div>
  </section>
</template>
