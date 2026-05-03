/**
 * Redaction for tool-call args before they hit Postgres. The set is exact-match
 * (case-insensitive) against the keys used by tools that take secrets today:
 *
 *   - password, privateKeyPassword           (WPA / EAP / EAP-TLS keystore)
 *   - privateKey                             (EAP-TLS, base64 PEM)
 *   - caCertificate, clientCertificate       (EAP-TLS, base64 PEM blobs —
 *     redacted because they bloat the row, not because they're secret)
 *   - certificate                            (wifi_install_certificate)
 *
 * If a future tool adds a new secret-bearing key, add it here. A heuristic
 * match (e.g. /password|secret/i) was rejected to avoid false positives like
 * `keyId` being conflated with `key`.
 */

const SENSITIVE_KEYS = new Set([
  'password',
  'privatekey',
  'privatekeypassword',
  'cacertificate',
  'clientcertificate',
  'certificate',
]);

const REDACTED = '***';

export function redactArgs(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactArgs);

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = REDACTED;
    } else if (v !== null && typeof v === 'object') {
      out[k] = redactArgs(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
