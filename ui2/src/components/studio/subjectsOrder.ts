/**
 * The Subjects list in the Population lens: the lens's order ("Montage"),
 * with anything it does not show after it in list order, or by subject ID.
 */
export function orderSubjectsForLens(
  ids: string[],
  order: 'montage' | 'id',
  lensIds: readonly string[] | null,
): string[] {
  if (order === 'id')
    return [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!lensIds) return ids;
  const position = new Map(lensIds.map((id, i) => [id, i]));
  const listed = new Map(ids.map((id, i) => [id, i]));
  const rank = (id: string) => position.get(id) ?? lensIds.length + listed.get(id)!;
  return [...ids].sort((a, b) => rank(a) - rank(b));
}
