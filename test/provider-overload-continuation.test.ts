import { expect, test } from "bun:test";
import { isTerminalProviderOverload, providerOverloadContinuationDelay } from "../packages/zcode-tui/src/provider-overload-continuation.ts";
import { normalizeEvent } from "../packages/zcode-tui/src/events.ts";

function event(statusCode: number, reason: string, retryable = true) {
  return normalizeEvent({ type: "turn.failed", payload: { error: {
    code: "model_request_failed", attribution: { source: "provider", statusCode, reason, retryable }
  } } })!;
}

test("only a terminal retryable provider overload can send a continuation", () => {
  expect(isTerminalProviderOverload(event(429, "provider_overloaded"))).toBe(true);
  expect(isTerminalProviderOverload(event(503, "provider_overloaded"))).toBe(true);
  expect(isTerminalProviderOverload(normalizeEvent({ type: "turn.failed", params: { payload: {
    error: { attribution: { source: "provider", statusCode: 429, reason: "provider_overloaded", retryable: true } }
  } } })!)).toBe(true);
  expect(isTerminalProviderOverload(event(429, "rate_limited"))).toBe(false);
  expect(isTerminalProviderOverload(event(503, "provider_overloaded", false))).toBe(false);
  expect(isTerminalProviderOverload(normalizeEvent({ type: "model.network_status", payload: {
    type: "model_request_failed", reason: "rate_limited", retryable: true
  } })!)).toBe(false);
  expect(isTerminalProviderOverload(normalizeEvent({ type: "turn.failed", payload: {
    error: { attribution: { source: "provider", statusCode: 400, reason: "invalid_request", retryable: false } }
  } })!)).toBe(false);
  expect(providerOverloadContinuationDelay({})).toBe(30_000);
  expect(providerOverloadContinuationDelay({ ZCODE_TUI_OVERLOAD_CONTINUE_DELAY_MS: "20" })).toBe(20);
});
