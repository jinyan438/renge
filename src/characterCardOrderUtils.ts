type ImportedCharacterCard = {
  importedAt: string;
};

export function sortCharacterCardsByImportTime<T extends ImportedCharacterCard>(
  cards: readonly T[],
) {
  return [...cards].sort(
    (left, right) =>
      (Date.parse(right.importedAt) || 0) - (Date.parse(left.importedAt) || 0),
  );
}
