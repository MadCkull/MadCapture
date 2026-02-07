import { NamingOptions } from './types';

export function renderFilename(template: string, name: string, index: number, ext: string, zeroPad: number): string {
  const indexText = String(index).padStart(Math.max(0, zeroPad), '0');
  return template
    .replaceAll('{name}', name)
    .replaceAll('{index}', indexText)
    .replaceAll('{ext}', ext);
}

export function buildFilenames(count: number, options: NamingOptions, hints: string[], ext: string): string[] {
  return new Array(count).fill(0).map((_, i) => {
    const hint = hints[i] || 'Pic';
    return renderFilename(options.template, hint, options.startIndex + i, ext, options.zeroPad);
  });
}
