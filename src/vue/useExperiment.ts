import { ref, computed } from 'vue';
import { getABTest } from '../instance';

export function useExperiment(name: string, variants: string[]) {
  const sdk = getABTest();
  const variant = ref<string>(sdk.experiment(name, variants));

  const track = (eventName: string, properties?: Record<string, unknown>) => {
    sdk.track(eventName, properties);
  };

  const userId = computed(() => sdk.getUserId());
  const isEnabled = computed(() => sdk.isEnabled());

  return {
    variant,
    track,
    userId,
    isEnabled,
  };
}
