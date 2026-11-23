/**
 * Where the render path gets its off-screen scratch canvases from.
 *
 * The `ai` tier builds a handful of canvases nobody ever sees: the ×S classic-sprite
 * fallback for art with no AI file, the spec=1 mirror's glass mask, LODE's mutable wreck
 * background, and the canvas-2D target's composite caches. In the browser that is
 * `document.createElement('canvas')`, and it stays exactly that unless something says
 * otherwise. A host without a DOM (native/, which runs these modules in QuickJS) injects
 * its own canvas instead, so the same compositor runs there unchanged.
 *
 * The type stays `HTMLCanvasElement` on purpose: every call site keeps the code it had,
 * and an injected canvas has to behave like one for the 2D operations those call sites
 * use. Anything it does not implement throws, which is the loud failure that is wanted.
 *
 * Nothing here runs at import: the factory is a variable a host sets at boot.
 */
export type ScratchCanvasFactory = () => HTMLCanvasElement;

let factory: ScratchCanvasFactory | null = null;

/** Replace the DOM canvas with a host's own (native/js/main.ts). `null` restores the DOM. */
export function setScratchCanvasFactory(f: ScratchCanvasFactory | null): void {
  factory = f;
}

/**
 * Can a scratch canvas be made at all? False only with neither a DOM nor an injected
 * factory — the unit tests, which drive these modules with recording contexts.
 */
export function scratchCanvasAvailable(): boolean {
  return factory !== null || typeof document !== 'undefined';
}

/** A new 300×150 scratch canvas, sized by the caller as `createElement` would be. */
export function createScratchCanvas(): HTMLCanvasElement {
  return factory ? factory() : document.createElement('canvas');
}
