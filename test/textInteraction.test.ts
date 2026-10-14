/**
 * WebKit text interaction in the iOS app (src/platform/textInteraction.ts) and the one form
 * that turns it back on (src/app/feedback.ts).
 *
 * The app runs with text interaction off so that iOS raises no selection loupe on a pressed
 * button. What is pinned here is that the feedback form restores it while open and drops it
 * again however it closes — a form left "on" would bring the loupe back to every button —
 * and that the web build never reaches for the bridge at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  native: true,
  setEnabled: vi.fn<(o: { enabled: boolean }) => Promise<void>>(),
  register: vi.fn(),
}));
vi.mock('../src/platform/nativeHost.js', () => ({ isNativeHost: () => mocks.native }));
vi.mock('@capacitor/core', () => ({ registerPlugin: mocks.register }));

const calls = (): boolean[] => mocks.setEnabled.mock.calls.map(([o]) => o.enabled);

beforeEach(() => {
  vi.resetModules();
  mocks.native = true;
  mocks.setEnabled.mockReset().mockResolvedValue(undefined);
  mocks.register.mockReset().mockReturnValue({ setEnabled: mocks.setEnabled });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('setTextInteraction', () => {
  it('never touches the bridge outside the native host', async () => {
    mocks.native = false;
    const { setTextInteraction } = await import('../src/platform/textInteraction.js');
    await setTextInteraction(true);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.setEnabled).not.toHaveBeenCalled();
  });

  it('delivers calls in the order they were made, even when the first is slow', async () => {
    let releaseFirst!: () => void;
    mocks.setEnabled.mockImplementationOnce(() => new Promise<void>((r) => { releaseFirst = r; }));
    const { setTextInteraction } = await import('../src/platform/textInteraction.js');
    const on = setTextInteraction(true);
    const off = setTextInteraction(false);
    await vi.waitFor(() => expect(calls()).toEqual([true]));
    releaseFirst();
    await Promise.all([on, off]);
    expect(calls()).toEqual([true, false]);
    expect(mocks.register).toHaveBeenCalledTimes(1);
  });

  it('a failed call does not wedge the ones behind it', async () => {
    mocks.setEnabled.mockRejectedValueOnce(new Error('No web view'));
    const { setTextInteraction } = await import('../src/platform/textInteraction.js');
    await expect(setTextInteraction(true)).resolves.toBeUndefined();
    await setTextInteraction(false);
    expect(calls()).toEqual([true, false]);
  });
});

/** Just enough of an element for initFeedback: listeners, and the bits of state it reads. */
class FakeEl {
  open = false;
  value = '';
  textContent = '';
  href = '';
  checked = false;
  private listeners = new Map<string, Array<() => void>>();
  addEventListener(type: string, fn: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
  readonly attrs = new Set<string>();
  focus(): void {}
  // Attributes only: without the dialog API the `open` ATTRIBUTE has no `.open` property
  // behind it, which is exactly why close() takes its fallback branch there.
  setAttribute(name: string): void {
    this.attrs.add(name);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  showModal?(): void;
  close?(): void;
}

function fakeDialog(withDialogApi: boolean): FakeEl {
  const d = new FakeEl();
  if (withDialogApi) {
    d.showModal = () => { d.open = true; };
    // A real dialog fires `close` whether the page or Escape closed it.
    d.close = () => { d.open = false; d.emit('close'); };
  }
  return d;
}

async function mountFeedback(dialog: FakeEl) {
  const ids: Record<string, FakeEl> = { feedback: dialog };
  for (const id of ['feedback-open', 'feedback-what', 'feedback-preview', 'feedback-issue', 'feedback-email']) {
    ids[id] = new FakeEl();
  }
  vi.stubGlobal('window', { innerWidth: 1024, innerHeight: 768, screen: {}, navigator: {} });
  vi.stubGlobal('document', {
    getElementById: (id: string) => ids[id] ?? null,
    querySelectorAll: () => [],
  });
  const { initFeedback } = await import('../src/app/feedback.js');
  const form = initFeedback({
    build: { version: '0', hash: 'h', date: 'd' },
    webgl2: () => true,
    game: () => ({
      screen: 'map', roomNum: null, roomName: null, roomTitle: null, graphics: 'original',
      renderer: 'webgl2', subtitles: 'en', moves: 0, record: '',
    }),
  });
  // render() swallows a failure into console.error; here that would hide a broken test.
  vi.spyOn(console, 'error').mockImplementation((...a) => { throw new Error(String(a)); });
  return { form };
}

describe('the feedback form', () => {
  it('turns text interaction on while open and off when closed', async () => {
    const dialog = fakeDialog(true);
    const { form } = await mountFeedback(dialog);
    form.open();
    await vi.waitFor(() => expect(calls()).toEqual([true]));
    form.close();
    await vi.waitFor(() => expect(calls()).toEqual([true, false]));
  });

  it('turns it off when the dialog closes behind its back (Escape)', async () => {
    const dialog = fakeDialog(true);
    const { form } = await mountFeedback(dialog);
    form.open();
    dialog.open = false;
    dialog.emit('close');
    await vi.waitFor(() => expect(calls()).toEqual([true, false]));
  });

  it('turns it off on the attribute fallback too, which fires no close event', async () => {
    const dialog = fakeDialog(false);
    const { form } = await mountFeedback(dialog);
    form.open();
    expect(dialog.attrs.has('open')).toBe(true);
    form.close();
    expect(dialog.attrs.has('open')).toBe(false);
    await vi.waitFor(() => expect(calls()).toEqual([true, false]));
  });
});
