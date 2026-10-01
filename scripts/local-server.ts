import "./load-env.js";
import { createServer } from "node:http";
import * as api from "../api/health.js";
import * as status from "../api/status.js";
import * as a2a from "../api/a2a.js";
import * as cardM from "../api/agent-card.js";
import * as regM from "../api/agent-registration.js";
import * as cron from "../api/cron/rebalance.js";

const routes: Record<string, any> = {
  "/api/health": api, "/api/status": status, "/api/a2a": a2a, "/api/cron/rebalance": cron,
  "/.well-known/agent-card.json": cardM, "/.well-known/agent-registration.json": regM,
};

export function start(port = Number(process.env.PORT ?? 3000)) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const mod = routes[url.pathname];
    const handler = mod?.[req.method ?? "GET"];
    if (!handler) { res.statusCode = mod ? 405 : 404; res.end("not found"); return; }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const r: Response = await handler(new Request(url, { method: req.method, headers, body: req.method === "GET" ? undefined : body }));
    res.statusCode = r.status;
    r.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  return new Promise<import("node:http").Server>((ok) => server.listen(port, () => ok(server)));
}

if (process.argv[1]?.endsWith("local-server.ts")) {
  start().then(() => console.log(`local server on http://localhost:${process.env.PORT ?? 3000}`));
}
