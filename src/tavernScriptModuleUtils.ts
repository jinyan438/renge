import { skipQuotedSegment, skipWhitespaceAndComments } from "./tavernModuleImports.mjs";
export { getTavernStaticModuleImports } from "./tavernModuleImports.mjs";

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

export function requiresTavernChatDom(source: string) {
  let index = 0;
  const observerCalls: boolean[] = [];
  while (index < source.length) {
    index = skipWhitespaceAndComments(source, index);
    const character = source[index];
    if (character === '"' || character === "'" || character === "`") {
      index = skipQuotedSegment(source, index, character);
      continue;
    }
    if (character === "(") {
      observerCalls.push(/\bobserve\s*$/.test(source.slice(Math.max(0, index - 64), index)));
    } else if (character === ")") {
      observerCalls.pop();
    }
    const match = character === "g" || character === "q"
      ? /^(getElementById|querySelectorAll|querySelector)\b/.exec(source.slice(index))
      : null;
    if (match && !/[\w$]/.test(source[index - 1] ?? "")) {
      const call = skipWhitespaceAndComments(source, index + match[0].length);
      if (source[call] === "(") {
        const argument = skipWhitespaceAndComments(source, call + 1);
        const quote = source[argument];
        if (quote === '"' || quote === "'") {
          const end = skipQuotedSegment(source, argument, quote);
          const selector = source.slice(argument + 1, end - 1);
          const chatSelector = match[0] === "getElementById"
            ? selector === "chat"
            : /^#chat(?:$|[\s.#:[,>+~])/.test(selector);
          const close = skipWhitespaceAndComments(source, end);
          const member = skipWhitespaceAndComments(source, close + 1);
          // Merely defining a guarded decorator must keep working before chat
          // opens. A concrete observer target or direct dereference needs DOM.
          if (chatSelector && (observerCalls.includes(true) || (source[close] === ")" && source[member] === "."))) return true;
        }
      }
    }
    index += 1;
  }
  return false;
}
