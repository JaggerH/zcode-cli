import { expect, test } from "bun:test";
import { join } from "node:path";
import { ScenarioWorkspace } from "./harness/scenario-workspace.ts";
import { TerminalSession } from "./harness/terminal-session.ts";

test.skipIf(process.platform === "win32")("TUI sends one continuation after a terminal provider 429", async () => {
  await using workspace = await ScenarioWorkspace.create({ prefix: "zcode-rate-limit-continue-" });
  await using session = TerminalSession.start({
    command: [process.execPath, join(import.meta.dir, "fixtures/rate-limit-continuation.ts")],
    workspace,
    env: {
      ZCODE_TUI_AUTO_CONTINUE_ON_RATE_LIMIT: "1",
      ZCODE_TUI_RATE_LIMIT_CONTINUE_DELAY_MS: "20"
    }
  });
  await session.waitForScreen("instructions", /RATE_LIMIT_TEST/u);
  session.send("RATE_LIMIT_TEST\r");
  await session.waitForHistory("automatic continuation", /RATE_LIMIT_AUTO_CONTINUED/u);
  const prompts = (await workspace.readRuntimeJournal()).trim().split("\n").filter(Boolean)
    .map(line => JSON.parse(line) as { kind: string; input: string })
    .filter(entry => entry.kind === "prompt");
  expect(prompts).toHaveLength(2);
  expect(prompts[0]?.input).toBe("RATE_LIMIT_TEST");
  expect(prompts[1]?.input).toContain("请继续完成上一条用户请求");
  await session.exit();
}, 20_000);
