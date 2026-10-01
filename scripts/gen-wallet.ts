import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const path = ".env";
const text = existsSync(path) ? readFileSync(path, "utf8") : "";
const m = text.match(/^AGENT_PRIVATE_KEY=(.*)$/m);
if (m && m[1].trim()) {
  const k = m[1].trim();
  console.log("AGENT_PRIVATE_KEY already set; not overwriting.");
  console.log("Agent address:", privateKeyToAccount((k.startsWith("0x") ? k : `0x${k}`) as `0x${string}`).address);
} else {
  const key = generatePrivateKey();
  const line = `AGENT_PRIVATE_KEY=${key}`;
  if (m) writeFileSync(path, text.replace(/^AGENT_PRIVATE_KEY=.*$/m, line));
  else appendFileSync(path, (text && !text.endsWith("\n") ? "\n" : "") + line + "\n");
  console.log("Generated a new agent key and saved it to .env (not shown).");
  console.log("Agent address:", privateKeyToAccount(key).address);
}
