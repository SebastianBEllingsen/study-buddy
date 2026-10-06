// Shift-click selection: every id from the last-clicked row to this one,
// inclusive, in the order the rows are shown. Without a usable anchor (none
// yet, or it's in another list) just the clicked row.
export function rangeBetween(orderedIds: number[], anchor: number | null, target: number): number[] {
  const to = orderedIds.indexOf(target);
  const from = anchor === null ? -1 : orderedIds.indexOf(anchor);
  if (to === -1 || from === -1) return [target];
  return orderedIds.slice(Math.min(from, to), Math.max(from, to) + 1);
}

// The selection after clicking `target`: a plain click flips that row; a
// shift-click sets every row in the range to the state the clicked row ends
// up in, like a file manager.
export function applyClick(
  selected: ReadonlySet<number>,
  target: number,
  options: { checked: boolean; shift: boolean; orderedIds: number[]; anchor: number | null }
): Set<number> {
  const next = new Set(selected);
  const ids = options.shift ? rangeBetween(options.orderedIds, options.anchor, target) : [target];
  for (const id of ids) {
    if (options.checked) next.add(id);
    else next.delete(id);
  }
  return next;
}
