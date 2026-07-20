# Enhanced (truecolor) background art

These `<ROOM>/w.png` (wall) + `<ROOM>/p.png` (background) files are the truecolor
background masters from **fillets-ng-data** (the Fish Fillets NG data package),
staged here so the port's *enhanced* graphics mode can ship them.

- Source: GPL `fillets-ng-data` (Debian `main`; upstream fillets.sf.net).
- License: **GPL** — same terms as the rest of the game data. Redistributable.
- Same art and pixel resolution as the classic 256-colour room backgrounds, just
  not palette-crushed (RGBA truecolor + alpha).

Regenerate with: `FF_ENHANCED_DIR=/path/to/fillets-ng/images npm run stage-enhanced`
(defaults to the installed `Fillets.app` images dir). Rooms without a truecolor
master, or whose background is a special effect (darkness/ZX/mirror), fall back to
the classic art automatically.
