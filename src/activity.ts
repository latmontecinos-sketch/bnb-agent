import { createPublicClient, formatUnits, http, parseAbiItem } from "viem";
import { bscTestnet } from "viem/chains";
import { agentAddress } from "./chain.js";
import { loadMarket } from "./market.js";

// The default data-seed RPC rejects eth_getLogs, so history is read from a node that allows it (50k-block windows).
const LOGS_RPC = process.env.LOGS_RPC_URL?.trim() || "https://bsc-testnet-rpc.publicnode.com";
const START_BLOCK = 134_308_000n; // just before agent #2545 was registered
const WINDOW = 50_000n;
const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export interface Action {
  hash: `0x${string}`;
  block: number;
  time: string;
  side: "sold_bnb" | "bought_bnb";
  stableAmount: string;
  stableSymbol: string;
  explorer: string;
}

/** Every swap of the agent wallet: stable-token transfers between it and the WBNB/stable pair. */
export async function recentActions(limit = 20): Promise<Action[]> {
  const self = agentAddress();
  if (!self) return [];
  const market = await loadMarket();
  const client = createPublicClient({ chain: bscTestnet, transport: http(LOGS_RPC) });
  const latest = await client.getBlockNumber();

  const windows: [bigint, bigint][] = [];
  for (let from = START_BLOCK; from <= latest; from += WINDOW) {
    windows.push([from, from + WINDOW - 1n > latest ? latest : from + WINDOW - 1n]);
  }
  const query = (args: { from: `0x${string}`; to: `0x${string}` }) =>
    Promise.all(windows.map(([fromBlock, toBlock]) => client.getLogs({ address: market.stable.address, event: transfer, args, fromBlock, toBlock })));
  const [outs, ins] = await Promise.all([query({ from: self, to: market.pair }), query({ from: market.pair, to: self })]);

  const logs = [
    ...outs.flat().map((l) => ({ l, side: "bought_bnb" as const })),
    ...ins.flat().map((l) => ({ l, side: "sold_bnb" as const })),
  ]
    .sort((a, b) => Number(b.l.blockNumber - a.l.blockNumber))
    .slice(0, limit);

  const times = new Map<bigint, string>();
  await Promise.all(
    [...new Set(logs.map(({ l }) => l.blockNumber))].map(async (n) => {
      const b = await client.getBlock({ blockNumber: n });
      times.set(n, new Date(Number(b.timestamp) * 1000).toISOString());
    }),
  );

  return logs.map(({ l, side }) => ({
    hash: l.transactionHash,
    block: Number(l.blockNumber),
    time: times.get(l.blockNumber)!,
    side,
    stableAmount: formatUnits(l.args.value ?? 0n, market.stable.decimals),
    stableSymbol: market.stable.symbol,
    explorer: `https://testnet.bscscan.com/tx/${l.transactionHash}`,
  }));
}
