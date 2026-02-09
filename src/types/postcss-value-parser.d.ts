declare module 'postcss-value-parser' {
  export interface Node {
    type: string;
    value: string;
    nodes?: Node[];
  }

  export interface ParsedValue {
    nodes: Node[];
    walk: (cb: (node: Node) => void | false) => void;
  }

  function valueParser(input: string | Node[]): ParsedValue;

  namespace valueParser {
    function stringify(node: Node | Node[]): string;
  }

  export default valueParser;
}
