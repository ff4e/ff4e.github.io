/**
 * UI test: the in-room touch bar and the touch Options, and the desktop neither must
 * appear on.
 *
 * The rule for whether touch mode is on is pinned in the unit suite
 * (test/touchMode.test.ts). What only a browser can show is everything these two modules
 * are actually made of: that each button reaches the RIGHT verb, that the bar comes and
 * goes with the screen, that its buttons float over the room without reserving any of the
 * room's space, and that the two doors into the faithful Options face lead somewhere else
 * in touch mode.
 *
 * The buttons and the Options controls are asserted by their EFFECT — the map appears,
 * the effects bus moves, the active fish changes — rather than by spying on
 * `panelAction`. Spying would prove a number was sent; this proves it was the right one,
 * which is the mistake worth catching in a table of regions copied into markup.
 *
 * The touch Options shares this probe rather than opening one of its own: it is reached
 * from this bar, so the setup is the same, and a second probe would pay the 1.3-2.7 s
 * browser launch again for it (AGENTS.md).
 *
 * It runs on a plain desktop context with `?touch=on`, deliberately: the touch UI has to
 * be reachable that way (it is the dev override's whole purpose), and it means this probe
 * is not also a test of Chromium's touch emulation, which test-phone-boots.mjs (a phone
 * reaches touch mode on its own) and test-touchswipe.mjs (a real touch pointer stream)
 * cover between them.
 */
import { chromium } from 'playwright';
import { exitProbe, WAIT_BACKSTOP } from './ui-lib.mjs';
import { checkDialogueHints } from './ui-dialogue-hints.mjs';
import { touchBarEdgeFor, touchBarLeftW } from '../src/app/touchBarEdge.ts';

const BASE = `http://127.0.0.1:${process.env.FF_UI_PORT ?? '5173'}/`;

/** KOSTE (room 6): an ordinary wide room, and not the boot room. */
const ROOM = 6;

let ok = true;
const expect = (cond, msg) => {
  if (!cond) ok = false;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

/** What the bar is doing, and what it is costing the stage. */
const barState = (p) =>
  p.evaluate(() => {
    const bar = document.getElementById('touchbar');
    const stage = document.querySelector('.stage');
    const buttons = bar ? [...bar.querySelectorAll('[data-region]')] : [];
    const visual = buttons.map((el) => ({ region: el.dataset.region, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    return {
      mode: document.documentElement.hasAttribute('data-touch'),
      reserving: document.documentElement.hasAttribute('data-touchbar'),
      visible: bar !== null && !bar.hidden,
      buttons: buttons.map((b) => b.dataset.region),
      visualButtons: visual.map(({ region }) => region).join(','),
      marginLeft: stage ? getComputedStyle(stage).marginLeft : '',
      marginTop: stage ? getComputedStyle(stage).marginTop : '',
      stageW: stage ? stage.clientWidth : 0,
      stageH: stage ? stage.clientHeight : 0,
      viewW: window.innerWidth,
      viewH: window.innerHeight,
      // The bar's own box: where it sits, and that it is only a positioning box — no paint
      // of its own and no hit-testing, so a swipe between two buttons reaches the room.
      bar: bar && !bar.hidden ? (() => {
        const r = bar.getBoundingClientRect();
        const cs = getComputedStyle(bar);
        return {
          left: Math.round(r.left), top: Math.round(r.top),
          w: Math.round(r.width), h: Math.round(r.height),
          bg: cs.backgroundColor, pe: cs.pointerEvents,
          buttonPe: [...new Set(buttons.map((b) => getComputedStyle(b).pointerEvents))].join(','),
        };
      })() : null,
    };
  });

/**
 * The faithful panel column, and what the stage row is spending its width on.
 *
 * `#stagebox` and `#panelcol` are the row's only children, so their extremes ARE its
 * content. Measured as extremes rather than with `scrollWidth`, which is no use here: the
 * row is centred, so it overflows BOTH ways and only the right-hand half of that shows up
 * in a scroll width.
 */
const rowState = (p) =>
  p.evaluate(() => {
    const stage = document.querySelector('.stage');
    const col = document.getElementById('panelcol');
    const box = document.getElementById('stagebox');
    const shown = [...stage.children].filter((el) => getComputedStyle(el).display !== 'none');
    const rects = shown.map((el) => el.getBoundingClientRect());
    return {
      panel: col !== null && getComputedStyle(col).display !== 'none',
      panelW: col ? Math.round(col.getBoundingClientRect().width) : 0,
      roomW: box ? Math.round(box.getBoundingClientRect().width) : 0,
      left: Math.round(Math.min(...rects.map((r) => r.left))),
      right: Math.round(Math.max(...rects.map((r) => r.right))),
      viewW: window.innerWidth,
    };
  });

/**
 * Where the ROOM's centre lands, against the screen's, and how close it comes to the bar.
 *
 * `#stagebox`/`#panelcol` are no use for this: the box hugs the room horizontally but is
 * handed the whole HEIGHT and letterboxes the room inside it, so its centre is the room's
 * on one axis only. `#screen` is the room. Measured through `clientLeft`/`clientWidth`
 * rather than the bounding rect, which includes the canvas's 1px border — a pixel that
 * `#stagebox`'s `overflow: hidden` clips and the player never sees, but that would show
 * up here as a one-pixel overlap of the bar.
 */
const roomCentre = (p) =>
  p.evaluate(() => {
    const el = document.getElementById('screen');
    const r = el.getBoundingClientRect();
    // The BUTTONS' extent (and the fish indicator's), not the bar's box: the box carries a
    // few px of breathing room that may lie over the room without any button on it.
    // The edge buttons only: Undo is pinned to the bottom-right corner (tabletUndo.css),
    // like the phone's, and is not part of the strip this measures.
    const rects = [...document.getElementById('touchbar').children]
      .filter((c) => c.id !== 'touchbar-undo')
      .map((c) => c.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0);
    const bar = {
      left: Math.min(...rects.map((b) => b.left)),
      top: Math.min(...rects.map((b) => b.top)),
      right: Math.max(...rects.map((b) => b.right)),
      bottom: Math.max(...rects.map((b) => b.bottom)),
    };
    const left = r.left + el.clientLeft;
    const top = r.top + el.clientTop;
    return {
      dx: Math.round(left + el.clientWidth / 2 - window.innerWidth / 2),
      dy: Math.round(top + el.clientHeight / 2 - window.innerHeight / 2),
      left: Math.round(left),
      top: Math.round(top),
      right: Math.round(left + el.clientWidth),
      bottom: Math.round(top + el.clientHeight),
      barLeft: Math.round(bar.left),
      barTop: Math.round(bar.top),
      barRight: Math.round(bar.right),
      barBottom: Math.round(bar.bottom),
      viewW: window.innerWidth,
      viewH: window.innerHeight,
    };
  });

async function open(query) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 620 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(WAIT_BACKSTOP);
  await p.addInitScript(() => {
    try {
      const raw = localStorage.getItem('ff.options');
      const o = raw ? JSON.parse(raw) : {};
      o.introSeen = true;
      localStorage.setItem('ff.options', JSON.stringify(o));
      // The dev bar carries the Touch override this probe drives at the end; it is
      // hidden for players and revealed by this flag (see withApp in ui-lib.mjs).
      localStorage.setItem('ff.devEnabled', '1');
    } catch {
      /* storage unavailable */
    }
  });
  await p.goto(BASE + query, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__ff !== undefined);
  return p;
}

const enter = async (p, num) => {
  await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
  await p.waitForFunction(
    (n) =>
      window.__ff.screen() === 'room' && !window.__ff.roomLoading() && window.__ff.roomNum() === n,
    num,
  );
};

/** Wait for the bar to be up or down — it is only recomputed on a painted frame. */
const settle = (p, want) =>
  p.waitForFunction((w) => document.documentElement.hasAttribute('data-touchbar') === w, want);

/**
 * Wait for the bar's landscape EDGE to settle on `want`, room and all.
 *
 * Two conditions, and the second is the one that matters: the attribute alone says the
 * decision was made, not that the room has been re-scaled into what the bar now leaves.
 * `roomGeom()` is what `relayout()` computed and the canvas takes it in the room's draw,
 * so they agree only once both have caught up — the same idiom as `settleRoom`.
 *
 * The attribute is absent until the first decision, so a missing one reads as the
 * stylesheet's orientation default: the left in landscape, the top in portrait.
 */
const settleEdge = (p, want) =>
  p.waitForFunction((w) => {
    const g = window.__ff.roomGeom();
    const el = document.getElementById('screen');
    return (
      (document.documentElement.getAttribute('data-touchbar-edge') ??
        (window.innerWidth > window.innerHeight ? 'left' : 'top')) === w &&
      g !== null &&
      Math.abs(el.clientWidth - g.cssW) <= 1 &&
      Math.abs(el.clientHeight - g.cssH) <= 1
    );
  }, want);

/**
 * Wait for a resize or a mode change to reach the screen.
 *
 * `relayout()` only recomputes the stage; the box is re-sized in the room's draw, so a
 * measurement taken straight after either would be the PREVIOUS frame's. Waits for the
 * width to stop being what it was rather than for a target, so the caller does not have
 * to predict the number it is about to measure.
 */
const settleBox = (p, was) =>
  p.waitForFunction(
    (w) => Math.round(document.getElementById('stagebox').getBoundingClientRect().width) !== w,
    was,
  );

/**
 * Wait until the page is quiescent, without needing to know what it looked like before.
 *
 * `settleBox` and `settleRoom` both wait for a CHANGE, which is the right thing after a
 * resize and no use before one — and the cutout block below needs a settled reading BEFORE
 * it touches anything. The four-inset sweep above sets and clears `--sa-left` four times
 * inside a single `evaluate` and never yields, so the CSS box geometry it measures is
 * correct while the room is still several frames behind it: 302px where the settled answer
 * is 519px. Measure off that and the cutout appears to make the room bigger.
 *
 * Measured on `#stagebox` and not `#screen`, which is what `settleEdge` uses: the canvas
 * sits at its 300x150 default here and never takes a CSS size, so a comparison against it
 * would wait for an agreement that never comes. `#stagebox` hugs the room horizontally, so
 * its width IS `roomGeom().cssW` once the layout has caught up — plus the canvas's 1px
 * border on each side, which the bounding rect includes and `cssW` does not. Hence 3 and
 * not 1: two for the border, one for rounding.
 */
const settled = (p) =>
  p.waitForFunction(() => {
    const g = window.__ff.roomGeom();
    const box = document.getElementById('stagebox');
    return g !== null && box !== null && Math.abs(box.getBoundingClientRect().width - g.cssW) <= 3;
  });

/**
 * Resize, and wait for the new size to reach the ROOM.
 *
 * `settleBox` above is no use for the centring block, twice over: it waits for a WIDTH to
 * change, so a resize that only moves the height never satisfies it, and a rect that has
 * merely stopped moving is not the same as a rect that is RIGHT — `#screen` sits at the
 * canvas default of 300x150 until the first draw after `enter()`, which is stable, wrong,
 * and (being centred like anything else) passes a centring assertion vacuously.
 *
 * So it waits for two things: that the room's rect has actually MOVED (the same idiom as
 * `settleBox` — `relayout()` runs off the resize event, which is not ordered against this
 * poll, so "the new size arrived" cannot be assumed from `innerWidth` alone), and that the
 * DOM then agrees with the app's own layout — `roomGeom()` is what `relayout()` computed,
 * the canvas takes it in the room's draw, and the two match only once both have caught up.
 * Every viewport this is called with therefore has to change the room's size.
 */
const settleRoom = async (p, width, height) => {
  const was = await p.evaluate(() => {
    const el = document.getElementById('screen');
    return [el.clientWidth, el.clientHeight].join(',');
  });
  await p.setViewportSize({ width, height });
  await p.waitForFunction(
    ([w, h]) => window.innerWidth === w && window.innerHeight === h,
    [width, height],
  );
  await p.waitForFunction((was) => {
    const g = window.__ff.roomGeom();
    const el = document.getElementById('screen');
    return (
      g !== null &&
      [el.clientWidth, el.clientHeight].join(',') !== was &&
      Math.abs(el.clientWidth - g.cssW) <= 1 &&
      Math.abs(el.clientHeight - g.cssH) <= 1
    );
  }, was);
};

/** Where the bar's buttons actually end up, for the "do six of them still fit?" check. */
const barFit = (p) =>
  p.evaluate(() => {
    const els = [...document.querySelectorAll('#touchbar [data-region]')];
    const rects = els.map((el) => el.getBoundingClientRect());
    return {
      count: els.length,
      left: Math.round(Math.min(...rects.map((r) => r.left))),
      right: Math.round(Math.max(...rects.map((r) => r.right))),
      minW: Math.round(Math.min(...rects.map((r) => r.width))),
      viewW: window.innerWidth,
    };
  });

const tap = (p, region) => p.click(`#touchbar [data-region="${region}"]`);

/**
 * Move a range input the way a thumb does: set the value, then fire the `input` event
 * the browser fires during a drag. `p.fill()` on a range does not emit it, and `input`
 * is what the live-volume wiring listens to (src/app/touchOptions.ts).
 */
const setRange = (p, id, value) =>
  p.evaluate(
    ({ id, value }) => {
      const el = document.getElementById(id);
      el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    { id, value },
  );

const browser = await chromium.launch();
try {
  // ── A desktop, untouched. The guarantee the whole touch series rests on, asserted
  // where it would actually be visible: in a room, which is the only place the bar is
  // ever up.
  const desktop = await open('');
  await enter(desktop, ROOM);
  const d = await barState(desktop);
  expect(!d.mode, 'desktop: touch mode is off');
  expect(!d.visible && !d.reserving, 'desktop: no bar in a room, and the stage keeps its width');
  expect(d.marginLeft === '0px', `desktop: the stage has no margin reserved (${d.marginLeft})`);
  const dRow = await rowState(desktop);
  expect(dRow.panel, 'desktop: the faithful control panel is beside the room');
  expect(dRow.panelW > 0, `desktop: and it is taking its width (${dRow.panelW}px)`);
  // The mouse player's Options is untouched: the corner button still scrolls the panel
  // to the canvas face, and the HTML one stays out of it. This is the guarantee the
  // whole touch series rests on, asserted at the one place the two could collide.
  await desktop.evaluate(() => window.__ff.panelAction(16));
  await desktop.waitForFunction(() => window.__ff.optionsOpen());
  expect(
    !(await desktop.evaluate(() => document.documentElement.hasAttribute('data-touchopts'))),
    'desktop: the corner button still opens the CANVAS options face',
  );

  // ── The same desktop with the dev override on: the touch UI has to be reachable
  // without device emulation, or nobody can look at it while building it.
  const p = await open('?touch=on');
  const boot = await barState(p);
  expect(boot.mode, 'override: touch mode is on');
  expect(!boot.visible, 'override: no bar on the map — these are IN-ROOM controls');

  await enter(p, ROOM);
  await settle(p, true);
  const inRoom = await barState(p);
  expect(inRoom.visible, 'in a room: the bar is up');
  expect(
    inRoom.buttons.join(',') === '14,12,13,15,16,24',
    `the six buttons send map/save/load/restart/options/undo (${inRoom.buttons.join(',')})`,
  );
  expect(inRoom.visualButtons === '14,12,13,15,16,24',
    'landscape left bar: Restart is fourth and Undo is last');
  // The buttons FLOAT over the room (Martin, 2026-09-29): the stage keeps the whole
  // viewport, and the bar is an invisible box that only positions the buttons — no fill,
  // and no hit-testing of its own, so a swipe that starts between two buttons still reaches
  // the room. It used to reserve its width with a margin on `.stage`.
  expect(
    inRoom.marginLeft === '0px' && inRoom.marginTop === '0px' && inRoom.stageW === inRoom.viewW,
    `the bar reserves nothing from the stage (margin ${inRoom.marginLeft}/${inRoom.marginTop}, stage ${inRoom.stageW} of ${inRoom.viewW})`,
  );
  expect(
    inRoom.bar !== null && inRoom.bar.bg === 'rgba(0, 0, 0, 0)' && inRoom.bar.pe === 'none' &&
      inRoom.bar.buttonPe === 'auto',
    `the bar is a see-through, click-through box and only its buttons take taps (bg ${inRoom.bar?.bg}, bar ${inRoom.bar?.pe}, buttons ${inRoom.bar?.buttonPe})`,
  );
  expect(
    inRoom.bar !== null && inRoom.bar.left === 0 && inRoom.bar.top === 0 && inRoom.bar.h === inRoom.viewH,
    `landscape: the buttons sit down the left edge (${inRoom.bar?.left},${inRoom.bar?.top} ${inRoom.bar?.w}x${inRoom.bar?.h})`,
  );

  // ── The display cutout, supplied. On a phone the native shell measures it and writes
  // it into `--sa-*` (ios/App/App/SafeAreaBridgeViewController.swift); the bar's footprint
  // is `58px + max(var(--sa-left), var(--bar-lead))` and it spends the inset as padding
  // INSIDE that box, so its rendered width is that footprint by construction.
  //
  // A browser reports every inset as 0, which makes the whole mechanism invisible here —
  // and that blind spot hid a real bug: `#touchbar` was `content-box`, so the padding was
  // added ON TOP of the width and the bar came out one whole inset wider than its footprint
  // (196px of bar against a 134px footprint, on an iPhone 17 Pro in landscape). Nothing in
  // the suite could see it, because with a 0 inset the padding is 0 and the two agree by
  // accident. The footprint is still what `touchBarEdge.ts` prices the left edge at, so the
  // two have to keep agreeing even though the room no longer gives that width up.
  //
  // So set the same variable the shell sets, and assert they still agree with it non-zero.
  //
  // Over EVERY inset the current iPhones actually report, not one sample. Measured by
  // installing this build on each simulator and reading back what the bridge published:
  //
  //     iPhone 17e                          390x844   47   (notch)
  //     iPhone 17 / 17 Pro / 17 Pro Max      402x874   62   (Dynamic Island)
  //     iPhone Air                           420x912   68
  //
  // Three different numbers across five current models, which is the whole reason none of
  // this is a constant: the housing is a different size on different phones, and iOS is the
  // only thing that knows. A single 62px case would pass just as well if the rule had been
  // written as "62" somewhere, and that is exactly the bug this table exists to prevent.
  // 0 is included because it is the OTHER landscape on any of them — the housing is on the
  // far side, so nothing pushes the bar in and `--bar-lead` takes over.
  const INSETS = [0, 47, 62, 68];
  const cutouts = await p.evaluate(({ insets, footprints }) => {
    const root = document.documentElement;
    const lead = Number.parseFloat(getComputedStyle(root).getPropertyValue('--bar-lead'));
    const out = insets.map((inset) => {
      root.style.setProperty('--sa-left', `${inset}px`);
      const bar = document.getElementById('touchbar').getBoundingClientRect();
      const footprint = footprints[insets.indexOf(inset)];
      const reserve = Number.parseFloat(getComputedStyle(document.querySelector('.stage')).marginLeft);
      // The column only: Undo is pinned to the bottom-right corner, not part of it.
      const column = [...document.querySelectorAll('#touchbar [data-region]:not(#touchbar-undo)')];
      const buttonLeft = Math.min(...column.map((b) => b.getBoundingClientRect().left));
      const buttonRight = Math.max(...column.map((b) => b.getBoundingClientRect().right));
      return {
        inset,
        barW: Math.round(bar.width),
        footprint,
        reserve,
        buttonLeft: Math.round(buttonLeft),
        trailing: Math.round(bar.right - buttonRight),
      };
    });
    root.style.removeProperty('--sa-left');
    return { lead, out };
  }, { insets: INSETS, footprints: INSETS.map((i) => touchBarLeftW(i)) });

  // The bar is its footprint at every inset — the box-sizing bug made it one whole inset
  // wider, and only a non-zero one shows it — and the room gives none of it up.
  const mismatched = cutouts.out.filter((c) => c.barW !== c.footprint || c.reserve !== 0);
  expect(
    mismatched.length === 0,
    `every cutout grows the bar by exactly its footprint, and the stage reserves none of it (${cutouts.out.map((c) => `${c.inset}->${c.barW}/${c.footprint} reserve ${c.reserve}`).join(' ')})`,
  );
  // And the rule the buttons follow: start AT the housing, or at the lead when there is no
  // housing on this side — `max()`, never a sum, and never centred in the leftover. Held off
  // it by the lead (the sum) is what put them 76px in against a 62px island, which is the
  // gap Martin reported; centred in the leftover is the other half of the same mistake.
  const wrong = cutouts.out.filter((c) => c.buttonLeft !== Math.max(c.inset, cutouts.lead));
  expect(
    wrong.length === 0,
    `the buttons start at max(cutout, lead=${cutouts.lead}) on every device (${cutouts.out.map((c) => `${c.inset}->${c.buttonLeft}`).join(' ')})`,
  );
  // The lead itself has to be a real number, or `max()` degenerates to the inset and the
  // 0 row above passes with the buttons flush against the glass — the original bug.
  expect(
    cutouts.lead > 0,
    `--bar-lead is set, so the no-housing landscape still clears the display corner (${cutouts.lead}px)`,
  );
  // And the gap on the FAR side of the buttons — between them and the room — is the same
  // on every device. It is the half of the footprint nothing else pins: the bar's width
  // was a flat `72px + inset`, sized for 56px buttons that started 8px in, so once they
  // became 52px starting at `max(inset, lead)` the leftover fell out of the far side and
  // varied with the phone — 6px without a housing, 20px with one, a ledge of dead bar
  // between the buttons and the room on exactly the phones that have an island.
  const trailing = new Set(cutouts.out.map((c) => c.trailing));
  expect(
    trailing.size === 1,
    `the gap between the buttons and the room is the same on every device (${cutouts.out.map((c) => `${c.inset}->${c.trailing}`).join(' ')})`,
  );

  // ── And the ROOM's half of the same cutout. Everything above measures the BAR — its
  // width, its buttons — and none of it looks at what the room does. The room must not
  // care: the buttons float, so an island that pushes them further in must neither
  // shrink the room nor move it off the screen's centre. (When the bar reserved its
  // width, this was where "the room starts clear of the bar" was asserted; that is
  // deliberately no longer true — the buttons may overlap the room.)
  //
  // Left as a separate pass at a real inset rather than folded into the loop above, because
  // it needs the layout to have SETTLED at that inset — the loop sets four values inside one
  // `evaluate` and reads the bar back synchronously, which is fine for CSS box geometry and
  // useless for a canvas that resizes on a frame.
  //
  // 62 is the Dynamic Island, the most common of the three.
  await settled(p);
  const bare = await rowState(p);
  await p.evaluate(() => document.documentElement.style.setProperty('--sa-left', '62px'));
  await p.waitForFunction(
    (w) => Math.round(document.getElementById('touchbar').getBoundingClientRect().width) === w,
    touchBarLeftW(62),
  );
  await settled(p);
  const housed = await rowState(p);
  const housedBar = await barState(p);
  expect(
    housedBar.marginLeft === '0px' && housed.left === bare.left && housed.right === bare.right,
    `with a 62px island the room does not move (${bare.left}..${bare.right} -> ${housed.left}..${housed.right}, margin ${housedBar.marginLeft})`,
  );
  const housedOff = Math.round((housed.left + housed.right) / 2 - housed.viewW / 2);
  expect(
    Math.abs(housedOff) <= 1,
    `and its centre is still the screen's (off by ${housedOff}px of ${housed.viewW})`,
  );
  await p.evaluate(() => document.documentElement.style.removeProperty('--sa-left'));
  await p.waitForFunction(
    (w) => Math.round(document.getElementById('touchbar').getBoundingClientRect().width) === w,
    touchBarLeftW(0),
  );
  await settled(p);

  // ── The faithful panel is retired, and the room is given its footprint back. The
  // whole point of doing this LAST: everything the panel does now has a thumb-sized
  // counterpart, so hiding it leaves nothing unreachable.
  const tRow = await rowState(p);
  expect(!tRow.panel, 'the faithful panel column is gone in touch mode');
  expect(
    tRow.panelW === 0,
    `and it is claiming no width at all — column, not canvas (${tRow.panelW}px)`,
  );

  // ── The clipping this fixes. A phone-width portrait viewport could not hold the row:
  // measured at 393x852 with touch OFF, rooms overhang it by 22px (KOSTE), 84px and 93px
  // (the 795-wide ones), and `#stagebox`'s `overflow: hidden` cut the difference off. The
  // 167 native px of panel + gap were the bulk of it, and `MIN_STAGE_SCALE` was the rest:
  // it floored the scale at 0.5, so the logical box was 400px in a 393px viewport and a
  // room wide enough to fill it still overhung by 7. The floor now yields to the width, so
  // the residual is gone; the arithmetic for both halves is in test/layout.test.ts.
  // Resized rather than opened in a context of its own: the viewport is a page property,
  // and a second context would pay the boot again to assert two numbers.
  await p.setViewportSize({ width: 393, height: 852 });
  await settleBox(p, tRow.roomW);
  const portrait = await rowState(p);
  expect(
    portrait.left >= 0 && portrait.right <= portrait.viewW,
    `portrait phone width: this room's row fits the viewport (${portrait.left}..${portrait.right} of ${portrait.viewW})`,
  );
  // The portrait half of the same rule, asserted for parity with the landscape check
  // above: the buttons are along the TOP edge here, and they cost the room no height.
  const portraitBar = await barState(p);
  expect(portraitBar.visualButtons === '14,12,13,15,16,24',
    'portrait top bar: Restart is fourth and Undo is last');
  expect(
    portraitBar.marginTop === '0px' && portraitBar.marginLeft === '0px',
    `portrait: the bar reserves no height either (margin-top ${portraitBar.marginTop}, margin-left ${portraitBar.marginLeft})`,
  );
  expect(
    portraitBar.bar !== null && portraitBar.bar.top === 0 && portraitBar.bar.w === portraitBar.viewW,
    `portrait: the buttons sit along the top edge (${portraitBar.bar?.left},${portraitBar.bar?.top} ${portraitBar.bar?.w}x${portraitBar.bar?.h})`,
  );
  // ── Six buttons in a portrait ROW, at the narrowest width this game is willing to be
  // played at. Landscape stacks them in a 72px column and has the whole height to spend,
  // so it cannot run out; portrait is the axis that can, and the bar neither wraps nor
  // scrolls — below 600px the split-window rules in activeFishIndicator.css shrink the gap
  // so the in-flow targets fit (Undo sits in the bottom-right corner, outside the row).
  // 375 is an iPhone SE (deviceGate.ts's own device table). Asserted from the rendered
  // rects rather than from that arithmetic, so a seventh button, a wider label or a
  // padding change fails here instead of on somebody's phone.
  await p.setViewportSize({ width: 375, height: 812 });
  await settleBox(p, portrait.roomW);
  const narrow = await barFit(p);
  const narrowRow = await rowState(p);
  expect(
    narrow.count === 6 && narrow.left >= 0 && narrow.right <= narrow.viewW,
    `portrait 375px: all ${narrow.count} buttons fit on screen (${narrow.left}..${narrow.right} of ${narrow.viewW})`,
  );
  expect(
    narrow.minW >= 44,
    `portrait 375px: and none is shrunk below a thumb (narrowest ${narrow.minW}px)`,
  );
  await p.setViewportSize({ width: 393, height: 852 });
  await settleBox(p, narrowRow.roomW);

  // ── And the room genuinely gets that width, measured end to end rather than in the
  // layout maths (test/layout.test.ts has the arithmetic). It takes a WIDTH-bound
  // viewport to show: where the height is what limits the scale, the panel's 167px were
  // never what the room was short of. 900x1000 is width-bound (900/800 < 1000/600).
  // Two things now separate the two numbers, not one: the panel's width, and the fit mode
  // — touch is always 'fill' (layout.ts, effectiveFitMode) and a width-bound viewport also
  // hands the box its leftover HEIGHT (stageBoxHeight). Both move the room the same way,
  // so the assertion is still one-directional; it just no longer isolates the panel.
  await p.setViewportSize({ width: 900, height: 1000 });
  await settleBox(p, portrait.roomW);
  const noPanel = await rowState(p);
  await p.selectOption('#touchmode', 'off');
  await p.waitForFunction(() => !document.documentElement.hasAttribute('data-touch'));
  await settleBox(p, noPanel.roomW);
  const withPanel = await rowState(p);
  expect(
    noPanel.roomW > withPanel.roomW,
    `the room gets the panel's width back (${noPanel.roomW} without it, ${withPanel.roomW} with)`,
  );
  await p.selectOption('#touchmode', 'on');
  await p.waitForFunction(() => document.documentElement.hasAttribute('data-touch'));
  await settleBox(p, withPanel.roomW);
  // Back to the probe's own viewport. Waits on `innerWidth`, NOT on `settleBox`: the box
  // here differs from the 900x1000 one by a single rounded pixel, and a "wait for it to
  // change" that the two sides can tie on is a wait that hangs the probe with no
  // diagnostic. Nothing after this reads geometry, so the resize landing is enough.
  await p.setViewportSize({ width: 1100, height: 620 });
  await p.waitForFunction(() => window.innerWidth === 1100);

  // ── Options (region 16): in touch mode the corner button opens the plain-HTML
  // Options, NOT the canvas face the mouse gets. Both halves matter: a touch player has
  // to reach the settings, and a touch player must not be able to reach the 9px-tall
  // canvas sliders that this screen exists to replace.
  await tap(p, 16);
  await p.waitForFunction(() => document.documentElement.hasAttribute('data-touchopts'));
  expect(true, 'Options opens the touch Options');
  expect(
    (await p.evaluate(() => window.__ff.optionsOpen())) === false,
    'and NOT the canvas options face',
  );

  // Each control reaches the same verb the panel's own region does. Asserted by effect —
  // the setting actually moved — rather than by spying on `panelAction`, like the buttons
  // above: what is worth catching is a slider wired to the wrong bus.
  await setRange(p, 'topt-effect', 3);
  expect((await p.evaluate(() => window.__ff.volumes().effect)) === 3, 'the effects slider sets the effects bus');
  await setRange(p, 'topt-voice', 9);
  expect((await p.evaluate(() => window.__ff.volumes().voice)) === 9, 'the voices slider sets the voices bus');
  await setRange(p, 'topt-music', 12);
  expect((await p.evaluate(() => window.__ff.volumes().music)) === 12, 'the music slider sets the music bus');
  // The readout is the ORIGINAL's level (Volumes[12] = 64), not the 0..12 index.
  expect(
    (await p.evaluate(() => document.getElementById('topt-music-val').textContent)) === '64',
    'and the number beside it is the level, not the index',
  );
  await p.click('#touchopts input[value="cz"]');
  await p.waitForFunction(() => window.__ff.subtitleMode() === 'cz');
  await p.click('#touchopts input[value="en"]');
  await p.waitForFunction(() => window.__ff.subtitleMode() === 'en');
  expect(true, 'the subtitle radios set the subtitle mode');

  // Help: the pages are a full-screen document, so this overlay has to get out of the way
  // — it is position:fixed and would otherwise sit on top of them.
  await p.click('#topt-help');
  await p.waitForFunction(() => window.__ff.helpOpen());
  expect(
    !(await p.evaluate(() => document.documentElement.hasAttribute('data-touchopts'))),
    'Help opens the help pages and closes the Options over them',
  );
  // The floating buttons step aside for the help pages too, and come back after.
  await settle(p, false);
  expect(!(await barState(p)).visible, 'the buttons are hidden while help is open');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !window.__ff.helpOpen());
  await settle(p, true);

  await tap(p, 16);
  await p.waitForFunction(() => document.documentElement.hasAttribute('data-touchopts'));
  await p.click('#topt-close');
  await p.waitForFunction(() => !document.documentElement.hasAttribute('data-touchopts'));
  expect(true, 'Done closes it again');

  // ── Undo (region 24), and the `-` key that is its desktop door. The one button on this
  // bar with no `Uovl.pas` region behind it: the 1998 game has no undo, so nothing here
  // is a fidelity question and nothing else in the repo would notice a wrong region.
  //
  // Asserted by walking a run forwards banking `posHash` after each move — the hash that
  // exists for exactly this ("undo/load must reproduce it exactly", debugHooks.ts) — and
  // then undoing back down it. That is the property the whole approach rests on, and the
  // browser is where it is worth checking, because the unit suite drives the engine
  // directly while this drives the real room build, the real tick and the real button.
  //
  // The moves are found rather than chosen: which pushes are legal is a fact about KOSTE,
  // and a probe that hard-codes them breaks the day the room data is looked at again. Any
  // press that the record accepts will do.
  await p.evaluate(() => window.__ff.restart());
  await p.waitForFunction(() => window.__ff.moves() === 0 && window.__ff.undoDepth() === 1);
  const bank = [await p.evaluate(() => window.__ff.posHash())];
  for (const which of ['little', 'big']) {
    for (const dir of [4, 3, 1, 2]) {
      if (bank.length >= 4) break;
      const depth = bank.length;
      // One round trip per press: read the record, press, and hand back what was read.
      // Three moves, not thirty — each undo is a real room rebuild, and this probe pays
      // for every one of them.
      await p.evaluate(([w, d]) => window.__ff.press(w, d), [which, dir]);
      await p.waitForFunction(() => window.__ff.phase() === 'idle');
      const after = await p.evaluate(() => [window.__ff.undoDepth(), window.__ff.posHash()]);
      if (after[0] === depth) continue; // the push was blocked: try another direction
      bank.push(after[1]);
    }
  }
  expect(bank.length === 4, `three moves banked to undo (${bank.length - 1})`);
  // The `-` key first, once, so the desktop trigger is asserted on a real key event and
  // not only through the button. FFNG's key for it, which is where the choice comes from.
  await p.keyboard.press('Minus');
  await p.waitForFunction((n) => window.__ff.moves() === n, bank.length - 2);
  expect(
    (await p.evaluate(() => window.__ff.posHash())) === bank[bank.length - 2],
    'the − key takes back exactly one move',
  );
  // …and on a layout that is not the one this machine is typing on. Playwright presses a
  // physical key, so the line above only ever proves the US position; the binding matches
  // `e.key` precisely so that it does not. On a Czech QWERTZ the `-` key reports
  // `code: 'Slash'` — a `code: 'Minus'` binding does nothing there and silently steals
  // `=`, which is the key that IS in that position. Both halves are asserted, because the
  // second is how the first was found: reported from a real Czech keyboard, where the
  // on-screen button worked and the key did not.
  const czech = (key, code) =>
    p.evaluate(
      (e) => window.dispatchEvent(new KeyboardEvent('keydown', { ...e, bubbles: true, cancelable: true })),
      { key, code },
    );
  let atMoves = await p.evaluate(() => window.__ff.moves());
  await czech('-', 'Slash');
  await p.waitForFunction((n) => window.__ff.moves() === n - 1, atMoves);
  expect(true, "a Czech/German layout's − (code 'Slash') undoes too");
  atMoves = await p.evaluate(() => window.__ff.moves());
  await czech('=', 'Minus');
  await p.waitForTimeout(200);
  expect(
    (await p.evaluate(() => window.__ff.moves())) === atMoves,
    "and the '=' sitting at the US − position does not",
  );
  for (let i = (await p.evaluate(() => window.__ff.moves())); i > 0; i--) {
    await tap(p, 24);
    await p.waitForFunction((n) => window.__ff.moves() === n, i - 1);
    expect(
      (await p.evaluate(() => window.__ff.posHash())) === bank[i - 1],
      `Undo #${bank.length - i} lands exactly on the position before move ${i}`,
    );
  }
  // And it stops at the room's start instead of running off the bottom: the last point in
  // the history IS where the player is, so there is nothing below it.
  expect(!(await p.evaluate(() => window.__ff.canUndo())), 'at the start, there is nothing to undo');
  await tap(p, 24);
  const after = await p.evaluate(() => [window.__ff.moves(), window.__ff.screen()]);
  expect(after[0] === 0 && after[1] === 'room', 'and pressing it anyway is a clean no-op');

  // ── The rescue case, which is why undo does NOT copy save's rule. `CanSave` refuses
  // while a fish is dead (URoom.pas:26900) and a lone survivor deliberately keeps playing,
  // so before this the only way out of a fatal move was a full restart. Undo is the way
  // out, and this is the assertion that says so: refused by save, offered by undo.
  await p.evaluate(() => window.__ff.press('little', 3));
  await p.waitForFunction(() => window.__ff.phase() === 'idle' && window.__ff.undoDepth() === 2);
  await p.evaluate(() => window.__ff.killFish('little'));
  await p.waitForFunction(() => window.__ff.state().dead);
  const dead = await p.evaluate(() => [window.__ff.canSave(), window.__ff.canUndo()]);
  expect(!dead[0], 'with a fish dead, saving is refused');
  expect(dead[1], 'and undo is offered anyway');
  await tap(p, 24);
  await p.waitForFunction(() => !window.__ff.state().dead);
  expect(true, 'Undo brings the dead fish back — the move that killed it is taken back');

  // ── Both fish at once. The room then restarts BY ITSELF once the skeletons erode
  // (URoom.pas:24337), about a second later, so there is no dead position to press undo
  // on. The ended attempt is kept behind the new one instead: undo from the fresh start
  // goes back to where the fish died, and the first move of the new attempt drops it.
  const moveOnce = async () => {
    for (const dir of [3, 4, 1, 2]) {
      const before = await p.evaluate(() => window.__ff.moves());
      await p.evaluate((d) => window.__ff.press('little', d), dir);
      await p.waitForFunction(() => window.__ff.phase() === 'idle');
      if ((await p.evaluate(() => window.__ff.moves())) > before) return true;
    }
    return false;
  };
  expect(await moveOnce(), 'a move first, so the attempt that dies has something to go back to');
  await p.waitForFunction(() => window.__ff.canUndo());
  const bothDeadAt = await p.evaluate(() => window.__ff.posHash());
  const bothDeadPokus = await p.evaluate(() => window.__ff.script().pokus);
  await p.evaluate(() => {
    window.__ff.killFish('little');
    window.__ff.killFish('big');
  });
  await p.waitForFunction(
    (n) => window.__ff.script().pokus === n + 1 && !window.__ff.state().dead && window.__ff.phase() === 'idle',
    bothDeadPokus,
  );
  expect(
    (await p.evaluate(() => [window.__ff.moves(), window.__ff.canUndo()])).join() === '0,true',
    'after both fish die the room auto-restarts, and undo is offered from its start',
  );
  await tap(p, 24);
  await p.waitForFunction((h) => window.__ff.posHash() === h && !window.__ff.state().dead, bothDeadAt);
  expect(true, 'Undo after the auto-restart returns to the position the fish died in');
  await p.evaluate(() => {
    window.__ff.killFish('little');
    window.__ff.killFish('big');
  });
  await p.waitForFunction(
    (n) => window.__ff.script().pokus === n + 2 && !window.__ff.state().dead && window.__ff.phase() === 'idle',
    bothDeadPokus,
  );
  const freshStart = await p.evaluate(() => window.__ff.posHash());
  expect(await moveOnce(), 'then a move in the new attempt');
  await p.waitForFunction(() => window.__ff.canUndo());
  await tap(p, 24);
  await p.waitForFunction((h) => window.__ff.posHash() === h && window.__ff.moves() === 0, freshStart);
  expect(
    !(await p.evaluate(() => window.__ff.canUndo())),
    'but a move in the new attempt drops the ended one: undo stops at the fresh start',
  );

  // ── Restart (region 15): the room goes back to a fresh attempt. It is on the bar ONLY
  // because retiring the faithful panel took away its last touch-reachable door — its
  // other one is the Backspace key, which a phone does not have (touchButtons.ts). It is
  // also the one destructive button here, so it is worth knowing it does exactly the
  // panel's verb and not something adjacent.
  //
  // Asserted by two effects, because either alone is weak: the attempt counter moves
  // (`pokus`, the original's own "this is another try"), and the active fish is back to
  // what the room started with — which is what a rebuild does, and which a mere repaint
  // would not. The swap in between is what gives the rebuild something to undo; it goes
  // through `panelAction(11)` rather than a button because Swap no longer HAS one (a tap
  // on the play area swaps, and test-touchswipe covers that).
  const startActive = await p.evaluate(() => window.__ff.state().active);
  const startPokus = await p.evaluate(() => window.__ff.script().pokus);
  await p.evaluate(() => window.__ff.panelAction(11));
  await p.waitForFunction((a) => window.__ff.state().active !== a, startActive);
  await tap(p, 15);
  await p.waitForFunction((a) => window.__ff.state().active === a, startActive);
  expect(true, `Restart rebuilds the room (active fish back to ${startActive})`);
  const nowPokus = await p.evaluate(() => window.__ff.script().pokus);
  expect(
    nowPokus === startPokus + 1,
    `and it counts as a fresh attempt (pokus ${startPokus} -> ${nowPokus})`,
  );

  // ── Save (region 12): a save exists afterwards where none did before. One move first,
  // remembering the position BEFORE it, because what the save has to carry is not only
  // where the player is but how they got there.
  await p.evaluate(() => localStorage.removeItem('ff.save.' + window.__ff.roomNum()));
  let beforeLast = null;
  for (const dir of [3, 4, 1, 2]) {
    const depth = await p.evaluate(() => window.__ff.undoDepth());
    const at = await p.evaluate(() => window.__ff.posHash());
    await p.evaluate((d) => window.__ff.press('little', d), dir);
    await p.waitForFunction(() => window.__ff.phase() === 'idle');
    if ((await p.evaluate(() => window.__ff.undoDepth())) > depth) {
      beforeLast = at;
      break;
    }
  }
  expect(beforeLast !== null, 'a move before saving, so the save has a history to carry');
  const savedMoves = await p.evaluate(() => window.__ff.moves());
  await tap(p, 12);
  await p.waitForFunction(() => window.__ff.hasSave());
  expect(true, 'Save writes a save for this room');

  // ── A save carries the undo history with it (Martin, 2026-08-29), so a load resumes an
  // ATTEMPT and not merely a position: undo after it walks back through the moves that
  // reached the save. Restart in between is what makes this an assertion about the SAVE —
  // it throws the in-memory history away, so anything undoable afterwards came off disk.
  await tap(p, 15);
  await p.waitForFunction(() => window.__ff.moves() === 0 && !window.__ff.canUndo());
  expect(true, 'Restart in between leaves nothing in memory to undo');

  // ── Load (region 13): it takes, without the room ending up somewhere else.
  await tap(p, 13);
  // `loading()` as well as `roomLoading()`, and they are different things: the second is
  // the ROOM being fetched, the first is the load's fast-forward still replaying the
  // record. `phase` is 'idle' between that replay's moves and `moves()` reaches its total
  // on the last one, so without this the probe can measure a load that has not finished —
  // and undo is deliberately refused while it runs, which is a real refusal read as a bug.
  await p.waitForFunction(
    (n) =>
      !window.__ff.roomLoading() &&
      !window.__ff.loading() &&
      window.__ff.moves() === n &&
      window.__ff.phase() === 'idle',
    savedMoves,
  );
  expect((await p.evaluate(() => window.__ff.roomNum())) === ROOM, 'Load stays in the same room');
  expect(
    await p.evaluate(() => window.__ff.canUndo()),
    'and it brings the saved run\'s undo history back with it',
  );
  await tap(p, 24);
  await p.waitForFunction((h) => window.__ff.posHash() === h, beforeLast);
  expect(true, 'Undo after a load steps back INTO the saved run, one move at a time');

  // ── Nothing in this room's history failed to replay. `undoMove` falls back to an
  // earlier point when a replay does not reproduce the one it was aimed at, which is a
  // real case (PARTY2 #18 replays one of its own records into a dead fish) — but in an
  // ordinary room it must never fire, and a counter that has moved here means the replay
  // path has drifted from the live one.
  expect(
    (await p.evaluate(() => window.__ff.undoDiverged())) === 0,
    'no point in this room needed the divergence fallback',
  );
  expect(
    (await p.evaluate(() => window.__ff.undoSnapshots())) <= 120,
    'and the history keeps script snapshots only for the newest points',
  );

  // ── Map (region 14): off to the world map, and the bar goes with it. The second half
  // is the one a pushed implementation would get wrong.
  await tap(p, 14);
  await p.waitForFunction(() => window.__ff.screen() === 'map');
  await settle(p, false);
  const onMap = await barState(p);
  expect(!onMap.visible, 'Map leaves the room, and the bar comes down with it');
  expect(
    onMap.marginLeft === '0px',
    `and the map has no margin either (${onMap.marginLeft})`,
  );
  // ── The map's own Options corner is the SECOND door into the faithful face, and it
  // has to hand over too — otherwise the panel column floats over the map on a phone
  // with the very sliders the touch screen replaces. `mapOverlay` staying 'none' is the
  // half worth pinning: nothing floats, so there is no overlay state to unwind.
  await p.evaluate(() => window.__ff.openMapOptions());
  await p.waitForFunction(() => document.documentElement.hasAttribute('data-touchopts'));
  expect(
    (await p.evaluate(() => window.__ff.mapOverlay())) === 'none',
    "the map's Options corner opens the touch Options, without floating the panel",
  );
  await p.click('#topt-close');
  await p.waitForFunction(() => !document.documentElement.hasAttribute('data-touchopts'));
  // ── The dev-bar control, driven the way a person drives it. Two independent
  // reviewers found the same defect here: the page was loaded with `?touch=on`, and
  // with the URL outranking everything the control could write storage all day and
  // never turn the mode off. Nothing in the suite touched this control at all, which is
  // why it was invisible — so it is asserted from the far end, on the bar itself.
  await enter(p, ROOM);
  await settle(p, true);
  await p.selectOption('#touchmode', 'off');
  await p.waitForFunction(() => !document.documentElement.hasAttribute('data-touch'));
  await settle(p, false);
  const off = await barState(p);
  expect(!off.visible, 'the dev-bar control turns the touch UI off, over a ?touch=on URL');
  expect(off.marginLeft === '0px', `and the stage has no margin (${off.marginLeft})`);
  const offRow = await rowState(p);
  expect(offRow.panel, 'and the faithful panel comes back with it');
  await p.selectOption('#touchmode', 'on');
  await settle(p, true);
  expect((await barState(p)).visible, 'and back on again');

  // ── Turning the override ON while the CANVAS Options face is open must not strand it.
  // The hand-over returns before the branch that scrolls that face back down, so without
  // an unwind nothing could close it until the next room load and both Options would be
  // on screen at once — the one thing this series promises cannot happen. Only reachable
  // from this control, which is exactly why nothing else was watching it.
  await p.selectOption('#touchmode', 'off');
  await p.waitForFunction(() => !document.documentElement.hasAttribute('data-touch'));
  await p.evaluate(() => window.__ff.panelAction(16));
  await p.waitForFunction(() => window.__ff.optionsOpen());
  await p.selectOption('#touchmode', 'on');
  await p.waitForFunction(() => !window.__ff.optionsOpen());
  expect(true, 'switching to touch closes the canvas options face behind it');

  // ── The room is centred on the SCREEN, always ──────────────────────────────────
  // When the bar reserved its space (a margin on `.stage`), "centred" meant centred in
  // [barWidth, viewport] until #126 added flex spacers to clamp it back. The buttons float
  // now, so the stage IS the viewport and the room is centred on it, whatever the buttons
  // do — they change EDGE when they would cover the room (`touchBarEdgeFor`), and the room
  // is never moved off them (Martin, 2026-09-29: "do not try to move the room off the
  // center anymore"). Asserted on both axes, in both orientations, at viewports where the
  // room has slack to spare and where it fills an axis.
  //
  // Runs after the dev-bar checks on this page, because it needs the dev chrome
  // GONE: `#devbar` and `#info` are in-flow siblings of `.stage`, so while they
  // are up the stage is not the viewport and the vertical half of this cannot be measured
  // against `innerHeight` at all. Ctrl+Alt+D is the only door out of dev mode (main.ts),
  // and it takes the dev bar this file's previous section drives with it — hence this order,
  // rather than paying another boot to say the same thing.
  await enter(p, ROOM);
  await settle(p, true);
  await p.keyboard.press('Control+Alt+D');
  await p.waitForFunction(() => !document.body.classList.contains('dev'));
  const player = p;

  /**
   * The edge the model picks for the room and viewport on screen now, waited for; then the
   * room centred on both axes and wholly on screen. Returns the edge and the room's rect.
   */
  const centredWithPredictedEdge = async (label) => {
    const g = await player.evaluate(() => {
      const r = window.__ff.roomGeom();
      return { w: r.nativeW, h: r.nativeH, vw: window.innerWidth, vh: window.innerHeight };
    });
    const want = touchBarEdgeFor(g.w, g.h, g.vw, g.vh, 'fill');
    await settleEdge(player, want);
    const r = await roomCentre(player);
    expect(
      Math.abs(r.dx) <= 1 && Math.abs(r.dy) <= 1,
      `${label}: the room's centre is the screen's (off by ${r.dx},${r.dy}px of ${r.viewW}x${r.viewH}; buttons ${want})`,
    );
    expect(
      r.left >= 0 && r.top >= 0 && r.right <= r.viewW && r.bottom <= r.viewH,
      `${label}: and the whole room is on screen (${r.left},${r.top}..${r.right},${r.bottom} of ${r.viewW}x${r.viewH})`,
    );
    // Never half on the room ("better have buttons fully covered than covered partially"):
    // the bar ends before the room starts, or starts where the room does or further in.
    const [near, barNear, barFar] = want === 'left'
      ? [r.left, r.barLeft, r.barRight]
      : [r.top, r.barTop, r.barBottom];
    expect(
      barFar <= near + 1 || barNear >= near - 1,
      `${label}: the buttons are wholly beside the room or wholly on it, never across its edge (room from ${near}, bar ${barNear}..${barFar})`,
    );
    return { want, r };
  };

  // 900x800: KOSTE fills the height and leaves 13.5px each side, so neither edge's buttons
  // fit beside it and either would cover its whole footprint — 61px on the left, 54px on
  // top. The shallower strip wins: they move to the top. First, because dropping the dev chrome resizes
  // nothing on its own and `settleRoom` needs a viewport that actually moves.
  await settleRoom(player, 900, 800);
  const tight = await centredWithPredictedEdge('landscape tight');
  expect(tight.want === 'top', `landscape tight: the buttons swap to the edge that covers less (${tight.want})`);

  // Slack on both sides, more than a bar each: the usual left edge, nothing covered.
  await settleRoom(player, 1100, 620);
  const wide = await centredWithPredictedEdge('landscape');
  expect(
    wide.want === 'left' && wide.r.left >= wide.r.barRight,
    `landscape: the usual left edge, clear of the room (room left ${wide.r.left}, bar right ${wide.r.barRight})`,
  );

  await settleRoom(player, 393, 852);
  const tall = await centredWithPredictedEdge('portrait');
  expect(tall.want === 'top', `portrait: an ordinary room keeps the top (${tall.want})`);

  // 320x360: 33.5px above and below against 54px buttons, and no width to spare at all —
  // covered either way, less on the top. The room stays put and the buttons move down
  // onto it, rather than sitting across its top edge.
  await settleRoom(player, 320, 360);
  const squat = await centredWithPredictedEdge('portrait tight');
  expect(
    squat.want === 'top' && squat.r.barTop > 0 && squat.r.barTop >= squat.r.top - 1,
    `portrait tight: the buttons move in onto the room (room top ${squat.r.top}, bar top ${squat.r.barTop})`,
  );

  // ── The third combination: which EDGE the buttons take in LANDSCAPE, per room ──
  //
  // At ONE landscape viewport, a room much wider than the screen puts the buttons along
  // the top and an ordinary room leaves them down the left. Asserted as a pair at a single
  // size, because that IS the claim — the edge tracks the room, and CSS cannot see which
  // room is loaded (`src/app/touchBarEdge.ts`).
  //
  // 1100x620 is 1.77:1. KOSTE 540x495 is 1.09:1, flatter than the screen, so it is
  // height-bound and leaves its slack at the sides. UTES 780x225 is 3.47:1, wider than the
  // screen, so it is width-bound and leaves its slack above and below.
  await settleRoom(player, 1100, 620);
  await settleEdge(player, 'left');
  const flatBar = await barState(player);
  expect(
    flatBar.bar !== null && flatBar.bar.left === 0 && flatBar.bar.h === flatBar.viewH,
    `landscape, ordinary room: the buttons stay down the left (${flatBar.bar?.left},${flatBar.bar?.top} ${flatBar.bar?.w}x${flatBar.bar?.h})`,
  );
  const flatRoom = await roomCentre(player);
  expect(
    flatRoom.left >= flatRoom.barRight,
    `landscape, ordinary room: and they land in the room's side slack, not on it (room left ${flatRoom.left}, bar right ${flatRoom.barRight})`,
  );

  await enter(player, 7); // UTES, the widest room in the game
  await settleEdge(player, 'top');
  const wideBar = await barState(player);
  expect(wideBar.visualButtons === '14,12,13,15,16,24',
    'landscape top bar: Restart is fourth and Undo is last');
  expect(
    wideBar.bar !== null && wideBar.bar.top === 0 && wideBar.bar.w === wideBar.viewW,
    `landscape, very wide room: the SAME viewport puts the buttons on top (${wideBar.bar?.left},${wideBar.bar?.top} ${wideBar.bar?.w}x${wideBar.bar?.h})`,
  );
  const wideRoom = (await centredWithPredictedEdge('landscape top bar')).r;
  expect(
    wideRoom.top >= wideRoom.barBottom,
    `landscape top bar: and the buttons land in the room's top slack, not on it (room top ${wideRoom.top}, bar bottom ${wideRoom.barBottom})`,
  );

  // And back, without the viewport moving at all: a room change alone moves the buttons,
  // which is the whole reason this cannot live in `relayout()` (a room change never
  // reaches it).
  await enter(player, 6);
  await settleEdge(player, 'left');
  const backBar = await barState(player);
  expect(
    backBar.bar !== null && backBar.bar.left === 0 && backBar.bar.h === backBar.viewH,
    `landscape: leaving the wide room puts the buttons back on the left (${backBar.bar?.left},${backBar.bar?.top} ${backBar.bar?.w}x${backBar.bar?.h})`,
  );

  // ── A cut room never wins, however much of it survives the cut ──
  //
  // 669x280 with ZRC (555x225), found by Martin 2026-08-31. It USED to be short enough that
  // MIN_STAGE_SCALE's floor overflowed the height once the top bar had taken its share, so
  // the room was drawn 266px tall into 214px and 52px of the level was not on screen.
  // `layout.ts`'s rework bounds the content by its area, and the buttons no longer take
  // any, so nothing can be cut here — asserted, because that is what the case is for.
  //
  // Which edge it gets changed with the floating buttons: ZRC fills the width exactly and
  // leaves 4.5px above and below, so neither edge's buttons fit beside it. The top's 54px
  // strip is shallower than the left's 61, so they go on top — moved in the 4.5px to start
  // on the room (Martin 2026-09-29).
  await enter(player, 9);
  await settleEdge(player, 'top'); // roomy window: the top edge covers nothing
  await settleRoom(player, 669, 280);
  const cut = await centredWithPredictedEdge('short viewport');
  expect(cut.want === 'top', `short viewport: the buttons take the shallower cover (${cut.want})`);

  // Hint checks enter tutorial rooms and save games; keep them after every original
  // assertion so the boot map, options and save/load checks retain their own setup.
  await p.setViewportSize({ width: 1100, height: 620 });
  await p.keyboard.press('Control+Alt+D');
  await p.waitForFunction(() => document.body.classList.contains('dev'));
  await p.evaluate(() => window.__ff.setLang('en')); // A forced Czech restore must fail.
  await checkDialogueHints(p, expect);
} catch (e) {
  ok = false;
  console.log('  FAIL threw: ' + (e?.message ?? e));
} finally {
  await browser.close().catch(() => {});
}

console.log(ok ? 'PASS' : 'FAIL');
exitProbe(ok ? 0 : 1);
