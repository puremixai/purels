/**
 * Builds the callback URL an OIDC provider must send back to Purels.
 *
 * The server owns the base URL, while the slug is normalized the same way as
 * the API: identifiers are case-insensitive and stored lower-cased.
 */
export function buildOIDCCallbackURL(redirectBase: string, slug: string): string {
  const base = redirectBase.trim().replace(/\/+$/, "");
  const normalizedSlug = slug.trim().toLowerCase();
  if (!base || !normalizedSlug) return "";
  return `${base}/api/v1/auth/oidc/${encodeURIComponent(normalizedSlug)}/callback`;
}
