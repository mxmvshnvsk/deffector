<script setup lang="ts">
import { useUnit } from 'effector-vue/composition';
import * as model from '@deffector-demo/shared';

const { count, isEven, onIncrement, onDecrement } = useUnit(model.$$counter);
</script>

<template>
  <section class="card">
    <h2>Counter</h2>
    <div class="row">
      <button type="button" data-testid="dec" @click="onDecrement()">−</button>
      <b data-testid="count" class="count">{{ count }}</b>
      <button type="button" data-testid="inc" @click="onIncrement()">+</button>
      <span class="muted">{{ isEven ? 'even' : 'odd' }}</span>
    </div>
  </section>
</template>
