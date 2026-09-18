/** "News, promo  news" -> ["news", "promo"] — split, trim, drop blanks, de-dupe. */
export function parseTags(raw: string) {
  const seen = new Set<string>();
  for (const part of raw.split(/[,，\s]+/)) {
    const name = part.trim();
    if (name) seen.add(name);
  }
  return [...seen];
}
