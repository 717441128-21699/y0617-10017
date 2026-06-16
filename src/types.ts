export interface ExperimentConfig {
  name: string;
  variants: string[];
  weights?: number[];
}

export interface RemoteExperiment {
  name: string;
  variants: string[];
  weights?: number[];
  enabled?: boolean;
}

export interface RemoteConfigResponse {
  experiments: RemoteExperiment[];
  version?: string;
  expiresAt?: number;
}

export interface TrackEvent {
  type: 'exposure' | 'conversion';
  eventName: string;
  experimentName?: string;
  variant?: string;
  userId: string;
  timestamp: number;
  properties?: Record<string, unknown>;
  commonProperties?: Record<string, unknown>;
}

export interface RetryPolicy {
  maxRetries?: number;
  backoffBase?: number;
  backoffMultiplier?: number;
}

export interface ABTestOptions {
  storageKey?: string;
  eventUrl?: string;
  batchSize?: number;
  flushInterval?: number;
  enabled?: boolean;

  configUrl?: string;
  configFetchTimeout?: number;
  configCacheTTL?: number;

  sampleRate?: number;
  commonProperties?: Record<string, unknown>;
  headers?: Record<string, string>;
  retryPolicy?: RetryPolicy;

  offlineStorageKey?: string;
  offlineEnabled?: boolean;
  offlineMaxEvents?: number;
}
