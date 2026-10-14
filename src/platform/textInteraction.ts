/**
 * WebKit text interaction in the iOS app: off by default, on while there is text to edit.
 *
 * The native host starts its web view with text interaction disabled, because that is the
 * only way to keep iOS's selection loupe off a pressed button (see
 * `ios/App/App/SafeAreaBridgeViewController.swift`). The cost is that a text field gets no
 * caret placement or selection, so the one form that has one turns it back on while open.
 *
 * A no-op everywhere but the native host. Calls are chained so a quick open-then-close
 * cannot reach the bridge in the wrong order and leave the loupe switched back on.
 */
import { isNativeHost } from './nativeHost.js';

interface TextInteractionPlugin {
  setEnabled(options: { enabled: boolean }): Promise<void>;
}

let queue: Promise<unknown> = Promise.resolve();
let plugin: Promise<TextInteractionPlugin> | null = null;

export function setTextInteraction(enabled: boolean): Promise<void> {
  if (!isNativeHost()) return Promise.resolve();
  plugin ??= import('@capacitor/core').then(({ registerPlugin }) =>
    registerPlugin<TextInteractionPlugin>('TextInteraction'));
  const next = queue.then(async () => (await plugin!).setEnabled({ enabled }));
  // One failed call must not wedge every later one behind it.
  queue = next.catch((e: unknown) => console.warn('textInteraction: setEnabled failed', e));
  return queue.then(() => undefined);
}
