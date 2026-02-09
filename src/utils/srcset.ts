import parseSrcsetLib from 'parse-srcset';

export interface SrcSetCandidate {
  url: string;
  descriptor?: string;
  width?: number;
  height?: number;
  density?: number;
}

function fallbackParse(srcset: string): SrcSetCandidate[] {
  return srcset
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [url, descriptor] = entry.split(/\s+/, 2);
      if (!descriptor) return { url };
      if (descriptor.endsWith('w'))
        return { url, descriptor, width: Number(descriptor.slice(0, -1)) };
      if (descriptor.endsWith('x'))
        return { url, descriptor, density: Number(descriptor.slice(0, -1)) };
      return { url, descriptor };
    });
}

export function parseSrcset(srcset: string): SrcSetCandidate[] {
  try {
    const parsed = parseSrcsetLib(srcset) as Array<{
      url: string;
      w?: number;
      h?: number;
      d?: number;
    }>;
    return parsed.map((c) => ({
      url: c.url,
      width: c.w,
      height: c.h,
      density: c.d,
      descriptor: c.w ? `${c.w}w` : c.d ? `${c.d}x` : undefined,
    }));
  } catch {
    return fallbackParse(srcset);
  }
}

export function pickHighestResCandidate(srcset: string): string | undefined {
  const parsed = parseSrcset(srcset);
  return parsed.sort((a, b) => (b.width ?? b.density ?? 0) - (a.width ?? a.density ?? 0))[0]?.url;
}

export function pickBestCandidateForDisplay(
  srcset: string,
  displayWidth: number | undefined,
): string | undefined {
  const parsed = parseSrcset(srcset);
  if (!parsed.length) return undefined;
  if (!displayWidth || !Number.isFinite(displayWidth)) {
    return pickHighestResCandidate(srcset);
  }
  const target = displayWidth * (window.devicePixelRatio || 1);
  const withWidth = parsed.filter((c) => Number.isFinite(c.width));
  if (withWidth.length) {
    const above = withWidth
      .filter((c) => (c.width as number) >= target)
      .sort((a, b) => (a.width as number) - (b.width as number))[0];
    if (above?.url) return above.url;
    return withWidth.sort((a, b) => (b.width as number) - (a.width as number))[0]?.url;
  }
  const withDensity = parsed
    .filter((c) => Number.isFinite(c.density))
    .sort((a, b) => (b.density as number) - (a.density as number));
  return withDensity[0]?.url ?? parsed[0]?.url;
}
