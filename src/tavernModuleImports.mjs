export function skipQuotedSegment(source, startIndex, quote) {
  for (let index = startIndex + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === quote) return index + 1;
  }
  return source.length;
}

export function skipWhitespaceAndComments(source, startIndex) {
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

/** Download static imports without evaluating modules or speculative lazy code. */
export function getTavernStaticModuleImports(source) {
  const urls = new Set();
  let index = 0;
  while (index < source.length) {
    index = skipWhitespaceAndComments(source, index);
    const character = source[index];
    if (character === '"' || character === "'" || character === "`") {
      index = skipQuotedSegment(source, index, character);
      continue;
    }
    const keyword = /^(?:import|export)\b/.exec(source.slice(index));
    if (!keyword || /[\w$.]/.test(source[index - 1] ?? "")) { index += 1; continue; }
    index = skipWhitespaceAndComments(source, index + keyword[0].length);
    if (source[index] === "(" || source[index] === ".") continue;
    if (keyword[0] === "export" && !/[{*]/.test(source[index] ?? "")) continue;
    // Only a side-effect import, or the literal following `from`, is a URL.
    let expectsUrl = keyword[0] === "import";
    while (index < source.length) {
      index = skipWhitespaceAndComments(source, index);
      const next = source[index];
      if (next === ";" || next === undefined) break;
      if (next === '"' || next === "'" || next === "`") {
        const end = skipQuotedSegment(source, index, next);
        if (expectsUrl && next !== "`") urls.add(source.slice(index + 1, end - 1));
        index = end;
        break;
      }
      const token = /^[\w$]+/.exec(source.slice(index));
      expectsUrl = token?.[0] === "from";
      index += token?.[0].length ?? 1;
    }
  }
  return [...urls];
}
