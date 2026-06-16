import { useState, useMemo, useEffect, useCallback } from 'react';
import { getABTest } from '../instance';
import { RemoteConfigResponse } from '../types';

export function useExperiment(name: string, variants: string[], weights?: number[]) {
  const sdk = useMemo(() => getABTest(), []);
  const [variant, setVariant] = useState<string>(() => sdk.experiment(name, variants, weights));

  useEffect(() => {
    const newVariant = sdk.experiment(name, variants, weights);
    setVariant(newVariant);
  }, [name, sdk, variants, weights]);

  const track = useCallback(
    (eventName: string, properties?: Record<string, unknown>) => {
      sdk.track(eventName, properties);
    },
    [sdk]
  );

  const fetchConfig = useCallback((): Promise<RemoteConfigResponse | null> => {
    return sdk.fetchConfig();
  }, [sdk]);

  return {
    variant,
    track,
    fetchConfig,
    userId: sdk.getUserId(),
    isEnabled: sdk.isEnabled(),
    sdk,
  };
}
