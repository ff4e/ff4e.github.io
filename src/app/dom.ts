/**
 * The DOM the app draws into: the element handles and their 2D contexts.
 *
 * These are the most-read declarations in `main.ts` — most of its regions touch one —
 * and nothing writes them, because they are all `const`. That combination is what makes
 * this the one seam in that file with no cost at all: importers get a read-only view and
 * no setter has to be exported.
 *
 * ── The one thing to be careful about ─────────────────────────────────────────
 * `main.ts` sequences its own side effects deliberately, and an imported module is
 * evaluated before any of its importer's statements, so anything here that mutated the
 * document would jump ahead of that sequence. (It used to jump ahead of something
 * sharper still: `main.ts` refused to run on a phone before anything else happened. The
 * refusal is gone — see `deviceGate.ts` — but the ordering it enforced is still what
 * this file's shape is for.)
 *
 * So this module is split in two:
 *   - Everything at module scope is side-effect-free as far as the page is concerned:
 *     `getElementById` reads, and `createElement` for elements that stay DETACHED.
 *   - `buildStage()` does every document mutation — the inserts, the appends, the
 *     styles — and `main.ts` calls it at exactly the point that code used to run.
 * Keep that division. Moving one `appendChild` up here would be silent and wrong.
 */

export const canvas = document.getElementById('screen') as HTMLCanvasElement;
export const ctx = canvas.getContext('2d')!;
// WebGL present surface (P3): a canvas stacked exactly over #screen, shown only
// while the WebGL backend is active (renderer==='webgl'). #screen stays the
// layout anchor; this overlay covers it when the GPU presents. Created here so
// the GlScreen can bind its context lazily on first use.
export const glCanvas = document.createElement('canvas');
glCanvas.id = 'screen-gl';
// The stage box (sized by relayout): rooms/map/cutscene are centered inside it and
// letterboxed vertically. Its WIDTH hugs the content so the side panel sits beside the
// room rather than beside the box's empty slack; `stage.stageW` is its max-width.
export const stageBox = document.createElement('div');
stageBox.id = 'stagebox';
export const wrap = document.createElement('div');
/**
 * The help pages (helpDom.ts). A document stacked over #screen while help is open.
 *
 * It takes NO pointer events, deliberately: a click anywhere on the help advances to the
 * next page (Help.pas:Image1Click) and that listener is on #screen underneath, so the page
 * must not be in the way of it. Same reason the GL overlay above is transparent to clicks.
 */
export const helpPageEl = document.createElement('div');
helpPageEl.id = 'help-page';
helpPageEl.hidden = true;
helpPageEl.setAttribute('role', 'document');
/**
 * Close button for the help overlay, top-left of the help page.
 *
 * Help.pas closes on any key or a right-click and shows no button; this is a deliberate
 * addition, because neither of those is discoverable and the control panel — which is
 * where a player would look — is deliberately hidden while help is up (see drawPanel).
 * It lives in `wrap` so it is positioned against the help canvas rather than the stage
 * box, which now hugs its content.
 */
export const helpClose = document.createElement('button');
helpClose.id = 'help-close';
helpClose.type = 'button';
helpClose.textContent = '✕';
helpClose.hidden = true;
helpClose.setAttribute('aria-label', 'Close help');

export const panelCanvas = document.getElementById('panel') as HTMLCanvasElement;
export const panelCtx = panelCanvas.getContext('2d')!;
// The panel's column wrapper (the canvas plus the feedback strip that hangs under the
// Options face). This is what floats over the map, so the strip travels with it.
export const panelCol = document.getElementById('panelcol') as HTMLElement;
export const feedbar = document.getElementById('feedbar') as HTMLElement | null;
export const select = document.getElementById('room') as HTMLSelectElement;
export const fitSelect = document.getElementById('fitmode') as HTMLSelectElement | null;
export const touchSelect = document.getElementById('touchmode') as HTMLSelectElement | null;
export const rendererSelect = document.getElementById('renderer') as HTMLSelectElement | null;
export const graphicsSelect = document.getElementById('graphics') as HTMLSelectElement | null;
export const idleDirtyToggle = document.getElementById('idledirty') as HTMLInputElement | null;
export const solveRoomBtn = document.getElementById('solveroom') as HTMLButtonElement | null;
export const solveSpeedSelect = document.getElementById('solvespeed') as HTMLSelectElement | null;
// The AI-tier colour tuning (src/app/aiFilter.ts): three sliders, their readout and a
// reset. Nullable like every other dev-bar handle — the bar is chrome, and a page that
// omits it must still boot.
export const aiFilterGroup = document.getElementById('aifilter') as HTMLElement | null;
export const aiFilterOut = document.getElementById('ai-filter-out') as HTMLOutputElement | null;
export const aiFilterReset = document.getElementById('ai-filter-reset') as HTMLButtonElement | null;
export const aiContrastInput = document.getElementById('ai-contrast') as HTMLInputElement | null;
export const aiSaturateInput = document.getElementById('ai-saturate') as HTMLInputElement | null;
export const aiBrightnessInput = document.getElementById('ai-brightness') as HTMLInputElement | null;
export const perfHud = document.getElementById('perfhud') as HTMLElement | null;
export const info = document.getElementById('info') as HTMLDivElement;
export const stageRow = document.querySelector('.stage') as HTMLElement;

// ── Public-release boot UX: loading indicator, fatal-error screen, and a
// software-renderer note. The loading overlay is present in the HTML (shown before
// this deferred module runs), so the player never sees a blank page while assets
// fetch; the app hides it once boot completes.
export const loadingEl = document.getElementById('loading') as HTMLElement | null;
export const loadingMsg = document.getElementById('loading-msg') as HTMLElement | null;
export const fatalEl = document.getElementById('fatal') as HTMLElement | null;

/**
 * Assemble the stage: nest #screen and its two overlays inside the stage box.
 *
 * Called from `main.ts` at the point this code used to sit — before anything that
 * measures or draws. Not done at module scope on purpose; see
 * the header.
 */
export function buildStage(): void {
  wrap.style.position = 'relative';
  wrap.style.display = 'inline-block';
  wrap.style.lineHeight = '0';
  // Insert the stage box where #screen sat (inside .stage), then nest the wrap
  // (which holds #screen + the GL/subtitle overlays) centered within it.
  canvas.parentNode!.insertBefore(stageBox, canvas);
  stageBox.appendChild(wrap);
  wrap.appendChild(canvas);
  // GL present canvas: absolute over #screen, below the subtitle overlay. It is
  // purely a display surface — the mouse listeners live on #screen underneath, so
  // it must not intercept pointer events (else clicking a fish does nothing in
  // WebGL mode). The subtitle overlay above is transparent to clicks for the same
  // reason.
  glCanvas.style.position = 'absolute';
  glCanvas.style.left = '0';
  glCanvas.style.top = '0';
  glCanvas.style.border = '1px solid transparent';
  glCanvas.style.display = 'none';
  glCanvas.style.pointerEvents = 'none';
  wrap.appendChild(glCanvas);
  // The help document, over both canvases and under the close button. Pointer-transparent
  // (see its declaration) so the paging listener on #screen still sees every click.
  wrap.appendChild(helpPageEl);
  // Above both canvases, and the one overlay in here that DOES take clicks — the
  // mousedown listener that pages through help lives on #screen underneath, so a click
  // that lands on this button never reaches it.
  wrap.appendChild(helpClose);
}
