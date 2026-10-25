#!/usr/bin/env bun

import { appendFileSync } from "node:fs";
import { runTui } from "../../../packages/zcode-tui/src/index.ts";

let attempts = 0;
let sessionListener: ((event: unknown) => void | Promise<void>) | undefined;
await runTui({
  initialModel: "fixture/model",
  workspaceDirectory: process.cwd(),
  loadSessionTranscript: async () => [{
    messageId: "overload_instruction", role: "agent", content: "Type OVERLOAD_TEST to exercise automatic continuation."
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
        code: "model_request_failed", message: "Provider is overloaded.",
        attribution: { source: "provider", reason: "provider_overloaded", statusCode: 429, retryable: true }
      } } });
      throw new Error("Provider is overloaded.");
    }
    return { response: "OVERLOAD_AUTO_CONTINUED" };
  }
});
