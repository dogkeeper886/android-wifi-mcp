---
id: TS-03
title: Server-validation modes behave correctly
namespace: enterprise-wifi
story: STORY-002
story_hash: 875f03224823a642778e30a216471799c99e90c36a6ee7e8d231c0808d6e18b7
plan: 109
issue: 71
status: green
---

# TS-03: Server-validation modes behave correctly

**Objective:** Each documented server-validation mode connects — including the lab
combinations — while the existing strict mode is preserved.

## TC-01 — strict validation (CA + domain)

| Action | Expected Result |
|---|---|
| Connect with both a pinned CA and a known RADIUS domain | The device associates — today's strict happy path, unchanged |

## TC-02 — pinned CA, no domain (to-be)

| Action | Expected Result |
|---|---|
| Connect with a pinned CA but no domain suffix | The device associates — the certificate chain is trusted without a domain check |

## TC-03 — domain only, public CA (to-be)

| Action | Expected Result |
|---|---|
| Connect with a domain suffix and no pinned CA, against a RADIUS server using a publicly-trusted CA | The device associates using the system trust store |
