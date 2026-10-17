import type { Page, Request } from 'playwright';
import type { AutomationLogger } from '@/lib/logger';

const BLOCKED_STATUSES = /"status"\s*:\s*"(publish|future|private|pending)"/i;

/** True when a request coming from the WordPress editor would publish/schedule a post. */
export function isPublishingRequest(method: string, url: string, body: string | null): boolean {
  if (!['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) return false;
  const decodedUrl = decodeURIComponent(url);
  const payload = body ?? '';

  // Block editor saves through the WordPress REST endpoints *the editor itself* uses.
  const isPostsEndpoint = /\/wp\/v2\/(posts|pages)(\/\d+)?(\?|$|\/?$)/.test(decodedUrl) || /rest_route=\/wp\/v2\/(posts|pages)/.test(decodedUrl);
  if (isPostsEndpoint && !/\/autosaves/.test(decodedUrl)) {
    if (BLOCKED_STATUSES.test(payload)) return true;
    // Some requests send the method override in the body (X-HTTP-Method-Override) — same check applies.
  }

  // Classic editor: the Publish button submits "publish=Publish" (hidden field is "original_publish").
  if (/\/wp-admin\/post\.php/.test(decodedUrl)) {
    if (/(^|&)publish=/.test(payload)) return true;
    if (/(^|&)post_status=(publish|future|private|pending)(&|$)/.test(payload)) return true;
  }
  return false;
}

/**
 * Network-level safety net: aborts any request that would publish, schedule or submit a post for review.
 * The automation never clicks Publish, but this guarantees a draft cannot be published by accident
 * (e.g. a changed button label or a keyboard shortcut).
 */
export async function installPublishGuard(page: Page, logger: AutomationLogger, onBlocked?: (req: Request) => void): Promise<void> {
  await page.route(
    (url) => /\/wp-json\/|rest_route=|\/wp-admin\/post\.php/.test(url.toString()),
    async (route) => {
      const req = route.request();
      if (isPublishingRequest(req.method(), req.url(), req.postData())) {
        logger.error('Blocked a request that would publish the post (drafts only).', { url: req.url(), method: req.method() });
        onBlocked?.(req);
        await route.abort('blockedbyclient');
        return;
      }
      await route.fallback();
    },
  );
}
