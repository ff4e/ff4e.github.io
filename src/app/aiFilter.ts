/**
 * The AI tier's colour filter, and the dev-bar tuning that feeds it.
 *
 * ── What this is ──────────────────────────────────────────────────────────────
 * A `filter: contrast() saturate() brightness()` over the game's canvases, applied ONLY
 * while the AI-upscaled art tier is the selected one. It is a display-time look control:
 * it costs no assets and no art pipeline, and it changes nothing the game simulates.
 *
 * ── What it is NOT, because this was measured and the assumption was wrong ────
 * It is not a correction for a washed-out upscale. The tier was assumed to have flattened
 * contrast and lost saturation against the 1998 original; rendering the same eight rooms
 * on all three tiers through the CPU compositor and comparing says the opposite. Mean
 * luminance spread: classic 50.8, enhanced 50.1, ai **53.2** — the AI tier has MORE
 * contrast, not less. Mean chroma: classic 0.757, enhanced 0.739, ai 0.744 — the same
 * within a couple of percent. Fitting a correction onto classic asks for
 * `contrast(0.955)`, i.e. to take contrast AWAY.
 *
 * The AI tier does read a little darker (mean 73.6 against 76.6), and that is a black
 * point, not a flattening: its 1st percentile sits at ~1 where classic's is at ~11, so
 * the upscale reaches a true black the palette art never did.
 *
 * So this knob exists to make the art deliberately richer than the original, which is a
 * taste decision, not to repair a defect. Anything shipped through it is an ADDITIVE
 * change to the AI tier's look and should be argued as one.
 *
 * ── Why the numbers live in CSS custom properties ─────────────────────────────
 * The stylesheet owns the `filter:` declaration and reads three variables from it; this
 * module only ever writes the variables. That is what lets the dev bar retune the game
 * live — dragging a slider sets a property and the next composite picks it up — while
 * the eventual SHIPPED default stays one place in the stylesheet, not a value smeared
 * across a stylesheet and a setter. Nothing here rewrites a `filter:` string at runtime.
 *
 * ── Why an attribute gates it as well as the tier ─────────────────────────────
 * `filter` is not free even when its arithmetic is: it makes the canvas its own stacking
 * context and pushes it onto the compositor's filter path for every one of the ~60 frames
 * a second the room is repainting. So the stylesheet requires `data-ai-filter` as well as
 * `data-graphics='ai'`, and this module sets it only while a value differs from IDENTITY.
 *
 * With a real grade now shipping (`AI_FILTER_DEFAULT`) that attribute is normally present,
 * so the AI tier does pay that compositing cost — which is the honest price of the look,
 * not something hidden. What the attribute still buys is the other direction: a dev who
 * drags all three sliders back to 1 gets no `filter` property at all rather than an empty
 * one, so "off" in the tuning tool is genuinely off and is a fair baseline to compare
 * against.
 *
 * The stylesheet's `:root` carries the same three numbers as `AI_FILTER_DEFAULT`. That is
 * deliberate duplication: it means the shipped look is already correct on the first paint,
 * before this module has run, so boot cannot flash an ungraded frame. `test/aiFilter.test.ts`
 * fails if the two ever drift apart.
 *
 * ── Scope, as decided ─────────────────────────────────────────────────────────
 * The gate is the SETTING (`graphics === 'ai'`, reflected onto `<html>` by
 * `renderSettings.ts`), not the per-frame `aiRoomRenderActive()`. Those two differ: a
 * room using the ZX band effect, an active fishing hook, a CPU-only frame effect, a
 * sprite cheat or an unloaded subtitle font each make one frame fall back to the
 * CPU-drawn `#screen` while the setting is still `'ai'`, and such a frame gets the
 * filter too. That was chosen deliberately — the unit a player picks is the tier, the
 * excluded cases are brief, and following the frame gate would mean writing a class
 * every frame with change-detection for a difference nobody is likely to see.
 */



/** The three tunable channels, in the order the stylesheet composes them. */
export const AI_FILTER_KEYS = ['contrast', 'saturate', 'brightness'] as const;

export type AiFilterKey = (typeof AI_FILTER_KEYS)[number];

export type AiFilterValues = Record<AiFilterKey, number>;

/**
 * The slider bounds, which are also the CLAMP applied to anything read back from
 * storage. The lower bounds are deliberately above 0: `brightness(0)` is a black screen
 * and `contrast(0)` a flat grey one, and a persisted key is a thing a player can edit by
 * hand or carry across a version. A dev tool that can permanently blank the game on next
 * boot is a trap, so the range cannot express it.
 */
export const AI_FILTER_RANGES: Readonly<Record<AiFilterKey, { min: number; max: number; step: number }>> = {
  contrast: { min: 0.5, max: 2, step: 0.01 },
  saturate: { min: 0, max: 2, step: 0.01 },
  brightness: { min: 0.5, max: 1.5, step: 0.01 },
};

/** Every channel's no-op value. `filter: contrast(1) saturate(1) brightness(1)` is identity. */
export const AI_FILTER_NEUTRAL: AiFilterValues = { contrast: 1, saturate: 1, brightness: 1 };

/**
 * What the game SHIPS with on the AI tier — the tuned look, chosen 2026-09-03.
 *
 * Distinct from `AI_FILTER_NEUTRAL`, and the two are not interchangeable: neutral is what
 * "the filter does nothing" means and is still what a dev drags to when comparing, while
 * this is the default a player gets. Anything stored in `ff.aiFilter` is a deviation from
 * THIS, not from identity.
 *
 * Measured rather than picked by eye. Across eight rooms it lifts luminance spread 53.2 ->
 * 56.4 and mean chroma 0.744 -> 0.786 while losing no shadow detail and touching ~1% of
 * highlights. Saturation stops above ~1.12 — the art is already highly saturated, so a
 * higher value only clips channels — and contrast is limited by the pale stone and coral
 * blowing out, not by the shadows, because the upscale's black point is already true.
 */
export const AI_FILTER_DEFAULT: AiFilterValues = { contrast: 1.06, saturate: 1.12, brightness: 1.03 };

/** The one persisted key. Read only after `migrateSaves()`, like every other `ff.*` (see persist.ts). */
const STORAGE_KEY = 'ff.aiFilter';

let values: AiFilterValues = { ...AI_FILTER_DEFAULT };

/**
 * Whether the AI tier is the selected one. Pushed in by `renderSettings.ts` rather than
 * imported from it, and that is deliberate: reading `graphics` here would put these two
 * modules in an import cycle for one boolean. It is also what makes the sliders follow
 * EVERY way the tier can change — the dev-bar combobox, the `E` hotkey and the
 * `__ff.setGraphics` test hook all go through `setGraphics()`, and only one of them goes
 * through the dev bar.
 */
let onAiTier = false;

/**
 * The dev-bar controls, handed over by `devBar.ts` at wiring time.
 *
 * Registered rather than imported from `dom.ts`, so this module touches no DOM it was not
 * given. That is what keeps it unit-testable: `dom.ts` reaches for `#screen` at module
 * scope and throws outside a browser, while the parts worth pinning here — the clamp that
 * stops a persisted value blanking the screen, and what counts as "tuned" — are pure.
 */
interface AiFilterControls {
  readonly inputs: Partial<Record<AiFilterKey, HTMLInputElement | null>>;
  readonly out: HTMLOutputElement | null;
  readonly reset: HTMLButtonElement | null;
}

let controls: AiFilterControls = { inputs: {}, out: null, reset: null };

/** Hand the tuning tool its controls, then draw them. Called once, from `initDevBar()`. */
export function registerAiFilterControls(c: AiFilterControls): void {
  controls = c;
  syncAiFilterControls();
}

/**
 * Put the dev-bar controls back in step: slider positions, the readout, and whether the
 * group is live at all.
 *
 * The positions matter at boot as much as after a drag — `initAiFilter()` restores the
 * filter itself, but the `value="1"` in the markup would otherwise still read 1 beside a
 * visibly tinted room.
 *
 * Disabled off the AI tier because the filter is scoped to it. Left live, the sliders
 * would drag, persist and show nothing, which reads as a broken control rather than an
 * inapplicable one.
 */
export function syncAiFilterControls(): void {
  for (const key of AI_FILTER_KEYS) {
    const el = controls.inputs[key];
    if (!el) continue;
    el.value = String(values[key]);
    el.disabled = !onAiTier;
  }
  if (controls.reset) controls.reset.disabled = !onAiTier;
  if (controls.out) controls.out.value = AI_FILTER_KEYS.map((k) => values[k].toFixed(2)).join(' / ');
}

/** Tell the tuning tool which tier is selected. Called by `renderSettings.ts` on every write of it. */
export function setAiFilterTier(isAi: boolean): void {
  onAiTier = isAi;
  syncAiFilterControls();
}

/**
 * Coerce one channel to a usable number: finite, and inside its slider range.
 *
 * Anything unusable becomes the neutral value rather than throwing, because the caller
 * is either a `<input type=range>` (which can produce `''` mid-edit) or JSON out of
 * localStorage (which can be anything at all).
 */
export function clampAiFilter(key: AiFilterKey, raw: unknown): number {
  // An empty string is not zero here. `Number('')` is 0, which is finite and would clamp
  // to the bottom of the range — so a range input momentarily reporting '' (or a hand-
  // edited storage key with an empty field) would darken the game rather than do nothing.
  if (typeof raw === 'string' && raw.trim() === '') return AI_FILTER_NEUTRAL[key];
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return AI_FILTER_NEUTRAL[key];
  const { min, max } = AI_FILTER_RANGES[key];
  return Math.min(max, Math.max(min, n));
}

/**
 * Parse a persisted blob into a complete, clamped set.
 *
 * Missing, malformed or absent storage falls back to the SHIPPED DEFAULT, not to identity
 * — the key records a deviation from the default look, so "nothing stored" has to mean
 * "the default look", and a blob naming one channel must leave the other two alone. Only
 * a channel that IS present is taken from storage, and then only through the clamp.
 */
export function parseAiFilter(raw: string | null): AiFilterValues {
  if (!raw) return { ...AI_FILTER_DEFAULT };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ...AI_FILTER_DEFAULT };
  }
  if (typeof obj !== 'object' || obj === null) return { ...AI_FILTER_DEFAULT };
  const rec = obj as Record<string, unknown>;
  const out = { ...AI_FILTER_DEFAULT };
  for (const k of AI_FILTER_KEYS) if (k in rec) out[k] = clampAiFilter(k, rec[k]);
  return out;
}

/**
 * Is any channel away from IDENTITY? This is what decides whether the filter is declared
 * at all — not whether it differs from the shipped default. Normally true, since the
 * default is a real grade; false only when a dev drags all three back to 1 to compare,
 * and then the canvases come off the compositor's filter path entirely rather than
 * running an arithmetically-empty filter.
 */
export function aiFilterActive(v: AiFilterValues = values): boolean {
  return AI_FILTER_KEYS.some((k) => v[k] !== AI_FILTER_NEUTRAL[k]);
}

/** The current tuning. The dev bar reads this to seed its sliders. */
export function aiFilterValues(): AiFilterValues {
  return { ...values };
}

/**
 * Push the current tuning at the document: three custom properties, plus the attribute
 * the stylesheet requires before it will declare `filter` at all.
 */
function apply(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const k of AI_FILTER_KEYS) root.style.setProperty(`--ai-${k}`, String(values[k]));
  root.toggleAttribute('data-ai-filter', aiFilterActive());
  syncAiFilterControls();
}

/**
 * Load the persisted tuning and apply it. Called once from `main.ts` during boot, AFTER
 * the save store is open — the same rule that governs `initRenderSettings()` beside it.
 */
export function initAiFilter(): void {
  values = parseAiFilter(typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY));
  apply();
}

/**
 * Retune one channel: clamp, apply, persist. The dev-bar sliders call this on every
 * `input` event, so it runs while a drag is in flight and must stay cheap — it is three
 * property writes and one `setItem`, with no repaint requested. None is needed: the
 * filter is applied by the compositor to whatever the canvas already holds, so an idle
 * room re-tints without the game drawing a frame.
 */
export function setAiFilter(key: AiFilterKey, raw: unknown): number {
  values[key] = clampAiFilter(key, raw);
  apply();
  persist();
  return values[key];
}

/**
 * Back to the SHIPPED default, and forget the stored deviation.
 *
 * Not to identity: the button's job is "undo my tuning", and what a player sees is the
 * default. Identity is still one drag away on the three sliders, which is how a dev
 * compares against no filter at all.
 */
export function resetAiFilter(): AiFilterValues {
  values = { ...AI_FILTER_DEFAULT };
  apply();
  persist();
  return { ...values };
}

function persist(): void {
  if (typeof localStorage === 'undefined') return;
  // Storing the default writes nothing. The key means "this dev moved it", so a dev who
  // tries the sliders and resets is left with the storage they started on — and, more
  // importantly, nobody is pinned to today's numbers: if the shipped default is ever
  // retuned, only the machines that actually chose something keep their own value.
  if (AI_FILTER_KEYS.every((k) => values[k] === AI_FILTER_DEFAULT[k])) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
}
