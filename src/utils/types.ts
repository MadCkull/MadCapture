export type OriginType =
  | 'img'
  | 'picture'
  | 'css-background'
  | 'inline-svg'
  | 'canvas'
  | 'video-poster'
  | 'lazy-attr'
  | 'data-url';

export interface ExtractedImage {
  id: string;
  url: string;
  originType: OriginType;
  width?: number;
  height?: number;
  filenameHint?: string;
  isDataUrl?: boolean;
  isInlineSVG?: boolean;
  isCanvas?: boolean;
  srcsetCandidates?: string[];
  lazyHint?: boolean;
  bytes?: number;
  estimatedBytes?: number;
  previewUrl?: string;
  pageX?: number;
  pageY?: number;
}

export interface SelectionPayload {
  selectors: string[];
  rects: Array<{ x: number; y: number; width: number; height: number }>;
}

export type DesiredFormat = 'original' | 'image/png' | 'image/jpeg' | 'image/webp';

export interface NamingOptions {
  baseName: string;
  zeroPad?: number;
  folderName?: string;
}
