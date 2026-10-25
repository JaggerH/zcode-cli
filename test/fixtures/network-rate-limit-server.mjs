import { createServer } from "node:http";

let streamingRequests = 0;
const status = Number(process.env.ZCODE_TEST_REJECT_STATUS || 429);
const rejectCount = Number(process.env.ZCODE_TEST_REJECT_COUNT || 1);
const businessCode = process.env.ZCODE_TEST_BUSINESS_CODE;
const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk.toString();
  if (request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  const parsed = body ? JSON.parse(body) : {};
  if (parsed.stream !== true) {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      id: "chatcmpl-probe", object: "chat.completion", created: Math.floor(Date.now() / 1000),
      model: "glm-5.2", choices: [{ index: 0, message: { role: "assistant", content: "RECOVERED_FINAL" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }));
    return;
  }
  streamingRequests += 1;
  process.stdout.write(`REQUEST ${streamingRequests}\n`);
  if (streamingRequests <= rejectCount) {
    response.writeHead(status, { "content-type": "application/json", "retry-after": "0" });
    response.end(JSON.stringify({ error: {
      ...(businessCode ? { code: businessCode } : {}),
      message: businessCode === "1312" ? "Provider overloaded" : status === 429 ? "rate limit" : "provider overloaded"
    } }));
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write(`data: ${JSON.stringify({
    id: "chatcmpl-recovered", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000),
    model: "glm-5.2", choices: [{ index: 0, delta: { role: "assistant", content: "RECOVERED_FINAL" }, finish_reason: null }]
  })}\n\n`);
  response.write(`data: ${JSON.stringify({
    id: "chatcmpl-recovered", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000),
    model: "glm-5.2", choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
  })}\n\n`);
  response.end("data: [DONE]\n\n");
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server has no TCP port.");
  process.stdout.write(`READY ${address.port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
