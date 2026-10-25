#!/usr/bin/env bun

import { appendFileSync } from "node:fs";
import { runTui } from "../../../packages/zcode-tui/src/index.ts";

let attempts = 0;
let sessionListener: ((event: unknown) => void | Promise<void>) | undefined;
await runTui({
  initialModel: "fixture/model",
  workspaceDirectory: process.cwd(),
  loadSessionTranscript: async () => [{
    messageId: "rate_limit_instruction", role: "agent", content: "Type RATE_LIMIT_TEST to exercise automatic continuation."
  }],
  subscribeSessionEvents: (listener) => {
    sessionListener = listener;
    return () => { sessionListener = undefined; };
  },
  submitPrompt: async (input) => {
    attempts += 1;
    appendFileSync(process.env.ZCODE_TUI_SCENARIO_RUNTIME_JOURNAL!, `${JSON.stringify({ kind: "prompt", input: String(input) })}\n`);
    if (attempts === 1) {
      await sessionListener?.({ type: "turn.failed", payload: { error: {
        code: "model_rate_limited", message: "Provider rate limited the model request.",
        attribution: { source: "provider", reason: "rate_limited", statusCode: 429, retryable: true }
      } } });
      throw new Error("Provider rate limited the model request.");
    }
    return { response: "RATE_LIMIT_AUTO_CONTINUED" };
  }
});
