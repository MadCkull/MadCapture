export type OriginType =
  | 'img'
  | 'srcset'
  | 'picture'
  | 'css-background'
  | 'css-mask'
  | 'css-content'
  | 'image-set'
  | 'link-href'
  | 'data-attr'
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
  hash?: string;
}

export interface ExtractOptions {
  deepScan?: boolean;
  visibleOnly?: boolean;
  viewportPadding?: number;
  includeDataUrls?: boolean;
  includeBlobUrls?: boolean;
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
