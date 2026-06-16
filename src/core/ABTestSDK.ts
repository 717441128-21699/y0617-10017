import { TrackEvent, ABTestOptions, RemoteConfigResponse, RemoteExperiment } from '../types';
import { consistentHash, generateUUID } from '../utils/hash';

const DEFAULT_STORAGE_KEY = 'ab_test_user_id';
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_FLUSH_INTERVAL = 5000;
const DEFAULT_CONFIG_FETCH_TIMEOUT = 5000;
const DEFAULT_CONFIG_CACHE_TTL = 5 * 60 * 1000;
const DEFAULT_SAMPLE_RATE = 1;
const DEFAULT_CONFIG_CACHE_KEY = 'ab_test_config_cache';
const DEFAULT_OFFLINE_STORAGE_KEY = 'ab_test_offline_events';
const DEFAULT_OFFLINE_MAX_EVENTS = 500;
const DEFAULT_RETRY_POLICY = {
  maxRetries: 3,
  backoffBase: 1000,
  backoffMultiplier: 2,
};

export class ABTestSDK {
  private userId: string;
  private storageKey: string;
  private eventUrl?: string;
  private batchSize: number;
  private flushInterval: number;
  private enabled: boolean;
  private eventQueue: TrackEvent[] = [];
  private flushTimer: number | null = null;
  private exposedExperiments: Set<string> = new Set();
  private forcedVariants: Map<string, string> = new Map();

  private configUrl?: string;
  private configFetchTimeout: number;
  private configCacheTTL: number;
  private configCacheKey: string;
  private remoteConfig: RemoteConfigResponse | null = null;
  private remoteConfigPromise: Promise<RemoteConfigResponse | null> | null = null;

  private sampleRate: number;
  private commonProperties: Record<string, unknown>;
  private headers: Record<string, string>;
  private retryPolicy: Required<ABTestOptions['retryPolicy']> & object;

  private offlineStorageKey: string;
  private offlineEnabled: boolean;
  private offlineMaxEvents: number;
  private isFlushing = false;
  private isOnline = true;

  constructor(options: ABTestOptions = {}) {
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.eventUrl = options.eventUrl;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushInterval = options.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
    this.enabled = options.enabled ?? true;

    this.configUrl = options.configUrl;
    this.configFetchTimeout = options.configFetchTimeout ?? DEFAULT_CONFIG_FETCH_TIMEOUT;
    this.configCacheTTL = options.configCacheTTL ?? DEFAULT_CONFIG_CACHE_TTL;
    this.configCacheKey = DEFAULT_CONFIG_CACHE_KEY;

    this.sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
    this.commonProperties = { ...(options.commonProperties ?? {}) };
    this.headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
    const rp = options.retryPolicy ?? {};
    this.retryPolicy = {
      maxRetries: rp.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries,
      backoffBase: rp.backoffBase ?? DEFAULT_RETRY_POLICY.backoffBase,
      backoffMultiplier: rp.backoffMultiplier ?? DEFAULT_RETRY_POLICY.backoffMultiplier,
    };

    this.offlineStorageKey = options.offlineStorageKey ?? DEFAULT_OFFLINE_STORAGE_KEY;
    this.offlineEnabled = options.offlineEnabled ?? true;
    this.offlineMaxEvents = options.offlineMaxEvents ?? DEFAULT_OFFLINE_MAX_EVENTS;

    this.userId = this.loadOrCreateUserId();
    this.parseForceVariantsFromUrl();
    this.loadOfflineEvents();
    this.loadCachedConfig();
    this.setupNetworkListeners();
    this.startFlushTimer();
  }

  private loadOrCreateUserId(): string {
    if (typeof localStorage === 'undefined') {
      return generateUUID();
    }

    let userId = localStorage.getItem(this.storageKey);
    if (!userId) {
      userId = generateUUID();
      localStorage.setItem(this.storageKey, userId);
    }
    return userId;
  }

  private parseForceVariantsFromUrl(): void {
    if (typeof window === 'undefined') return;

    const urlParams = new URLSearchParams(window.location.search);
    const forceParam = urlParams.get('force_exp');
    if (!forceParam) return;

    const pairs = forceParam.split(',');
    pairs.forEach((pair) => {
      const [expName, variant] = pair.split(':');
      if (expName && variant) {
        this.forcedVariants.set(expName.trim(), variant.trim());
      }
    });
  }

  private setupNetworkListeners(): void {
    if (typeof window === 'undefined') return;

    this.isOnline = navigator.onLine;
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.loadOfflineEvents();
      this.flush();
    });
    window.addEventListener('offline', () => {
      this.isOnline = false;
    });
  }

  private startFlushTimer(): void {
    if (typeof window === 'undefined') return;

    this.flushTimer = window.setInterval(() => {
      this.flush();
    }, this.flushInterval);

    window.addEventListener('beforeunload', () => {
      this.persistOfflineEvents();
      this.flush(true);
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.persistOfflineEvents();
        }
      });
    }
  }

  // --- 远程配置 ---

  private loadCachedConfig(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.configCacheKey);
      if (!raw) return;
      const cached = JSON.parse(raw) as RemoteConfigResponse & { _fetchedAt?: number };
      if (cached._fetchedAt && Date.now() - cached._fetchedAt < this.configCacheTTL) {
        this.remoteConfig = cached;
      }
    } catch {
      // ignore
    }
  }

  private saveCachedConfig(config: RemoteConfigResponse): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const toCache = { ...config, _fetchedAt: Date.now() };
      localStorage.setItem(this.configCacheKey, JSON.stringify(toCache));
    } catch {
      // ignore
    }
  }

  async fetchConfig(): Promise<RemoteConfigResponse | null> {
    const url = this.configUrl;
    if (!url) {
      return this.remoteConfig;
    }

    if (this.remoteConfigPromise) {
      return this.remoteConfigPromise;
    }

    this.remoteConfigPromise = (async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.configFetchTimeout);

        const resp = await fetch(url, {
          method: 'GET',
          headers: this.headers,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!resp.ok) {
          throw new Error(`Config fetch failed: ${resp.status}`);
        }

        const data: RemoteConfigResponse = await resp.json();
        this.remoteConfig = data;
        this.saveCachedConfig(data);
        return data;
      } catch {
        return this.remoteConfig;
      } finally {
        this.remoteConfigPromise = null;
      }
    })();

    return this.remoteConfigPromise;
  }

  private getRemoteExperiment(name: string): RemoteExperiment | undefined {
    if (!this.remoteConfig?.experiments) return undefined;
    return this.remoteConfig.experiments.find((e) => e.name === name);
  }

  // --- 实验分配 ---

  experiment(name: string, variants: string[], weights?: number[]): string {
    if (!this.enabled) {
      return variants[0];
    }

    const forced = this.forcedVariants.get(name);
    if (forced && variants.includes(forced)) {
      this.trackExposure(name, forced);
      return forced;
    }

    let finalVariants = variants;
    let finalWeights = weights;
    let experimentEnabled = true;

    const remote = this.getRemoteExperiment(name);
    if (remote && remote.variants && remote.variants.length > 0) {
      finalVariants = remote.variants;
      finalWeights = remote.weights;
      if (remote.enabled === false) {
        experimentEnabled = false;
      }
    }

    if (!experimentEnabled) {
      return finalVariants[0];
    }

    const variant = this.pickVariant(name, finalVariants, finalWeights);
    this.trackExposure(name, variant);
    return variant;
  }

  private pickVariant(name: string, variants: string[], weights?: number[]): string {
    if (weights && weights.length === variants.length) {
      const totalWeight = weights.reduce((s, w) => s + w, 0);
      if (totalWeight > 0) {
        const hashKey = `${this.userId}:${name}`;
        const hashRange = 10000;
        const hashValue = consistentHash(hashKey, hashRange) / hashRange * totalWeight;
        let cumulative = 0;
        for (let i = 0; i < variants.length; i++) {
          cumulative += weights[i];
          if (hashValue < cumulative) {
            return variants[i];
          }
        }
      }
    }

    const hashKey = `${this.userId}:${name}`;
    const index = consistentHash(hashKey, variants.length);
    return variants[index];
  }

  private trackExposure(experimentName: string, variant: string): void {
    if (this.exposedExperiments.has(`${experimentName}:${variant}`)) {
      return;
    }

    this.exposedExperiments.add(`${experimentName}:${variant}`);

    this.enqueueEvent({
      type: 'exposure',
      eventName: 'experiment_exposure',
      experimentName,
      variant,
      userId: this.userId,
      timestamp: Date.now(),
    });
  }

  // --- 事件上报 ---

  track(eventName: string, properties?: Record<string, unknown>): void {
    if (!this.enabled) return;

    if (Math.random() > this.sampleRate) {
      return;
    }

    this.enqueueEvent({
      type: 'conversion',
      eventName,
      userId: this.userId,
      timestamp: Date.now(),
      properties,
    });
  }

  private enqueueEvent(event: TrackEvent): void {
    const eventWithCommon: TrackEvent = {
      ...event,
      commonProperties: { ...this.commonProperties },
    };

    this.eventQueue.push(eventWithCommon);

    if (this.eventQueue.length >= this.batchSize) {
      this.flush();
    }
  }

  // --- 离线存储 ---

  private loadOfflineEvents(): void {
    if (!this.offlineEnabled || typeof localStorage === 'undefined') return;

    try {
      const raw = localStorage.getItem(this.offlineStorageKey);
      if (!raw) return;
      const offlineEvents = JSON.parse(raw) as TrackEvent[];
      if (Array.isArray(offlineEvents) && offlineEvents.length > 0) {
        this.eventQueue = [...offlineEvents, ...this.eventQueue];
        localStorage.removeItem(this.offlineStorageKey);
      }
    } catch {
      // ignore
    }
  }

  private persistOfflineEvents(): void {
    if (!this.offlineEnabled || typeof localStorage === 'undefined') return;
    if (this.eventQueue.length === 0) return;

    try {
      const toStore = this.eventQueue.slice(-this.offlineMaxEvents);
      localStorage.setItem(this.offlineStorageKey, JSON.stringify(toStore));
    } catch {
      // ignore
    }
  }

  // --- 上报与重试 ---

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async sendWithRetry(events: TrackEvent[]): Promise<void> {
    const eventUrl = this.eventUrl;
    if (!eventUrl) {
      if (typeof console !== 'undefined') {
        console.log('[ABTest] Events (no eventUrl configured):', events);
      }
      return;
    }

    const { maxRetries, backoffBase, backoffMultiplier } = this.retryPolicy;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (!this.isOnline && attempt < maxRetries) {
          throw new Error('Offline');
        }

        const resp = await fetch(eventUrl, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ events }),
        });

        if (resp.status >= 200 && resp.status < 300) {
          return;
        }

        if (resp.status >= 400 && resp.status < 500) {
          return;
        }

        lastError = new Error(`HTTP ${resp.status}`);
      } catch (err) {
        lastError = err;
      }

      if (attempt < maxRetries) {
        const delay = backoffBase * Math.pow(backoffMultiplier, attempt);
        await this.sleep(delay);
      }
    }

    throw lastError ?? new Error('Send failed');
  }

  async flush(immediate = false): Promise<void> {
    if (this.isFlushing) return;
    if (this.eventQueue.length === 0) return;

    this.isFlushing = true;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    try {
      await this.sendWithRetry(events);
    } catch {
      this.eventQueue = [...events, ...this.eventQueue];
      if (this.eventQueue.length > this.offlineMaxEvents * 2) {
        this.eventQueue = this.eventQueue.slice(-this.offlineMaxEvents);
      }
      this.persistOfflineEvents();
    } finally {
      this.isFlushing = false;
      void immediate;
    }
  }

  // --- 公共API ---

  getUserId(): string {
    return this.userId;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setCommonProperties(props: Record<string, unknown>): void {
    this.commonProperties = { ...this.commonProperties, ...props };
  }

  setHeader(key: string, value: string): void {
    this.headers[key] = value;
  }

  setSampleRate(rate: number): void {
    this.sampleRate = Math.max(0, Math.min(1, rate));
  }

  getRemoteConfig(): RemoteConfigResponse | null {
    return this.remoteConfig;
  }

  destroy(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.persistOfflineEvents();
    this.flush(true);
  }
}
