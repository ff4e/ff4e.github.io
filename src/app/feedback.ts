/**
 * Player feedback, DOM half: the affordance, the form, and the payload preview.
 * What a report *contains* is decided in src/platform/feedback.ts and unit-tested
 * there; this file only wires it to the page.
 *
 * WHERE THE AFFORDANCE LIVES, AND WHY IT IS NOT IN THE GAME
 *
 * Three places could plausibly host it, and two of them are worse than they look:
 *
 *  - **The control panel.** It is the original's own 155×395 bitmap (`FFP`, drawn by
 *    composePanel/composeOptions), and the port draws exactly the buttons ALTAR drew.
 *    A "report a problem" button there means either inventing 1998 art that does not
 *    exist or painting over art that does. This is a faithful port; that is the whole
 *    of the objection.
 *  - **A world-map corner.** The map's corner buttons are not laid out in code — they
 *    are read out of the original's mask bitmap (`cornerAction`, worldMap.ts:224,
 *    UMain.pas:1636), so a new corner means a new hotspot on shipped 1998 artwork.
 *    Worse, it would only be reachable FROM the map: a player who hits a bug in a room
 *    would have to leave the room to report it, and leaving the room throws away the
 *    move record (`engine.srecord`) that makes the report reproducible. The one
 *    diagnostic worth having is the one that placement destroys.
 *
 * So it lives in the page's own chrome, in a slim bar under the stage — outside the
 * canvas by construction (it is a flex sibling of `.stage`, so it can never overlap
 * the art, at any window size or scale), present on every screen, and able to read the
 * live record without disturbing the game. It costs the stage ~24 CSS px of height,
 * which the layout absorbs automatically (relayout() measures the row, not the window).
 *
 * NOTHING IS SENT AUTOMATICALLY. The form shows the finished report, in full, before
 * any of the three exits is offered. Both send buttons are ordinary links, so the
 * player can see where they go — and so a UI probe can assert on them without opening
 * a tab or a mail client.
 */
import {
  buildFeedback,
  collectFacts,
  FEEDBACK_EMAIL,
  FEEDBACK_REPO,
  type Feedback,
  type FeedbackEnv,
  type FeedbackKind,
} from '../platform/feedback.js';

/** What the host (main.ts) must be able to tell the form. */
export interface FeedbackHost {
  build: { version: string; hash: string; date: string };
  /** Was WebGL2 available at boot? */
  webgl2: () => boolean;
  /** The live game state, read once when the form opens. */
  game: () => FeedbackEnv['game'];
}

export interface FeedbackUi {
  open: (kind?: FeedbackKind) => void;
  close: () => void;
  isOpen: () => boolean;
  /** The report text currently on screen — exactly what "Copy report" would copy. */
  preview: () => string;
  /** The two links as the buttons currently carry them (for probes). */
  links: () => { issue: string; email: string };
  /** The warning line under the buttons, or '' when there is nothing to warn about. */
  note: () => string;
}

/** The form is inert (and `isOpen()` false) when the markup is missing. */
const NOOP: FeedbackUi = {
  open: () => {},
  close: () => {},
  isOpen: () => false,
  preview: () => '',
  links: () => ({ issue: '', email: '' }),
  note: () => '',
};

/**
 * Put text on the clipboard.
 *
 * The async Clipboard API needs a secure context, which `file://` and a plain-http
 * LAN test server are not, so the deprecated `execCommand('copy')` stays as the
 * fallback — this is the button that exists precisely for when the other exits do not
 * work, and it would be a poor joke if it were the one to fail.
 *
 * The scratch textarea goes inside `host`, which is the open `<dialog>`: `showModal()`
 * makes everything OUTSIDE the dialog inert, so a textarea appended to `document.body`
 * cannot take focus, the selection is empty, and `execCommand` copies nothing — while
 * still returning `true`. Reporting a successful copy that did not happen is the one
 * failure this fallback must not have.
 */
async function copyText(text: string, host: HTMLElement): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* denied or unavailable — fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    host.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function initFeedback(host: FeedbackHost): FeedbackUi {
  const dialog = document.getElementById('feedback') as HTMLDialogElement | null;
  const openBtn = document.getElementById('feedback-open');
  const what = document.getElementById('feedback-what') as HTMLTextAreaElement | null;
  const preview = document.getElementById('feedback-preview');
  const noteEl = document.getElementById('feedback-note');
  const issueLink = document.getElementById('feedback-issue') as HTMLAnchorElement | null;
  const emailLink = document.getElementById('feedback-email') as HTMLAnchorElement | null;
  const copyBtn = document.getElementById('feedback-copy');
  const closeBtn = document.getElementById('feedback-close');
  const status = document.getElementById('feedback-status');
  const buildEl = document.getElementById('feedbar-build');
  if (!dialog || !openBtn || !what || !preview || !issueLink || !emailLink) return NOOP;

  if (buildEl) buildEl.textContent = `v${host.build.version}`;

  /**
   * The environment as it was when the form opened.
   *
   * Snapshotted rather than read per keystroke so the preview cannot drift while the
   * player types — what is shown is what is sent. The game keeps running behind the
   * modal, but its keyboard is blocked (main.ts checks isOpen()), so the state the
   * player is reporting on is the state that was captured.
   */
  let env: FeedbackEnv | null = null;
  let kind: FeedbackKind = 'bug';
  let current: Feedback | null = null;

  const kindInputs = (): HTMLInputElement[] =>
    Array.from(document.querySelectorAll<HTMLInputElement>('input[name="feedback-kind"]'));

  function render(): void {
    if (!env) return;
    try {
      const facts = collectFacts(env, kind);
      current = buildFeedback({ kind, description: what!.value, facts });
      preview!.textContent = current.report.body;
      issueLink!.href = current.issue.url;
      emailLink!.href = current.email.url;
      const warn: string[] = [];
      if (current.issue.recordOmitted || current.email.recordOmitted) {
        const which = [
          current.issue.recordOmitted ? 'the GitHub issue' : '',
          current.email.recordOmitted ? 'the email' : '',
        ]
          .filter(Boolean)
          .join(' and ');
        warn.push(
          `The move record is too long to fit in a link, so ${which} will arrive without it — ` +
            'use “Copy report” and paste the whole thing instead.',
        );
      }
      if (current.issue.clamped || current.email.clamped) {
        warn.push('Your text is too long for a link and will be cut short — “Copy report” keeps it whole.');
      }
      if (current.issue.oversize || current.email.oversize) {
        warn.push('This report is too big for a link at all — please use “Copy report”.');
      }
      if (noteEl) noteEl.textContent = warn.join(' ');
    } catch (e) {
      // A broken preview must never take the form with it: the player would lose what
      // they wrote and — since the text survives a close — the button would stay dead
      // for the rest of the session. Fall back to the bare exits (an empty form, a bare
      // mailto, and the clipboard, which copies the textarea when there is no report),
      // never to a stale link that no longer matches what is on screen.
      current = null;
      preview!.textContent = what!.value;
      issueLink!.href = `https://github.com/${FEEDBACK_REPO}/issues/new/choose`;
      emailLink!.href = `mailto:${FEEDBACK_EMAIL}`;
      if (noteEl) {
        noteEl.textContent =
          'Something went wrong preparing the links, so they are empty. Use “Copy report” and ' +
          `paste what you wrote into an issue, or mail it to ${FEEDBACK_EMAIL}.`;
      }
      // Loud on purpose: this should be unreachable, and a UI probe fails on it.
      console.error('feedback: could not build the report', e);
    }
  }

  function open(k: FeedbackKind = kind): void {
    env = {
      build: host.build,
      game: host.game(),
      webgl2: host.webgl2(),
      // Narrowed HERE, not by handing over `window`: the report builder is then
      // physically unable to reach storage, cookies, the URL or anything else on the
      // window, rather than merely typed as if it could not.
      win: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        screen: { width: window.screen?.width, height: window.screen?.height },
        navigator: { userAgent: window.navigator?.userAgent },
      },
    };
    kind = k;
    for (const r of kindInputs()) r.checked = r.value === kind;
    // Open FIRST: whatever the preview does, the player gets the form and their text.
    if (!dialog!.open) {
      if (typeof dialog!.showModal === 'function') dialog!.showModal();
      else dialog!.setAttribute('open', '');
    }
    render();
    if (status) status.textContent = '';
    what!.focus();
  }

  function close(): void {
    if (dialog!.open) dialog!.close();
    else dialog!.removeAttribute('open');
  }

  openBtn.addEventListener('click', () => open());
  closeBtn?.addEventListener('click', () => close());
  what.addEventListener('input', render);
  for (const r of kindInputs()) {
    r.addEventListener('change', () => {
      kind = r.value === 'idea' ? 'idea' : 'bug';
      render();
    });
  }
  copyBtn?.addEventListener('click', () => {
    const text = current?.report.body ?? what.value;
    void copyText(text, dialog).then((ok) => {
      if (status) {
        status.textContent = ok
          ? 'Copied. Paste it into an issue, an email, or anywhere you can reach me.'
          : `Couldn't reach the clipboard — select the text above and copy it by hand.`;
      }
    });
  });
  // Both exits leave the report on screen: a mail client that never opens, or a GitHub
  // tab the player abandons, must not also lose what they wrote.
  issueLink.addEventListener('click', () => {
    if (status) status.textContent = 'Opened GitHub in a new tab. The report is filled in — press Submit there.';
  });
  emailLink.addEventListener('click', () => {
    if (status) {
      status.textContent =
        'Opening your mail program. If nothing happens, use “Copy report” and mail it yourself.';
    }
  });

  return {
    open,
    close,
    isOpen: () => dialog.open,
    preview: () => preview.textContent ?? '',
    links: () => ({ issue: issueLink.href, email: emailLink.href }),
    note: () => noteEl?.textContent ?? '',
  };
}
