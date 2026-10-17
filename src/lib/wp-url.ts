/** Normalises "https://site.com" / "https://site.com/wp-admin" into "https://site.com/wp-admin/". */
export function normalizeAdminUrl(siteUrl: string, adminUrl?: string | null): string {
  const raw = adminUrl?.trim() || `${siteUrl.replace(/\/+$/, '')}/wp-admin/`;
  const url = new URL(raw);
  if (!url.pathname.includes('/wp-admin')) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/wp-admin/`;
  }
  url.pathname = url.pathname.replace(/\/wp-admin(\/.*)?$/, '/wp-admin/');
  url.search = '';
  url.hash = '';
  return url.toString();
}
