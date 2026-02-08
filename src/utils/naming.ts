import { NamingOptions } from './types';

function safeName(input: string): string {
  return input.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

export function buildFilenames(count: number, options: NamingOptions, ext: string): string[] {
  const base = safeName(options.baseName?.trim() || 'Pic');
  const pad = Math.max(0, Math.min(5, options.zeroPad ?? 0));
  return new Array(count).fill(0).map((_, i) => {
    const indexText = pad > 0 ? String(i + 1).padStart(pad, '0') : String(i + 1);
    return `${base} (${indexText}).${ext}`;
  });
}
