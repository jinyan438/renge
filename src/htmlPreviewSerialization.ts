type PreviewValue = null | boolean | number | string | [number];
type PreviewNode =
  | [0, Array<[string, PreviewValue]>]
  | [1, PreviewValue[]]
  | [2, string];

function escapePreviewJson(json: string) {
  return json
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Serialize an inline script expression without expanding shared snapshot data.
 * Tavern snapshots alias complete cards by name/id and repeat HTML in messages,
 * swipes, regexes and scripts. Plain JSON can exceed the engine's string limit
 * even when the underlying snapshot is small enough to fit comfortably in memory.
 */
export function serializeHtmlPreviewValue(value: unknown): string {
  const nodes: PreviewNode[] = [];
  const objects = new WeakMap<object, number>();
  const strings = new Map<string, number>();
  const encode = (input: unknown, key: string): PreviewValue | undefined => {
    let current = input;
    if (current && typeof current === "object" &&
        typeof (current as { toJSON?: unknown }).toJSON === "function") {
      current = (current as { toJSON: (key: string) => unknown }).toJSON(key);
    }
    if (current instanceof Number || current instanceof String || current instanceof Boolean) {
      current = current.valueOf();
    }
    if (current === null) return null;
    if (typeof current === "boolean") return current;
    if (typeof current === "number") return Number.isFinite(current) ? current : null;
    if (typeof current === "string") {
      if (current.length < 1024) return current;
      let index = strings.get(current);
      if (index === undefined) {
        index = nodes.length;
        strings.set(current, index);
        nodes.push([2, current]);
      }
      return [index];
    }
    if (typeof current === "bigint") throw new TypeError("Do not know how to serialize a BigInt");
    if (typeof current !== "object") return undefined;
    const knownIndex = objects.get(current);
    if (knownIndex !== undefined) return [knownIndex];
    const index = nodes.length;
    objects.set(current, index);
    if (Array.isArray(current)) {
      const items: PreviewValue[] = [];
      nodes.push([1, items]);
      for (let itemIndex = 0; itemIndex < current.length; itemIndex += 1) {
        items.push(encode(current[itemIndex], String(itemIndex)) ?? null);
      }
    } else {
      const entries: Array<[string, PreviewValue]> = [];
      nodes.push([0, entries]);
      for (const property of Object.keys(current)) {
        const encoded = encode((current as Record<string, unknown>)[property], property);
        if (encoded !== undefined) entries.push([property, encoded]);
      }
    }
    return [index];
  };
  const root = JSON.stringify(encode(value, "") ?? null);
  if (!nodes.length) return escapePreviewJson(root);
  // Allocate every node before assigning references. Define own properties so
  // variable keys such as "__proto__" remain data, as they do with JSON.parse.
  return [
    "((root,nodes)=>{",
    "const values=nodes.map(([kind,data])=>kind===2?data:kind===1?[]:{});",
    "const read=value=>Array.isArray(value)?values[value[0]]:value;",
    "nodes.forEach(([kind,data],index)=>{",
    "if(kind===0)data.forEach(([key,value])=>Object.defineProperty(values[index],key,{value:read(value),enumerable:true,writable:true,configurable:true}));",
    "else if(kind===1)data.forEach(value=>values[index].push(read(value)));",
    "});return read(root);})(",
    root,
    ",",
    escapePreviewJson(JSON.stringify(nodes)),
    ")",
  ].join("");
}
