/**
 * Layout-independent single-letter key match.
 *
 * `ev.key` returns the *produced character*, which differs by keyboard layout
 * (the physical C/V keys emit "с"/"м" on a Russian ЙЦУКЕН layout, so a plain
 * `ev.key === 'c'` check silently fails there). `ev.code` is the *physical* key
 * in QWERTY terms ("KeyC"/"KeyV") and is layout-independent, so we accept
 * either — the Latin character on a Latin layout, or the same physical key on
 * any other layout.
 */
export function matchesKey(ev: KeyboardEvent, letter: string): boolean {
  return (
    ev.key.toLowerCase() === letter ||
    ev.code === `Key${letter.toUpperCase()}`
  );
}
