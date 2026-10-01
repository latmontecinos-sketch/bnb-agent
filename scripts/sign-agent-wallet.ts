// Produces the EIP-712 signature the Identity Registry needs for setAgentWallet(agentId, newWallet, deadline, signature).
// Offline signature only: sends NO transaction. The registry owner then submits it from tools/register.html.
import "./load-env.js";
import { agentAccount } from "../src/chain.js";
import { CHAIN_ID, IDENTITY_REGISTRY } from "../src/config.js";

const agentId = process.argv[2];
const owner = process.argv[3];
if (!agentId || !/^\d+$/.test(agentId) || !owner || !/^0x[a-fA-F0-9]{40}$/.test(owner)) {
  console.error("usage: npm run sign-agent-wallet -- <agentId> <ownerAddress (the wallet that registered)>");
  process.exit(1);
}
const account = agentAccount();
if (!account) throw new Error("AGENT_PRIVATE_KEY missing");
const deadline = BigInt(Math.floor(Date.now() / 1000) + 240); // registry caps the deadline window (~5 min)
const signature = await account.signTypedData({
  domain: { name: "ERC8004IdentityRegistry", version: "1", chainId: CHAIN_ID, verifyingContract: IDENTITY_REGISTRY },
  types: { AgentWalletSet: [
    { name: "agentId", type: "uint256" }, { name: "newWallet", type: "address" },
    { name: "owner", type: "address" }, { name: "deadline", type: "uint256" },
  ] },
  primaryType: "AgentWalletSet",
  message: { agentId: BigInt(agentId), newWallet: account.address, owner: owner as `0x${string}`, deadline },
});
console.log(JSON.stringify({ agentId, newWallet: account.address, deadline: deadline.toString(), signature }, null, 2));
