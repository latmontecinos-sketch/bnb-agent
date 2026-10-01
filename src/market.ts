import { formatUnits, zeroAddress, type Address } from "viem";
import { erc20Abi, factoryAbi, pairAbi, routerAbi } from "./abis.js";
import { publicClient } from "./chain.js";
import { FACTORY, ROUTER, STABLE_CANDIDATES, cfg } from "./config.js";

export interface Market {
  wbnb: Address;
  stable: { address: Address; symbol: string; decimals: number };
  pair: Address;
  reserveWbnb: bigint; // 18 dec
  reserveStable: bigint; // stable decimals
  /** stable units (human) per 1 BNB */
  price: number;
  candidates: { symbol: string; address: Address; pair: Address | null; reserveWbnb: string; reserveStable: string }[];
}

async function pairInfo(wbnb: Address, token: Address) {
  const pub = publicClient();
  const pair = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "getPair", args: [wbnb, token] });
  if (pair === zeroAddress) return null;
  const [[r0, r1], t0] = await Promise.all([
    pub.readContract({ address: pair, abi: pairAbi, functionName: "getReserves" }),
    pub.readContract({ address: pair, abi: pairAbi, functionName: "token0" }),
  ]);
  const w0 = t0.toLowerCase() === wbnb.toLowerCase();
  return { pair, reserveWbnb: BigInt(w0 ? r0 : r1), reserveStable: BigInt(w0 ? r1 : r0) };
}

export async function loadMarket(): Promise<Market> {
  const pub = publicClient();
  // WBNB is read from the router, never hardcoded.
  const wbnb = await pub.readContract({ address: ROUTER, abi: routerAbi, functionName: "WETH" });
  const list: Address[] = cfg().stableOverride ? [cfg().stableOverride as Address] : [...STABLE_CANDIDATES];
  const rows = await Promise.all(
    list.map(async (address) => {
      try {
        const [symbol, decimals, info] = await Promise.all([
          pub.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
          pub.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
          pairInfo(wbnb, address),
        ]);
        return { address, symbol, decimals: Number(decimals), info };
      } catch {
        return null;
      }
    }),
  );
  const ok = rows.filter((r): r is NonNullable<typeof r> => !!r);
  const live = ok.filter((r) => r.info && r.info.reserveWbnb > 0n && r.info.reserveStable > 0n);
  // "real liquidity" = most WBNB on the pair
  live.sort((a, b) => (b.info!.reserveWbnb > a.info!.reserveWbnb ? 1 : -1));
  const best = live[0];
  if (!best || !best.info) throw new Error("No test stablecoin has a WBNB pair with liquidity on PancakeSwap V2 testnet");
  const price = Number(formatUnits(best.info.reserveStable, best.decimals)) / Number(formatUnits(best.info.reserveWbnb, 18));
  return {
    wbnb,
    stable: { address: best.address, symbol: best.symbol, decimals: best.decimals },
    pair: best.info.pair,
    reserveWbnb: best.info.reserveWbnb,
    reserveStable: best.info.reserveStable,
    price,
    candidates: ok.map((r) => ({
      symbol: r.symbol,
      address: r.address,
      pair: r.info?.pair ?? null,
      reserveWbnb: r.info ? formatUnits(r.info.reserveWbnb, 18) : "0",
      reserveStable: r.info ? formatUnits(r.info.reserveStable, r.decimals) : "0",
    })),
  };
}
