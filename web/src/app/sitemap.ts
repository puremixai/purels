import type { MetadataRoute } from "next";
import { requestOrigin } from "@/lib/request-origin";

/** See the note in robots.ts: this depends on the request host. */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // One entry, because the homepage is the only URL here that is both this
  // app's and meant to be indexed: the console is Disallowed in robots.txt, and
  // a short link belongs to whatever it points at.
  //
  // No lastModified. This route is dynamic, so a timestamp read now would claim
  // the page changed on every request, which is worse than saying nothing.
  return [{ url: `${await requestOrigin()}/` }];
}
