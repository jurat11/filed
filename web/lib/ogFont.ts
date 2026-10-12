/**
 * Serif for the share cards, so a posted link looks like the site (Newsreader). Satori
 * (next/og) needs the font file, not the CSS, so this asks Google Fonts for a TTF that holds
 * only the glyphs the card uses (a few KB) and caches it per text. It must never break a
 * share preview: any failure returns undefined and the card renders in the default font.
 */
type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: "normal" };

const cache = new Map<string, Promise<OgFont | undefined>>();

// Without a browser user agent, Google Fonts answers with TrueType, which Satori reads.
const TTF_AGENT = "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1";

async function fetchFont(text: string, weight: OgFont["weight"]): Promise<OgFont | undefined> {
  try {
    const glyphs = [...new Set(text)].join("");
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=Newsreader:wght@${weight}&text=${encodeURIComponent(glyphs)}`,
      { headers: { "User-Agent": TTF_AGENT }, signal: AbortSignal.timeout(4000) },
    ).then((r) => (r.ok ? r.text() : ""));
    const url = css.match(/src: url\((https:[^)]+)\) format\('(?:truetype|opentype)'\)/)?.[1];
    if (!url) return undefined;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return undefined;
    return { name: "Newsreader", data: await res.arrayBuffer(), weight, style: "normal" };
  } catch {
    return undefined;
  }
}

/** Newsreader at `weight`, covering `text`. Undefined when it could not be loaded. */
export function ogFont(text: string, weight: OgFont["weight"] = 600): Promise<OgFont | undefined> {
  const key = `${weight}:${text}`;
  let p = cache.get(key);
  if (!p) {
    p = fetchFont(text, weight);
    cache.set(key, p);
    // Do not remember a failure: the next request may succeed.
    void p.then((f) => f ?? cache.delete(key));
  }
  return p;
}
