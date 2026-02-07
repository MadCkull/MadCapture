const URL_RE = /url\((['"]?)(.*?)\1\)/g;

export function extractBackgroundImageUrls(backgroundImage: string): string[] {
  const results: string[] = [];
  for (const match of backgroundImage.matchAll(URL_RE)) {
    const raw = match[2]?.trim();
    if (!raw || raw.startsWith('data:image/svg+xml;base64,') && raw.includes('gradient')) continue;
    if (/gradient\(/i.test(raw)) continue;
    results.push(raw);
  }
  return results;
}
