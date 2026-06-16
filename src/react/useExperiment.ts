import { useState, useMemo, useEffect } from 'react';
import { getABTest } from '../instance';

export function useExperiment(name: string, variants: string[]) {
  const sdk = useMemo(() => getABTest(), []);
  const [variant, setVariant] = useState<string>(() => sdk.experiment(name, variants));

  useEffect(() => {
    const newVariant = sdk.experiment(name, variants);
    setVariant(newVariant);
  }, [name, sdk, variants]);

  const track = useMemo(
    () => (eventName: string, properties?: Record<string, unknown>) => {
      sdk.track(eventName, properties);
    },
    [sdk]
  );

  return {
    variant,
    track,
    userId: sdk.getUserId(),
    isEnabled: sdk.isEnabled(),
  };
}
