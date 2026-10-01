import { createPublicClient, createWalletClient, http, isHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { CHAIN_ID, cfg } from "./config.js";

export function publicClient() {
  return createPublicClient({ chain: bscTestnet, transport: http(cfg().rpcUrl, { timeout: 15_000, retryCount: 2 }) });
}

export function agentAccount() {
  const k = process.env.AGENT_PRIVATE_KEY?.trim();
  if (!k) return undefined;
  const key = (k.startsWith("0x") ? k : `0x${k}`) as Hex;
  if (!isHex(key) || key.length !== 66) throw new Error("AGENT_PRIVATE_KEY has an invalid format");
  return privateKeyToAccount(key);
}

export function agentAddress(): `0x${string}` | undefined {
  try {
    return agentAccount()?.address;
  } catch {
    return undefined;
  }
}

/** Every path that signs MUST go through here. Refuses unless the RPC really is chain 97. */
export async function signerContext() {
  const account = agentAccount();
  if (!account) throw new Error("AGENT_PRIVATE_KEY is not set (run: npm run gen-wallet)");
  const pub = publicClient();
  const id = await pub.getChainId();
  if (id !== CHAIN_ID || bscTestnet.id !== CHAIN_ID) {
    throw new Error(`Refusing to sign: RPC reports chainId ${id}, expected ${CHAIN_ID} (BSC testnet only)`);
  }
  const wallet = createWalletClient({ account, chain: bscTestnet, transport: http(cfg().rpcUrl, { timeout: 15_000 }) });
  return { pub, wallet, account };
}
