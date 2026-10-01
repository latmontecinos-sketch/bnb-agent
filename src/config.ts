export const CHAIN_ID = 97;
export const ROUTER = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1" as const;
export const FACTORY = "0x6725F303b657a9451d8BA641348b6761A6CC7a17" as const;
export const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
export const REGISTRY_CAIP = `eip155:${CHAIN_ID}:${IDENTITY_REGISTRY}`;

// Test stablecoins from the official BNB testnet faucet. Symbols/decimals are verified onchain at runtime.
export const STABLE_CANDIDATES = [
  "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd", // USDT
  "0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee", // BUSD
  "0x64544969ed7EBf5f083679233325356EbE738930", // USDC
] as const;

const env = (k: string) => process.env[k]?.trim() || undefined;
const num = (k: string, d: number) => {
  const raw = env(k);
  if (raw === undefined) return d;
  const v = Number(raw);
  return Number.isFinite(v) ? v : d;
};

export const cfg = () => {
  const prod = env("VERCEL_PROJECT_PRODUCTION_URL");
  return {
    rpcUrl: env("RPC_URL") ?? "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
    targetPct: num("TARGET_WBNB_PCT", 50),
    driftPct: num("DRIFT_THRESHOLD_PCT", 1),
    maxTxBnb: num("MAX_TX_BNB", 0.02),
    slippagePct: num("SLIPPAGE_PCT", 1),
    gasReserveBnb: num("GAS_RESERVE_BNB", 0.005),
    stableOverride: env("STABLE_TOKEN"),
    executionEnabled: (env("EXECUTION_ENABLED") ?? "true") !== "false",
    minExecIntervalSec: num("MIN_EXEC_INTERVAL_SEC", 300),
    agentId: env("AGENT_ID"),
    cronSecret: env("CRON_SECRET"),
    baseUrl: (env("PUBLIC_BASE_URL") ?? (prod ? `https://${prod}` : "https://YOUR-DOMAIN.vercel.app")).replace(/\/$/, ""),
  };
};

export const VERSION = "0.1.0";
