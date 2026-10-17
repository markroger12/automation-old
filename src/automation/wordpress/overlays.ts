import type { Page } from 'playwright';

/**
 * Floating assistant widgets that hosting companies add to wp-admin — e.g. Hostinger's "Kodee" AI assistant on
 * promizeiten.de and peakbuzz.co.uk — sit on top of the block editor sidebar and menus and swallow the automation's
 * clicks. They are hidden inside the automation browser only; nothing on the website changes.
 */
const ASSISTANT_MARKERS = ['[class*="kodee" i]', '[id*="kodee" i]', '.token-loading-overlay', '.first-greeting', '.float-btn', '.intro-item'];

/**
 * Never hide anything that holds the WordPress editor or admin itself. Hostinger also puts its "kodee-…" classes on
 * <html> and <body>, so those (and any element around the admin) must stay visible whatever matches.
 */
const WORDPRESS_UI = [
  '#wpwrap',
  '#wpcontent',
  '#wpadminbar',
  '#adminmenumain',
  '#wpbody-content',
  '.interface-interface-skeleton',
  '.editor-editor-interface',
  '.edit-post-layout',
  '.block-editor',
  '.block-editor-writing-flow',
  '.editor-header',
  'iframe[name="editor-canvas"]',
].join(', ');

function hideAssistants({ markers, protectedUi }: { markers: string[]; protectedUi: string }): void {
  const holdsWordPress = (el: Element): boolean => {
    if (el === document.documentElement || el === document.body || el.tagName === 'HEAD') return true;
    try {
      return el.matches(protectedUi) || el.querySelector(protectedUi) !== null;
    } catch {
      return true;
    }
  };

  const hide = () => {
    for (const marker of markers) {
      let nodes: NodeListOf<HTMLElement>;
      try {
        nodes = document.querySelectorAll<HTMLElement>(marker);
      } catch {
        continue;
      }
      nodes.forEach((el) => {
        if (!(el instanceof HTMLElement) || holdsWordPress(el)) return;
        // Hide the floating container the widget lives in (the nearest fixed-position ancestor), else the element.
        let target: HTMLElement = el;
        for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
          if (getComputedStyle(node).position === 'fixed') {
            target = node;
            break;
          }
        }
        if (holdsWordPress(target)) target = el;
        if (holdsWordPress(target)) return;
        if (target.style.getPropertyValue('display') !== 'none') target.style.setProperty('display', 'none', 'important');
      });
    }
  };
  let timer: number | undefined;
  const schedule = () => {
    if (timer === undefined) timer = window.setTimeout(() => ((timer = undefined), hide()), 250);
  };
  const start = () => {
    hide();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}

export async function hideAssistantOverlays(page: Page): Promise<void> {
  // Runs in every page the automation opens from now on (the tab is still empty when this is installed).
  await page.addInitScript(hideAssistants, { markers: ASSISTANT_MARKERS, protectedUi: WORDPRESS_UI });
}
