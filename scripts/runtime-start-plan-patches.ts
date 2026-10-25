import { parseExpressionAt, type FunctionExpression } from "acorn";

const helper = 'require(require("node:path").join(__dirname,"cli-config.cjs"))';
const identifier = "[A-Za-z_$][\\w$]*";

function namedFunction(runtime: string, label: string): FunctionExpression {
  const matches = [...runtime.matchAll(new RegExp(`${identifier}\\((${identifier}),"${label}"\\)`, "gu"))];
  if (matches.length !== 1) throw new Error(`Start Plan runtime anchor ${label} is missing or ambiguous.`);
  const name = matches[0]![1]!;
  const declaration = new RegExp(`(?:async )?function ${name}\\(`, "gu").exec(runtime);
  if (!declaration) throw new Error(`Start Plan runtime function ${label} is missing.`);
  const fn = parseExpressionAt(runtime, declaration.index, { ecmaVersion: "latest" });
  if (fn.type !== "FunctionExpression") throw new Error(`Start Plan runtime function ${label} changed shape.`);
  return fn;
}

export function hasRuntimeStartPlan(runtime: string): boolean {
  return runtime.includes("let $zStartPlanEntries=await") && runtime.includes("$zStartPlanRuntimeHeaders");
}

/** Add Start Plan to the native account overlay and reuse the request auth port. */
export function patchRuntimeStartPlan(runtime: string): string {
  if (hasRuntimeStartPlan(runtime)) return runtime;
  if (runtime.includes("$zStartPlanEntries") || runtime.includes("$zStartPlanRuntimeHeaders")) {
    throw new Error("ZCode runtime has a partial Start Plan patch.");
  }
  const snapshot = namedFunction(runtime, "readStandaloneAccountProviderConfigSnapshot");
  const source = runtime.slice(snapshot.start, snapshot.end);
  const returnMatch = /return ([A-Za-z_$][\w$]*)\(o\.zcodeBuiltinRevision,b\)/u.exec(source);
  const mapClass = /b=new ([A-Za-z_$][\w$]*)\(i\.map\(/u.exec(source)?.[1];
  const providerClass = /new ([A-Za-z_$][\w$]*)\(\{access:new ([A-Za-z_$][\w$]*)\(\{entitled:/u.exec(source);
  const store = snapshot.params[0], env = snapshot.params[1];
  if (!returnMatch || !mapClass || !providerClass || store?.type !== "Identifier" || env?.type !== "Identifier") {
    throw new Error("ZCode runtime account snapshot changed shape.");
  }
  const replacement = `let $zStartPlanEntries=await ${helper}.resolveStartPlanEntries({store:${store.name},env:${env.name}});`
    + `return ${returnMatch[1]}(o.zcodeBuiltinRevision,new ${mapClass}([...b.entries(),...$zStartPlanEntries.map(v=>[v.providerId,`
    + `new ${providerClass[1]}({access:new ${providerClass[2]}({entitled:true}),builtinModelIds:v.modelIds})])]))`;
  runtime = runtime.slice(0, snapshot.start + returnMatch.index)
    + replacement + runtime.slice(snapshot.start + returnMatch.index + returnMatch[0].length);

  const headers = namedFunction(runtime, "createStandaloneProviderRuntimeHeadersPort");
  const headersSource = runtime.slice(headers.start, headers.end);
  const request = /async refreshBeforeModelRequest\(([A-Za-z_$][\w$]*)\)\{\$zSharedProviders\.set\([^;]+;\1\.abortSignal\?\.throwIfAborted\(\);/u.exec(headersSource);
  const headerStore = headers.params[0], headerEnv = headers.params[1];
  if (!request || headerStore?.type !== "Identifier" || headerEnv?.type !== "Identifier") {
    throw new Error("ZCode runtime request auth changed shape.");
  }
  const injected = `let $zStartPlanRuntimeHeaders=${helper}.startPlanRuntimeHeaders;`
    + `if(${request[1]}.accountAccess?.mode==="start-plan")return await $zStartPlanRuntimeHeaders({store:${headerStore.name},input:${request[1]},env:${headerEnv.name}});`;
  runtime = runtime.slice(0, headers.start + request.index + request[0].length)
    + injected + runtime.slice(headers.start + request.index + request[0].length);
  if (!hasRuntimeStartPlan(runtime)) throw new Error("Start Plan runtime patch did not apply completely.");
  return runtime;
}
