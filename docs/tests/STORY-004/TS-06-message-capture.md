---
id: TS-06
title: Message-capture tools read the inbox and wait for OTPs
namespace: messaging
story: STORY-004
plan: 120
issue: 128
status: green
---

# TS-06: Message-capture tools read the inbox and wait for OTPs

**Objective:** The message-capture tools (`sms_read_recent`, `sms_wait_for_otp`,
`notifications_list_recent`, `notifications_wait_for_otp`) — used to grab a one-time code
during an auth flow — behave correctly: the wait tools return cleanly on a bounded timeout
when no code arrives, and the read tools return real inbox/notification state.

## TC-01 — sms_wait_for_otp times out cleanly

**Script:** cicd/tests/testcases/sms/TC-SMS-003.yml

| Action | Expected Result |
|---|---|
| Wait for an OTP with a short timeout when no message arrives | The call returns cleanly at the timeout — no hang, no crash — reporting no code found |

## TC-02 — notifications_wait_for_otp times out cleanly

**Script:** cicd/tests/testcases/notifications/TC-NOTIF-002.yml

| Action | Expected Result |
|---|---|
| Wait for an OTP notification with a short timeout when none arrives | The call returns cleanly at the timeout — no hang, no crash |

## TC-03 — sms_read_recent returns a real inbox message (to-be)

| Action | Expected Result |
|---|---|
| Read recent SMS on a device with a known message present | The result contains that message — verified against a real inbox, not just the response shape. Needs a message fixture; until then `sms_read_recent` has no meaningful test. |

## TC-04 — notifications_list_recent returns a real notification (to-be)

| Action | Expected Result |
|---|---|
| List recent notifications with a known notification posted | The result contains that notification — verified against real state, not just the shape. Needs a notification fixture; until then `notifications_list_recent` has no meaningful test. |
