import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { verifyTwitchEventSubSignature } from "../src/services/twitch-channel-points.service";

test("verifies Twitch EventSub HMAC signatures and rejects tampering", () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const messageId = "message-123";
  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  const rawBody = JSON.stringify({ subscription: { type: "test" }, event: { id: "redemption-1" } });
  const signature = `sha256=${crypto.createHmac("sha256", secret).update(messageId + timestamp + rawBody).digest("hex")}`;

  assert.equal(verifyTwitchEventSubSignature(secret, messageId, timestamp, rawBody, signature, now), true);
  assert.equal(verifyTwitchEventSubSignature(secret, messageId, timestamp, `${rawBody} `, signature, now), false);
  assert.equal(verifyTwitchEventSubSignature(secret, "different-message", timestamp, rawBody, signature, now), false);
});

test("rejects stale, future, and invalid EventSub timestamps", () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const messageId = "message-123";
  const rawBody = "{}";
  const now = Date.now();
  const sign = (timestamp: string) =>
    `sha256=${crypto.createHmac("sha256", secret).update(messageId + timestamp + rawBody).digest("hex")}`;

  const stale = new Date(now - 10 * 60 * 1000 - 1).toISOString();
  const future = new Date(now + 10 * 60 * 1000 + 1).toISOString();
  assert.equal(verifyTwitchEventSubSignature(secret, messageId, stale, rawBody, sign(stale), now), false);
  assert.equal(verifyTwitchEventSubSignature(secret, messageId, future, rawBody, sign(future), now), false);
  assert.equal(verifyTwitchEventSubSignature(secret, messageId, "not-a-date", rawBody, sign("not-a-date"), now), false);
});
