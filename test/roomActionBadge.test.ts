import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = { touch: true, screen: 'room', helpOpen: false, options: false };
vi.mock('../src/app/screenState.js', () => ({ ui: state }));
vi.mock('../src/app/touchButtons.js', () => ({ touchUi: () => state.touch }));
vi.mock('../src/app/touchOptions.js', () => ({ touchOptionsOpen: () => state.options }));
const stageBox = { appendChild: vi.fn() };
vi.mock('../src/app/dom.js', () => ({ stageBox }));

const { syncRoomActionBadge, clearRoomActionBadge, BADGE_MS } = await import('../src/app/roomActionBadge.js');
const { reportRoomAction } = await import('../src/app/roomActionEvent.js');

const made: Array<Record<string, any>> = [];
const createElement = vi.fn((tag: string) => {
  const el = {
    tag, id: '', textContent: '', children: [] as unknown[],
    dataset: {} as Record<string, string>,
    style: { setProperty: vi.fn() },
    setAttribute: vi.fn(),
    append: vi.fn((...kids: unknown[]) => { el.children.push(...kids); }),
    remove: vi.fn(),
  };
  made.push(el);
  return el;
});
const icons = new Map(['12', '13', '15'].map((r) => [r, { region: r, cloneNode: vi.fn(() => ({ copyOf: r })) }]));
const querySelector = vi.fn((sel: string) => icons.get(/#touchbar \[data-region="(\d+)"\] svg/.exec(sel)?.[1] ?? '') ?? null);

const badge = () => made.find((e) => e.id === 'room-action-badge');
const label = () => (badge()?.children[1] as { textContent: string } | undefined)?.textContent;

beforeEach(() => {
  Object.assign(state, { touch: true, screen: 'room', helpOpen: false, options: false });
  made.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal('document', { createElement, querySelector, hidden: false });
  vi.spyOn(performance, 'now').mockReturnValue(100);
});
afterEach(() => {
  clearRoomActionBadge();
  syncRoomActionBadge(0); // drain anything a test left reported
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('room action badge', () => {
  it.each([['save', '12', 'Saved'], ['load', '13', 'Loaded'], ['restart', '15', 'Restarted']] as const)(
    '%s shows the button symbol and "%s" label in the room', (action, region, text) => {
      reportRoomAction(action);
      syncRoomActionBadge(100);
      expect(badge()).toBeDefined();
      expect(badge()!.dataset.action).toBe(action);
      expect(badge()!.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
      expect(badge()!.children[0]).toEqual({ copyOf: region });
      expect(label()).toBe(text);
      expect(stageBox.appendChild).toHaveBeenCalledExactlyOnceWith(badge());
    },
  );

  it('shows once per report, and expires after its duration', () => {
    reportRoomAction('save');
    syncRoomActionBadge(100);
    syncRoomActionBadge(100 + BADGE_MS - 1);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(1);
    expect(badge()!.remove).not.toHaveBeenCalled();
    syncRoomActionBadge(100 + BADGE_MS);
    expect(badge()!.remove).toHaveBeenCalledTimes(1);
  });

  it('replaces a badge still showing with the newer action', () => {
    reportRoomAction('save');
    syncRoomActionBadge(100);
    const first = badge()!;
    reportRoomAction('restart');
    syncRoomActionBadge(200);
    expect(first.remove).toHaveBeenCalledTimes(1);
    expect(made.filter((e) => e.id === 'room-action-badge').at(-1)!.dataset.action).toBe('restart');
  });

  it('shows nothing on desktop, and does not resurrect a stale report later', () => {
    state.touch = false;
    reportRoomAction('save');
    syncRoomActionBadge(100);
    state.touch = true;
    syncRoomActionBadge(101);
    expect(createElement).not.toHaveBeenCalled();
  });

  it.each([
    ['map', () => { state.screen = 'map'; }],
    ['help', () => { state.helpOpen = true; }],
    ['options', () => { state.options = true; }],
    ['desktop', () => { state.touch = false; }],
  ])('clears when the player leaves for %s', (_name, leave) => {
    reportRoomAction('load');
    syncRoomActionBadge(100);
    leave();
    syncRoomActionBadge(101);
    expect(badge()!.remove).toHaveBeenCalledTimes(1);
  });
});
