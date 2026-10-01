# Aex Rebalancer

ERC-8004 AI agent for the BNB Chain "Set and Earn" campaign.

- **Category:** rebalancing
- **Chain:** BNB Smart Chain testnet (chain 97). Testnet only, no real funds.
- **Identity Registry:** `0x8004A818BFB912233c491871b3d84c89A494BD9e` (`eip155:97:0x8004A818BFB912233c491871b3d84c89A494BD9e`)
- **Agent ID:** `<pending>`
- **Operating wallet:** `0x5375f369Bc68b1a930c3942e7DfC09A32217F728` (the agent signs with its own key; fund it with tBNB and the faucet test stable to see swaps)

## What it does

Keeps a managed portfolio between WBNB and a test stablecoin at a target weight (default 50/50, bounded 10-90%) by swapping on PancakeSwap V2 testnet (router `0xD99D1c33F9fC3444f8101754aBC46c52416550D1`, factory `0x6725F303b657a9451d8BA641348b6761A6CC7a17`).

- WBNB is read from the router (`WETH()`), never hardcoded.
- The stable (USDT / BUSD / USDC from the BNB testnet faucet) is chosen onchain: the one whose WBNB pair has the most liquidity (`factory.getPair` + `getReserves`). At the time of writing: USDT (`0x337610d27c682E347C9cD60BD4b3b107C9d34dDd`), pair `0x5F52Ad4bD4f519AE79999400ad8B83A3D002fD92`, about 18.39 WBNB / 219.98 USDT. Override with `STABLE_TOKEN`.
- "BNB side" = native BNB (minus `GAS_RESERVE_BNB`) + WBNB. Drift = BNB-side weight minus target. If |drift| > threshold (default 1%) it swaps the difference, capped per tx (`MAX_TX_BNB`, default 0.02 BNB value), with `minOut` = `getAmountsOut` minus `SLIPPAGE_PCT` (default 1%). It uses `swapExactETHForTokens`, `swapExactTokensForETH` or `swapExactTokensForTokens`, with approvals when needed.
- Every signing path asserts `chainId === 97` and refuses otherwise.

### Messages (A2A)

| Message | Result |
|---|---|
| `status` | balances, weights, price, drift, last action |
| `rebalance to 60/40` (first number = WBNB %) | public callers: returns the rebalance plan (dry run). Owner (`Authorization: Bearer <CRON_SECRET>`): executes it and returns tx hash and before/after |
| any text with a `0x...` address | read-only split of that address and the suggested swap (never executes) |

**Limitation:** there is no database. The target comes from `TARGET_WBNB_PCT` (env) or from the request itself; it is not remembered between requests. "Last action" lives in instance memory only (best effort on serverless). Executions are rate limited per instance (`MIN_EXEC_INTERVAL_SEC`).

## Endpoints

| Path | Purpose |
|---|---|
| `/.well-known/agent-card.json` | A2A agent card |
| `/.well-known/agent-registration.json` | ERC-8004 registration file |
| `/api/a2a` | A2A JSON-RPC 2.0 (`message/send`, alias `SendMessage`) |
| `/api/health` | liveness |
| `/api/status` | portfolio status |
| `/api/cron/rebalance` | daily check, requires `CRON_SECRET` (`Authorization: Bearer ...` or `x-cron-secret`) |
| `/register.html` | registration helper (built from `tools/register.html`) |

## Run

```bash
npm install
npm run gen-wallet                 # writes AGENT_PRIVATE_KEY to .env (only if unset), prints the address only
npm run status
npm run rebalance -- --dry-run     # plan only
npm run rebalance -- --target 60   # sends txs from the agent wallet (testnet)
npm run dev                        # local server on :3000
npm test                           # smoke test of all endpoints (read-only)
npm run build                      # typecheck + copy the register page
```

## Deploy (Vercel)

Import the repo (no framework). Set `AGENT_PRIVATE_KEY`, `PUBLIC_BASE_URL`, `CRON_SECRET`, and later `AGENT_ID`. `vercel.json` defines the rewrites and a daily cron (12:00 UTC).

## Register on ERC-8004

1. Deploy and check `https://<domain>/.well-known/agent-registration.json`.
2. Open `tools/register.html` in a browser with your wallet (or `https://<domain>/register.html`), connect, confirm chain 97, keep the prefilled agentURI and press `register`. The page shows the new Agent ID. Put it in `AGENT_ID` and in this README.
3. Optional: `npm run sign-agent-wallet -- <agentId> <registering address>` creates an offline EIP-712 signature so the registry owner can call `setAgentWallet` from the same page (the registry gives short deadlines, so submit right away).

## Marketplaces

- **HelloFugu** (`app.hellofugu.xyz/list`): needs an ERC-8004 identity; the owner wallet then lists it (category, price, period). Hires are escrow subscriptions in `FuguSubscription`; payment accrues per second and is paid to the listing owner when anyone calls `claim(subId)`.
- **Pokter** (`pokter.xyz/build`): needs a public HTTPS A2A endpoint (`GET /.well-known/agent-card.json` and JSON-RPC 2.0 POST). Connection test, profile review, then registry tx with the identity wallet.

## Campaign checklist mapping

| Requirement | Where |
|---|---|
| Build and list one quality agent (rebalancing) | this repo, listed via HelloFugu / Pokter |
| Public repository | this repo (to be published) |
| Executes real onchain actions | PancakeSwap V2 testnet swaps from the agent wallet |
| ERC-8004 identity | `tools/register.html` + registration file |
| Independent hires / category activity | by users of the marketplaces; the agent does not self-hire |

## Risks

Testnet liquidity is thin and prices differ from mainnet (the chosen pair prices BNB far from market). Swaps use slippage protection and a per-tx cap, and only the owner (or the daily cron) can make the agent send a swap; public A2A calls get the plan only.
