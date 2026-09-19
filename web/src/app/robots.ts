import type { MetadataRoute } from "next";
import { requestOrigin } from "@/lib/request-origin";

/**
 * Reading the request host is what keeps this honest: the Sitemap line has to
 * name the host the crawler actually reached, and that is not known until the
 * request arrives. headers() already opts a metadata route out of caching, so
 * this would work without the export below; it is here so the intent is stated
 * rather than resting on that behaviour, because a route evaluated once at build
 * time would bake in whichever host the image was built against.
 */
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await requestOrigin();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // The console is reachable only with a session and the API is not a
      // document at all, so neither has anything to offer a crawler. A short
      // link is answered by the API — a redirect, or a page it marks noindex —
      // and is not under this app's control anyway.
      disallow: ["/admin", "/login", "/register", "/api/"],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
