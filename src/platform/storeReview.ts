import { isNativeHost } from './nativeHost.js';

interface StoreReviewPlugin {
  requestReview(): Promise<void>;
}

/** Keep Capacitor out of the web path; recheck/persist eligibility just before dispatch. */
export async function requestStoreReview(prepare: () => boolean): Promise<void> {
  if (!isNativeHost()) return;
  const { registerPlugin } = await import('@capacitor/core');
  const plugin = registerPlugin<StoreReviewPlugin>('StoreReview');
  if (prepare()) await plugin.requestReview();
}
