import iconSource from '../styles/nativeMenuIcons.svg?raw';

const regions: Readonly<Record<string, string>> = {
  14: 'map', 24: 'undo', 12: 'save', 13: 'load', 16: 'options', 15: 'restart',
};
let library: Document | null = null;

/** Replace only the artwork; keep button dispatch, SVG boxes and accessible names. */
export function applyRusticIcons(doc: Document): void {
  if (!library) {
    library = new DOMParser().parseFromString(iconSource, 'image/svg+xml');
    if (library.querySelector('parsererror')) throw new Error('Native menu symbols failed to parse');
  }
  for (const svg of doc.querySelectorAll<SVGSVGElement>('.tbtn svg')) {
    const button = svg.closest('button');
    const name = button?.id === 'phone-more' ? 'more' : regions[button?.dataset.region ?? ''];
    const symbol = name ? library.getElementById(name) : null;
    if (!symbol || !name) throw new Error(`Missing native menu symbol for ${button?.id}`);
    const copy = doc.importNode(symbol, true);
    copy.removeAttribute('id');
    svg.replaceChildren(copy);
    svg.dataset.menuIcon = name;
  }
}
