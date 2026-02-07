export function canonicalizeUrl(input: string, base = location.href): string {
  try {
    const u = new URL(input, base);
    u.hash = '';
    return u.toString();
  } catch {
    return input;
  }
}

export function filenameFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const file = pathname.split('/').pop();
    return file || undefined;
  } catch {
    return undefined;
  }
}

export function extFromMime(type: string): string {
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'bin';
}
