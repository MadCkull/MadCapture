declare module 'parse-srcset' {
  export interface ParsedSrcsetCandidate {
    url: string;
    w?: number;
    h?: number;
    d?: number;
  }

  export default function parseSrcset(input: string): ParsedSrcsetCandidate[];
}
