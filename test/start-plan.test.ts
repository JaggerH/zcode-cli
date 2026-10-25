import { expect, test } from "bun:test";
import { parseStartPlanGrant, resolveStartPlanEntries } from "../src/start-plan.ts";

const catalog = {
  revision: 28,
  config: { providerConfigRules: { providerRules: [
    { providerId: "account:zai-start-plan", config: { access: { type: "zhipu-account", mode: "start-plan", accountType: "zai" }, builtinModelIds: ["GLM-5.3-Flash", "GLM-5.2"] } },
    { providerId: "account:zai-individual-coding-plan", config: { access: { type: "zhipu-account", mode: "individual-coding-plan", accountType: "zai" }, builtinModelIds: ["GLM-5.3"] } }
  ] } }
};

test("Start Plan grant exposes only active, unexhausted models in the bundled catalog", () => {
  const grant = parseStartPlanGrant({ code: 0, data: {
    plans: [{ plan_id: "zcode-v3-start-plan", status: "active" }],
    balances: [
      { capabilities: ["model:glm-5.3-flash"], remaining_units: 10 },
      { capabilities: ["model:glm-5.2"], remaining_units: 0 }
    ]
  } }, ["GLM-5.3-Flash", "GLM-5.2"]);
  expect(grant).toEqual(["GLM-5.3-Flash"]);
  expect(() => parseStartPlanGrant({ code: 401, data: {} }, ["GLM-5.3-Flash"])).toThrow(/balance/);
});

test("a WSL shared login admits only its own Start Plan provider", async () => {
  const values: Record<string, string> = {
    "oauth:active_provider": "zai",
    "oauth:zai:user_info": JSON.stringify({ user_id: "user-1" }),
    "oauth:zai:access_token": "business-token",
    zcodejwttoken: "jwt-token"
  };
  const store = { loadMany: async (keys: string[]) => Object.fromEntries(keys.map(key => [key, values[key] ?? null])) };
  const fetch = async () => new Response(JSON.stringify({ code: 0, data: {
    plans: [{ plan_id: "start-plan", status: "active" }],
    balances: [{ capabilities: ["model:glm-5.3-flash"], remaining_units: 1 }]
  } }), { status: 200 });
  expect(await resolveStartPlanEntries({ store, catalog, fetch })).toEqual([
    { providerId: "account:zai-start-plan", family: "zai", modelIds: ["GLM-5.3-Flash"] }
  ]);
  delete values.zcodejwttoken;
  expect(await resolveStartPlanEntries({ store, catalog, fetch })).toEqual([]);
});
