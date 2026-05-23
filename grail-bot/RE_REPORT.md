# Phase 0 Reverse Engineering Report — Grail.xyz on Base

> **Status: TEMPLATE — Not yet completed.**
> Fill in all fields before writing any production code.
> Run `npm run dev -- start --dry-run` to validate calldata against BaseScan transactions.

---

## Tools Used

- [ ] Tenderly — transaction debugger
- [ ] BaseScan — verified contract ABI / read-write tabs
- [ ] Foundry `cast 4byte-decode`, `cast call`, `cast run`
- [ ] Chrome DevTools Network tab (XHR filter)
- [ ] mitmproxy (optional, for HTTPS interception)

---

## buy_pack

```yaml
contract: "0x???"                          # TODO: find via Chrome DevTools tx to contract
function: "buy(???)"                        # TODO: decode via cast 4byte-decode <selector>
selector: "0x???"                          # first 4 bytes of calldata
payment_token: "USDC | ETH"               # TODO: check msg.value vs ERC20 transferFrom in Tenderly
price_per_pack: "fixed | dynamic"         # TODO: fixed = constant, dynamic = oracle/mapping
price_value: "???"                         # e.g. "10000000" (10 USDC at 6 decimals)
max_per_wallet: null                       # TODO: check for require(bought[msg.sender] < maxPacks)
requires_signature: false                  # TODO: check for ecrecover / SignatureChecker in bytecode
requires_approval:
  - token: "USDC"
    spender: "0x???"                       # the pack sale contract address
events_emitted:
  - "PackBought(address indexed buyer, uint256 packCount, uint256[] packIds)"
    # TODO: verify exact event signature from contract ABI
example_tx: "https://basescan.org/tx/0x..."  # Link to a real buy tx for regression test
notes: |
  TODO: Fill after Tenderly analysis of a real buy transaction.
```

---

## open_pack

```yaml
contract: "0x???"
function: "open(???)"
selector: "0x???"
open_mode: "batch | single"               # TODO: one tx for all packs, or one per pack?
cooldown_seconds: null                    # TODO: check for cooldown mapping in contract
nft_standard: "ERC721 | ERC1155"          # TODO: check supportsInterface
tokens_of_owner_function: "tokensOfOwner" # TODO: verify function name (ERC721Enumerable?)
requires_setApprovalForAll: false         # TODO: does sale contract need approval to burn NFT?
events_emitted:
  - "PackOpened(address indexed opener, uint256 packId, address[] tokens, uint256[] amounts)"
    # TODO: verify actual event and token distribution mechanism
reward_mechanism: "transfer_in_open_tx | separate_claim"
  # transfer_in_open_tx: tokens are transferred as part of open() tx
  # separate_claim: need a separate claim() call
example_tx: "https://basescan.org/tx/0x..."
notes: |
  TODO: Fill after Tenderly analysis. Key question: are reward tokens transferred
  in the same tx as open(), or is there a pending rewards mapping requiring a claim?
```

---

## claim_rewards

```yaml
needed: false                             # TODO: set to true if separate claim tx required
contract: "0x???"
function: "claim(???)"
selector: "0x???"
claim_by: "wallet | NFT_ID | both"
auto_claimed: true                        # TODO: if tokens auto-transfer on open, this is true
events_emitted: []
example_tx: null
notes: |
  TODO: Determine by checking if PackOpened event includes token transfers.
  If Tenderly shows ERC20 Transfer events in the open tx → auto-claimed.
  If no transfers but a pending balance mapping exists → separate claim needed.
```

---

## sell_route

```yaml
aggregator: "zerion | odos | 1inch | uniswap_v3"  # TODO: test all, pick best
recommended: "???"
api_endpoint: "???"
auth: "none | api_key | signed"
quote_format: "???"                       # JSON schema of quote request/response
swap_calldata_source: "backend | onchain" # backend API or on-chain quoter?
usdc_output: true                         # we always sell to USDC
slippage_tested: "???"                    # what slippage % works for these tokens?
notes: |
  TODO: Test each aggregator with a sample token received from a real pack opening.
  Verify that simulation succeeds before live test.
```

---

## antibot_checks

```yaml
tx_origin_check: false                    # TODO: search contract bytecode for tx.origin == msg.sender
rate_limit_backend: false                 # TODO: test rapid requests to see if IP/wallet rate-limited
merkle_whitelist: false                   # TODO: check for MerkleProof.verify in bytecode
captcha_required: false                   # TODO: check frontend for hCaptcha/reCAPTCHA on buy action
session_token_required: false             # TODO: check if frontend sends JWT/session in buy API call
notes: |
  TODO: Critical for deciding if Playwright is needed.
  If any of these are true, consult with team before proceeding.
```

---

## pack_limits

```yaml
max_per_wallet: null                      # TODO: read from contract mapping or constant
max_per_tx: null                          # TODO: check require() in buy()
max_per_day: null                         # TODO: check for timestamp-based rate limiting
collection_size: null                     # TODO: read from totalSupply or max supply constant
notes: |
  TODO: Check contract storage for pack limit variables.
  Use: cast call <contract> "maxPacksPerWallet()(uint256)" --rpc-url base
```

---

## open_questions

| Question | Status | Answer |
|----------|--------|--------|
| Does buy() require backend signature? | ❓ TODO | |
| Is payment ETH or USDC? | ❓ TODO | |
| Is price fixed or dynamic? | ❓ TODO | |
| One open() tx for all packs, or one per pack? | ❓ TODO | |
| Are rewards auto-minted in open() tx? | ❓ TODO | |
| Is there a claim() function? | ❓ TODO | |
| ERC721 or ERC1155 for pack NFTs? | ❓ TODO | |
| tx.origin == msg.sender check? | ❓ TODO | |
| Backend rate limiting? | ❓ TODO | |
| What tokens can be received from packs? | ❓ TODO | |

---

## Regression Test Transactions

Once real transactions are found, add them here for regression testing:

```
# Buy pack
TX_BUY=https://basescan.org/tx/0x...
EXPECTED_CALLDATA=0x...

# Open pack  
TX_OPEN=https://basescan.org/tx/0x...
EXPECTED_CALLDATA=0x...

# Claim (if separate)
TX_CLAIM=https://basescan.org/tx/0x...
```

---

## Completion Criteria

Phase 0 is complete when:
1. All TODO fields above are filled in
2. `npm run dev -- start --dry-run` prints calldata identical to the example_tx transactions
3. `cast 4byte-decode` confirms all function selectors
4. Anti-bot questions are answered (no surprises on mainnet)
