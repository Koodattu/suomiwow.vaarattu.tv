import assert from "node:assert/strict";
import test from "node:test";
import CcgCard from "../src/models/CcgCard";
import {
  CCG_CARD_NOT_FOUND_CONFIRMATION_MS,
  resolveCcgCardNotFoundStatus,
} from "../src/services/ccg-card-availability.service";

const firstObservedAt = new Date("2026-08-01T10:00:00.000Z");

test("new cards enter the live roster by default", () => {
  assert.equal(new CcgCard().availabilityStatus, "active");
});

test("a first Blizzard 404 starts verification instead of archiving the card", () => {
  assert.equal(resolveCcgCardNotFoundStatus({}, firstObservedAt), "verification_pending");
});

test("a repeated 404 must be at least 24 hours after the first before archiving", () => {
  const evidence = {
    status: "verification_pending" as const,
    firstNotFoundAt: firstObservedAt,
    lastNotFoundAt: firstObservedAt,
  };
  assert.equal(
    resolveCcgCardNotFoundStatus(evidence, new Date(firstObservedAt.getTime() + CCG_CARD_NOT_FOUND_CONFIRMATION_MS - 1)),
    "verification_pending",
  );
  assert.equal(
    resolveCcgCardNotFoundStatus(evidence, new Date(firstObservedAt.getTime() + CCG_CARD_NOT_FOUND_CONFIRMATION_MS)),
    "archived",
  );
});

test("an archived card remains archived until a successful media fetch restores it", () => {
  assert.equal(
    resolveCcgCardNotFoundStatus({ status: "archived" }, new Date("2026-08-10T10:00:00.000Z")),
    "archived",
  );
});
