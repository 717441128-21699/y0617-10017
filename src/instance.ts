import { ABTestSDK } from './core/ABTestSDK';
import { ABTestOptions } from './types';

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

export function experiment(name: string, variants: string[]): string {
  return getABTest().experiment(name, variants);
}

export function track(eventName: string, properties?: Record<string, unknown>): void {
  getABTest().track(eventName, properties);
}
