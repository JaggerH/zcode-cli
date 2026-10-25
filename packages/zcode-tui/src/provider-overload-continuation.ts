import type { StreamEvent } from "./events.ts";
import { asString, isRecord } from "./types.ts";

export const providerOverloadContinuationPrompt =
  "刚才因模型服务过载中断。请继续完成上一条用户请求；先检查会话里已经完成的步骤，避免重复执行工具操作。";

/** Only a terminal, provider-attributed failure can start a new conversation turn. */
export function isTerminalProviderOverload(event: StreamEvent): boolean {
  if (event.type !== "turn.failed" && event.type !== "turn_error") return false;
  const params = isRecord(event.raw.params) ? event.raw.params : undefined;
  const payload = isRecord(event.raw.payload) ? event.raw.payload
    : params && isRecord(params.payload) ? params.payload : event.raw;
  const error = isRecord(payload.error) ? payload.error : undefined;
  const attribution = error && isRecord(error.attribution) ? error.attribution : undefined;
  if (attribution?.source !== "provider" || attribution.retryable !== true) return false;
  const reason = asString(attribution.reason)?.toLowerCase();
  return reason === "provider_overloaded";
}

export function providerOverloadContinuationDelay(env: NodeJS.ProcessEnv): number {
  const configured = Number(env.ZCODE_TUI_OVERLOAD_CONTINUE_DELAY_MS);
  return Number.isFinite(configured) && configured >= 0
    ? Math.min(Math.floor(configured), 60_000) : 30_000;
}
