// Local smoke test: starts the plain node server and calls the endpoints (read-only against BSC testnet).
import "./load-env.js";
import { start } from "./local-server.js";

process.env.EXECUTION_ENABLED = "false"; // belt and braces: smoke never sends txs
const port = 3917;
const server = await start(port);
const base = `http://localhost:${port}`;
const show = (t: string, v: unknown) => console.log(`\n### ${t}\n` + (typeof v === "string" ? v : JSON.stringify(v, null, 2)).slice(0, 1800));

show("GET /api/health", await (await fetch(`${base}/api/health`)).json());
show("GET /.well-known/agent-card.json", await (await fetch(`${base}/.well-known/agent-card.json`)).json());
show("GET /.well-known/agent-registration.json", await (await fetch(`${base}/.well-known/agent-registration.json`)).json());
const rpc = (text: string) =>
  fetch(`${base}/api/a2a`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "message/send", params: { message: { kind: "message", role: "user", messageId: "t1", parts: [{ kind: "text", text }] } } }),
  }).then((r) => r.json());
show("A2A message/send 'status'", await rpc("status"));
show("A2A message/send 'rebalance to 60/40' (execution disabled)", await rpc("rebalance to 60/40"));
show("A2A analyze address", await rpc("analyze 0x0000000000000000000000000000000000001004 target 70/30"));
show("cron without secret", (await fetch(`${base}/api/cron/rebalance`)).status);
server.close();
