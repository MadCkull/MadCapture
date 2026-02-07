import piexif from 'piexifjs';

export function tryInsertExif(originalArrayBuffer: ArrayBuffer, outputDataUrl: string): string {
  try {
    const originalBinary = new TextDecoder().decode(new Uint8Array(originalArrayBuffer));
    const exif = piexif.load(originalBinary);
    const exifBytes = piexif.dump(exif);
    return piexif.insert(exifBytes, outputDataUrl);
  } catch {
    return outputDataUrl;
  }
}
