export interface SrcSetCandidate { url: string; descriptor?: string; width?: number; density?: number }

export function parseSrcset(srcset: string): SrcSetCandidate[] {
  return srcset
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [url, descriptor] = entry.split(/\s+/, 2);
      if (!descriptor) return { url };
      if (descriptor.endsWith('w')) return { url, descriptor, width: Number(descriptor.slice(0, -1)) };
      if (descriptor.endsWith('x')) return { url, descriptor, density: Number(descriptor.slice(0, -1)) };
      return { url, descriptor };
    });
}

export function pickHighestResCandidate(srcset: string): string | undefined {
  const parsed = parseSrcset(srcset);
  return parsed.sort((a, b) => (b.width ?? b.density ?? 0) - (a.width ?? a.density ?? 0))[0]?.url;
}
