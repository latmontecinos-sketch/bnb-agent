import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
import { agentAddress } from "./chain.js";
import { handleMessage, clampTarget } from "./agent.js";
import { cfg } from "./config.js";
import { run } from "./rebalance.js";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n: string) => rest.includes(`--${n}`);
const val = (n: string) => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

async function main() {
  if (cmd === "status") {
    const r = await handleMessage("status");
    console.log(JSON.stringify(r.data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    console.log("\n" + r.text);
    return;
  }
  if (cmd === "rebalance") {
    const self = agentAddress();
    if (!self) throw new Error("AGENT_PRIVATE_KEY missing (npm run gen-wallet)");
    const t = val("target");
    const target = t !== undefined ? clampTarget(Number(t)) : cfg().targetPct;
    const report = await run({ address: self, targetPct: target, execute: !flag("dry-run") && cfg().executionEnabled });
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log("usage: status | rebalance [--target 60] [--dry-run]");
  process.exitCode = 1;
}
main().catch((e) => {
  console.error("Error:", (e instanceof Error ? e.message : String(e)).split("\n")[0]);
  process.exitCode = 1;
});
