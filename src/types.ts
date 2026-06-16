export interface ExperimentConfig {
  name: string;
  variants: string[];
}

export interface TrackEvent {
  type: 'exposure' | 'conversion';
  eventName: string;
  experimentName?: string;
  variant?: string;
  userId: string;
  timestamp: number;
  properties?: Record<string, unknown>;
}

export interface ABTestOptions {
  storageKey?: string;
  eventUrl?: string;
  batchSize?: number;
  flushInterval?: number;
  enabled?: boolean;
}
