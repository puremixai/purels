/**
 * The landing page's in-page anchors, shared by the header, the footer and the
 * sections themselves so that a link and its target cannot drift apart.
 *
 * The ids are English and identical in every language. A fragment that changed
 * with the reader's language would not be a link anybody could share.
 */
export const SECTIONS = [
  { id: "features", key: "home.nav.features" },
  { id: "how", key: "home.nav.how" },
  { id: "self-hosted", key: "home.nav.selfHost" },
  { id: "faq", key: "home.nav.faq" },
] as const;
