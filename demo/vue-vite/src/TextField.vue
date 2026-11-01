<script setup lang="ts">
import { useUnit } from 'effector-vue/composition';
import type { FormField } from '@deffector-demo/shared';

// an input bound to a field from the shared model's createField factory
const props = defineProps<{
  label: string;
  type: 'text' | 'password';
  field: FormField<string>;
  testId: string;
}>();
const { value, error, touched, onChange } = useUnit(props.field.$$input);
</script>

<template>
  <label class="field">
    <span>{{ label }}</span>
    <input
      :data-testid="testId"
      :type="type"
      :value="value"
      :aria-invalid="touched && !!error"
      @input="onChange(($event.target as HTMLInputElement).value)"
    />
    <small v-if="touched && error" class="err">{{ error }}</small>
  </label>
</template>
