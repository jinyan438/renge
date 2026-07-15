export function usesTavernModuleSyntax(source: string) {
  try {
    // Compiling a Function only parses the source; it does not execute it. This lets
    // Chromium distinguish a genuine top-level await from awaits inside async
    // functions without changing classic-script scoping for legacy Tavern scripts.
    Function(source);
    return false;
  } catch (error) {
    if (!(error instanceof SyntaxError)) return false;
    if (
      /(^|\n)\s*(?:import\s+(?:[\s\S]*?\s+from\s+)?["']|export\s+)/m.test(source) ||
      /\bimport\s*\.\s*meta\b/.test(source)
    ) {
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
