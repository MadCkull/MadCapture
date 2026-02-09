import valueParser, { Node as ValueParserNode } from 'postcss-value-parser';

export type CssImageCandidate = { url: string; density?: number; fromImageSet?: boolean };

function cleanUrl(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, '');
}

function parseImageSet(nodes: ValueParserNode[]): CssImageCandidate | null {
  const segments: string[] = [];
  let current: valueParser.Node[] = [];

  for (const node of nodes) {
    if (node.type === 'div' && node.value === ',') {
      if (current.length) segments.push(valueParser.stringify(current));
      current = [];
    } else {
      current.push(node);
    }
  }
  if (current.length) segments.push(valueParser.stringify(current));

  let best: CssImageCandidate | null = null;
  for (const segment of segments) {
    const parsed = valueParser(segment);
    let url: string | undefined;
    let density: number | undefined;

    parsed.walk((node) => {
      if (node.type === 'function' && node.value.toLowerCase() === 'url') {
        if (!url) url = cleanUrl(valueParser.stringify(node.nodes));
        return false;
      }
      if (node.type === 'string' && !url) {
        url = cleanUrl(node.value);
      }
      if (node.type === 'word' && /x$/i.test(node.value)) {
        const val = Number(node.value.slice(0, -1));
        if (Number.isFinite(val)) density = val;
      }
      return undefined;
    });

    if (!url) continue;
    const candidate: CssImageCandidate = { url, density, fromImageSet: true };
    if (!best) {
      best = candidate;
    } else {
      const bestScore = best.density ?? 1;
      const candScore = density ?? 1;
      if (candScore > bestScore) best = candidate;
    }
  }

  return best;
}

export function extractCssImageCandidates(value: string): CssImageCandidate[] {
  const results: CssImageCandidate[] = [];
  if (!value || value === 'none') return results;

  const parsed = valueParser(value);
  parsed.walk((node) => {
    if (node.type !== 'function') return undefined;
    const fn = node.value.toLowerCase();
    if (fn === 'image-set' || fn === '-webkit-image-set') {
      const best = parseImageSet(node.nodes || []);
      if (best) results.push(best);
      return false;
    }
    if (fn === 'url') {
      const raw = cleanUrl(valueParser.stringify(node.nodes));
      if (raw) results.push({ url: raw });
      return false;
    }
    return undefined;
  });

  return results;
}

export function extractBackgroundImageUrls(backgroundImage: string): string[] {
  return extractCssImageCandidates(backgroundImage).map((c) => c.url);
}
