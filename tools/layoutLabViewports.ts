/**
 * Viewport presets for `tools/layout-lab.html` — DEV ONLY.
 *
 * Three sources, and the mix is deliberate:
 *
 *  - **Playwright's device registry**, every `hasTouch` entry, **paired by device rather
 *    than flattened by size**. Both orientations of a device are one row here, because the
 *    two are the same physical thing and the layout answer differs completely between them
 *    — in landscape height is the scarce axis and a left strip is nearly free, in portrait
 *    the opposite. A flat list sorted by area put a phone's two orientations dozens of
 *    entries apart and made them look like two devices, which is exactly the confusion this
 *    structure removes. The lab's orientation switch reads `port`/`land` off one row.
 *  - **Desktop windows**, including the two Martin was resizing when he found the defects
 *    this task exists for. They are marked so they cannot be lost in the list.
 *  - **Extremes**, to make a rule's failure mode visible rather than theoretical.
 *
 * Playwright's phone viewports are already the area the PAGE gets (iPhone 15 landscape is
 * 734x343, not the 852x393 screen); its tablet entries are full-screen, which is why the
 * lab offers a browser-chrome subtraction on top.
 *
 * Generated from `playwright`'s `devices` export; regenerate with the snippet in
 * PROGRESS.md if the dependency is updated.
 */
export type LabOrientation = 'portrait' | 'landscape';

export interface LabSize {
  w: number;
  h: number;
}

export interface LabDevice {
  name: string;
  klass: 'phone' | 'tablet' | 'foldable' | 'desktop' | 'tv' | 'probe';
  /** Either may be null — a couple of registry entries only exist one way up. */
  port: LabSize | null;
  land: LabSize | null;
  /** A viewport a real defect was found at — kept at the top of the picker. */
  note?: string;
}

/**
 * The two windows Martin found the current defects at, plus the sizes that bracket them.
 *
 * These are DESKTOP windows, not devices, so they have one shape rather than two: rotating
 * a window is just resizing it, and the lab's switch does that anyway.
 */
export const LAB_PROBE_VIEWPORTS: readonly LabDevice[] = [
  { name: 'defect: room sliced', klass: 'probe', port: null, land: { w: 669, h: 280 }, note: 'ZRC was drawn 266px tall into 214px of space — 52px off screen. Fixed; the lab now shows both models whole.' },
  { name: 'defect: reserve held', klass: 'probe', port: null, land: { w: 1491, h: 1114 }, note: 'BOTTLES held 21px off both edges; the same window at 1557 had none' },
  { name: 'the same, +30 wide', klass: 'probe', port: null, land: { w: 1521, h: 1114 }, note: 'the old reserve was 14px here' },
  { name: 'the same, +66 wide', klass: 'probe', port: null, land: { w: 1557, h: 1114 }, note: 'the old reserve had vanished entirely' },
  { name: 'monotonicity, narrow', klass: 'probe', port: null, land: { w: 301, h: 300 }, note: 'widening to 456 used to SHRINK VRAK by 1.59%' },
  { name: 'monotonicity, wide', klass: 'probe', port: null, land: { w: 456, h: 300 }, note: 'the wider window that used to hold the smaller room' },
];

export const LAB_DESKTOP_VIEWPORTS: readonly LabDevice[] = [
  { name: 'laptop 16:10', klass: 'desktop', port: null, land: { w: 1280, h: 800 } },
  { name: 'MacBook Pro 14', klass: 'desktop', port: null, land: { w: 1512, h: 860 } },
  { name: 'window 1600', klass: 'desktop', port: null, land: { w: 1600, h: 1017 } },
  { name: '1080p maximised', klass: 'desktop', port: null, land: { w: 1920, h: 1030 } },
  { name: 'window 2048', klass: 'desktop', port: null, land: { w: 2048, h: 1017 } },
  { name: '1440p maximised', klass: 'desktop', port: null, land: { w: 2560, h: 1380 } },
  { name: 'ultrawide', klass: 'desktop', port: null, land: { w: 3440, h: 1400 } },
  { name: 'the stage box itself', klass: 'desktop', port: null, land: { w: 800, h: 600 } },
  { name: 'tiny window', klass: 'desktop', port: null, land: { w: 640, h: 480 } },
  { name: 'tall narrow window', klass: 'desktop', port: { w: 400, h: 900 }, land: null },
];

/**
 * TV. A fixed viewport that never resizes, which is the one property that makes this
 * target different in kind rather than in degree — and the one device class that is
 * landscape-only, so the orientation switch has nothing to offer it.
 */
export const LAB_TV_VIEWPORTS: readonly LabDevice[] = [
  { name: '720p', klass: 'tv', port: null, land: { w: 1280, h: 720 } },
  { name: '1080p', klass: 'tv', port: null, land: { w: 1920, h: 1080 } },
];

/** Every touch device Playwright knows, both ways up, one row each. */
export const LAB_DEVICES: readonly LabDevice[] = [
  { name: "Galaxy Z Flip 6", klass: "foldable", port: { w: 360, h: 804 }, land: { w: 828, h: 308 } },
  { name: "Galaxy Z Flip 6 Cover", klass: "foldable", port: null, land: { w: 322, h: 308 } },
  { name: "Galaxy Z Flip 7 Cover", klass: "foldable", port: null, land: { w: 472, h: 422 } },
  { name: "Galaxy Z Fold 6", klass: "foldable", port: { w: 928, h: 1004 }, land: { w: 1028, h: 876 } },
  { name: "Galaxy Z Fold 6 Cover", klass: "foldable", port: { w: 484, h: 1112 }, land: { w: 1136, h: 432 } },
  { name: "Galaxy Z Fold 7", klass: "foldable", port: { w: 984, h: 1016 }, land: { w: 1040, h: 932 } },
  { name: "Galaxy Z Fold 7 Cover, Galaxy Z Flip 7", klass: "foldable", port: { w: 360, h: 764 }, land: { w: 788, h: 308 } },
  { name: "Blackberry PlayBook", klass: "phone", port: { w: 600, h: 1024 }, land: { w: 1024, h: 600 } },
  { name: "BlackBerry Z30, Galaxy Note 3", klass: "phone", port: { w: 360, h: 640 }, land: { w: 640, h: 360 } },
  { name: "Galaxy A55", klass: "phone", port: { w: 480, h: 1040 }, land: { w: 1040, h: 480 } },
  { name: "Galaxy S24", klass: "phone", port: { w: 360, h: 780 }, land: { w: 780, h: 360 } },
  { name: "Galaxy S8", klass: "phone", port: { w: 360, h: 740 }, land: { w: 740, h: 360 } },
  { name: "Galaxy S9+", klass: "phone", port: { w: 320, h: 658 }, land: { w: 658, h: 320 } },
  { name: "iPhone 11", klass: "phone", port: { w: 414, h: 715 }, land: { w: 800, h: 364 } },
  { name: "iPhone 11 Pro", klass: "phone", port: { w: 375, h: 635 }, land: { w: 724, h: 325 } },
  { name: "iPhone 11 Pro Max", klass: "phone", port: { w: 414, h: 715 }, land: { w: 808, h: 364 } },
  { name: "iPhone 12, iPhone 12 Pro", klass: "phone", port: { w: 390, h: 664 }, land: { w: 750, h: 340 } },
  { name: "iPhone 12 Mini", klass: "phone", port: { w: 375, h: 629 }, land: { w: 712, h: 325 } },
  { name: "iPhone 12 Pro Max, iPhone 14 Plus", klass: "phone", port: { w: 428, h: 746 }, land: { w: 832, h: 378 } },
  { name: "iPhone 13, iPhone 13 Pro", klass: "phone", port: { w: 390, h: 664 }, land: { w: 750, h: 342 } },
  { name: "iPhone 13 Mini", klass: "phone", port: { w: 375, h: 629 }, land: { w: 712, h: 327 } },
  { name: "iPhone 13 Pro Max", klass: "phone", port: { w: 428, h: 746 }, land: { w: 832, h: 380 } },
  { name: "iPhone 14 Pro", klass: "phone", port: { w: 393, h: 660 }, land: { w: 734, h: 343 } },
  { name: "iPhone 14 Pro Max", klass: "phone", port: { w: 430, h: 740 }, land: { w: 814, h: 380 } },
  { name: "iPhone 15, iPhone 15 Pro", klass: "phone", port: { w: 393, h: 659 }, land: { w: 734, h: 343 } },
  { name: "iPhone 15 Plus, iPhone 15 Pro Max", klass: "phone", port: { w: 430, h: 739 }, land: { w: 814, h: 380 } },
  { name: "iPhone 16 Pro, iPhone 17", klass: "phone", port: { w: 402, h: 681 }, land: { w: 756, h: 352 } },
  { name: "iPhone 16 Pro Max, iPhone 17 Pro Max", klass: "phone", port: { w: 440, h: 763 }, land: { w: 838, h: 390 } },
  { name: "iPhone 16e, iPhone 17e", klass: "phone", port: { w: 390, h: 651 }, land: { w: 726, h: 340 } },
  { name: "iPhone 6, iPhone 7", klass: "phone", port: { w: 375, h: 667 }, land: { w: 667, h: 375 } },
  { name: "iPhone 6 Plus, iPhone 7 Plus", klass: "phone", port: { w: 414, h: 736 }, land: { w: 736, h: 414 } },
  { name: "iPhone Air", klass: "phone", port: { w: 420, h: 719 }, land: { w: 794, h: 370 } },
  { name: "iPhone SE", klass: "phone", port: { w: 320, h: 568 }, land: { w: 568, h: 320 } },
  { name: "iPhone X", klass: "phone", port: { w: 375, h: 812 }, land: { w: 812, h: 375 } },
  { name: "iPhone XR", klass: "phone", port: { w: 414, h: 896 }, land: { w: 896, h: 414 } },
  { name: "LG Optimus L70, Nexus 4", klass: "phone", port: { w: 384, h: 640 }, land: { w: 640, h: 384 } },
  { name: "Nexus 5X, Nexus 6", klass: "phone", port: { w: 412, h: 732 }, land: { w: 732, h: 412 } },
  { name: "Nokia Lumia 520", klass: "phone", port: { w: 320, h: 533 }, land: { w: 533, h: 320 } },
  { name: "Nokia N9", klass: "phone", port: { w: 480, h: 854 }, land: { w: 854, h: 480 } },
  { name: "Pixel 2", klass: "phone", port: { w: 411, h: 731 }, land: { w: 731, h: 411 } },
  { name: "Pixel 2 XL", klass: "phone", port: { w: 411, h: 823 }, land: { w: 823, h: 411 } },
  { name: "Pixel 3", klass: "phone", port: { w: 393, h: 786 }, land: { w: 786, h: 393 } },
  { name: "Pixel 4", klass: "phone", port: { w: 353, h: 745 }, land: { w: 745, h: 353 } },
  { name: "Pixel 4a (5G)", klass: "phone", port: { w: 412, h: 765 }, land: { w: 840, h: 312 } },
  { name: "Pixel 5", klass: "phone", port: { w: 393, h: 727 }, land: { w: 802, h: 293 } },
  { name: "Pixel 6, Pixel 6a", klass: "phone", port: { w: 412, h: 839 }, land: { w: 863, h: 360 } },
  { name: "Pixel 6 Pro, Pixel 7 Pro", klass: "phone", port: { w: 412, h: 816 }, land: { w: 840, h: 360 } },
  { name: "Pixel 8 Pro, Pixel 9 Pro XL", klass: "phone", port: { w: 448, h: 921 }, land: { w: 945, h: 396 } },
  { name: "Pixel 9, Pixel 10", klass: "phone", port: { w: 360, h: 732 }, land: { w: 756, h: 308 } },
  { name: "Pixel 9 Pro, Pixel 10 Pro", klass: "phone", port: { w: 427, h: 876 }, land: { w: 900, h: 375 } },
  { name: "Galaxy Tab S4", klass: "tablet", port: { w: 712, h: 1138 }, land: { w: 1138, h: 712 } },
  { name: "Galaxy Tab S9", klass: "tablet", port: { w: 640, h: 1024 }, land: { w: 1024, h: 640 } },
  { name: "iPad (gen 11)", klass: "tablet", port: { w: 656, h: 944 }, land: { w: 944, h: 656 } },
  { name: "iPad (gen 5), iPad (gen 6)", klass: "tablet", port: { w: 768, h: 1024 }, land: { w: 1024, h: 768 } },
  { name: "iPad (gen 7)", klass: "tablet", port: { w: 810, h: 1080 }, land: { w: 1080, h: 810 } },
  { name: "iPad Pro 11", klass: "tablet", port: { w: 834, h: 1194 }, land: { w: 1194, h: 834 } },
  { name: "Kindle Fire HDX, Nexus 10", klass: "tablet", port: { w: 800, h: 1280 }, land: { w: 1280, h: 800 } },
  { name: "Nexus 7", klass: "tablet", port: { w: 600, h: 960 }, land: { w: 960, h: 600 } },
];

/** Everything the picker offers, probes first so a known defect is one click away. */
export const LAB_VIEWPORTS: readonly LabDevice[] = [
  ...LAB_PROBE_VIEWPORTS,
  ...LAB_DESKTOP_VIEWPORTS,
  ...LAB_TV_VIEWPORTS,
  ...LAB_DEVICES,
];

/** The size for one device the requested way up, falling back to the one it does have. */
export function sizeFor(d: LabDevice, orient: LabOrientation): LabSize {
  const want = orient === 'portrait' ? d.port : d.land;
  const other = orient === 'portrait' ? d.land : d.port;
  if (want) return want;
  // Rotating a device the registry only lists one way up is still a fair question to ask of
  // the layout — a window can be any shape — so the size is transposed rather than refused.
  return other ? { w: other.h, h: other.w } : { w: 800, h: 600 };
}
