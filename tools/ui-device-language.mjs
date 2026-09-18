import { gotoApp, reloadApp } from './ui-lib.mjs';

/** Real navigator.language and device classification; the full preference matrix is unit-tested. */
export async function checkDeviceLanguageDefaults(parent, expect) {
  const browser = parent.context().browser();
  for (const [kind, language, expected, titDef] of [
    ['phone', 'cs-CZ', 'off', 'cz'],
    ['tablet', 'cs-CZ', 'off', 'cz'],
    ['phone', 'fr-FR', 'en', 'en'],
    ['desktop', 'cs-CZ', 'en', 'en'],
  ]) {
    const size = kind === 'phone' ? { width: 393, height: 852 } : { width: 1024, height: 768 };
    const context = await browser.newContext({
      viewport: size, screen: size, locale: language,
      hasTouch: kind !== 'desktop', isMobile: kind !== 'desktop',
    });
    try {
      const p = await context.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(e.message));
      p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await p.addInitScript(() => {
        if (!localStorage.getItem('ff.options')) {
          localStorage.setItem('ff.options', JSON.stringify({ introSeen: true }));
        }
      });
      await gotoApp(p);
      const actual = await p.evaluate(() => ({
        language: navigator.language, mode: window.__ff.subtitleMode(), titDef: window.__ff.titDef(),
      }));
      expect(actual.language === language && actual.mode === expected && actual.titDef === titDef,
        `${language} ${kind} defaults to ${expected} subtitles and ${titDef} UI: ${JSON.stringify(actual)}`);
      if (kind === 'phone' && language === 'cs-CZ') {
        await p.evaluate(() => window.__ff.setLang('en'));
        await reloadApp(p);
        expect(await p.evaluate(() => window.__ff.subtitleMode() === 'en' && window.__ff.titDef() === 'en'),
          'a saved English preference survives relaunch on a Czech phone');
      }
      expect(errors.length === 0, `${language} ${kind}: no console/page errors (${errors.join('; ')})`);
    } finally {
      await context.close();
    }
  }
}
