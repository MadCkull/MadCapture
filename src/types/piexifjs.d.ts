declare module 'piexifjs' {
  const piexif: {
    load: (data: string) => any;
    dump: (exifObj: any) => string;
    insert: (exifBytes: string, image: string) => string;
    remove: (image: string) => string;
    TagValues: any;
    ImageIFD: any;
    ExifIFD: any;
    GPSIFD: any;
    InteropIFD: any;
    Helper: any;
  };
  export default piexif;
}
