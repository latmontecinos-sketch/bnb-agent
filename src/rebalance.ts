import { formatEther, formatUnits, parseEther, parseUnits, type Address, type Hash } from "viem";
import { erc20Abi, routerAbi } from "./abis.js";
import { publicClient, signerContext } from "./chain.js";
import { ROUTER, cfg } from "./config.js";
import { loadMarket, type Market } from "./market.js";

const MIN_SWAP_BNB = 0.0005;

export interface Holdings {
  native: bigint;
  wbnb: bigint;
  stable: bigint;
}

export interface Snapshot {
  address: Address;
  holdings: Holdings;
  /** BNB side = spendable native (minus gas reserve) + WBNB */
  bnbSideBnb: number;
  stableAmount: number;
  valueBnbSideStable: number;
  totalStable: number;
  wbnbWeightPct: number;
}

export interface Plan {
  action: "none" | "sell_bnb" | "buy_bnb";
  reason: string;
  targetPct: number;
  thresholdPct: number;
  driftPct: number;
  /** sell_bnb: BNB in. buy_bnb: stable in. Human units. */
  amountIn: string;
  source?: "native" | "wbnb" | "stable";
  expectedOut?: string;
  minOut?: string;
  capped?: boolean;
  swapPath?: string;
}

export async function readHoldings(address: Address, market: Market): Promise<Holdings> {
  const pub = publicClient();
  const [native, wbnb, stable] = await Promise.all([
    pub.getBalance({ address }),
    pub.readContract({ address: market.wbnb, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    pub.readContract({ address: market.stable.address, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
  ]);
  return { native, wbnb, stable };
}

export function snapshot(address: Address, h: Holdings, m: Market): Snapshot {
  const reserve = parseEther(String(cfg().gasReserveBnb));
  const spendable = h.native > reserve ? h.native - reserve : 0n;
  const bnbSideBnb = Number(formatEther(spendable + h.wbnb));
  const stableAmount = Number(formatUnits(h.stable, m.stable.decimals));
  const valueBnbSideStable = bnbSideBnb * m.price;
  const totalStable = valueBnbSideStable + stableAmount;
  return {
    address,
    holdings: h,
    bnbSideBnb,
    stableAmount,
    valueBnbSideStable,
    totalStable,
    wbnbWeightPct: totalStable > 0 ? (valueBnbSideStable / totalStable) * 100 : 0,
  };
}

const fix = (n: number, d: number) => (n > 0 ? n.toFixed(d) : "0");

/** Pure planning step (no signing, no state changes). */
export async function computePlan(s: Snapshot, m: Market, targetPct: number): Promise<Plan> {
  const c = cfg();
  const base = { targetPct, thresholdPct: c.driftPct, amountIn: "0" };
  if (s.totalStable <= 0) {
    return { ...base, action: "none", reason: "Portfolio is empty (no spendable BNB/WBNB or stable). Fund the agent wallet first.", driftPct: 0 };
  }
  const drift = s.wbnbWeightPct - targetPct;
  if (Math.abs(drift) <= c.driftPct) {
    return { ...base, action: "none", reason: `Drift ${drift.toFixed(2)}% is within the ${c.driftPct}% threshold.`, driftPct: drift };
  }
  const excessValue = (Math.abs(drift) / 100) * s.totalStable; // in stable units
  const pub = publicClient();

  if (drift > 0) {
    // too much BNB: sell BNB -> stable
    let amt = (excessValue / m.price) * 0.999;
    let capped = false;
    if (amt > c.maxTxBnb) {
      amt = c.maxTxBnb;
      capped = true;
    }
    const nativeSpendable = Number(formatEther(s.holdings.native > parseEther(String(c.gasReserveBnb)) ? s.holdings.native - parseEther(String(c.gasReserveBnb)) : 0n));
    const wbnbBal = Number(formatEther(s.holdings.wbnb));
    let source: "native" | "wbnb";
    if (nativeSpendable >= amt) source = "native";
    else if (wbnbBal >= amt) source = "wbnb";
    else {
      source = nativeSpendable >= wbnbBal ? "native" : "wbnb";
      amt = Math.min(amt, source === "native" ? nativeSpendable : wbnbBal) * 0.999;
    }
    if (amt < MIN_SWAP_BNB) {
      return { ...base, action: "none", reason: `Needed swap (${fix(amt, 6)} BNB) is below the minimum ${MIN_SWAP_BNB} BNB.`, driftPct: drift };
    }
    const amountIn = parseEther(fix(amt, 18));
    const amounts = await pub.readContract({ address: ROUTER, abi: routerAbi, functionName: "getAmountsOut", args: [amountIn, [m.wbnb, m.stable.address]] });
    const out = amounts[1];
    const minOut = (out * BigInt(Math.round((100 - c.slippagePct) * 100))) / 10000n;
    return {
      ...base,
      action: "sell_bnb",
      reason: `WBNB weight ${s.wbnbWeightPct.toFixed(2)}% > target ${targetPct}%: sell BNB for ${m.stable.symbol}.`,
      driftPct: drift,
      amountIn: formatEther(amountIn),
      source,
      expectedOut: formatUnits(out, m.stable.decimals),
      minOut: formatUnits(minOut, m.stable.decimals),
      capped,
      swapPath: `${source === "native" ? "BNB" : "WBNB"} -> ${m.stable.symbol}`,
    };
  }
  // too little BNB: buy BNB with stable
  let amtStable = excessValue * 0.999;
  let capped = false;
  const capStable = c.maxTxBnb * m.price;
  if (amtStable > capStable) {
    amtStable = capStable;
    capped = true;
  }
  amtStable = Math.min(amtStable, s.stableAmount * 0.999);
  if (amtStable / m.price < MIN_SWAP_BNB) {
    return { ...base, action: "none", reason: `Needed swap (~${fix(amtStable / m.price, 6)} BNB) is below the minimum ${MIN_SWAP_BNB} BNB.`, driftPct: drift };
  }
  const amountIn = parseUnits(fix(amtStable, m.stable.decimals), m.stable.decimals);
  const amounts = await pub.readContract({ address: ROUTER, abi: routerAbi, functionName: "getAmountsOut", args: [amountIn, [m.stable.address, m.wbnb]] });
  const out = amounts[1];
  const minOut = (out * BigInt(Math.round((100 - c.slippagePct) * 100))) / 10000n;
  return {
    ...base,
    action: "buy_bnb",
    reason: `WBNB weight ${s.wbnbWeightPct.toFixed(2)}% < target ${targetPct}%: buy BNB with ${m.stable.symbol}.`,
    driftPct: drift,
    amountIn: formatUnits(amountIn, m.stable.decimals),
    source: "stable",
    expectedOut: formatEther(out),
    minOut: formatEther(minOut),
    capped,
    swapPath: `${m.stable.symbol} -> BNB`,
  };
}

export interface ExecResult {
  txs: { step: string; hash: Hash }[];
  status: "success" | "reverted";
}

let lastExecAt = 0;
export interface LastAction {
  at: string;
  plan: Plan;
  txs: string[];
  beforeWeightPct: number;
  afterWeightPct?: number;
}
let lastAction: LastAction | undefined;
export const getLastAction = () => lastAction;

/** Signs and sends. Always goes through signerContext() which asserts chainId === 97. */
export async function executePlan(plan: Plan, m: Market): Promise<ExecResult> {
  if (plan.action === "none") return { txs: [], status: "success" };
  const c = cfg();
  if (!c.executionEnabled) throw new Error("Execution is disabled (EXECUTION_ENABLED=false)");
  const since = (Date.now() - lastExecAt) / 1000;
  if (lastExecAt && since < c.minExecIntervalSec) {
    throw new Error(`Rate limit: last execution ${Math.round(since)}s ago (min ${c.minExecIntervalSec}s)`);
  }
  const { pub, wallet, account } = await signerContext();
  const txs: { step: string; hash: Hash }[] = [];
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const minOutDec = plan.action === "sell_bnb" ? m.stable.decimals : 18;
  const minOut = parseUnits(plan.minOut!, minOutDec);
  const wait = async (step: string, hash: Hash) => {
    txs.push({ step, hash });
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (r.status !== "success") throw new Error(`${step} reverted (${hash})`);
  };
  lastExecAt = Date.now();

  if (plan.action === "sell_bnb") {
    const amountIn = parseEther(plan.amountIn);
    if (plan.source === "native") {
      const hash = await wallet.writeContract({
        address: ROUTER, abi: routerAbi, functionName: "swapExactETHForTokens",
        args: [minOut, [m.wbnb, m.stable.address], account.address, deadline], value: amountIn,
      });
      await wait("swapExactETHForTokens", hash);
    } else {
      await ensureAllowance(m.wbnb, amountIn, wait);
      const hash = await wallet.writeContract({
        address: ROUTER, abi: routerAbi, functionName: "swapExactTokensForTokens",
        args: [amountIn, minOut, [m.wbnb, m.stable.address], account.address, deadline],
      });
      await wait("swapExactTokensForTokens", hash);
    }
  } else {
    const amountIn = parseUnits(plan.amountIn, m.stable.decimals);
    await ensureAllowance(m.stable.address, amountIn, wait);
    const hash = await wallet.writeContract({
      address: ROUTER, abi: routerAbi, functionName: "swapExactTokensForETH",
      args: [amountIn, minOut, [m.stable.address, m.wbnb], account.address, deadline],
    });
    await wait("swapExactTokensForETH", hash);
  }
  return { txs, status: "success" };

  async function ensureAllowance(token: Address, amount: bigint, w: (s: string, h: Hash) => Promise<void>) {
    const { pub: p, wallet: wl, account: a } = await signerContext();
    const cur = await p.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [a.address, ROUTER] });
    if (cur >= amount) return;
    const hash = await wl.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [ROUTER, amount] });
    await w("approve", hash);
  }
}

export interface RunReport {
  address: Address;
  market: { stable: string; stableAddress: Address; wbnb: Address; pair: Address; reserveWbnb: string; reserveStable: string; priceStablePerBnb: number };
  before: { wbnbWeightPct: number; native: string; wbnb: string; stable: string; totalStable: number };
  plan: Plan;
  executed: boolean;
  txs: { step: string; hash: Hash; url: string }[];
  after?: { wbnbWeightPct: number; native: string; wbnb: string; stable: string };
  note?: string;
}

const fmtH = (h: Holdings, m: Market) => ({ native: formatEther(h.native), wbnb: formatEther(h.wbnb), stable: formatUnits(h.stable, m.stable.decimals) });

export function marketView(m: Market): RunReport["market"] {
  return {
    stable: m.stable.symbol, stableAddress: m.stable.address, wbnb: m.wbnb, pair: m.pair,
    reserveWbnb: formatEther(m.reserveWbnb), reserveStable: formatUnits(m.reserveStable, m.stable.decimals),
    priceStablePerBnb: m.price,
  };
}

/** Shared code path used by CLI, A2A and cron. */
export async function run(opts: { address: Address; targetPct: number; execute: boolean }): Promise<RunReport> {
  const m = await loadMarket();
  const h = await readHoldings(opts.address, m);
  const s = snapshot(opts.address, h, m);
  const plan = await computePlan(s, m, opts.targetPct);
  const report: RunReport = {
    address: opts.address,
    market: marketView(m),
    before: { wbnbWeightPct: s.wbnbWeightPct, ...fmtH(h, m), totalStable: s.totalStable },
    plan,
    executed: false,
    txs: [],
  };
  if (plan.action === "none") return report;
  if (!opts.execute) {
    report.note = "Dry run / read-only: nothing was sent.";
    return report;
  }
  const res = await executePlan(plan, m);
  const h2 = await readHoldings(opts.address, m);
  const s2 = snapshot(opts.address, h2, m);
  report.executed = true;
  report.txs = res.txs.map((t) => ({ ...t, url: `https://testnet.bscscan.com/tx/${t.hash}` }));
  report.after = { wbnbWeightPct: s2.wbnbWeightPct, ...fmtH(h2, m) };
  lastAction = { at: new Date().toISOString(), plan, txs: res.txs.map((t) => t.hash), beforeWeightPct: s.wbnbWeightPct, afterWeightPct: s2.wbnbWeightPct };
  return report;
}
