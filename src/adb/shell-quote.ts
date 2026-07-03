/**
 * POSIX single-quote a string for safe interpolation into a device-shell command that
 * `adb shell` forwards. Wraps the value in single quotes and escapes any embedded single
 * quote as `'\''` (close-quote, escaped-quote, re-open) — the standard shell idiom.
 *
 * Extracted so the escape lives in ONE place (#87): it was copy-pasted as `shellQuote`
 * (settings), `sq` (wifi), and `shQuote` (network) — an escaping bug would have needed
 * fixing in three files.
 */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
