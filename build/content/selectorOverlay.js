"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/postcss-value-parser/lib/parse.js
  var require_parse = __commonJS({
    "node_modules/postcss-value-parser/lib/parse.js"(exports, module) {
      var openParentheses = "(".charCodeAt(0);
      var closeParentheses = ")".charCodeAt(0);
      var singleQuote = "'".charCodeAt(0);
      var doubleQuote = '"'.charCodeAt(0);
      var backslash = "\\".charCodeAt(0);
      var slash = "/".charCodeAt(0);
      var comma = ",".charCodeAt(0);
      var colon = ":".charCodeAt(0);
      var star = "*".charCodeAt(0);
      var uLower = "u".charCodeAt(0);
      var uUpper = "U".charCodeAt(0);
      var plus = "+".charCodeAt(0);
      var isUnicodeRange = /^[a-f0-9?-]+$/i;
      module.exports = function(input) {
        var tokens = [];
        var value = input;
        var next, quote, prev, token, escape, escapePos, whitespacePos, parenthesesOpenPos;
        var pos = 0;
        var code = value.charCodeAt(pos);
        var max = value.length;
        var stack = [{ nodes: tokens }];
        var balanced = 0;
        var parent;
        var name = "";
        var before = "";
        var after = "";
        while (pos < max) {
          if (code <= 32) {
            next = pos;
            do {
              next += 1;
              code = value.charCodeAt(next);
            } while (code <= 32);
            token = value.slice(pos, next);
            prev = tokens[tokens.length - 1];
            if (code === closeParentheses && balanced) {
              after = token;
            } else if (prev && prev.type === "div") {
              prev.after = token;
              prev.sourceEndIndex += token.length;
            } else if (code === comma || code === colon || code === slash && value.charCodeAt(next + 1) !== star && (!parent || parent && parent.type === "function" && parent.value !== "calc")) {
              before = token;
            } else {
              tokens.push({
                type: "space",
                sourceIndex: pos,
                sourceEndIndex: next,
                value: token
              });
            }
            pos = next;
          } else if (code === singleQuote || code === doubleQuote) {
            next = pos;
            quote = code === singleQuote ? "'" : '"';
            token = {
              type: "string",
              sourceIndex: pos,
              quote
            };
            do {
              escape = false;
              next = value.indexOf(quote, next + 1);
              if (~next) {
                escapePos = next;
                while (value.charCodeAt(escapePos - 1) === backslash) {
                  escapePos -= 1;
                  escape = !escape;
                }
              } else {
                value += quote;
                next = value.length - 1;
                token.unclosed = true;
              }
            } while (escape);
            token.value = value.slice(pos + 1, next);
            token.sourceEndIndex = token.unclosed ? next : next + 1;
            tokens.push(token);
            pos = next + 1;
            code = value.charCodeAt(pos);
          } else if (code === slash && value.charCodeAt(pos + 1) === star) {
            next = value.indexOf("*/", pos);
            token = {
              type: "comment",
              sourceIndex: pos,
              sourceEndIndex: next + 2
            };
            if (next === -1) {
              token.unclosed = true;
              next = value.length;
              token.sourceEndIndex = next;
            }
            token.value = value.slice(pos + 2, next);
            tokens.push(token);
            pos = next + 2;
            code = value.charCodeAt(pos);
          } else if ((code === slash || code === star) && parent && parent.type === "function" && parent.value === "calc") {
            token = value[pos];
            tokens.push({
              type: "word",
              sourceIndex: pos - before.length,
              sourceEndIndex: pos + token.length,
              value: token
            });
            pos += 1;
            code = value.charCodeAt(pos);
          } else if (code === slash || code === comma || code === colon) {
            token = value[pos];
            tokens.push({
              type: "div",
              sourceIndex: pos - before.length,
              sourceEndIndex: pos + token.length,
              value: token,
              before,
              after: ""
            });
            before = "";
            pos += 1;
            code = value.charCodeAt(pos);
          } else if (openParentheses === code) {
            next = pos;
            do {
              next += 1;
              code = value.charCodeAt(next);
            } while (code <= 32);
            parenthesesOpenPos = pos;
            token = {
              type: "function",
              sourceIndex: pos - name.length,
              value: name,
              before: value.slice(parenthesesOpenPos + 1, next)
            };
            pos = next;
            if (name === "url" && code !== singleQuote && code !== doubleQuote) {
              next -= 1;
              do {
                escape = false;
                next = value.indexOf(")", next + 1);
                if (~next) {
                  escapePos = next;
                  while (value.charCodeAt(escapePos - 1) === backslash) {
                    escapePos -= 1;
                    escape = !escape;
                  }
                } else {
                  value += ")";
                  next = value.length - 1;
                  token.unclosed = true;
                }
              } while (escape);
              whitespacePos = next;
              do {
                whitespacePos -= 1;
                code = value.charCodeAt(whitespacePos);
              } while (code <= 32);
              if (parenthesesOpenPos < whitespacePos) {
                if (pos !== whitespacePos + 1) {
                  token.nodes = [
                    {
                      type: "word",
                      sourceIndex: pos,
                      sourceEndIndex: whitespacePos + 1,
                      value: value.slice(pos, whitespacePos + 1)
                    }
                  ];
                } else {
                  token.nodes = [];
                }
                if (token.unclosed && whitespacePos + 1 !== next) {
                  token.after = "";
                  token.nodes.push({
                    type: "space",
                    sourceIndex: whitespacePos + 1,
                    sourceEndIndex: next,
                    value: value.slice(whitespacePos + 1, next)
                  });
                } else {
                  token.after = value.slice(whitespacePos + 1, next);
                  token.sourceEndIndex = next;
                }
              } else {
                token.after = "";
                token.nodes = [];
              }
              pos = next + 1;
              token.sourceEndIndex = token.unclosed ? next : pos;
              code = value.charCodeAt(pos);
              tokens.push(token);
            } else {
              balanced += 1;
              token.after = "";
              token.sourceEndIndex = pos + 1;
              tokens.push(token);
              stack.push(token);
              tokens = token.nodes = [];
              parent = token;
            }
            name = "";
          } else if (closeParentheses === code && balanced) {
            pos += 1;
            code = value.charCodeAt(pos);
            parent.after = after;
            parent.sourceEndIndex += after.length;
            after = "";
            balanced -= 1;
            stack[stack.length - 1].sourceEndIndex = pos;
            stack.pop();
            parent = stack[balanced];
            tokens = parent.nodes;
          } else {
            next = pos;
            do {
              if (code === backslash) {
                next += 1;
              }
              next += 1;
              code = value.charCodeAt(next);
            } while (next < max && !(code <= 32 || code === singleQuote || code === doubleQuote || code === comma || code === colon || code === slash || code === openParentheses || code === star && parent && parent.type === "function" && parent.value === "calc" || code === slash && parent.type === "function" && parent.value === "calc" || code === closeParentheses && balanced));
            token = value.slice(pos, next);
            if (openParentheses === code) {
              name = token;
            } else if ((uLower === token.charCodeAt(0) || uUpper === token.charCodeAt(0)) && plus === token.charCodeAt(1) && isUnicodeRange.test(token.slice(2))) {
              tokens.push({
                type: "unicode-range",
                sourceIndex: pos,
                sourceEndIndex: next,
                value: token
              });
            } else {
              tokens.push({
                type: "word",
                sourceIndex: pos,
                sourceEndIndex: next,
                value: token
              });
            }
            pos = next;
          }
        }
        for (pos = stack.length - 1; pos; pos -= 1) {
          stack[pos].unclosed = true;
          stack[pos].sourceEndIndex = value.length;
        }
        return stack[0].nodes;
      };
    }
  });

  // node_modules/postcss-value-parser/lib/walk.js
  var require_walk = __commonJS({
    "node_modules/postcss-value-parser/lib/walk.js"(exports, module) {
      module.exports = function walk(nodes, cb, bubble) {
        var i, max, node, result;
        for (i = 0, max = nodes.length; i < max; i += 1) {
          node = nodes[i];
          if (!bubble) {
            result = cb(node, i, nodes);
          }
          if (result !== false && node.type === "function" && Array.isArray(node.nodes)) {
            walk(node.nodes, cb, bubble);
          }
          if (bubble) {
            cb(node, i, nodes);
          }
        }
      };
    }
  });

  // node_modules/postcss-value-parser/lib/stringify.js
  var require_stringify = __commonJS({
    "node_modules/postcss-value-parser/lib/stringify.js"(exports, module) {
      function stringifyNode(node, custom) {
        var type = node.type;
        var value = node.value;
        var buf;
        var customResult;
        if (custom && (customResult = custom(node)) !== void 0) {
          return customResult;
        } else if (type === "word" || type === "space") {
          return value;
        } else if (type === "string") {
          buf = node.quote || "";
          return buf + value + (node.unclosed ? "" : buf);
        } else if (type === "comment") {
          return "/*" + value + (node.unclosed ? "" : "*/");
        } else if (type === "div") {
          return (node.before || "") + value + (node.after || "");
        } else if (Array.isArray(node.nodes)) {
          buf = stringify(node.nodes, custom);
          if (type !== "function") {
            return buf;
          }
          return value + "(" + (node.before || "") + buf + (node.after || "") + (node.unclosed ? "" : ")");
        }
        return value;
      }
      function stringify(nodes, custom) {
        var result, i;
        if (Array.isArray(nodes)) {
          result = "";
          for (i = nodes.length - 1; ~i; i -= 1) {
            result = stringifyNode(nodes[i], custom) + result;
          }
          return result;
        }
        return stringifyNode(nodes, custom);
      }
      module.exports = stringify;
    }
  });

  // node_modules/postcss-value-parser/lib/unit.js
  var require_unit = __commonJS({
    "node_modules/postcss-value-parser/lib/unit.js"(exports, module) {
      var minus = "-".charCodeAt(0);
      var plus = "+".charCodeAt(0);
      var dot = ".".charCodeAt(0);
      var exp = "e".charCodeAt(0);
      var EXP = "E".charCodeAt(0);
      function likeNumber(value) {
        var code = value.charCodeAt(0);
        var nextCode;
        if (code === plus || code === minus) {
          nextCode = value.charCodeAt(1);
          if (nextCode >= 48 && nextCode <= 57) {
            return true;
          }
          var nextNextCode = value.charCodeAt(2);
          if (nextCode === dot && nextNextCode >= 48 && nextNextCode <= 57) {
            return true;
          }
          return false;
        }
        if (code === dot) {
          nextCode = value.charCodeAt(1);
          if (nextCode >= 48 && nextCode <= 57) {
            return true;
          }
          return false;
        }
        if (code >= 48 && code <= 57) {
          return true;
        }
        return false;
      }
      module.exports = function(value) {
        var pos = 0;
        var length = value.length;
        var code;
        var nextCode;
        var nextNextCode;
        if (length === 0 || !likeNumber(value)) {
          return false;
        }
        code = value.charCodeAt(pos);
        if (code === plus || code === minus) {
          pos++;
        }
        while (pos < length) {
          code = value.charCodeAt(pos);
          if (code < 48 || code > 57) {
            break;
          }
          pos += 1;
        }
        code = value.charCodeAt(pos);
        nextCode = value.charCodeAt(pos + 1);
        if (code === dot && nextCode >= 48 && nextCode <= 57) {
          pos += 2;
          while (pos < length) {
            code = value.charCodeAt(pos);
            if (code < 48 || code > 57) {
              break;
            }
            pos += 1;
          }
        }
        code = value.charCodeAt(pos);
        nextCode = value.charCodeAt(pos + 1);
        nextNextCode = value.charCodeAt(pos + 2);
        if ((code === exp || code === EXP) && (nextCode >= 48 && nextCode <= 57 || (nextCode === plus || nextCode === minus) && nextNextCode >= 48 && nextNextCode <= 57)) {
          pos += nextCode === plus || nextCode === minus ? 3 : 2;
          while (pos < length) {
            code = value.charCodeAt(pos);
            if (code < 48 || code > 57) {
              break;
            }
            pos += 1;
          }
        }
        return {
          number: value.slice(0, pos),
          unit: value.slice(pos)
        };
      };
    }
  });

  // node_modules/postcss-value-parser/lib/index.js
  var require_lib = __commonJS({
    "node_modules/postcss-value-parser/lib/index.js"(exports, module) {
      var parse = require_parse();
      var walk = require_walk();
      var stringify = require_stringify();
      function ValueParser(value) {
        if (this instanceof ValueParser) {
          this.nodes = parse(value);
          return this;
        }
        return new ValueParser(value);
      }
      ValueParser.prototype.toString = function() {
        return Array.isArray(this.nodes) ? stringify(this.nodes) : "";
      };
      ValueParser.prototype.walk = function(cb, bubble) {
        walk(this.nodes, cb, bubble);
        return this;
      };
      ValueParser.unit = require_unit();
      ValueParser.walk = walk;
      ValueParser.stringify = stringify;
      module.exports = ValueParser;
    }
  });

  // node_modules/parse-srcset/src/parse-srcset.js
  var require_parse_srcset = __commonJS({
    "node_modules/parse-srcset/src/parse-srcset.js"(exports, module) {
      (function(root, factory) {
        if (typeof define === "function" && define.amd) {
          define([], factory);
        } else if (typeof module === "object" && module.exports) {
          module.exports = factory();
        } else {
          root.parseSrcset = factory();
        }
      })(exports, function() {
        return function(input) {
          function isSpace(c2) {
            return c2 === " " || // space
            c2 === "	" || // horizontal tab
            c2 === "\n" || // new line
            c2 === "\f" || // form feed
            c2 === "\r";
          }
          function collectCharacters(regEx) {
            var chars, match = regEx.exec(input.substring(pos));
            if (match) {
              chars = match[0];
              pos += chars.length;
              return chars;
            }
          }
          var inputLength = input.length, regexLeadingSpaces = /^[ \t\n\r\u000c]+/, regexLeadingCommasOrSpaces = /^[, \t\n\r\u000c]+/, regexLeadingNotSpaces = /^[^ \t\n\r\u000c]+/, regexTrailingCommas = /[,]+$/, regexNonNegativeInteger = /^\d+$/, regexFloatingPoint = /^-?(?:[0-9]+|[0-9]*\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/, url, descriptors, currentDescriptor, state, c, pos = 0, candidates = [];
          while (true) {
            collectCharacters(regexLeadingCommasOrSpaces);
            if (pos >= inputLength) {
              return candidates;
            }
            url = collectCharacters(regexLeadingNotSpaces);
            descriptors = [];
            if (url.slice(-1) === ",") {
              url = url.replace(regexTrailingCommas, "");
              parseDescriptors();
            } else {
              tokenize();
            }
          }
          function tokenize() {
            collectCharacters(regexLeadingSpaces);
            currentDescriptor = "";
            state = "in descriptor";
            while (true) {
              c = input.charAt(pos);
              if (state === "in descriptor") {
                if (isSpace(c)) {
                  if (currentDescriptor) {
                    descriptors.push(currentDescriptor);
                    currentDescriptor = "";
                    state = "after descriptor";
                  }
                } else if (c === ",") {
                  pos += 1;
                  if (currentDescriptor) {
                    descriptors.push(currentDescriptor);
                  }
                  parseDescriptors();
                  return;
                } else if (c === "(") {
                  currentDescriptor = currentDescriptor + c;
                  state = "in parens";
                } else if (c === "") {
                  if (currentDescriptor) {
                    descriptors.push(currentDescriptor);
                  }
                  parseDescriptors();
                  return;
                } else {
                  currentDescriptor = currentDescriptor + c;
                }
              } else if (state === "in parens") {
                if (c === ")") {
                  currentDescriptor = currentDescriptor + c;
                  state = "in descriptor";
                } else if (c === "") {
                  descriptors.push(currentDescriptor);
                  parseDescriptors();
                  return;
                } else {
                  currentDescriptor = currentDescriptor + c;
                }
              } else if (state === "after descriptor") {
                if (isSpace(c)) {
                } else if (c === "") {
                  parseDescriptors();
                  return;
                } else {
                  state = "in descriptor";
                  pos -= 1;
                }
              }
              pos += 1;
            }
          }
          function parseDescriptors() {
            var pError = false, w, d, h, i, candidate = {}, desc, lastChar, value, intVal, floatVal;
            for (i = 0; i < descriptors.length; i++) {
              desc = descriptors[i];
              lastChar = desc[desc.length - 1];
              value = desc.substring(0, desc.length - 1);
              intVal = parseInt(value, 10);
              floatVal = parseFloat(value);
              if (regexNonNegativeInteger.test(value) && lastChar === "w") {
                if (w || d) {
                  pError = true;
                }
                if (intVal === 0) {
                  pError = true;
                } else {
                  w = intVal;
                }
              } else if (regexFloatingPoint.test(value) && lastChar === "x") {
                if (w || d || h) {
                  pError = true;
                }
                if (floatVal < 0) {
                  pError = true;
                } else {
                  d = floatVal;
                }
              } else if (regexNonNegativeInteger.test(value) && lastChar === "h") {
                if (h || d) {
                  pError = true;
                }
                if (intVal === 0) {
                  pError = true;
                } else {
                  h = intVal;
                }
              } else {
                pError = true;
              }
            }
            if (!pError) {
              candidate.url = url;
              if (w) {
                candidate.w = w;
              }
              if (d) {
                candidate.d = d;
              }
              if (h) {
                candidate.h = h;
              }
              candidates.push(candidate);
            } else if (console && console.log) {
              console.log("Invalid srcset descriptor found in '" + input + "' at '" + desc + "'.");
            }
          }
        };
      });
    }
  });

  // src/utils/cssBackground.ts
  var import_postcss_value_parser = __toESM(require_lib(), 1);
  function cleanUrl(raw) {
    return raw.trim().replace(/^['"]|['"]$/g, "");
  }
  function parseImageSet(nodes) {
    const segments = [];
    let current = [];
    for (const node of nodes) {
      if (node.type === "div" && node.value === ",") {
        if (current.length) segments.push(import_postcss_value_parser.default.stringify(current));
        current = [];
      } else {
        current.push(node);
      }
    }
    if (current.length) segments.push(import_postcss_value_parser.default.stringify(current));
    let best = null;
    for (const segment of segments) {
      const parsed = (0, import_postcss_value_parser.default)(segment);
      let url;
      let density;
      parsed.walk((node) => {
        if (node.type === "function" && node.value.toLowerCase() === "url") {
          if (!url) url = cleanUrl(import_postcss_value_parser.default.stringify(node.nodes));
          return false;
        }
        if (node.type === "string" && !url) {
          url = cleanUrl(node.value);
        }
        if (node.type === "word" && /x$/i.test(node.value)) {
          const val = Number(node.value.slice(0, -1));
          if (Number.isFinite(val)) density = val;
        }
        return void 0;
      });
      if (!url) continue;
      const candidate = { url, density, fromImageSet: true };
      if (!best) {
        best = candidate;
      } else {
        const bestScore = best.density ?? 1;
        const candScore = density ?? 1;
        if (candScore > bestScore) best = candidate;
      }
    }
    return best;
  }
  function extractCssImageCandidates(value) {
    const results = [];
    if (!value || value === "none") return results;
    const parsed = (0, import_postcss_value_parser.default)(value);
    parsed.walk((node) => {
      if (node.type !== "function") return void 0;
      const fn = node.value.toLowerCase();
      if (fn === "image-set" || fn === "-webkit-image-set") {
        const best = parseImageSet(node.nodes || []);
        if (best) results.push(best);
        return false;
      }
      if (fn === "url") {
        const raw = cleanUrl(import_postcss_value_parser.default.stringify(node.nodes));
        if (raw) results.push({ url: raw });
        return false;
      }
      return void 0;
    });
    return results;
  }

  // src/utils/srcset.ts
  var import_parse_srcset = __toESM(require_parse_srcset(), 1);
  function fallbackParse(srcset) {
    return srcset.split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
      const [url, descriptor] = entry.split(/\s+/, 2);
      if (!descriptor) return { url };
      if (descriptor.endsWith("w"))
        return { url, descriptor, width: Number(descriptor.slice(0, -1)) };
      if (descriptor.endsWith("x"))
        return { url, descriptor, density: Number(descriptor.slice(0, -1)) };
      return { url, descriptor };
    });
  }
  function parseSrcset(srcset) {
    try {
      const parsed = (0, import_parse_srcset.default)(srcset);
      return parsed.map((c) => ({
        url: c.url,
        width: c.w,
        height: c.h,
        density: c.d,
        descriptor: c.w ? `${c.w}w` : c.d ? `${c.d}x` : void 0
      }));
    } catch {
      return fallbackParse(srcset);
    }
  }

  // src/utils/url.ts
  function canonicalizeUrl(input, base = location.href) {
    try {
      const u = new URL(input, base);
      u.hash = "";
      return u.toString();
    } catch {
      return input;
    }
  }
  function filenameFromUrl(url) {
    try {
      const pathname = new URL(url).pathname;
      const file = pathname.split("/").pop();
      return file || void 0;
    } catch {
      return void 0;
    }
  }

  // src/content/imageExtractor.ts
  var LAZY_ATTRS = ["data-src", "data-lazy-src", "data-original", "data-srcset"];
  var ATTR_HINT_RE = /(src|img|image|photo|poster|thumb|avatar|bg|background|full|orig|large|zoom|raw|hires|highres|media)/i;
  var STRONG_ORIG_RE = /(orig|original|full|large|hires|highres|zoom|raw|download)/i;
  var LOW_RES_RE = /(thumb|small|low|tiny|preview)/i;
  var ALLOWED_EXTS = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "webp", "avif"]);
  var ALLOWED_MIMES = /* @__PURE__ */ new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
  var FORMAT_QUERY_KEYS = ["format", "fm", "ext", "type", "imageformat"];
  var IMG_EXT_RE = /\.(avif|webp|png|jpe?g)(?:$|[?#])/i;
  var URL_TOKEN_RE = /((?:https?:)?\/\/[^\s"'()]+|data:image\/[^\s"'()]+|blob:[^\s"'()]+)/gi;
  var RELATIVE_IMG_RE = /(^|[\s"'(])((?:\.{0,2}\/)?[^\s"'()<>]+?\.(?:avif|webp|png|jpe?g)(?:\?[^\s"'()<>]*)?)/gi;
  var URL_FUNC_RE = /url\((['"]?)(.*?)\1\)/gi;
  var LINK_QUERY_KEYS = ["url", "imgurl", "image", "media", "photo", "src", "u", "uri", "href"];
  var SIZE_QUERY_KEYS = ["w", "width", "h", "height", "size", "s", "sz"];
  var QUALITY_QUERY_KEYS = ["q", "quality"];
  var DPR_QUERY_KEYS = ["dpr"];
  function idFor(url, idx) {
    return `${idx}-${url.slice(0, 80)}`;
  }
  function posForRect(rect) {
    return { pageX: rect.left + window.scrollX, pageY: rect.top + window.scrollY };
  }
  function getViewportBounds(padding) {
    return {
      left: 0 - padding,
      top: 0 - padding,
      right: window.innerWidth + padding,
      bottom: window.innerHeight + padding
    };
  }
  function isVisibleInBounds(el, bounds) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    if (rect.right < bounds.left || rect.left > bounds.right) return false;
    if (rect.bottom < bounds.top || rect.top > bounds.bottom) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const opacity = Number(style.opacity);
    if (Number.isFinite(opacity) && opacity <= 0.01) return false;
    return true;
  }
  function looksLikeImageUrl(url) {
    if (url.startsWith("data:image/")) return true;
    if (url.startsWith("blob:")) return true;
    return getAllowedExtFromUrl(url) !== null;
  }
  function isUrlLike(url) {
    if (/^(https?:|data:image|blob:)/i.test(url)) return true;
    if (/^(\/|\.\/|\.\.\/)/.test(url)) return true;
    if (IMG_EXT_RE.test(url)) return true;
    return false;
  }
  function extractDataUrlMime(dataUrl) {
    const match = dataUrl.match(/^data:(.*?);/);
    return match?.[1] ?? "application/octet-stream";
  }
  function normalizeExt(raw) {
    return raw.toLowerCase().replace(/^\.+/, "").replace(/[^a-z0-9]/g, "");
  }
  function isAllowedExt(ext) {
    if (!ext) return false;
    return ALLOWED_EXTS.has(normalizeExt(ext));
  }
  function isAllowedMime(mime) {
    if (!mime) return false;
    return ALLOWED_MIMES.has(mime.toLowerCase());
  }
  function allowedExtFromQuery(url) {
    for (const key of FORMAT_QUERY_KEYS) {
      const raw = url.searchParams.get(key);
      if (!raw) continue;
      let value = raw.toLowerCase();
      value = value.split(/[;,]/)[0] || value;
      if (value.includes("/")) value = value.split("/").pop() || value;
      if (value.startsWith(".")) value = value.slice(1);
      if (isAllowedExt(value)) return normalizeExt(value);
    }
    return null;
  }
  function allowedExtFromPathname(pathname) {
    const file = pathname.split("/").pop() || "";
    if (!file.includes(".")) return null;
    const ext = file.split(".").pop();
    return isAllowedExt(ext) ? normalizeExt(ext || "") : null;
  }
  function getAllowedExtFromUrl(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      return allowedExtFromPathname(url.pathname) ?? allowedExtFromQuery(url);
    } catch {
      const cleaned = rawUrl.split(/[?#]/)[0];
      const match = cleaned.match(/\.([a-z0-9]{2,5})$/i);
      if (!match) return null;
      return isAllowedExt(match[1]) ? normalizeExt(match[1]) : null;
    }
  }
  function extractUrlsFromValue(value) {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.includes(",") && /\d+w|\d+x/i.test(trimmed)) {
      return parseSrcset(trimmed).map((c) => c.url);
    }
    const urls = [];
    for (const match of trimmed.matchAll(URL_FUNC_RE)) {
      const raw = match[2]?.trim();
      if (raw) urls.push(raw);
    }
    for (const match of trimmed.matchAll(URL_TOKEN_RE)) {
      urls.push(match[0]);
    }
    if (!urls.length) urls.push(trimmed);
    return urls;
  }
  function extractUrlsFromText(text) {
    if (!text) return [];
    const urls = [];
    for (const match of text.matchAll(URL_TOKEN_RE)) {
      urls.push(decodeEscapedUrl(match[0]));
    }
    return urls;
  }
  function extractRelativeImageUrls(text) {
    if (!text) return [];
    const urls = [];
    let match;
    while (match = RELATIVE_IMG_RE.exec(text)) {
      if (match[2]) urls.push(match[2]);
    }
    return urls;
  }
  function extractUrlsFromJsonValue(value) {
    const results = [];
    const seen = /* @__PURE__ */ new Set();
    const visit = (node) => {
      if (node === null || node === void 0) return;
      if (seen.has(node)) return;
      if (typeof node === "string") {
        if (looksLikeImageUrl(node)) results.push(node);
        else extractLinkedImageUrls(node).forEach((u) => results.push(u));
        return;
      }
      if (typeof node === "number" || typeof node === "boolean") return;
      if (Array.isArray(node)) {
        seen.add(node);
        node.forEach(visit);
        return;
      }
      if (typeof node === "object") {
        seen.add(node);
        Object.values(node).forEach(visit);
      }
    };
    visit(value);
    return results;
  }
  function extractUrlsFromCssText(text) {
    if (!text) return [];
    const results = [];
    for (const match of text.matchAll(URL_FUNC_RE)) {
      const raw = match[2]?.trim();
      if (raw) results.push(raw);
    }
    return results;
  }
  function decodeEscapedUrl(value) {
    return value.replace(/\\u002F/gi, "/").replace(/\\u0026/gi, "&").replace(/\\u003A/gi, ":").replace(/\\u003D/gi, "=").replace(/\\\//g, "/").replace(/^"+|"+$/g, "");
  }
  function collectStyleSheetUrls() {
    const urls = /* @__PURE__ */ new Set();
    const sheets = Array.from(document.styleSheets || []);
    for (const sheet of sheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        const cssText = rule.cssText || "";
        const found = extractUrlsFromCssText(cssText);
        for (const raw of found) {
          if (looksLikeImageUrl(raw) || isUrlLike(raw)) urls.add(raw);
        }
      }
    }
    return Array.from(urls);
  }
  function collectHtmlEmbeddedUrls() {
    const html = document.documentElement?.innerHTML || "";
    if (!html) return [];
    const urls = /* @__PURE__ */ new Set();
    const matches = [
      ...extractUrlsFromText(html),
      ...extractRelativeImageUrls(html),
      ...extractUrlsFromCssText(html)
    ];
    for (const raw of matches) {
      if (looksLikeImageUrl(raw)) {
        urls.add(raw);
        continue;
      }
      extractLinkedImageUrls(raw).forEach((u) => urls.add(u));
    }
    return Array.from(urls);
  }
  function collectHtmlFragmentImageUrls(html) {
    if (!html) return [];
    let doc;
    try {
      doc = new DOMParser().parseFromString(html, "text/html");
    } catch {
      return [];
    }
    const urls = /* @__PURE__ */ new Set();
    const addValue = (value) => {
      if (!value) return;
      extractUrlsFromValue(value).forEach((raw) => {
        if (raw) urls.add(raw);
      });
    };
    doc.querySelectorAll("img").forEach((node) => {
      addValue(node.getAttribute("src"));
      addValue(node.getAttribute("srcset"));
      LAZY_ATTRS.forEach((attr) => addValue(node.getAttribute(attr)));
    });
    doc.querySelectorAll("source").forEach((node) => {
      addValue(node.getAttribute("srcset"));
      addValue(node.getAttribute("src"));
    });
    doc.querySelectorAll("video").forEach((node) => {
      addValue(node.getAttribute("poster"));
    });
    doc.querySelectorAll('input[type="image"]').forEach((node) => {
      addValue(node.getAttribute("src"));
    });
    doc.querySelectorAll("[style]").forEach((node) => {
      const style = node.getAttribute("style");
      if (!style) return;
      extractUrlsFromCssText(style).forEach((raw) => urls.add(raw));
    });
    return Array.from(urls);
  }
  function collectEmbeddedFragmentUrls() {
    const urls = /* @__PURE__ */ new Set();
    const blocks = [];
    document.querySelectorAll("noscript").forEach((node) => {
      const html = node.textContent || node.innerHTML || "";
      if (html) blocks.push(html);
    });
    document.querySelectorAll("template").forEach((node) => {
      const html = node.innerHTML || "";
      if (html) blocks.push(html);
    });
    document.querySelectorAll('script[type="text/template"], script[type="text/x-template"], script[type="text/html"]').forEach((node) => {
      const html = node.textContent || "";
      if (html) blocks.push(html);
    });
    for (const html of blocks) {
      collectHtmlFragmentImageUrls(html).forEach((raw) => urls.add(raw));
    }
    return Array.from(urls);
  }
  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  function extractLinkedImageUrls(href) {
    const results = [];
    if (!href) return results;
    if (looksLikeImageUrl(href)) return [href];
    try {
      const u = new URL(href, location.href);
      for (const key of LINK_QUERY_KEYS) {
        const value = u.searchParams.get(key);
        if (!value) continue;
        const decoded = safeDecodeURIComponent(value);
        const candidate = decoded || value;
        if (looksLikeImageUrl(candidate)) results.push(candidate);
      }
    } catch {
    }
    return results;
  }
  function deriveOriginalUrl(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl, location.href);
    } catch {
      return null;
    }
    if (/pinimg\.com$/i.test(url.hostname)) {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length > 1 && parts[0] !== "originals") {
        parts[0] = "originals";
        url.pathname = `/${parts.join("/")}`;
        return url.toString();
      }
    }
    let changed = false;
    SIZE_QUERY_KEYS.forEach((key) => {
      if (!url.searchParams.has(key)) return;
      const current = Number(url.searchParams.get(key));
      const next = Number.isFinite(current) ? Math.max(current, 2048) : 2048;
      url.searchParams.set(key, String(next));
      changed = true;
    });
    QUALITY_QUERY_KEYS.forEach((key) => {
      if (!url.searchParams.has(key)) return;
      url.searchParams.set(key, "95");
      changed = true;
    });
    DPR_QUERY_KEYS.forEach((key) => {
      if (!url.searchParams.has(key)) return;
      url.searchParams.set(key, "2");
      changed = true;
    });
    if (changed) return url.toString();
    const stripped = rawUrl.replace(/=w\d+-h\d+[^&?#]*/i, "").replace(/=s\d+[^&?#]*/i, "").replace(/=w\d+[^&?#]*/i, "").replace(/=h\d+[^&?#]*/i, "");
    if (stripped !== rawUrl && looksLikeImageUrl(stripped)) return stripped;
    if (/\/upload\//i.test(rawUrl) && /\/upload\/[^/]*(w_|h_|c_|q_|f_)/i.test(rawUrl)) {
      const cleaned = rawUrl.replace(
        /(\/upload\/)[^/]+\/(?=[^/]+\.[a-z]{3,5}(?:$|[?#]))/i,
        "$1"
      );
      if (cleaned !== rawUrl && looksLikeImageUrl(cleaned)) return cleaned;
    }
    return null;
  }
  function collectDocumentLinkedImages() {
    const urls = /* @__PURE__ */ new Set();
    const metaSelectors = [
      'meta[property="og:image"]',
      'meta[property="og:image:url"]',
      'meta[name="og:image"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
      'meta[property="twitter:image"]',
      'meta[property$=":image"]',
      'meta[name$="image"]'
    ];
    for (const selector of metaSelectors) {
      document.querySelectorAll(selector).forEach((meta) => {
        const content = meta.content?.trim();
        if (!content) return;
        if (looksLikeImageUrl(content)) {
          urls.add(content);
          return;
        }
        if (isUrlLike(content)) {
          extractLinkedImageUrls(content).forEach((u) => urls.add(u));
        }
      });
    }
    const linkSelectors = [
      'link[rel~="preload"][as="image"]',
      'link[rel~="image_src"]',
      'link[rel~="icon"]',
      'link[rel~="apple-touch-icon"]',
      'link[rel~="thumbnail"]'
    ];
    for (const selector of linkSelectors) {
      document.querySelectorAll(selector).forEach((link) => {
        const href = link.href?.trim();
        if (!href) return;
        if (looksLikeImageUrl(href)) {
          urls.add(href);
          return;
        }
        if (isUrlLike(href)) {
          extractLinkedImageUrls(href).forEach((u) => urls.add(u));
        }
      });
    }
    return Array.from(urls);
  }
  function extractUrlsByKey(text, keys) {
    if (!text) return [];
    const escaped = keys.map((k) => k.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"));
    const re = new RegExp(`"(?:${escaped.join("|")})"\\s*:\\s*"([^"]+)"`, "gi");
    const results = [];
    let match;
    while (match = re.exec(text)) {
      if (match[1]) results.push(decodeEscapedUrl(match[1]));
    }
    return results;
  }
  function collectPinterestUrls() {
    const urls = /* @__PURE__ */ new Set();
    const script = document.querySelector("#__PWS_DATA__") || document.querySelector('script[data-test-id="__PWS_DATA__"]');
    if (script?.textContent) {
      try {
        const data = JSON.parse(script.textContent);
        extractUrlsFromJsonValue(data).forEach((u) => urls.add(u));
      } catch {
      }
    }
    document.querySelectorAll('script[type="application/json"]').forEach((node) => {
      const text = node.textContent || "";
      if (!text.includes("pinimg") && !text.includes('"pins"')) return;
      try {
        const parsed = JSON.parse(text);
        extractUrlsFromJsonValue(parsed).forEach((u) => urls.add(u));
      } catch {
      }
    });
    const html = document.documentElement?.innerHTML || "";
    extractUrlsFromText(html).filter((u) => u.includes("pinimg") || u.includes("pinterest")).forEach((u) => urls.add(u));
    return Array.from(urls);
  }
  function collectInstagramUrls() {
    const urls = /* @__PURE__ */ new Set();
    const html = document.documentElement?.innerHTML || "";
    extractUrlsByKey(html, [
      "display_url",
      "thumbnail_src",
      "profile_pic_url",
      "profile_pic_url_hd",
      "video_url",
      "url"
    ]).forEach((u) => urls.add(u));
    extractUrlsFromText(html).filter((u) => u.includes("cdninstagram") || u.includes("fbcdn") || u.includes("instagram")).forEach((u) => urls.add(u));
    return Array.from(urls);
  }
  function collectFacebookUrls() {
    const urls = /* @__PURE__ */ new Set();
    const html = document.documentElement?.innerHTML || "";
    extractUrlsFromText(html).filter((u) => u.includes("scontent") || u.includes("fbcdn") || u.includes("facebook")).forEach((u) => urls.add(u));
    extractUrlsByKey(html, ["uri", "url", "image"]).forEach((u) => urls.add(u));
    return Array.from(urls);
  }
  function collectSiteSpecificUrls() {
    const host = location.hostname.toLowerCase();
    const urls = /* @__PURE__ */ new Set();
    if (host.includes("pinterest")) {
      collectPinterestUrls().forEach((u) => urls.add(u));
    }
    if (host.includes("instagram")) {
      collectInstagramUrls().forEach((u) => urls.add(u));
    }
    if (host.includes("facebook") || host.includes("fb.com")) {
      collectFacebookUrls().forEach((u) => urls.add(u));
    }
    return Array.from(urls);
  }
  function attributePriority(name, url) {
    let priority = 2;
    if (STRONG_ORIG_RE.test(name)) priority = 5;
    else if (/srcset/.test(name)) priority = 4;
    else if (/src|image|img|photo|poster/.test(name)) priority = 3;
    if (LOW_RES_RE.test(name)) priority = Math.min(priority, 1);
    if (LOW_RES_RE.test(url)) priority = Math.min(priority, 1);
    return priority;
  }
  function pickBestCandidate(candidates) {
    if (!candidates.length) return void 0;
    let best = candidates[0];
    let bestScore = (best.priority ?? 0) * 1e6 + (best.quality ?? 0);
    for (const candidate of candidates.slice(1)) {
      const score = (candidate.priority ?? 0) * 1e6 + (candidate.quality ?? 0);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }
  function pickSrcsetCandidate(candidates, displayWidth) {
    if (!candidates.length) return void 0;
    if (!displayWidth || !Number.isFinite(displayWidth)) {
      return candidates.sort((a, b) => (b.width ?? b.density ?? 0) - (a.width ?? a.density ?? 0))[0];
    }
    const target = displayWidth * (window.devicePixelRatio || 1);
    const withWidth = candidates.filter((c) => Number.isFinite(c.width));
    if (withWidth.length) {
      const above = withWidth.filter((c) => c.width >= target).sort((a, b) => a.width - b.width)[0];
      return above ?? withWidth.sort((a, b) => b.width - a.width)[0];
    }
    const withDensity = candidates.filter((c) => Number.isFinite(c.density)).sort((a, b) => b.density - a.density);
    return withDensity[0] ?? candidates[0];
  }
  function collectAttributeCandidates(el, deepScan = false) {
    const results = [];
    for (const name of el.getAttributeNames()) {
      if (name === "src" || name === "srcset" || name === "href") continue;
      const value = el.getAttribute(name);
      if (!value) continue;
      const lower = name.toLowerCase();
      const hasHint = ATTR_HINT_RE.test(lower);
      const urls = extractUrlsFromValue(value);
      if (!urls.length) continue;
      for (const raw of urls) {
        if (!raw) continue;
        const candidateOk = looksLikeImageUrl(raw) || hasHint && isUrlLike(raw);
        if (candidateOk) {
          results.push({
            url: raw,
            originType: "data-attr",
            priority: attributePriority(lower, raw),
            lazyHint: LAZY_ATTRS.includes(lower)
          });
          continue;
        }
        if (deepScan && isUrlLike(raw)) {
          const linked = extractLinkedImageUrls(raw);
          for (const url of linked) {
            results.push({
              url,
              originType: "data-attr",
              priority: 2,
              lazyHint: LAZY_ATTRS.includes(lower)
            });
          }
        }
      }
      if (deepScan && (value.trim().startsWith("{") || value.trim().startsWith("["))) {
        try {
          const parsed = JSON.parse(value);
          const jsonUrls = extractUrlsFromJsonValue(parsed);
          for (const url of jsonUrls) {
            results.push({
              url,
              originType: "data-attr",
              priority: 2,
              lazyHint: LAZY_ATTRS.includes(lower)
            });
          }
        } catch {
        }
      }
    }
    return results;
  }
  function collectLazyAttributeCandidates(el) {
    const results = [];
    for (const attr of LAZY_ATTRS) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const urls = extractUrlsFromValue(value);
      for (const raw of urls) {
        if (!raw) continue;
        if (!looksLikeImageUrl(raw) && !isUrlLike(raw)) continue;
        results.push({
          url: raw,
          originType: "lazy-attr",
          priority: 3,
          lazyHint: true
        });
      }
    }
    return results;
  }
  function collectImgCandidates(el, rect, includeAttrs, deepScan) {
    const candidates = [];
    const displayWidth = rect.width || el.clientWidth || el.naturalWidth || void 0;
    if (el.srcset) {
      const parsed = parseSrcset(el.srcset);
      const best = pickSrcsetCandidate(parsed, displayWidth);
      if (best?.url) {
        candidates.push({
          url: best.url,
          originType: "srcset",
          priority: 3,
          quality: best.width ?? (best.density ?? 1) * (displayWidth ?? 100),
          srcsetCandidates: parsed.map((c) => c.url)
        });
      }
      if (deepScan) {
        parsed.forEach((cand) => {
          if (!cand.url || cand.url === best?.url) return;
          candidates.push({
            url: cand.url,
            originType: "srcset",
            priority: 2,
            quality: cand.width ?? (cand.density ?? 1) * (displayWidth ?? 100)
          });
        });
      }
    }
    const picture = el.parentElement instanceof HTMLPictureElement ? el.parentElement : null;
    if (picture) {
      for (const source of Array.from(picture.querySelectorAll("source"))) {
        const srcset = source.srcset || source.getAttribute("srcset") || "";
        if (!srcset) continue;
        const parsed = parseSrcset(srcset);
        const best = pickSrcsetCandidate(parsed, displayWidth);
        if (best?.url) {
          candidates.push({
            url: best.url,
            originType: "picture",
            priority: 3,
            quality: best.width ?? (best.density ?? 1) * (displayWidth ?? 100)
          });
        }
        if (deepScan) {
          parsed.forEach((cand) => {
            if (!cand.url || cand.url === best?.url) return;
            candidates.push({
              url: cand.url,
              originType: "picture",
              priority: 2,
              quality: cand.width ?? (cand.density ?? 1) * (displayWidth ?? 100)
            });
          });
        }
      }
    }
    if (el.currentSrc) {
      candidates.push({
        url: el.currentSrc,
        originType: "img",
        priority: 2,
        quality: el.naturalWidth || displayWidth || 0
      });
    }
    if (el.src) {
      candidates.push({
        url: el.src,
        originType: "img",
        priority: 1,
        quality: el.naturalWidth || displayWidth || 0
      });
    }
    const anchor = el.closest("a[href]");
    if (anchor?.href) {
      const linked = extractLinkedImageUrls(anchor.href);
      for (const url of linked) {
        candidates.push({
          url,
          originType: "link-href",
          priority: 4,
          quality: el.naturalWidth || displayWidth || 0
        });
      }
    }
    if (includeAttrs) candidates.push(...collectAttributeCandidates(el, deepScan));
    else candidates.push(...collectLazyAttributeCandidates(el));
    if (deepScan) {
      const extra = [];
      for (const cand of candidates) {
        const derived = deriveOriginalUrl(cand.url);
        if (derived && derived !== cand.url) {
          extra.push({
            url: derived,
            originType: cand.originType,
            priority: cand.priority + 1,
            quality: (cand.quality ?? 0) + 500
          });
        }
      }
      candidates.push(...extra);
    }
    return candidates;
  }
  function collectCssCandidates(el) {
    const results = [];
    const style = getComputedStyle(el);
    const values = [
      { value: style.backgroundImage, originType: "css-background" },
      { value: style.maskImage, originType: "css-mask" },
      { value: style.webkitMaskImage, originType: "css-mask" },
      { value: style.content, originType: "css-content" }
    ];
    for (const entry of values) {
      if (!entry.value || entry.value === "none") continue;
      const candidates = extractCssImageCandidates(entry.value);
      for (const cand of candidates) {
        results.push({
          url: cand.url,
          originType: cand.fromImageSet ? "image-set" : entry.originType,
          priority: cand.fromImageSet ? 3 : 2,
          quality: (cand.density ?? 1) * 1e3
        });
      }
    }
    const pseudoSelectors = ["::before", "::after"];
    for (const pseudo of pseudoSelectors) {
      const pseudoStyle = getComputedStyle(el, pseudo);
      if (!pseudoStyle) continue;
      const pseudoValues = [
        { value: pseudoStyle.backgroundImage, originType: "css-background" },
        { value: pseudoStyle.maskImage, originType: "css-mask" },
        { value: pseudoStyle.webkitMaskImage, originType: "css-mask" },
        { value: pseudoStyle.content, originType: "css-content" }
      ];
      for (const entry of pseudoValues) {
        if (!entry.value || entry.value === "none") continue;
        const candidates = extractCssImageCandidates(entry.value);
        for (const cand of candidates) {
          results.push({
            url: cand.url,
            originType: cand.fromImageSet ? "image-set" : entry.originType,
            priority: cand.fromImageSet ? 3 : 2,
            quality: (cand.density ?? 1) * 1e3
          });
        }
      }
    }
    return results;
  }
  async function maybeDecodeImage(el) {
    if (el.complete && el.naturalWidth) return;
    try {
      await el.decode();
    } catch {
    }
  }
  function collectElements(root, includeIframes) {
    const results = [];
    const seen = /* @__PURE__ */ new Set();
    const queue = [root];
    while (queue.length) {
      const node = queue.pop();
      const elements = [];
      if (node instanceof Element) elements.push(node);
      if ("querySelectorAll" in node) {
        elements.push(...Array.from(node.querySelectorAll?.("*") ?? []));
      }
      for (const el of elements) {
        if (seen.has(el)) continue;
        seen.add(el);
        results.push(el);
        const shadow = el.shadowRoot;
        if (shadow) queue.push(shadow);
        if (includeIframes && el instanceof HTMLIFrameElement) {
          try {
            const doc = el.contentDocument;
            if (doc) queue.push(doc);
          } catch {
          }
        }
      }
    }
    return results;
  }
  async function extractImagesFromRoots(roots, options = {}) {
    const opts = {
      deepScan: options.deepScan ?? false,
      visibleOnly: options.visibleOnly ?? false,
      viewportPadding: options.viewportPadding ?? Math.min(500, Math.round(window.innerHeight * 0.25)),
      includeDataUrls: options.includeDataUrls ?? true,
      includeBlobUrls: options.includeBlobUrls ?? true
    };
    const bounds = opts.visibleOnly ? getViewportBounds(opts.viewportPadding) : null;
    const items = [];
    let idx = 0;
    const includeGlobal = roots.some(
      (root) => root === document.body || root === document.documentElement
    );
    if (opts.deepScan && includeGlobal) {
      const linked = collectDocumentLinkedImages();
      linked.forEach((raw) => {
        const url = canonicalizeUrl(raw);
        items.push({
          id: idFor(url, idx++),
          url,
          originType: "link-href",
          filenameHint: filenameFromUrl(url)
        });
        const derived = deriveOriginalUrl(url);
        if (derived && derived !== url) {
          const absDerived = canonicalizeUrl(derived);
          items.push({
            id: idFor(absDerived, idx++),
            url: absDerived,
            originType: "link-href",
            filenameHint: filenameFromUrl(absDerived)
          });
        }
      });
      const cssUrls = collectStyleSheetUrls();
      cssUrls.forEach((raw) => {
        const url = canonicalizeUrl(raw);
        items.push({
          id: idFor(url, idx++),
          url,
          originType: "css-background",
          filenameHint: filenameFromUrl(url)
        });
        const derived = deriveOriginalUrl(url);
        if (derived && derived !== url) {
          const absDerived = canonicalizeUrl(derived);
          items.push({
            id: idFor(absDerived, idx++),
            url: absDerived,
            originType: "css-background",
            filenameHint: filenameFromUrl(absDerived)
          });
        }
      });
      const embedded = collectHtmlEmbeddedUrls();
      embedded.forEach((raw) => {
        const url = canonicalizeUrl(raw);
        items.push({
          id: idFor(url, idx++),
          url,
          originType: "data-attr",
          filenameHint: filenameFromUrl(url)
        });
      });
      const fragments = collectEmbeddedFragmentUrls();
      fragments.forEach((raw) => {
        const url = canonicalizeUrl(raw);
        items.push({
          id: idFor(url, idx++),
          url,
          originType: "data-attr",
          filenameHint: filenameFromUrl(url)
        });
      });
      const siteUrls = collectSiteSpecificUrls();
      siteUrls.forEach((raw) => {
        const url = canonicalizeUrl(raw);
        items.push({
          id: idFor(url, idx++),
          url,
          originType: "link-href",
          filenameHint: filenameFromUrl(url)
        });
        const derived = deriveOriginalUrl(url);
        if (derived && derived !== url) {
          const absDerived = canonicalizeUrl(derived);
          items.push({
            id: idFor(absDerived, idx++),
            url: absDerived,
            originType: "link-href",
            filenameHint: filenameFromUrl(absDerived)
          });
        }
      });
    }
    for (const root of roots) {
      const elements = collectElements(root, opts.deepScan);
      for (const el of elements) {
        try {
          if (bounds && !isVisibleInBounds(el, bounds)) continue;
          const rect = el.getBoundingClientRect();
          const pos = posForRect(rect);
          if (el instanceof HTMLImageElement) {
            if (opts.deepScan) await maybeDecodeImage(el);
            const candidates = collectImgCandidates(el, rect, opts.deepScan, opts.deepScan);
            const best = pickBestCandidate(candidates);
            const selected = opts.deepScan ? candidates : best ? [best] : [];
            const seen = /* @__PURE__ */ new Set();
            for (const cand of selected) {
              if (!cand?.url) continue;
              const url = canonicalizeUrl(cand.url);
              if (seen.has(url)) continue;
              seen.add(url);
              items.push({
                id: idFor(url, idx++),
                url,
                originType: cand.originType,
                width: el.naturalWidth || void 0,
                height: el.naturalHeight || void 0,
                filenameHint: filenameFromUrl(url),
                srcsetCandidates: cand.srcsetCandidates,
                lazyHint: cand.lazyHint,
                pageX: pos.pageX,
                pageY: pos.pageY
              });
            }
            continue;
          }
          if (el instanceof HTMLCanvasElement) {
            try {
              const dataUrl = el.toDataURL("image/png");
              items.push({
                id: idFor(dataUrl, idx++),
                url: dataUrl,
                originType: "canvas",
                isCanvas: true,
                isDataUrl: true,
                width: el.width,
                height: el.height,
                filenameHint: "canvas.png",
                pageX: pos.pageX,
                pageY: pos.pageY
              });
            } catch {
            }
            continue;
          }
          if (el instanceof SVGElement) {
            if (!opts.includeDataUrls) continue;
            try {
              const clone = el.cloneNode(true);
              if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
              const payload = new XMLSerializer().serializeToString(clone);
              const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(payload)))}`;
              items.push({
                id: idFor(dataUrl, idx++),
                url: dataUrl,
                originType: "inline-svg",
                isInlineSVG: true,
                isDataUrl: true,
                filenameHint: "vector.svg",
                pageX: pos.pageX,
                pageY: pos.pageY
              });
            } catch {
            }
            continue;
          }
          if (el instanceof HTMLVideoElement && el.poster) {
            const url = canonicalizeUrl(el.poster);
            items.push({
              id: idFor(url, idx++),
              url,
              originType: "video-poster",
              filenameHint: filenameFromUrl(url),
              pageX: pos.pageX,
              pageY: pos.pageY
            });
          }
          if (el instanceof HTMLInputElement && el.type.toLowerCase() === "image" && el.src) {
            const url = canonicalizeUrl(el.src);
            items.push({
              id: idFor(url, idx++),
              url,
              originType: "img",
              filenameHint: filenameFromUrl(url),
              pageX: pos.pageX,
              pageY: pos.pageY
            });
          }
          if (opts.deepScan && el instanceof HTMLSourceElement) {
            const srcset = el.srcset || el.getAttribute("srcset") || "";
            if (srcset) {
              const parsed = parseSrcset(srcset);
              parsed.forEach((cand) => {
                if (!cand.url) return;
                const url = canonicalizeUrl(cand.url);
                items.push({
                  id: idFor(url, idx++),
                  url,
                  originType: "picture",
                  filenameHint: filenameFromUrl(url),
                  pageX: pos.pageX,
                  pageY: pos.pageY
                });
              });
            }
          }
          if (opts.deepScan && el instanceof HTMLScriptElement) {
            const type = (el.type || "").toLowerCase();
            if (type.includes("json")) {
              const text = el.textContent || "";
              let urls = extractUrlsFromText(text);
              if (!urls.length) {
                try {
                  const parsed = JSON.parse(text);
                  urls = extractUrlsFromJsonValue(parsed);
                } catch {
                }
              }
              for (const raw of urls) {
                if (!looksLikeImageUrl(raw)) continue;
                const url = canonicalizeUrl(raw);
                items.push({
                  id: idFor(url, idx++),
                  url,
                  originType: "data-attr",
                  filenameHint: filenameFromUrl(url),
                  pageX: pos.pageX,
                  pageY: pos.pageY
                });
              }
            }
          }
          if (el instanceof HTMLElement) {
            const cssCandidates = collectCssCandidates(el);
            for (const cand of cssCandidates) {
              if (!cand.url) continue;
              const url = canonicalizeUrl(cand.url);
              items.push({
                id: idFor(url, idx++),
                url,
                originType: cand.originType,
                filenameHint: filenameFromUrl(url),
                pageX: pos.pageX,
                pageY: pos.pageY
              });
              if (opts.deepScan) {
                const derived = deriveOriginalUrl(url);
                if (derived && derived !== url) {
                  const absDerived = canonicalizeUrl(derived);
                  items.push({
                    id: idFor(absDerived, idx++),
                    url: absDerived,
                    originType: cand.originType,
                    filenameHint: filenameFromUrl(absDerived),
                    pageX: pos.pageX,
                    pageY: pos.pageY
                  });
                }
              }
            }
          }
          if (!opts.deepScan) {
            const lazyCandidates = collectLazyAttributeCandidates(el);
            for (const cand of lazyCandidates) {
              if (!cand?.url) continue;
              const url = canonicalizeUrl(cand.url);
              items.push({
                id: idFor(url, idx++),
                url,
                originType: cand.originType,
                filenameHint: filenameFromUrl(url),
                lazyHint: cand.lazyHint,
                pageX: pos.pageX,
                pageY: pos.pageY
              });
            }
          }
          if (opts.deepScan) {
            if (el instanceof HTMLAnchorElement && el.href) {
              const linked = extractLinkedImageUrls(el.href);
              for (const url of linked) {
                const abs = canonicalizeUrl(url);
                items.push({
                  id: idFor(abs, idx++),
                  url: abs,
                  originType: "link-href",
                  filenameHint: filenameFromUrl(abs),
                  pageX: pos.pageX,
                  pageY: pos.pageY
                });
                const derived = deriveOriginalUrl(abs);
                if (derived && derived !== abs) {
                  const absDerived = canonicalizeUrl(derived);
                  items.push({
                    id: idFor(absDerived, idx++),
                    url: absDerived,
                    originType: "link-href",
                    filenameHint: filenameFromUrl(absDerived),
                    pageX: pos.pageX,
                    pageY: pos.pageY
                  });
                }
              }
            }
            const attrCandidates = collectAttributeCandidates(el, true);
            for (const cand of attrCandidates) {
              if (!cand?.url) continue;
              const url = canonicalizeUrl(cand.url);
              items.push({
                id: idFor(url, idx++),
                url,
                originType: cand.originType,
                filenameHint: filenameFromUrl(url),
                lazyHint: cand.lazyHint,
                pageX: pos.pageX,
                pageY: pos.pageY
              });
              const derived = deriveOriginalUrl(url);
              if (derived && derived !== url) {
                const absDerived = canonicalizeUrl(derived);
                items.push({
                  id: idFor(absDerived, idx++),
                  url: absDerived,
                  originType: cand.originType,
                  filenameHint: filenameFromUrl(absDerived),
                  lazyHint: cand.lazyHint,
                  pageX: pos.pageX,
                  pageY: pos.pageY
                });
              }
            }
          }
        } catch (error) {
          console.warn("Element extraction failed", error);
        }
      }
    }
    return items.filter((item) => {
      const url = item.url.toLowerCase();
      if (url.startsWith("data:")) {
        if (!opts.includeDataUrls) return false;
        const mime = extractDataUrlMime(item.url);
        return isAllowedMime(mime) && !mime.toLowerCase().includes("svg");
      }
      if (url.startsWith("blob:")) {
        if (!opts.includeBlobUrls) return false;
        const allowedOrigins = [
          "img",
          "srcset",
          "picture",
          "css-background",
          "css-mask",
          "css-content",
          "image-set",
          "video-poster",
          "lazy-attr",
          "canvas"
        ];
        return allowedOrigins.includes(item.originType);
      }
      if (url.endsWith(".svg") || url.includes("svg+xml")) return false;
      return getAllowedExtFromUrl(item.url) !== null;
    }).map((item) => {
      if (item.url.startsWith("data:")) {
        const mime = extractDataUrlMime(item.url);
        const ext = mime.split("/")[1]?.split("+")[0] || "bin";
        return { ...item, isDataUrl: true, filenameHint: item.filenameHint ?? `data.${ext}` };
      }
      return item;
    }).filter((item, i, arr) => arr.findIndex((x) => x.url === item.url) === i);
  }

  // src/content/selectorOverlay.ts
  function normalizeExtractOptions(overrides) {
    const basePadding = Math.min(500, Math.round(window.innerHeight * 0.25));
    const padding = typeof overrides?.viewportPadding === "number" ? Math.max(0, overrides.viewportPadding) : basePadding;
    return {
      deepScan: overrides?.deepScan ?? false,
      visibleOnly: overrides?.visibleOnly ?? true,
      viewportPadding: padding,
      includeDataUrls: overrides?.includeDataUrls ?? true,
      includeBlobUrls: overrides?.includeBlobUrls ?? true
    };
  }
  window.__madcapture_extract_images__ = async (options) => {
    return extractImagesFromRoots([document.body], normalizeExtractOptions(options));
  };
  if (!window.__madcapture_selector_booted__) {
    let selectorFor = function(el) {
      const parts = [];
      let node = el;
      while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
        const id = node.id ? `#${CSS.escape(node.id)}` : "";
        const cls = node.classList.length ? `.${[...node.classList].slice(0, 2).map((c) => CSS.escape(c)).join(".")}` : "";
        parts.unshift(`${node.tagName.toLowerCase()}${id || cls}`);
        node = node.parentElement;
      }
      return parts.join(" > ");
    }, hasImageHints = function(el) {
      if (el instanceof HTMLImageElement) return true;
      if (el instanceof HTMLVideoElement && el.poster) return true;
      if (el instanceof HTMLCanvasElement) return true;
      if (el instanceof SVGElement) return true;
      if (el instanceof HTMLInputElement && el.type.toLowerCase() === "image") return true;
      if (el instanceof HTMLElement) {
        const style = getComputedStyle(el);
        if (style.backgroundImage && style.backgroundImage !== "none") return true;
        if (style.content && style.content !== "none" && style.content.includes("url(")) return true;
      }
      return !!el.querySelector(IMAGE_HINT_SELECTOR);
    }, findCaptureRoot = function(el) {
      let node = el;
      let depth = 0;
      while (node && depth < 6) {
        if (node !== document.body && node !== document.documentElement && hasImageHints(node)) {
          return node;
        }
        const parent = node.parentElement;
        if (!parent || parent === document.body || parent === document.documentElement) break;
        node = parent;
        depth += 1;
      }
      return el;
    }, expandSelectionRoots = function(elements) {
      const roots = [];
      const seen = /* @__PURE__ */ new Set();
      for (const el of elements) {
        const root = findCaptureRoot(el);
        if (!seen.has(root)) {
          seen.add(root);
          roots.push(root);
        }
      }
      return roots;
    }, ensureOverlay = function() {
      if (state.overlay) return;
      const shield = document.createElement("div");
      shield.style.position = "fixed";
      shield.style.inset = "0";
      shield.style.pointerEvents = "auto";
      shield.style.background = "transparent";
      shield.style.zIndex = "2147483646";
      shield.style.cursor = "crosshair";
      document.documentElement.append(shield);
      const host = document.createElement("div");
      host.style.position = "fixed";
      host.style.inset = "0";
      host.style.pointerEvents = "none";
      host.style.zIndex = "2147483647";
      const shadow = host.attachShadow({ mode: "open" });
      const box = document.createElement("div");
      box.style.position = "fixed";
      box.style.border = "2px solid #7c4dff";
      box.style.background = "rgba(124,77,255,0.15)";
      box.style.opacity = "0";
      box.style.pointerEvents = "none";
      const tooltip = document.createElement("div");
      tooltip.style.position = "fixed";
      tooltip.style.background = "#111";
      tooltip.style.color = "#fff";
      tooltip.style.padding = "4px 6px";
      tooltip.style.font = "12px sans-serif";
      tooltip.style.opacity = "0";
      tooltip.style.pointerEvents = "none";
      shadow.append(box, tooltip);
      document.documentElement.append(host);
      state.shield = shield;
      state.overlay = host;
      state.box = box;
      state.tooltip = tooltip;
    }, renderCurrent = function(el) {
      const rect = el.getBoundingClientRect();
      if (!state.box || !state.tooltip) return;
      state.box.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
      state.box.style.width = `${rect.width}px`;
      state.box.style.height = `${rect.height}px`;
      state.box.style.opacity = "1";
      state.tooltip.textContent = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
      state.tooltip.style.transform = `translate(${rect.left}px, ${Math.max(0, rect.top - 22)}px)`;
      state.tooltip.style.opacity = "1";
    }, elementUnderPoint = function(x, y) {
      const list = document.elementsFromPoint(x, y);
      for (const el of list) {
        if (state.shield && el === state.shield) continue;
        if (state.overlay && (el === state.overlay || state.overlay.contains(el))) continue;
        return el;
      }
      return null;
    }, onMove = function(ev) {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = elementUnderPoint(ev.clientX, ev.clientY);
        if (!el || state.overlay && (el === state.overlay || state.overlay.contains(el))) return;
        state.current = el;
        renderCurrent(el);
      });
    }, onKey = function(ev) {
      if (ev.key === "Escape") {
        deactivate();
        chrome.runtime.sendMessage({ type: "SELECTION_CANCELLED" });
      }
      if (ev.key === "[" && state.current?.parentElement) {
        state.current = state.current.parentElement;
        renderCurrent(state.current);
      }
      if (ev.key === "]" && state.current?.children[0]) {
        state.current = state.current.children[0];
        renderCurrent(state.current);
      }
    }, stopEvents = function(ev) {
      if (!state.active) return;
      if (ev.type === "click" && ev instanceof MouseEvent) {
        if (state.current) {
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation();
          if (!ev.shiftKey) {
            state.locked = [];
            deactivate();
          }
          if (!state.locked.includes(state.current)) state.locked.push(state.current);
          chrome.runtime.sendMessage({ type: "WAIT_FOR_IMAGES" });
          void reportSelection();
          return;
        }
      }
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    }, activate = function() {
      if (state.active) return;
      state.active = true;
      state.locked = [];
      state.current = void 0;
      ensureOverlay();
      window.addEventListener("click", stopEvents, true);
      window.addEventListener("mousedown", stopEvents, true);
      window.addEventListener("mouseup", stopEvents, true);
      window.addEventListener("pointerdown", stopEvents, true);
      window.addEventListener("pointerup", stopEvents, true);
      window.addEventListener("dblclick", stopEvents, true);
      document.addEventListener("pointermove", onMove, true);
      document.addEventListener("keydown", onKey, true);
      document.body.style.cursor = "crosshair";
    }, deactivate = function() {
      if (!state.active) return;
      state.active = false;
      window.removeEventListener("click", stopEvents, true);
      window.removeEventListener("mousedown", stopEvents, true);
      window.removeEventListener("mouseup", stopEvents, true);
      window.removeEventListener("pointerdown", stopEvents, true);
      window.removeEventListener("pointerup", stopEvents, true);
      window.removeEventListener("dblclick", stopEvents, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.cursor = "";
      state.overlay?.remove();
      state.shield?.remove();
      state.overlay = void 0;
      state.shield = void 0;
    };
    selectorFor2 = selectorFor, hasImageHints2 = hasImageHints, findCaptureRoot2 = findCaptureRoot, expandSelectionRoots2 = expandSelectionRoots, ensureOverlay2 = ensureOverlay, renderCurrent2 = renderCurrent, elementUnderPoint2 = elementUnderPoint, onMove2 = onMove, onKey2 = onKey, stopEvents2 = stopEvents, activate2 = activate, deactivate2 = deactivate;
    window.__madcapture_selector_booted__ = true;
    const state = { active: false, locked: [] };
    const IMAGE_HINT_SELECTOR = [
      "img",
      "picture",
      "source[srcset]",
      "source[src]",
      "video[poster]",
      "canvas",
      "svg",
      'input[type="image"]',
      '[style*="background"]',
      '[style*="url("]',
      "[data-src]",
      "[data-srcset]",
      "[data-lazy-src]",
      "[data-original]"
    ].join(",");
    let raf = 0;
    async function reportSelection() {
      const payload = {
        selectors: state.locked.map(selectorFor),
        rects: state.locked.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        })
      };
      try {
        const options = state.extractOptions ?? normalizeExtractOptions();
        const roots = expandSelectionRoots(state.locked);
        const images = await extractImagesFromRoots(roots, options);
        chrome.runtime.sendMessage({ type: "SELECTION_LOCKED", payload, images });
      } catch (error) {
        chrome.runtime.sendMessage({
          type: "SELECTION_LOCKED",
          payload,
          images: [],
          error: error.message
        });
      }
    }
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === "TOGGLE_SELECTOR") {
        if (state.active) deactivate();
        else activate();
        state.extractOptions = normalizeExtractOptions(msg.options);
        sendResponse({ active: state.active });
      }
      if (msg.type === "EXTRACT_PAGE_IMAGES") {
        (async () => {
          chrome.runtime.sendMessage({ type: "WAIT_FOR_IMAGES" });
          try {
            const images = await extractImagesFromRoots(
              [document.body],
              normalizeExtractOptions(msg.options)
            );
            chrome.runtime.sendMessage({ type: "PAGE_IMAGES_FOUND", images });
          } catch (error) {
            chrome.runtime.sendMessage({
              type: "PAGE_IMAGES_FOUND",
              images: [],
              error: error.message
            });
          }
        })();
        sendResponse({ ok: true });
      }
      if (msg.type === "SET_EXTRACT_OPTIONS") {
        state.extractOptions = normalizeExtractOptions(msg.options);
        sendResponse({ ok: true });
      }
      if (msg.type === "LOCATE_IMAGE_ON_PAGE") {
        (async () => {
          try {
            const result = await locateAndHighlight(msg.url, msg.pageX, msg.pageY);
            sendResponse(result);
          } catch (error) {
            sendResponse({ ok: false, error: error.message });
          }
        })();
        return true;
      }
      return true;
    });
  }
  var selectorFor2;
  var hasImageHints2;
  var findCaptureRoot2;
  var expandSelectionRoots2;
  var ensureOverlay2;
  var renderCurrent2;
  var elementUnderPoint2;
  var onMove2;
  var onKey2;
  var stopEvents2;
  var activate2;
  var deactivate2;
  function normalizeUrl(input, base = location.href) {
    try {
      const u = new URL(input, base);
      u.hash = "";
      return u.toString();
    } catch {
      return input;
    }
  }
  function srcsetUrls(srcset) {
    return srcset.split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
  }
  function extractCssUrls(value) {
    const urls = [];
    const re = /url\((['"]?)(.*?)\1\)/g;
    let match;
    while (match = re.exec(value)) {
      if (match[2]) urls.push(match[2]);
    }
    return urls;
  }
  function findCandidates(targetUrl) {
    const targetNorm = normalizeUrl(targetUrl);
    const candidates = [];
    for (const img of Array.from(document.images)) {
      const srcs = [img.currentSrc, img.src].filter(Boolean).map((u) => normalizeUrl(u));
      if (srcs.includes(targetNorm)) {
        candidates.push(img);
        continue;
      }
      if (img.srcset) {
        const urls = srcsetUrls(img.srcset).map((u) => normalizeUrl(u));
        if (urls.includes(targetNorm)) candidates.push(img);
      }
    }
    for (const source of Array.from(document.querySelectorAll("source"))) {
      const srcset = source.srcset || source.getAttribute("srcset") || "";
      if (!srcset) continue;
      const urls = srcsetUrls(srcset).map((u) => normalizeUrl(u));
      if (urls.includes(targetNorm)) {
        candidates.push(source.parentElement ?? source);
      }
    }
    for (const video of Array.from(document.querySelectorAll("video"))) {
      const poster = video.poster;
      if (poster && normalizeUrl(poster) === targetNorm) candidates.push(video);
    }
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === "none") continue;
      const urls = extractCssUrls(bg).map((u) => normalizeUrl(u));
      if (urls.includes(targetNorm)) candidates.push(el);
    }
    return candidates;
  }
  function pickClosest(candidates, pageX, pageY) {
    if (!candidates.length) return null;
    if (!Number.isFinite(pageX) || !Number.isFinite(pageY)) return candidates[0];
    let best = candidates[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + window.scrollX + rect.width / 2;
      const cy = rect.top + window.scrollY + rect.height / 2;
      const dx = cx - pageX;
      const dy = cy - pageY;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = el;
      }
    }
    return best;
  }
  async function highlightElement(el) {
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    await waitForScrollStop();
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.border = "2px solid #f2c94c";
    overlay.style.boxShadow = "0 0 0 2px rgba(242, 201, 76, 0.6), 0 0 20px rgba(242, 201, 76, 0.45)";
    overlay.style.borderRadius = "6px";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "2147483647";
    overlay.style.transition = "opacity 0.6s ease";
    document.documentElement.appendChild(overlay);
    setTimeout(() => {
      overlay.style.opacity = "0";
    }, 800);
    setTimeout(() => {
      overlay.remove();
    }, 1400);
  }
  async function waitForScrollStop(timeoutMs = 2500, idleMs = 200) {
    return new Promise((resolve) => {
      let settled = false;
      let idleTimer;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (idleTimer) window.clearTimeout(idleTimer);
        window.removeEventListener("scroll", onScroll, true);
        resolve();
      };
      const onScroll = () => {
        if (idleTimer) window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(finish, idleMs);
      };
      window.addEventListener("scroll", onScroll, true);
      idleTimer = window.setTimeout(finish, idleMs);
      window.setTimeout(finish, timeoutMs);
    });
  }
  async function locateAndHighlight(url, pageX, pageY) {
    if (!url) return { ok: false, error: "Missing image url", level: "error" };
    const candidates = findCandidates(url);
    let target = pickClosest(candidates, pageX, pageY);
    if (!target && Number.isFinite(pageY)) {
      window.scrollTo({ top: Math.max(0, pageY - window.innerHeight / 2), behavior: "smooth" });
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (Number.isFinite(pageX)) {
        const x = Math.min(window.innerWidth - 1, Math.max(0, pageX - window.scrollX));
        const y = Math.min(window.innerHeight - 1, Math.max(0, pageY - window.scrollY));
        target = document.elementFromPoint(x, y) || null;
      }
    }
    if (!target) return { ok: false, error: "Could not locate image on page", level: "warn" };
    await highlightElement(target);
    return { ok: true };
  }
})();
