import { agentAddress } from "./chain.js";
import { REGISTRY_CAIP, VERSION, cfg } from "./config.js";

export function agentCard(baseUrl = cfg().baseUrl) {
  return {
    protocolVersion: "0.3.0",
    name: "Aex Rebalancer",
    description:
      "Category: rebalancing. Keeps a managed BSC testnet (chain 97) portfolio between WBNB and a test stablecoin at a target weight (default 50/50, bounded 10-90%) by swapping on PancakeSwap V2 testnet with slippage protection and a per-tx cap. Send 'status', 'rebalance to 60/40', or a 0x address for a read-only split and suggested swap. Testnet only, no real funds.",
    url: `${baseUrl}/api/a2a`,
    preferredTransport: "JSONRPC",
    version: VERSION,
    iconUrl: `${baseUrl}/logo.svg`,
    documentationUrl: `${baseUrl}/api/status`,
    provider: { organization: "Aex", url: baseUrl },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "rebalance",
        name: "Rebalance WBNB / stable",
        description: "Rebalance the managed portfolio to a target WBNB weight (10-90%) via PancakeSwap V2 testnet. Returns tx hash and before/after weights.",
        tags: ["rebalancing", "defi", "bnb-chain", "testnet"],
        examples: ["rebalance to 60/40", "rebalance target 50"],
        inputModes: ["text/plain"],
        outputModes: ["text/plain", "application/json"],
      },
      {
        id: "status",
        name: "Portfolio status",
        description: "Balances, WBNB/stable weights, price, drift and last action of the agent wallet.",
        tags: ["rebalancing", "status", "bnb-chain"],
        examples: ["status"],
        inputModes: ["text/plain"],
        outputModes: ["text/plain", "application/json"],
      },
      {
        id: "analyze-address",
        name: "Analyze an address (read-only)",
        description: "Include a 0x address to get its WBNB/stable split and the suggested swap. Never executes.",
        tags: ["rebalancing", "analysis", "read-only"],
        examples: ["analyze 0x0000000000000000000000000000000000000001 target 60/40"],
        inputModes: ["text/plain"],
        outputModes: ["text/plain", "application/json"],
      },
    ],
  };
}

export function registrationFile(baseUrl = cfg().baseUrl) {
  const c = cfg();
  const wallet = agentAddress();
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Aex Rebalancer",
    description:
      "Rebalancing agent (category: rebalancing). Keeps a BSC testnet WBNB/test-stablecoin portfolio at a target weight (default 50/50) using PancakeSwap V2 testnet swaps with slippage protection. Testnet only.",
    image: `${baseUrl}/logo.svg`,
    services: [
      { name: "A2A", endpoint: `${baseUrl}/api/a2a`, version: "0.3.0" },
      { name: "agentCard", endpoint: `${baseUrl}/.well-known/agent-card.json` },
    ],
    x402Support: false,
    active: true,
    registrations: [{ agentId: c.agentId && /^\d+$/.test(c.agentId) ? Number(c.agentId) : null, agentRegistry: REGISTRY_CAIP }],
    supportedTrust: ["reputation"],
    agentWallet: wallet ? `eip155:97:${wallet}` : null,
    operatingWallet: wallet ?? null,
  };
}
