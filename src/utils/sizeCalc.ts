import { ExtractedImage } from './types';

export function estimateBytes(width?: number, height?: number): number {
  if (!width || !height) return 0;
  return width * height * 3;
}

export function compareBySizeDesc(a: ExtractedImage, b: ExtractedImage): number {
  const aSize = a.bytes ?? a.estimatedBytes ?? estimateBytes(a.width, a.height);
  const bSize = b.bytes ?? b.estimatedBytes ?? estimateBytes(b.width, b.height);
  if (bSize !== aSize) return bSize - aSize;
  return (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0);
}
