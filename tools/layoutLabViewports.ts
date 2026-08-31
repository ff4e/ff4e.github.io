/**
 * Viewport presets for `tools/layout-lab.html` — DEV ONLY.
 *
 * Three sources, and the mix is deliberate:
 *
 *  - **Playwright's device registry**, every `hasTouch` entry, deduplicated by viewport
 *    size. This is the list `tools/measure-touchbar-edge.mjs` already sweeps, and it is
 *    used for the same reason: nine hand-picked sizes (seven of them Apple) flattered the
 *    top bar in rounds 1-2 of the touch-bar work, because iPads are 1.33-1.44 aspect where
 *    Android tablets are 1.60-1.82. Playwright's phone entries are already the area the
 *    PAGE gets, not the screen; its tablet entries are full-screen, so the lab offers a
 *    browser-chrome subtraction on top.
 *  - **Desktop windows**, including the two Martin was resizing when he found the defects
 *    this task exists for. They are marked so they cannot be lost in the list.
 *  - **Extremes**, to make a rule's failure mode visible rather than theoretical.
 *
 * Generated from `playwright`'s `devices` export; regenerate by re-running the snippet in
 * PROGRESS.md if the dependency is updated.
 */
export interface LabViewport {
  w: number;
  h: number;
  klass: 'phone' | 'tablet' | 'foldable' | 'desktop' | 'tv' | 'probe';
  name: string;
  /** A viewport a real defect was found at — kept at the top of the picker. */
  note?: string;
}

/** The two windows Martin found the current defects at, plus the sizes that bracket them. */
export const LAB_PROBE_VIEWPORTS: readonly LabViewport[] = [
  { w: 669, h: 280, klass: 'probe', name: 'defect: room sliced', note: 'ZRC drawn 266px tall into 214px of space — 52px off screen' },
  { w: 1491, h: 1114, klass: 'probe', name: "defect: reserve held", note: 'BOTTLES held 21px off both edges; the same window at 1557 has none' },
  { w: 1521, h: 1114, klass: 'probe', name: 'the same, +30 wide', note: 'the reserve is 14px here' },
  { w: 1557, h: 1114, klass: 'probe', name: 'the same, +66 wide', note: 'the reserve has vanished entirely' },
  { w: 301, h: 300, klass: 'probe', name: 'monotonicity, narrow', note: 'widening to 456 SHRINKS VRAK by 1.59%' },
  { w: 456, h: 300, klass: 'probe', name: 'monotonicity, wide', note: 'the wider window with the smaller room' },
];

export const LAB_DESKTOP_VIEWPORTS: readonly LabViewport[] = [
  { w: 1280, h: 800, klass: 'desktop', name: 'laptop 16:10' },
  { w: 1512, h: 860, klass: 'desktop', name: 'MacBook Pro 14' },
  { w: 1600, h: 1017, klass: 'desktop', name: 'window 1600' },
  { w: 1920, h: 1030, klass: 'desktop', name: '1080p maximised' },
  { w: 2048, h: 1017, klass: 'desktop', name: 'window 2048' },
  { w: 2560, h: 1380, klass: 'desktop', name: '1440p maximised' },
  { w: 3440, h: 1400, klass: 'desktop', name: 'ultrawide' },
  { w: 800, h: 600, klass: 'desktop', name: 'the stage box itself' },
  { w: 640, h: 480, klass: 'desktop', name: 'tiny window' },
  { w: 400, h: 900, klass: 'desktop', name: 'tall narrow window' },
];

/**
 * TV. A fixed viewport that never resizes, which is the one property that makes this
 * target different in kind rather than in degree. 1080p is the floor a living-room
 * browser reports; 4K panels still hand a page 1920x1080 CSS px at dpr 2.
 */
export const LAB_TV_VIEWPORTS: readonly LabViewport[] = [
  { w: 1280, h: 720, klass: 'tv', name: '720p' },
  { w: 1920, h: 1080, klass: 'tv', name: '1080p' },
];

/** Every landscape or portrait touch viewport Playwright knows, deduplicated by size. */
export const LAB_DEVICE_VIEWPORTS: readonly LabViewport[] = [
  { w: 322, h: 308, klass: "foldable", name: "Galaxy Z Flip 6 Cover" },
  { w: 360, h: 298, klass: "foldable", name: "Galaxy Z Flip 6 Cover" },
  { w: 320, h: 533, klass: "phone", name: "Nokia Lumia 520" },
  { w: 533, h: 320, klass: "phone", name: "Nokia Lumia 520" },
  { w: 320, h: 568, klass: "phone", name: "iPhone SE" },
  { w: 568, h: 320, klass: "phone", name: "iPhone SE" },
  { w: 472, h: 422, klass: "foldable", name: "Galaxy Z Flip 7 Cover" },
  { w: 320, h: 658, klass: "phone", name: "Galaxy S9+" },
  { w: 658, h: 320, klass: "phone", name: "Galaxy S9+" },
  { w: 474, h: 448, klass: "foldable", name: "Galaxy Z Flip 7 Cover" },
  { w: 360, h: 640, klass: "phone", name: "BlackBerry Z30, Galaxy Note 3" },
  { w: 640, h: 360, klass: "phone", name: "BlackBerry Z30, Galaxy Note 3" },
  { w: 712, h: 325, klass: "phone", name: "iPhone 12 Mini" },
  { w: 712, h: 327, klass: "phone", name: "iPhone 13 Mini" },
  { w: 756, h: 308, klass: "phone", name: "Pixel 9, Pixel 10" },
  { w: 802, h: 293, klass: "phone", name: "Pixel 5" },
  { w: 724, h: 325, klass: "phone", name: "iPhone 11 Pro" },
  { w: 375, h: 629, klass: "phone", name: "iPhone 12 Mini, iPhone 13 Mini" },
  { w: 375, h: 635, klass: "phone", name: "iPhone 11 Pro" },
  { w: 788, h: 308, klass: "foldable", name: "Galaxy Z Fold 7 Cover, Galaxy Z Flip 7" },
  { w: 384, h: 640, klass: "phone", name: "LG Optimus L70, Nexus 4" },
  { w: 640, h: 384, klass: "phone", name: "LG Optimus L70, Nexus 4" },
  { w: 726, h: 340, klass: "phone", name: "iPhone 16e, iPhone 17e" },
  { w: 375, h: 667, klass: "phone", name: "iPhone 6, iPhone 7" },
  { w: 667, h: 375, klass: "phone", name: "iPhone 6, iPhone 7" },
  { w: 734, h: 343, klass: "phone", name: "iPhone 14 Pro, iPhone 15" },
  { w: 390, h: 651, klass: "phone", name: "iPhone 16e, iPhone 17e" },
  { w: 750, h: 340, klass: "phone", name: "iPhone 12, iPhone 12 Pro" },
  { w: 828, h: 308, klass: "foldable", name: "Galaxy Z Flip 6" },
  { w: 750, h: 342, klass: "phone", name: "iPhone 13, iPhone 13 Pro" },
  { w: 390, h: 664, klass: "phone", name: "iPhone 12, iPhone 12 Pro" },
  { w: 393, h: 659, klass: "phone", name: "iPhone 15, iPhone 15 Pro" },
  { w: 393, h: 660, klass: "phone", name: "iPhone 14 Pro" },
  { w: 840, h: 312, klass: "phone", name: "Pixel 4a (5G)" },
  { w: 353, h: 745, klass: "phone", name: "Pixel 4" },
  { w: 745, h: 353, klass: "phone", name: "Pixel 4" },
  { w: 360, h: 732, klass: "phone", name: "Pixel 9, Pixel 10" },
  { w: 756, h: 352, klass: "phone", name: "iPhone 16 Pro, iPhone 17" },
  { w: 360, h: 740, klass: "phone", name: "Galaxy S8" },
  { w: 740, h: 360, klass: "phone", name: "Galaxy S8" },
  { w: 402, h: 681, klass: "phone", name: "iPhone 16 Pro, iPhone 17" },
  { w: 360, h: 764, klass: "foldable", name: "Galaxy Z Fold 7 Cover, Galaxy Z Flip 7" },
  { w: 360, h: 780, klass: "phone", name: "Galaxy S24" },
  { w: 780, h: 360, klass: "phone", name: "Galaxy S24" },
  { w: 393, h: 727, klass: "phone", name: "Pixel 5" },
  { w: 360, h: 804, klass: "foldable", name: "Galaxy Z Flip 6" },
  { w: 800, h: 364, klass: "phone", name: "iPhone 11" },
  { w: 794, h: 370, klass: "phone", name: "iPhone Air" },
  { w: 808, h: 364, klass: "phone", name: "iPhone 11 Pro Max" },
  { w: 414, h: 715, klass: "phone", name: "iPhone 11, iPhone 11 Pro Max" },
  { w: 411, h: 731, klass: "phone", name: "Pixel 2" },
  { w: 731, h: 411, klass: "phone", name: "Pixel 2" },
  { w: 412, h: 732, klass: "phone", name: "Nexus 5X, Nexus 6" },
  { w: 732, h: 412, klass: "phone", name: "Nexus 5X, Nexus 6" },
  { w: 420, h: 719, klass: "phone", name: "iPhone Air" },
  { w: 840, h: 360, klass: "phone", name: "Pixel 6 Pro, Pixel 7 Pro" },
  { w: 375, h: 812, klass: "phone", name: "iPhone X" },
  { w: 812, h: 375, klass: "phone", name: "iPhone X" },
  { w: 414, h: 736, klass: "phone", name: "iPhone 6 Plus, iPhone 7 Plus" },
  { w: 736, h: 414, klass: "phone", name: "iPhone 6 Plus, iPhone 7 Plus" },
  { w: 393, h: 786, klass: "phone", name: "Pixel 3" },
  { w: 786, h: 393, klass: "phone", name: "Pixel 3" },
  { w: 814, h: 380, klass: "phone", name: "iPhone 14 Pro Max, iPhone 15 Plus" },
  { w: 863, h: 360, klass: "phone", name: "Pixel 6, Pixel 6a" },
  { w: 832, h: 378, klass: "phone", name: "iPhone 12 Pro Max, iPhone 14 Plus" },
  { w: 412, h: 765, klass: "phone", name: "Pixel 4a (5G)" },
  { w: 832, h: 380, klass: "phone", name: "iPhone 13 Pro Max" },
  { w: 430, h: 739, klass: "phone", name: "iPhone 15 Plus, iPhone 15 Pro Max" },
  { w: 430, h: 740, klass: "phone", name: "iPhone 14 Pro Max" },
  { w: 428, h: 746, klass: "phone", name: "iPhone 12 Pro Max, iPhone 13 Pro Max" },
  { w: 838, h: 390, klass: "phone", name: "iPhone 16 Pro Max, iPhone 17 Pro Max" },
  { w: 440, h: 763, klass: "phone", name: "iPhone 16 Pro Max, iPhone 17 Pro Max" },
  { w: 412, h: 816, klass: "phone", name: "Pixel 6 Pro, Pixel 7 Pro" },
  { w: 900, h: 375, klass: "phone", name: "Pixel 9 Pro, Pixel 10 Pro" },
  { w: 411, h: 823, klass: "phone", name: "Pixel 2 XL" },
  { w: 823, h: 411, klass: "phone", name: "Pixel 2 XL" },
  { w: 412, h: 839, klass: "phone", name: "Pixel 6, Pixel 6a" },
  { w: 414, h: 896, klass: "phone", name: "iPhone XR" },
  { w: 896, h: 414, klass: "phone", name: "iPhone XR" },
  { w: 427, h: 876, klass: "phone", name: "Pixel 9 Pro, Pixel 10 Pro" },
  { w: 945, h: 396, klass: "phone", name: "Pixel 8 Pro, Pixel 9 Pro XL" },
  { w: 480, h: 854, klass: "phone", name: "Nokia N9" },
  { w: 854, h: 480, klass: "phone", name: "Nokia N9" },
  { w: 448, h: 921, klass: "phone", name: "Pixel 8 Pro, Pixel 9 Pro XL" },
  { w: 1136, h: 432, klass: "foldable", name: "Galaxy Z Fold 6 Cover" },
  { w: 480, h: 1040, klass: "phone", name: "Galaxy A55" },
  { w: 1040, h: 480, klass: "phone", name: "Galaxy A55" },
  { w: 484, h: 1112, klass: "foldable", name: "Galaxy Z Fold 6 Cover" },
  { w: 600, h: 960, klass: "tablet", name: "Nexus 7" },
  { w: 960, h: 600, klass: "tablet", name: "Nexus 7" },
  { w: 600, h: 1024, klass: "phone", name: "Blackberry PlayBook" },
  { w: 1024, h: 600, klass: "phone", name: "Blackberry PlayBook" },
  { w: 656, h: 944, klass: "tablet", name: "iPad (gen 11)" },
  { w: 944, h: 656, klass: "tablet", name: "iPad (gen 11)" },
  { w: 640, h: 1024, klass: "tablet", name: "Galaxy Tab S9" },
  { w: 1024, h: 640, klass: "tablet", name: "Galaxy Tab S9" },
  { w: 768, h: 1024, klass: "tablet", name: "iPad (gen 5), iPad (gen 6)" },
  { w: 1024, h: 768, klass: "tablet", name: "iPad (gen 5), iPad (gen 6)" },
  { w: 712, h: 1138, klass: "tablet", name: "Galaxy Tab S4" },
  { w: 1138, h: 712, klass: "tablet", name: "Galaxy Tab S4" },
  { w: 810, h: 1080, klass: "tablet", name: "iPad (gen 7)" },
  { w: 1080, h: 810, klass: "tablet", name: "iPad (gen 7)" },
  { w: 1028, h: 876, klass: "foldable", name: "Galaxy Z Fold 6" },
  { w: 928, h: 1004, klass: "foldable", name: "Galaxy Z Fold 6" },
  { w: 1040, h: 932, klass: "foldable", name: "Galaxy Z Fold 7" },
  { w: 834, h: 1194, klass: "tablet", name: "iPad Pro 11" },
  { w: 1194, h: 834, klass: "tablet", name: "iPad Pro 11" },
  { w: 984, h: 1016, klass: "foldable", name: "Galaxy Z Fold 7" },
  { w: 800, h: 1280, klass: "tablet", name: "Kindle Fire HDX, Nexus 10" },
  { w: 1280, h: 800, klass: "tablet", name: "Kindle Fire HDX, Nexus 10" },
];

/** Everything the picker offers, probes first so a known defect is one click away. */
export const LAB_VIEWPORTS: readonly LabViewport[] = [
  ...LAB_PROBE_VIEWPORTS,
  ...LAB_DESKTOP_VIEWPORTS,
  ...LAB_TV_VIEWPORTS,
  ...LAB_DEVICE_VIEWPORTS,
];
