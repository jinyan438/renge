function skipQuotedSegment(source: string, startIndex: number, quote: string) {
  for (let index = startIndex + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === quote) return index + 1;
  }
  return source.length;
}

function skipWhitespaceAndComments(source: string, startIndex: number) {
  let index = startIndex;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (source[index] === "/" && source[index + 1] === "/") {
      const lineEnd = source.indexOf("\n", index + 2);
      index = lineEnd < 0 ? source.length : lineEnd + 1;
      continue;
    }
    if (source[index] === "/" && source[index + 1] === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      index = commentEnd < 0 ? source.length : commentEnd + 2;
      continue;
    }
    break;
  }
  return index;
}

function hasTavernModuleKeyword(source: string) {
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '"' || character === "'" || character === "`") {
      index = skipQuotedSegment(source, index, character);
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index = skipWhitespaceAndComments(source, index);
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      index = skipWhitespaceAndComments(source, index);
      continue;
    }
    if (!/[A-Za-z_$]/.test(character)) {
      index += 1;
      continue;
    }

    const tokenStart = index;
    index += 1;
    while (index < source.length && /[\w$]/.test(source[index])) index += 1;
    const token = source.slice(tokenStart, index);
    if (token !== "import" && token !== "export") continue;

    const previousCharacter = source.slice(0, tokenStart).match(/\S(?=\s*$)/)?.[0] ?? "";
    if (previousCharacter === "." || /[\w$]/.test(previousCharacter)) continue;
    if (token === "export") return true;

    const nextIndex = skipWhitespaceAndComments(source, index);
    const nextCharacter = source[nextIndex];
    if (nextCharacter === ".") return true;
    if (nextCharacter !== "(") return true;
  }
  return false;
}

export function usesTavernModuleSyntax(source: string) {
  try {
    // Compiling a Function only parses the source; it does not execute it. This lets
    // Chromium distinguish a genuine top-level await from awaits inside async
    // functions without changing classic-script scoping for legacy Tavern scripts.
    Function(source);
    return false;
  } catch (error) {
    if (!(error instanceof SyntaxError)) return false;
    if (hasTavernModuleKeyword(source)) {
      return true;
    }
    return (
      /\bawait\b/.test(source) &&
      /await[\s\S]*(?:async functions?|modules?|top level)|(?:reserved word|unexpected token)[\s\S]*await/i.test(
        error.message,
      )
    );
  }
}

export function scopeTavernClassicScript(source: string) {
  // TavernHelper evaluates each classic script in its own function scope. Keep
  // bundled top-level names from shadowing globals used by another card module.
  return `(function () {\n${source}\n}).call(window);`;
}
