import { ref, computed, watch } from 'vue';
import { getABTest } from '../instance';
import { RemoteConfigResponse } from '../types';

export function useExperiment(name: string, variants: string[], weights?: number[]) {
  const sdk = getABTest();
  const variantRef = ref<string>(sdk.experiment(name, variants, weights));

  watch(
    [() => name, () => variants, () => weights],
    () => {
      variantRef.value = sdk.experiment(name, variants, weights);
    },
    { deep: true }
  );

  const track = (eventName: string, properties?: Record<string, unknown>) => {
    sdk.track(eventName, properties);
  };

  const fetchConfig = (): Promise<RemoteConfigResponse | null> => {
    return sdk.fetchConfig();
  };

  const userId = computed(() => sdk.getUserId());
  const isEnabled = computed(() => sdk.isEnabled());

  return {
    variant: variantRef,
    track,
    fetchConfig,
    userId,
    isEnabled,
    sdk,
  };
}
