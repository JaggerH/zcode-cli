import { expect, test } from "bun:test";
import { isTerminalRateLimitFailure, rateLimitContinuationDelay } from "../packages/zcode-tui/src/rate-limit-continuation.ts";
import { normalizeEvent } from "../packages/zcode-tui/src/events.ts";

function event(statusCode: number, reason: string, retryable = true) {
  return normalizeEvent({ type: "turn.failed", payload: { error: {
    code: "model_rate_limited", attribution: { source: "provider", statusCode, reason, retryable }
  } } })!;
}

test("only a terminal retryable provider limit can send a continuation", () => {
  expect(isTerminalRateLimitFailure(event(429, "rate_limited"))).toBe(true);
  expect(isTerminalRateLimitFailure(event(503, "provider_overloaded"))).toBe(true);
  expect(isTerminalRateLimitFailure(normalizeEvent({ type: "turn.failed", params: { payload: {
    error: { attribution: { source: "provider", statusCode: 429, reason: "rate_limited", retryable: true } }
  } } })!)).toBe(true);
  expect(isTerminalRateLimitFailure(event(429, "rate_limited", false))).toBe(false);
  expect(isTerminalRateLimitFailure(normalizeEvent({ type: "model.network_status", payload: {
    type: "model_request_failed", reason: "rate_limited", retryable: true
  } })!)).toBe(false);
  expect(isTerminalRateLimitFailure(normalizeEvent({ type: "turn.failed", payload: {
    error: { attribution: { source: "provider", statusCode: 400, reason: "invalid_request", retryable: false } }
  } })!)).toBe(false);
  expect(rateLimitContinuationDelay({})).toBe(30_000);
  expect(rateLimitContinuationDelay({ ZCODE_TUI_RATE_LIMIT_CONTINUE_DELAY_MS: "20" })).toBe(20);
});
