# MysticAPR

MysticAPR is a confidential staking dApp for the mUSDT confidential token. Users can claim an airdrop, stake, withdraw, and claim 1% APR rewards while keeping their balances encrypted end to end with Zama FHEVM.

## Why it exists
- On-chain activity is transparent by default; MysticAPR keeps balances encrypted so users do not leak holdings or rewards history.
- Staking flows are private without sacrificing composability: encryption is enforced by the contract while the UI drives encryption and decryption through the Zama relayer.
- The reward model is deterministic (1% APR) and withdrawable at any time, so there is no lockup risk or opaque accounting.

## Core features
- Claim a one-time 1,000 mUSDT airdrop to try the protocol.
- Stake encrypted mUSDT and withdraw partially or fully with encrypted amounts.
- Claim accrued interest at a fixed 1% APR (basis-point based accrual).
- View encrypted wallet balance, encrypted stake, and encrypted rewards; decrypt on demand client-side via user decryption.
- End-to-end confidentiality with ERC7984 token semantics and Zama FHEVM ACL enforcement.

## Architecture and tech
- Smart contracts: Solidity 0.8.27, Hardhat, @fhevm/solidity, ERC7984 confidential fungible token implementation.
- Frontend: React + Vite + TypeScript; RainbowKit for wallet connection; viem for reads; ethers for writes; Zama relayer SDK for encryption/decryption. No Tailwind or frontend env vars.
- Tooling: hardhat-deploy for deployments, hardhat-gas-reporter, solidity-coverage, TypeChain (ethers-v6).
- Networks: Hardhat for local development; Sepolia for testnet (via Infura).
- Artifacts and ABIs: stored under `deployments/` (e.g., `deployments/sepolia/MysticAPR.json`); frontend copies ABI/address from there.

## Problems solved
- Privacy-preserving staking: balances and rewards stay encrypted on-chain; only the user decrypts locally.
- Trust-minimized onboarding: the starter airdrop avoids faucet friction and lets users interact without third-party tokens.
- Predictable earnings: APR is fixed and accrued continuously; claims mint encrypted rewards directly to the user.
- User-controlled access: ACL sharing ensures only the contract and the user can operate on ciphertexts, reducing leakage.

## Repository layout
- `contracts/` — MysticAPR confidential staking contract.
- `deploy/` — hardhat-deploy script for MysticAPR.
- `deployments/` — addresses and ABIs per network (source of truth for the frontend).
- `tasks/` — Hardhat tasks for reading addresses, claiming the airdrop, and decrypting balances.
- `test/` — FHEVM-aware contract tests.
- `app/` — React + Vite frontend (uses Sepolia by default, no env vars).
- `docs/` — Zama FHEVM and relayer reference notes.

## Getting started
Prerequisites: Node.js 20+, npm, and an Infura project key for Sepolia.

1) Install dependencies  
`npm install` at the repo root, then `cd app && npm install` for the frontend.

2) Configure environment (contracts)  
Create `.env` in the repo root with:
```
INFURA_API_KEY=your_infura_key
PRIVATE_KEY=your_sepolia_private_key   # single private key, no mnemonic
ETHERSCAN_API_KEY=optional_for_verify
```

3) Compile and test contracts  
`npm run compile`  
`npm run test` (uses the FHEVM mock; run before any deployment).

4) Local blockchain (for contract iteration)  
`npm run chain` to start Hardhat with the FHEVM mock; use `npm run deploy:localhost` if you need a local deploy for scripting/tests.

5) Frontend  
In `app/`, update `src/config/wagmi.ts` with your WalletConnect `projectId` and ensure `src/config/contracts.ts` is synced with `deployments/sepolia/MysticAPR.json` (address + ABI).  
Run `npm run dev` and open the Vite dev server; the UI expects Sepolia, not localhost.

## Contract details
- Token: mUSDT (ERC7984 confidential fungible token), 6 decimals.
- Airdrop: `AIRDROP_AMOUNT = 1_000 * 10^6`, callable once per address.
- Staking: `stake(externalEuint64, bytes)` moves encrypted mUSDT into the contract; `withdrawStake` and `withdrawAllStake` return encrypted principal.
- Rewards: accrues at `APR_BPS = 100` (1% APR) against time elapsed; `claimInterest()` mints encrypted rewards and resets accrued rewards.
- Views: `confidentialBalanceOf`, `encryptedStakeOf`, `encryptedRewardsOf`, `hasClaimed`, `lastAccrualOf`, `lastClaimedReward`.
- ACL: balances and rewards share permissions with the user and contract for safe decrypt/select operations.

## Frontend experience
- Wallet connection via RainbowKit (Sepolia).
- Encryption: inputs are encrypted client-side with the relayer SDK (`useZamaInstance`) before writes.
- Reads: viem `useReadContract` keeps encrypted balances up to date; decryption uses user-initiated EIP-712 signatures and relayer user-decrypt.
- Writes: ethers contracts for `claimAirdrop`, `stake`, `withdrawStake`, `withdrawAllStake`, and `claimInterest`; transactions are labelled in UI state.
- UX notes: no localhost network, no localStorage, no frontend env vars; ciphertexts are truncated when shown encrypted.

## Developer scripts (root)
- `npm run compile` — compile contracts.
- `npm run test` — run FHEVM mock tests.
- `npm run coverage` — solidity-coverage.
- `npm run lint` — Solidity + TypeScript linting.
- `npm run deploy:sepolia` — deploy via hardhat-deploy using `PRIVATE_KEY` and `INFURA_API_KEY`.
- `npm run verify:sepolia` — Etherscan verification (optional).

## Hardhat tasks
- `npx hardhat task:mystic-address` — print deployed MysticAPR address.
- `npx hardhat task:claim-airdrop` — call `claimAirdrop()` from the first signer.
- `npx hardhat task:decrypt-balance --address <addr>` — decrypt confidential balance with the mock relayer.
- `npx hardhat task:decrypt-stake` — decrypt stake and rewards for the first signer.

## Deployment workflow (Sepolia)
1) Ensure tests pass locally (`npm run test`).
2) Set `INFURA_API_KEY` and `PRIVATE_KEY` (single key, no mnemonic).
3) `npm run deploy:sepolia`.
4) Copy the newly emitted address and ABI from `deployments/sepolia/MysticAPR.json` into `app/src/config/contracts.ts` (address, ABI, and constants). Do not use mock or placeholder data.
5) Restart the frontend; connect a Sepolia wallet to interact end-to-end.

## Testing and QA
- Use the FHEVM mock when running `npm run test`; the suite covers airdrop gating, staking/withdrawal, and reward accrual/minting with time travel.
- For manual QA on Sepolia, claim the airdrop, stake a small amount, wait or time-travel on a fork, then claim interest and decrypt balances from the UI.
- Gas/reporting: enable `REPORT_GAS=1` when needed; keep optimizer at 800 runs as configured.

## Advantages
- Privacy-first: encrypted balances and rewards; user-controlled decryption.
- Predictable returns: fixed 1% APR with transparent formula.
- Simple UX: guided airdrop, wallet connect, decrypt-on-demand, and clear transaction labeling.
- Auditable logic: small, single-purpose contract with comprehensive tests and deterministic parameters.

## Roadmap ideas
- Variable APR schedules and reward vault funding.
- Multiple asset support using additional ERC7984 tokens.
- Public metrics (total value staked) via selectively decryptable aggregates.
- Enhanced UI states for relayer latency and transaction receipts.
- Additional tasks for rotating keys and exporting audit logs of accrual events.

## References
- Zama FHEVM docs: see `docs/zama_llm.md`.
- Relayer SDK reference: see `docs/zama_doc_relayer.md`.
- Contract ABI/address source: `deployments/sepolia/MysticAPR.json` (copy into the frontend).
