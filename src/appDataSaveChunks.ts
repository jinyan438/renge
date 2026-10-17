import { exceedsJsonStringBudget } from "./appDataPersistenceUtils.ts";

export type AppDataSavePart = { path: string[]; value: unknown; append?: boolean };
const chunkCharacters = 256 * 1024;

/** Bound each synchronous structured clone; the captured app state is immutable. */
export function* splitAppDataSave(value: unknown, path: string[] = [], ancestors = new Set<object>()): Generator<AppDataSavePart> {
  if (typeof value === "string" && value.length > chunkCharacters) {
    yield { path, value: "" };
    for (let index = 0; index < value.length; index += chunkCharacters) {
      yield { path, value: value.slice(index, index + chunkCharacters), append: true };
    }
    return;
  }
  if (value && typeof value === "object") {
    if (!(value instanceof Date) && typeof (value as { toJSON?: unknown }).toJSON === "function") {
      throw new Error("自定义 JSON 序列化需要使用兼容保存路径。");
    }
    const prototype = Object.getPrototypeOf(value);
    const plain = Array.isArray(value) || prototype === null || Object.getPrototypeOf(prototype) === null;
    if (plain && exceedsJsonStringBudget(value, chunkCharacters)) {
      if (ancestors.has(value)) throw new Error("无法保存循环引用。");
      ancestors.add(value);
      yield { path, value: Array.isArray(value) ? new Array(value.length) : {} };
      for (const key of Object.keys(value)) {
        yield* splitAppDataSave((value as Record<string, unknown>)[key], [...path, key], ancestors);
      }
      ancestors.delete(value);
      return;
    }
  }
  yield { path, value };
}

export function applyAppDataSavePart(root: unknown, part: AppDataSavePart): unknown {
  if (part.path.length === 0) return part.append ? String(root) + String(part.value) : part.value;
  let parent = root as Record<string, unknown>;
  for (const key of part.path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  const key = part.path[part.path.length - 1];
  // JSON data may legitimately contain an own __proto__ key.
  Object.defineProperty(parent, key, {
    value: part.append ? String(parent[key]) + String(part.value) : part.value,
    writable: true, enumerable: true, configurable: true,
  });
  return root;
}
