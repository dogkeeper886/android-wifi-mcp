---
name: android-wifi-mcp-enterprise-certs
description: |
  Build the certificate parameters for wifi_connect_enterprise (EAP-TLS/PEAP/TTLS) and
  diagnose enterprise-WiFi cert failures. Use when connecting to an 802.1X network, or
  when a connect fails with "Not a CA certificate", "unknown_ca" /
  AUTHENTICATION_FAILURE, or "mandates server certificate but validation is not enabled".
---

# Enterprise-WiFi certificates (android-wifi-mcp)

`wifi_connect_enterprise` takes certs **inline** as PEM strings, not file paths. Getting
the cert params right is the whole game. Read the tool's own schema for the full param
list and enums — this skill is about **which PEM goes where, and why**.

## Two trust directions — keep them straight

EAP-TLS authenticates both ways. Each direction maps to its own parameter; they are
usually **different PKIs**, so don't cross them.

| Param | Direction | What to pass |
|-------|-----------|--------------|
| `clientCertificate` + `privateKey` | phone → RADIUS (what the phone presents) | the client **leaf** cert + its key. Key must be PKCS#8 (`BEGIN PRIVATE KEY`); convert `BEGIN RSA/EC PRIVATE KEY` with `openssl pkcs8 -topk8`. |
| `caCertificate` | phone validates the RADIUS **server** | a **self-signed root** the server cert chains to — see below. |
| `identity` | the client's EAP identity | derive it from the deployment (often the client cert's CN/email), don't assume. |

## The `caCertificate` rule (the one that bites)

It must be **a self-signed root** (or a chain ending in one). Derive the right anchor
from what the server actually presents — don't guess:

1. Inspect the RADIUS server cert (`openssl s_client -connect …`, or the server's served
   chain). Look at the **top** of that chain and who issued it.
2. **Public CA** (Let's Encrypt, DigiCert, …): pin that CA's published **self-signed
   root**. If the RADIUS serves its intermediates (common), the root alone is enough; if
   it presents only its leaf, pin the full chain (intermediates + the self-signed root).
3. **Private CA**: pin that CA's self-signed root (plus intermediates if the server
   doesn't serve them).

Confirm any candidate is self-signed: `subject == issuer`
(`openssl x509 -in <f> -noout -subject -issuer`).

**Never pass as `caCertificate`:**
- the server **leaf** cert → `"Not a CA certificate"`.
- a served **fullchain** whose top cert is a **cross-signed** intermediate (issuer ≠
  subject) → it associates, then drops with `unknown_ca`.

`domainSuffixMatch` (a suffix of the server cert's SAN) is optional once `caCertificate`
is pinned, but include it for real validation. Android 11+ **requires at least one** of
{`caCertificate`, `domainSuffixMatch`}.

## Failure → cause → fix

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Not a CA certificate` | `caCertificate` leads with a non-CA (server leaf / fullchain) | pin the self-signed root |
| Associates, then `unknown_ca` / `NETWORK_SELECTION_DISABLED_AUTHENTICATION_FAILURE` (repeats ~3×) | phone doesn't trust the server cert's CA — anchor missing, wrong, or not self-signed | pin the correct self-signed root |
| `mandates server certificate but validation is not enabled` | neither `caCertificate` nor `domainSuffixMatch` set | set at least one |
| Suggestion accepted, never associates | first-run approval pending (see below) | approve on the phone |

Read the **RADIUS server log** when you can — it names the reason plainly (`unknown_ca`
= the phone rejected the server cert → fix the anchor; a client-cert reject = the client
cert/identity isn't provisioned server-side). Client-side, `adb shell dumpsys wifi` shows
the association trail (`ASSOCIATED` then a `locallyGenerated` disconnect = auth phase
failed, not range/association).

## First-run approval (one-time per companion install)

The companion connects via `WifiNetworkSuggestion`. The **first** suggestion triggers an
Android notification "Allow suggested Wi‑Fi networks?" and the device won't auto-join
until the user taps **Allow**. If a connect returns "suggestion accepted but did not
associate" and the config is otherwise correct, expand the notification shade and approve
(the mobile-next UI tools can tap it). Approval persists for later connects.

## Verify success

- `wifi_status` → `connected: true`, `supplicantState: COMPLETED`, the target SSID.
- `query_log` (when structured logging is on) records the attempt with cert fields
  redacted.

## Local lab material

The 802.1X test certs live under `certs/` (gitignored). Its `README.md` maps each file to
the parameter above and names the pre-built server anchor to pin — use it instead of
re-deriving the anchor each time.
