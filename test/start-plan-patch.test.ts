import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasRuntimeStartPlan, patchRuntimeStartPlan } from "../scripts/runtime-start-plan-patches.ts";

test("the pinned Linux runtime gets a Start Plan registry and request auth hook", () => {
  const source = readFileSync(join(import.meta.dir, "../vendor/zcode.cjs"), "utf8");
  const patched = patchRuntimeStartPlan(source);
  expect(hasRuntimeStartPlan(patched)).toBe(true);
  expect(patchRuntimeStartPlan(patched)).toBe(patched);
});
