import { expect, test } from "bun:test";
import { join } from "node:path";
import { ScenarioWorkspace } from "./harness/scenario-workspace.ts";
import { TerminalSession } from "./harness/terminal-session.ts";

test.skipIf(process.platform === "win32")("TUI sends one continuation after a terminal provider overload", async () => {
  await using workspace = await ScenarioWorkspace.create({ prefix: "zcode-overload-continue-" });
  await using session = TerminalSession.start({
    command: [process.execPath, join(import.meta.dir, "fixtures/provider-overload-continuation.ts")],
    workspace,
    env: {
      ZCODE_TUI_AUTO_CONTINUE_ON_OVERLOAD: "1",
      ZCODE_TUI_OVERLOAD_CONTINUE_DELAY_MS: "20"
    }
  });
  await session.waitForScreen("instructions", /OVERLOAD_TEST/u);
  session.send("OVERLOAD_TEST\r");
  await session.waitForHistory("automatic continuation", /OVERLOAD_AUTO_CONTINUED/u);
  const prompts = (await workspace.readRuntimeJournal()).trim().split("\n").filter(Boolean)
    .map(line => JSON.parse(line) as { kind: string; input: string })
    .filter(entry => entry.kind === "prompt");
  expect(prompts).toHaveLength(2);
  expect(prompts[0]?.input).toBe("OVERLOAD_TEST");
  expect(prompts[1]?.input).toContain("请继续完成上一条用户请求");
  await session.exit();
}, 20_000);
