import { formatEther, formatUnits, isAddress, type Address } from "viem";
import { agentAddress, publicClient } from "./chain.js";
import { cfg } from "./config.js";
import { loadMarket } from "./market.js";
import { computePlan, getLastAction, marketView, readHoldings, run, snapshot } from "./rebalance.js";

export const clampTarget = (n: number) => Math.min(90, Math.max(10, Math.round(n)));

export interface Intent {
  kind: "rebalance" | "status" | "analyze" | "help";
  targetPct?: number;
  address?: Address;
  clamped?: boolean;
}

export function parseIntent(text: string): Intent {
  const t = text.toLowerCase();
  const addr = text.match(/0x[a-fA-F0-9]{40}/)?.[0];
  let target: number | undefined;
  const pair = t.match(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/);
  const pct = t.match(/(?:target|to|weight|wbnb|bnb)\D{0,12}(\d{1,3})\s*%?/) ?? t.match(/\b(\d{1,3})\s*%/);
  if (pair) target = Number(pair[1]);
  else if (pct) target = Number(pct[1]);
  const clamped = target !== undefined && (target < 10 || target > 90);
  if (addr && isAddress(addr)) {
    return { kind: "analyze", address: addr as Address, targetPct: target === undefined ? undefined : clampTarget(target), clamped };
  }
  if (/\b(rebalance|rebalancea|balance|target|rebalancear)\b/.test(t) || target !== undefined) {
    return { kind: "rebalance", targetPct: target === undefined ? undefined : clampTarget(target), clamped };
  }
  if (/\b(status|estado|portfolio|balance[s]?|state)\b/.test(t)) return { kind: "status" };
  return { kind: "help" };
}

export interface AgentReply {
  text: string;
  data: Record<string, unknown>;
}

const helpText =
  'Aex Rebalancer keeps a testnet WBNB/stable portfolio at a target weight on PancakeSwap V2 (BSC testnet). Try: "status", "rebalance to 60/40" (60% WBNB), or send a 0x address to get its split and suggested swap (read-only).';

export async function handleMessage(text: string, opts: { allowExecute?: boolean } = {}): Promise<AgentReply> {
  const intent = parseIntent(text);
  const c = cfg();
  const self = agentAddress();
  try {
    if (intent.kind === "help") return { text: helpText, data: { intent: "help" } };

    if (intent.kind === "analyze") {
      const m = await loadMarket();
      const h = await readHoldings(intent.address!, m);
      const s = snapshot(intent.address!, h, m);
      const target = intent.targetPct ?? c.targetPct;
      const plan = await computePlan(s, m, target);
      return {
        text:
          `Analysis for ${intent.address} (read-only, nothing executed): WBNB-side ${s.wbnbWeightPct.toFixed(2)}% / ${m.stable.symbol} ${(100 - s.wbnbWeightPct).toFixed(2)}%. ` +
          `Target ${target}/${100 - target}. ` +
          (plan.action === "none" ? plan.reason : `Suggested: ${plan.swapPath}, amountIn ${plan.amountIn}, expected out ${plan.expectedOut}, minOut ${plan.minOut}.`),
        data: {
          intent: "analyze-address",
          address: intent.address,
          executed: false,
          market: marketView(m),
          holdings: { native: formatEther(h.native), wbnb: formatEther(h.wbnb), stable: formatUnits(h.stable, m.stable.decimals) },
          wbnbWeightPct: s.wbnbWeightPct,
          plan,
        },
      };
    }

    if (!self) return { text: "Agent wallet is not configured (AGENT_PRIVATE_KEY missing).", data: { intent: intent.kind, error: "no_wallet" } };

    if (intent.kind === "status") {
      const m = await loadMarket();
      const h = await readHoldings(self, m);
      const s = snapshot(self, h, m);
      const plan = await computePlan(s, m, c.targetPct);
      const nonce = await publicClient().getTransactionCount({ address: self });
      const last = getLastAction();
      return {
        text:
          `Wallet ${self}: ${formatEther(h.native)} BNB, ${formatEther(h.wbnb)} WBNB, ${formatUnits(h.stable, m.stable.decimals)} ${m.stable.symbol}. ` +
          `WBNB weight ${s.wbnbWeightPct.toFixed(2)}% vs target ${c.targetPct}%. ` +
          (last ? `Last action (this instance): ${last.plan.action} at ${last.at}.` : "No rebalance executed by this instance yet.") +
          ` Next: ${plan.action === "none" ? plan.reason : plan.reason}`,
        data: {
          intent: "status",
          address: self,
          chainId: 97,
          market: marketView(m),
          holdings: { native: formatEther(h.native), wbnb: formatEther(h.wbnb), stable: formatUnits(h.stable, m.stable.decimals) },
          wbnbWeightPct: s.wbnbWeightPct,
          targetPct: c.targetPct,
          plan,
          lastAction: last ?? null,
          txCount: nonce,
        },
      };
    }

    // rebalance
    const target = intent.targetPct ?? c.targetPct;
    const report = await run({ address: self, targetPct: target, execute: opts.allowExecute !== false && c.executionEnabled });
    const clampNote = intent.clamped ? ` (target bounded to ${target}%; allowed range 10-90)` : "";
    const txt = report.executed
      ? `Rebalanced to ${target}/${100 - target}${clampNote}. Before ${report.before.wbnbWeightPct.toFixed(2)}% -> after ${report.after!.wbnbWeightPct.toFixed(2)}% WBNB. Tx: ${report.txs.map((t) => t.hash).join(", ")}`
      : `No transaction sent${clampNote}. ${report.plan.reason}${report.note ? " " + report.note : ""}`;
    return { text: txt, data: { intent: "rebalance", ...report } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { text: `Error: ${msg.split("\n")[0].slice(0, 300)}`, data: { intent: intent.kind, error: msg.split("\n")[0].slice(0, 300) } };
  }
}
