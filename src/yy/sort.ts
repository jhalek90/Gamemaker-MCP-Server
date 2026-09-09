/**
 * GameMaker's object-key ordering.
 *
 * Keys are sorted case-insensitively, except that `_` sorts ABOVE all letters
 * rather than below it as ASCII would have it — which is why GameMaker writes
 * `"bboxMode"` before `"bbox_bottom"`. Substituting `|` (0x7C, above `z`) for
 * `_` reproduces the ordering exactly.
 *
 * Measured against 620,224 objects in current-format `.yy` files:
 *   plain case-insensitive sort  -> 11,570 violations
 *   with the `_` substitution    ->      453 violations  (99.93% clean)
 *
 * The `$GMType` and `%Name` marker keys need no special handling: `$` (0x24)
 * and `%` (0x25) already sort below every letter.
 *
 * We only need this to decide WHERE a newly inserted key goes. Existing keys
 * are never reordered, so the residual 0.07% of hand-edited files stay intact.
 */

/** Map a key to its GameMaker sort collation form. */
export function sortKey(key: string): string {
  return key.toLowerCase().split('_').join('|');
}

/** Index in `keys` at which `newKey` should be inserted to stay sorted. */
export function insertIndexFor(keys: readonly string[], newKey: string): number {
  const target = sortKey(newKey);
  for (let i = 0; i < keys.length; i++) {
    if (sortKey(keys[i]) > target) return i;
  }
  return keys.length;
}

/** True when `keys` are already in GameMaker order. */
export function isSorted(keys: readonly string[]): boolean {
  for (let i = 1; i < keys.length; i++) {
    if (sortKey(keys[i - 1]) > sortKey(keys[i])) return false;
  }
  return true;
}

/**
 * Sort order for the `.yyp` arrays GameMaker keeps ordered by path
 * (`resources`, `Folders`, `IncludedFiles`) — case-insensitive on the path.
 */
export function comparePaths(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la < lb ? -1 : la > lb ? 1 : 0;
}
