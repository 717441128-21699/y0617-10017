import { ABTestSDK } from './core/ABTestSDK';
import { ABTestOptions, RemoteConfigResponse } from './types';

let sdkInstance: ABTestSDK | null = null;

export function initABTest(options: ABTestOptions = {}): ABTestSDK {
  if (!sdkInstance) {
    sdkInstance = new ABTestSDK(options);
  }
  return sdkInstance;
}

export function getABTest(): ABTestSDK {
  if (!sdkInstance) {
    sdkInstance = new ABTestSDK();
  }
  return sdkInstance;
}

export function experiment(name: string, variants: string[], weights?: number[]): string {
  return getABTest().experiment(name, variants, weights);
}

export function track(eventName: string, properties?: Record<string, unknown>): void {
  getABTest().track(eventName, properties);
}

export function fetchConfig(): Promise<RemoteConfigResponse | null> {
  return getABTest().fetchConfig();
}

export function setCommonProperties(props: Record<string, unknown>): void {
  getABTest().setCommonProperties(props);
}

export function setHeader(key: string, value: string): void {
  getABTest().setHeader(key, value);
}

export function setSampleRate(rate: number): void {
  getABTest().setSampleRate(rate);
}

export function getUserId(): string {
  return getABTest().getUserId();
}

export function flush(): Promise<void> {
  return getABTest().flush();
}

export function destroy(): void {
  getABTest().destroy();
  sdkInstance = null;
}
