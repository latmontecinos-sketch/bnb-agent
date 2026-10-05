import { timingSafeEqual } from "node:crypto";
import { handleRpc } from "./a2a.js";
import { recentActions } from "./activity.js";
import { handleMessage } from "./agent.js";
import { agentAddress } from "./chain.js";
import { agentCard, registrationFile } from "./cards.js";
import { IDENTITY_REGISTRY, VERSION, cfg } from "./config.js";
import { run } from "./rebalance.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-cron-secret",
};

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { "content-type": "application/json", ...CORS, ...extra } });

/** PUBLIC_BASE_URL wins; otherwise use the request origin so cards always point at the live host. */
function baseFor(req: Request) {
  if (process.env.PUBLIC_BASE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL) return cfg().baseUrl;
  try {
    return new URL(req.url).origin;
  } catch {
    return cfg().baseUrl;
  }
}

export const options = () => new Response(null, { status: 204, headers: CORS });
export const health = () => json({ ok: true, service: "aex-rebalancer", version: VERSION });
export const card = (req: Request) => json(agentCard(baseFor(req)), 200, { "cache-control": "public, max-age=60" });
export const registration = (req: Request) => json(registrationFile(baseFor(req)), 200, { "cache-control": "public, max-age=60" });

export async function status() {
  const r = await handleMessage("status");
  return json({
    agent: "Aex Rebalancer",
    chainId: 97,
    identityRegistry: IDENTITY_REGISTRY,
    agentId: cfg().agentId ?? null,
    operatingWallet: agentAddress() ?? null,
    summary: r.text,
    ...r.data,
  });
}

export async function activity() {
  try {
    const actions = await recentActions();
    return json({ wallet: agentAddress() ?? null, count: actions.length, actions }, 200, { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" });
  } catch (e) {
    return json({ error: (e instanceof Error ? e.message : String(e)).split("\n")[0] }, 502);
  }
}

export async function a2a(req: Request) {
  if (req.method === "GET") return json(agentCard(baseFor(req)));
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  return json(await handleRpc(body, { allowExecute: authorized(req) }));
}

function authorized(req: Request) {
  const secret = cfg().cronSecret;
  if (!secret) return false;
  const got = req.headers.get("x-cron-secret") ?? (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function cronRebalance(req: Request) {
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const self = agentAddress();
  if (!self) return json({ error: "no_wallet" }, 500);
  try {
    const report = await run({ address: self, targetPct: cfg().targetPct, execute: cfg().executionEnabled });
    return json(report);
  } catch (e) {
    return json({ error: (e instanceof Error ? e.message : String(e)).split("\n")[0] }, 500);
  }
}
