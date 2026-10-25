import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { arch, platform, version } from "node:os";
import { join } from "node:path";
import { sharedDataBaseDir } from "./config-paths.ts";

const balanceUrl = "https://zcode.z.ai/api/v1/zcode-plan/billing/balance";
type Family = "zai" | "bigmodel";
type CredentialStore = { loadMany(keys: string[]): Promise<Record<string, string | null>> };
type StartPlanFetch = (url: URL, init: RequestInit) => Promise<Response>;
type Catalog = { config?: { providerConfigRules?: { providerRules?: Array<{
  providerId: string;
  config?: { access?: { type?: string; mode?: string; accountType?: string }; builtinModelIds?: string[] };
}> } } };
type Entry = { providerId: string; family: Family; modelIds: string[] };

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** A failed business envelope or exhausted balance never advertises a model. */
export function parseStartPlanGrant(payload: unknown, models: readonly string[]): string[] {
  const root = record(payload), data = record(root?.data);
  if (!root || root.success === false || ![undefined, 0, 200].includes(root.code as number | undefined)
    || !data || !Array.isArray(data.plans) || !Array.isArray(data.balances)) {
    throw new Error("Cannot verify Start Plan balance.");
  }
  const active = data.plans.some(raw => {
    const plan = record(raw);
    if (!plan || String(plan.status ?? "").toLowerCase() !== "active") return false;
    const identity = String(plan.plan_id ?? plan.product_id ?? plan.name ?? "").toLowerCase();
    return identity.includes("start-plan") || identity.includes("start plan");
  });
  if (!active) return [];
  const granted = new Set<string>();
  for (const raw of data.balances) {
    const balance = record(raw);
    if (!balance || !(Number(balance.remaining_units) > 0)) continue;
    for (const capability of Array.isArray(balance.capabilities) ? balance.capabilities : []) {
      if (typeof capability === "string" && capability.toLowerCase().startsWith("model:")) {
        granted.add(capability.slice(6).trim().toLowerCase());
      }
    }
    if (typeof balance.show_name === "string") granted.add(balance.show_name.trim().toLowerCase());
  }
  return models.filter(model => granted.has(model.toLowerCase()));
}

function catalogFromEnv(env: NodeJS.ProcessEnv): Catalog {
  const path = env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE?.trim();
  if (!path) throw new Error("ZCode built-in provider catalog is unavailable for Start Plan.");
  return JSON.parse(readFileSync(path, "utf8")) as Catalog;
}

function sourceHeaders(env: NodeJS.ProcessEnv): Record<string, string> {
  const telemetryPath = join(sharedDataBaseDir(env), ".zcode", "v2", "telemetry-state.json");
  const telemetry = record(JSON.parse(readFileSync(telemetryPath, "utf8")));
  const mid = telemetry?.deviceMid;
  if (typeof mid !== "string" || !/^[a-f0-9-]{36}$/i.test(mid)) {
    throw new Error("ZCode device identity is missing. Open ZCode Desktop once before using Start Plan.");
  }
  const appVersion = env.ZCODE_APP_VERSION?.trim();
  if (!appVersion) throw new Error("ZCODE_APP_VERSION is required for Start Plan.");
  const locale = Intl.DateTimeFormat().resolvedOptions();
  return {
    "HTTP-Referer": "https://zcode.z.ai", "User-Agent": `ZCode/${appVersion}`,
    "X-Title": "ZCode CLI", "X-ZCode-App-Version": appVersion,
    "X-Platform": `${platform()}-${arch()}`, "X-Device-Mid": mid,
    "X-Client-Language": locale.locale, "X-Client-Timezone": locale.timeZone,
    "X-Os-Category": platform() === "darwin" ? "macos" : platform() === "win32" ? "windows" : "linux",
    "X-Os-Version": version()
  };
}

async function currentLogin(store: CredentialStore): Promise<{ family: Family; token: string; fingerprint: string } | null> {
  const keys = ["oauth:active_provider", "oauth:zai:user_info", "oauth:bigmodel:user_info",
    "oauth:zai:access_token", "oauth:bigmodel:access_token", "zcodejwttoken"];
  const values = await store.loadMany(keys);
  const family = values["oauth:active_provider"];
  if (family !== "zai" && family !== "bigmodel") return null;
  const profile = values[`oauth:${family}:user_info`], access = values[`oauth:${family}:access_token`];
  const token = values.zcodejwttoken?.trim();
  if (!profile || !access?.trim() || !token) return null;
  const identity = record(JSON.parse(profile));
  const userId = identity?.user_id ?? identity?.id ?? record(identity?.rawProfile)?.user_id;
  if (typeof userId !== "string" || !userId.trim()) return null;
  return { family, token, fingerprint: createHash("sha256").update(`${family}\0${userId}\0${token}`).digest("hex") };
}

async function fetchGrant(input: { token: string; models: readonly string[]; fetch: StartPlanFetch;
  headers: Record<string, string>; signal?: AbortSignal }): Promise<string[]> {
  const url = new URL(balanceUrl);
  url.searchParams.set("app_version", input.headers["X-ZCode-App-Version"] ?? "");
  const response = await input.fetch(url, { headers: { ...input.headers, Authorization: `Bearer ${input.token}` },
    signal: input.signal, redirect: "error" });
  if (!response.ok) throw new Error(`Start Plan balance HTTP ${response.status}.`);
  return parseStartPlanGrant(await response.json(), input.models);
}

export async function resolveStartPlanEntries(options: {
  store: CredentialStore; catalog?: Catalog; env?: NodeJS.ProcessEnv; fetch?: StartPlanFetch;
  sourceHeaders?: Record<string, string>; signal?: AbortSignal;
}): Promise<Entry[]> {
  const env = options.env ?? process.env;
  const login = await currentLogin(options.store);
  if (!login) return [];
  const catalog = options.catalog ?? catalogFromEnv(env);
  const rules = catalog.config?.providerConfigRules?.providerRules ?? [];
  const headers = options.sourceHeaders ?? (options.catalog ? { "X-ZCode-App-Version": env.ZCODE_APP_VERSION ?? "3.16.3" } : sourceHeaders(env));
  const matching = rules.filter(rule => rule.config?.access?.type === "zhipu-account"
    && rule.config.access.mode === "start-plan" && rule.config.access.accountType === login.family);
  const entries: Entry[] = [];
  for (const rule of matching) {
    const models = rule.config?.builtinModelIds ?? [];
    const modelIds = await fetchGrant({ token: login.token, models, fetch: options.fetch ?? fetch, headers, signal: options.signal });
    if (modelIds.length) entries.push({ providerId: rule.providerId, family: login.family, modelIds });
  }
  const latest = await currentLogin(options.store);
  if (!latest || latest.fingerprint !== login.fingerprint) throw new Error("ZCode login changed during Start Plan discovery.");
  return entries;
}

export async function startPlanRuntimeHeaders(options: {
  store: CredentialStore; input: { providerId: string; modelId: string;
    accountAccess?: { type?: string; mode?: string; accountType?: string }; abortSignal?: AbortSignal };
  env?: NodeJS.ProcessEnv; fetch?: StartPlanFetch;
  solveCaptcha?: (token: string) => Promise<{ param: string; region: string }>;
}): Promise<{ headersApplied: true; requestAuth: { apiKey: string; headers: Record<string, string> } }> {
  const { store, input } = options, env = options.env ?? process.env;
  input.abortSignal?.throwIfAborted();
  const login = await currentLogin(store);
  if (!login || input.providerId !== `account:${login.family}-start-plan` || !input.modelId
    || input.accountAccess?.type !== "zhipu-account" || input.accountAccess.mode !== "start-plan"
    || input.accountAccess.accountType !== login.family) {
    throw new Error("Start Plan account selection does not match the current ZCode login.");
  }
  const entries = await resolveStartPlanEntries({ store, env, fetch: options.fetch, signal: input.abortSignal });
  const selected = entries.find(entry => entry.providerId === input.providerId);
  if (!selected?.modelIds.includes(input.modelId)) {
    throw new Error("Selected model is not covered by the active Start Plan balance.");
  }
  const solve = options.solveCaptcha ?? ((token: string) =>
    require(join(__dirname, "start-plan-captcha.cjs")).getOrSolveCaptchaParam(token));
  const captcha = await solve(login.token);
  input.abortSignal?.throwIfAborted();
  const latest = await currentLogin(store);
  if (!latest || latest.fingerprint !== login.fingerprint) throw new Error("ZCode login changed during Start Plan authorization.");
  return { headersApplied: true, requestAuth: { apiKey: login.token, headers: {
    ...sourceHeaders(env),
    "X-Aliyun-Captcha-Verify-Param": captcha.param,
    "X-Aliyun-Captcha-Verify-Region": captcha.region
  } } };
}
