/**
 * UI test: a phone is asked to turn, and nothing else ever is.
 *
 * The rule itself is pinned in the unit suite against every room near the threshold
 * (test/orientation.test.ts). What only a browser can show is the part that made this
 * worth a probe at all: the prompt is DERIVED once per frame from three things that
 * change independently — the device's orientation, which screen is up, and which room is
 * loaded — so the failures worth catching are all "it did not notice". A stale prompt
 * over a playable room is exactly as bad as a missing one, and neither is reachable from
 * a pure function.
 *
 * It emulates its own contexts rather than using `withApp`, for the same reason
 * test-desktop-only.mjs does: `hasTouch` and the emulated `screen` are context options,
 * and the whole feature is about what a touch device reports.
 *
 * Rooms are entered through `__ff.enterRoomAwait()` and NOT through the dev-bar dropdown,
 * which is deliberate and is also the first thing this found: the prompt is a full-screen
 * overlay, so once it is up the dropdown is covered and `selectOption` fails its
 * actionability check. That is correct behaviour — the screen underneath is meant to be
 * unusable — but it means the probe has to drive the game through the hook.
 */
import { chromium } from 'playwright';
import { exitProbe, WAIT_BACKSTOP } from './ui-lib.mjs';

const URL = `http://127.0.0.1:${process.env.FF_UI_PORT ?? '5173'}/?phone=1`;

/** VRAK, 315×555 native: the one room portrait genuinely helps (×1.76 on a phone). */
const PORTRAIT_ROOM = 4;
/** PUCLIK, 795×585: the widest room there is, and the plainest landscape case. */
const LANDSCAPE_ROOM = 42;

/** A phone, held sideways. `screen` does not rotate under emulation; the viewport does. */
const PHONE_LANDSCAPE = {
  viewport: { width: 852, height: 393 },
  screen: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
/** The same phone, upright. */
const PHONE_PORTRAIT = { width: 393, height: 852 };

/** A tablet, which is free to be held either way and must never be asked to turn. */
const TABLET = {
  viewport: { width: 820, height: 1180 },
  screen: { width: 820, height: 1180 },
  hasTouch: true,
  isMobile: true,
};

let ok = true;
const expect = (cond, msg) => {
  if (!cond) ok = false;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

/** What the prompt is doing right now, read the way the app writes it. */
const state = (p) =>
  p.evaluate(() => ({
    flag: document.documentElement.dataset.rotate ?? null,
    visible: document.getElementById('rotate')?.hidden === false,
    title: document.getElementById('rotate-title')?.textContent?.trim() ?? '',
    // Which way the phone glyph turns. It is chosen by `html[data-rotate]` in the
    // stylesheet, and the two directions are genuinely different animations because
    // the glyph is drawn tall — one shared animation showed a phone tipping OVER
    // while the heading said "upright".
    hint: (() => {
      const el = document.querySelector('.rotate-phone');
      return el ? getComputedStyle(el).animationName : '';
    })(),
  }));

/**
 * Wait for the prompt to settle on a value — it is only recomputed on a painted frame.
 *
 * No timeout of its own: `setDefaultTimeout(WAIT_BACKSTOP)` in `open()` already applies
 * the suite's backstop to every wait on the page (test/uiProbeWaits.test.ts).
 */
const settle = (p, want) =>
  p.waitForFunction((w) => (document.documentElement.dataset.rotate ?? null) === w, want);

async function open(contextOpts) {
  const ctx = await browser.newContext(contextOpts);
  const p = await ctx.newPage();
  p.setDefaultTimeout(WAIT_BACKSTOP);
  // Skip the first-run intro: it is a full-screen overlay of its own, and this probe is
  // about a different one.
  await p.addInitScript(() => {
    try {
      const raw = localStorage.getItem('ff.options');
      const o = raw ? JSON.parse(raw) : {};
      o.introSeen = true;
      localStorage.setItem('ff.options', JSON.stringify(o));
    } catch {
      /* storage unavailable */
    }
  });
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__ff !== undefined);
  return p;
}

const enter = async (p, num) => {
  await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
  await p.waitForFunction(
    (n) => window.__ff.screen() === 'room' && !window.__ff.roomLoading() && window.__ff.roomNum() === n,
    num,
  );
};

const browser = await chromium.launch();
try {
  // ── A phone held sideways, which is how the game is normally played.
  const phone = await open(PHONE_LANDSCAPE);
  await enter(phone, LANDSCAPE_ROOM);
  await settle(phone, null);
  expect(!(await state(phone)).visible, 'landscape room on a sideways phone: no prompt');

  // ── Into the one room that wants portrait. Nothing else changed: same device, same
  // orientation, so this is the room change alone being noticed.
  await enter(phone, PORTRAIT_ROOM);
  await settle(phone, 'portrait');
  const asked = await state(phone);
  expect(asked.visible, 'portrait room on a sideways phone: the prompt is up');
  expect(asked.flag === 'portrait', `it asks for portrait (${asked.flag})`);
  expect(/upright/i.test(asked.title), `it says which way to turn ("${asked.title}")`);
  expect(
    asked.hint === 'rotate-to-upright',
    `the glyph turns the way the words do (${asked.hint})`,
  );

  // ── Turning the phone. Now the room has not changed and the ORIENTATION has, which is
  // the other half of "derived": a pushed prompt would still be up.
  await phone.setViewportSize(PHONE_PORTRAIT);
  await settle(phone, null);
  expect(!(await state(phone)).visible, 'turning the phone upright clears the prompt');

  // ── The demand goes both ways: an ordinary room on an upright phone asks for sideways.
  await enter(phone, LANDSCAPE_ROOM);
  await settle(phone, 'landscape');
  const back = await state(phone);
  expect(back.visible && back.flag === 'landscape', `upright phone in a wide room asks for landscape (${back.flag})`);
  expect(/sideways/i.test(back.title), `it says which way to turn ("${back.title}")`);
  expect(
    back.hint === 'rotate-to-side',
    `the glyph turns the other way for the other demand (${back.hint})`,
  );

  // ── Leaving the room for the map, which is landscape whatever the room was.
  await phone.evaluate(() => window.__ff.showMap());
  await phone.waitForFunction(() => window.__ff.screen() === 'map');
  await settle(phone, 'landscape');
  expect((await state(phone)).flag === 'landscape', 'the map wants a sideways phone too');

  // ── A tablet: the deliberate carve-out. Same shapes that made the phone ask, twice
  // over — a portrait room while held portrait-tall, and a wide room in the same
  // portrait viewport — and it must stay silent through both.
  const tablet = await open(TABLET);
  await enter(tablet, PORTRAIT_ROOM);
  await enter(tablet, LANDSCAPE_ROOM);
  const t = await state(tablet);
  expect(!t.visible && t.flag === null, `tablet is never asked to turn (${t.flag})`);
} catch (e) {
  ok = false;
  console.log('  FAIL threw: ' + (e?.message ?? e));
} finally {
  await browser.close().catch(() => {});
}

console.log(ok ? 'PASS' : 'FAIL');
exitProbe(ok ? 0 : 1);
