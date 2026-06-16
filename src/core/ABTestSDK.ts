import { TrackEvent, ABTestOptions, ExperimentConfig } from '../types';
import { consistentHash, generateUUID } from '../utils/hash';

const DEFAULT_STORAGE_KEY = 'ab_test_user_id';
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_FLUSH_INTERVAL = 5000;

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

  constructor(options: ABTestOptions = {}) {
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.eventUrl = options.eventUrl;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushInterval = options.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
    this.enabled = options.enabled ?? true;

    this.userId = this.loadOrCreateUserId();
    this.parseForceVariantsFromUrl();
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

  private startFlushTimer(): void {
    if (typeof window === 'undefined') return;

    this.flushTimer = window.setInterval(() => {
      this.flush();
    }, this.flushInterval);

    window.addEventListener('beforeunload', () => {
      this.flush(true);
    });
  }

  experiment(name: string, variants: string[]): string {
    if (!this.enabled) {
      return variants[0];
    }

    const forced = this.forcedVariants.get(name);
    if (forced && variants.includes(forced)) {
      this.trackExposure(name, forced);
      return forced;
    }

    const hashKey = `${this.userId}:${name}`;
    const index = consistentHash(hashKey, variants.length);
    const variant = variants[index];

    this.trackExposure(name, variant);
    return variant;
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

  track(eventName: string, properties?: Record<string, unknown>): void {
    if (!this.enabled) return;

    this.enqueueEvent({
      type: 'conversion',
      eventName,
      userId: this.userId,
      timestamp: Date.now(),
      properties,
    });
  }

  private enqueueEvent(event: TrackEvent): void {
    this.eventQueue.push(event);

    if (this.eventQueue.length >= this.batchSize) {
      this.flush();
    }
  }

  async flush(immediate = false): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    if (!this.eventUrl) {
      if (typeof console !== 'undefined' && !immediate) {
        console.log('[ABTest] Events (no eventUrl configured):', events);
      }
      return;
    }

    try {
      await fetch(this.eventUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ events }),
        keepalive: immediate,
      });
    } catch (error) {
      this.eventQueue = [...events, ...this.eventQueue];
    }
  }

  getUserId(): string {
    return this.userId;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  destroy(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush(true);
  }
}
