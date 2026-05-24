# Foundry Setup & Deployment Guide

## Table of Contents
1. [Installation](#installation)
2. [Configuration](#configuration)
3. [Building](#building)
4. [Testing](#testing)
5. [Deployment](#deployment)
6. [Verification](#verification)
7. [Troubleshooting](#troubleshooting)

---

## Installation

### Prerequisites
- macOS, Linux, or Windows (WSL2)
- Git
- Rust 1.74+ (automatically installed with Foundry)

### Install Foundry

```bash
# Latest version
curl -L https://foundry.paradigm.xyz | bash

# Reload shell
source ~/.bashrc  # or ~/.zshrc for macOS

# Install tools
foundryup
```

### Verify Installation

```bash
forge --version
cast --version
anvil --version
```

---

## Configuration

### 1. Install Dependencies

```bash
cd DEX-Arbitrage-Bot

# Install forge-std library
forge install foundry-rs/forge-std

# Install OpenZeppelin (optional, for additional standards)
forge install OpenZeppelin/openzeppelin-contracts
```

### 2. Create `.env` File

In the project root:

```bash
cat > .env << 'EOF'
# Private key of deployment wallet (KEEP SECRET!)
PRIVATE_KEY=0x...your_bot_wallet_private_key...

# RPC Endpoints
BSC_MAINNET_RPC=https://bsc-dataseed1.binance.org:443
BSC_TESTNET_RPC=https://data-seed-prebsc-1-1.binance.org:8545

# BscScan API Key (for verification)
ETHERSCAN_API_KEY=your_bscscan_api_key
EOF

# Protect .env
chmod 600 .env
```

### 3. Verify `.foundry.toml` Exists

Should be in project root with:
```toml
[profile.default]
src = "contracts"
out = "out"
libs = ["lib"]
```

### 4. Verify Directory Structure

```
DEX-Arbitrage-Bot/
├── contracts/
│   └── PancakeArbFlashLoan.sol
├── script/
│   └── Deploy.s.sol          ← Deployment script
├── test/
│   └── PancakeArbFoundry.t.sol  ← Tests
├── lib/
│   └── forge-std/
├── foundry.toml              ← Foundry config
└── .env                      ← Your configuration
```

---

## Building

### Compile Contracts

```bash
# Standard build
forge build

# With more verbose output
forge build -vvv

# Clean build (remove artifacts)
forge clean
forge build
```

### Check for Warnings

```bash
forge build 2>&1 | grep -i "warning"
```

---

## Testing

### Run All Tests

```bash
# Standard run
forge test

# Verbose output (shows assertion details)
forge test -vvv

# Very verbose (shows stack traces)
forge test -vvvv

# With gas report
forge test --gas-report
```

### Run Specific Test

```bash
# Test a single test contract
forge test --match-contract PancakeArbFoundryTest

# Test a specific test function
forge test --match-test test_RejectDirectPancakeCall -vvv

# Match by pattern
forge test --match test_Owner
```

### Generate Gas Report

```bash
forge test --gas-report > gas-report.txt
cat gas-report.txt
```

### Fuzz Testing

```bash
# Run with fuzzing (default 256 runs)
forge test --fuzz-runs 1000

# Run with seed for reproducibility
forge test --fuzz-seed 12345
```

### Coverage Report

```bash
forge coverage --report lcov

# Install lcov if needed (macOS)
brew install lcov

# Generate HTML report
genhtml lcov.info -o coverage
open coverage/index.html
```

---

## Deployment

### Environment Setup

Before any deployment:

```bash
# Load environment variables
source .env

# Verify private key is set
echo $PRIVATE_KEY

# Verify RPC endpoints
echo $BSC_MAINNET_RPC
echo $BSC_TESTNET_RPC
```

### Dry Run (Testnet)

```bash
# Simulate deployment without broadcasting
forge script script/Deploy.s.sol \
  --rpc-url $BSC_TESTNET_RPC \
  --private-key $PRIVATE_KEY \
  -vvv
```

### Deploy to Testnet

```bash
# Broadcast to testnet
forge script script/Deploy.s.sol \
  --rpc-url $BSC_TESTNET_RPC \
  --private-key $PRIVATE_KEY \
  --broadcast \
  -vvv
```

Output will show:
```
✅ DEPLOYMENT SUCCESSFUL
Contract Address: 0x...
Owner Address: 0x...
```

### Deploy to Mainnet (DRY RUN)

```bash
# Test deployment (does NOT broadcast)
forge script script/Deploy.s.sol \
  --rpc-url $BSC_MAINNET_RPC \
  --private-key $PRIVATE_KEY \
  -vvv
```

### Deploy to Mainnet (BROADCAST)

⚠️ **BE EXTREMELY CAREFUL** - This sends real transactions!

```bash
# Actual deployment
forge script script/Deploy.s.sol \
  --rpc-url $BSC_MAINNET_RPC \
  --private-key $PRIVATE_KEY \
  --broadcast \
  -vvv
```

### Broadcast with Verification

```bash
forge script script/Deploy.s.sol \
  --rpc-url $BSC_MAINNET_RPC \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  --verifier blockscout \
  --verifier-url https://api.bscscan.com/api \
  -vvv
```

---

## Verification

### Verify on BscScan

After deployment, verify the contract:

```bash
forge verify-contract \
  --chain-id 56 \
  --compiler-version v0.8.19 \
  <CONTRACT_ADDRESS> \
  PancakeArbFlashLoan \
  --verifier blockscout \
  --verifier-url https://api.bscscan.com/api
```

### Verify with Constructor Arguments

If your contract has constructor args:

```bash
forge verify-contract \
  --chain-id 56 \
  --compiler-version v0.8.19 \
  <CONTRACT_ADDRESS> \
  PancakeArbFlashLoan \
  --constructor-args <encoded_args> \
  --verifier blockscout \
  --verifier-url https://api.bscscan.com/api
```

### Check Verification Status

```bash
# Go to BscScan
# Search for contract address
# "Contract" tab should show source code
```

---

## Deployment Checklist

- [ ] Foundry installed: `forge --version`
- [ ] Dependencies installed: `forge install foundry-rs/forge-std`
- [ ] `.env` created with `PRIVATE_KEY`
- [ ] `.env` added to `.gitignore`
- [ ] Contract compiles: `forge build`
- [ ] Tests pass: `forge test`
- [ ] Testnet dry run successful
- [ ] Testnet deployment successful
- [ ] Contract verified on BscScan
- [ ] Arbitrage tested on testnet
- [ ] Mainnet dry run successful
- [ ] Mainnet deployment successful

---

## Common Commands Reference

```bash
# Build
forge build
forge clean

# Test
forge test
forge test -vvv
forge test --gas-report
forge test --match test_OwnerCanSetGasRefund

# Deploy (testnet)
forge script script/Deploy.s.sol \
  --rpc-url $BSC_TESTNET_RPC \
  --private-key $PRIVATE_KEY \
  --broadcast -vvv

# Deploy (mainnet)
forge script script/Deploy.s.sol \
  --rpc-url $BSC_MAINNET_RPC \
  --private-key $PRIVATE_KEY \
  --broadcast -vvv

# Format code
forge fmt

# Check gas
forge test --gas-report | grep PancakeArb

# View deployment history
cat broadcast/Deploy.s.sol/56/run-latest.json | jq

# Local testing with Anvil
anvil --fork-url $BSC_MAINNET_RPC --fork-block-number 40000000
```

---

## Troubleshooting

### Issue: "Permission denied" when running forge

**Solution:**
```bash
# Update foundry
foundryup

# Check permissions
ls -la ~/.foundry/bin/
```

### Issue: `.env` file not loading

**Solution:**
```bash
# Ensure .env is in project root
ls -la .env

# Load manually
source .env

# Verify variables are set
echo $PRIVATE_KEY
echo $BSC_MAINNET_RPC
```

### Issue: "Invalid private key format"

**Solution:**
```bash
# Private key must be:
# - Without 0x prefix (will be added automatically)
# - 64 hex characters
# - OR with 0x prefix for 66 characters

# Correct formats:
PRIVATE_KEY=abcd1234...  # 64 chars
PRIVATE_KEY=0xabcd1234...  # 66 chars with 0x
```

### Issue: "RPC endpoint not responding"

**Solution:**
```bash
# Test RPC connection
curl https://bsc-dataseed1.binance.org:443 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"web3_clientVersion","params":[],"id":1}'

# Alternative RPC endpoints:
# https://bsc-dataseed.binance.org
# https://bsc-dataseed1.binance.org
# https://bsc-dataseed2.binance.org
```

### Issue: Contract compilation fails

**Solution:**
```bash
# Check Solidity version
forge --version

# Update Foundry
foundryup

# Clean and rebuild
forge clean
forge build -vvv
```

### Issue: Tests fail with "call reverted"

**Solution:**
```bash
# Run with very verbose output
forge test -vvvv

# Check test logic
cat test/PancakeArbFoundry.t.sol

# Test individual functions
forge test --match test_RejectDirectPancakeCall -vvv
```

### Issue: Deployment times out

**Solution:**
```bash
# Increase timeout
forge script script/Deploy.s.sol \
  --rpc-url $BSC_MAINNET_RPC \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --slow  # Slower but more reliable

# Or use better RPC provider
# - Alchemy
# - Infura
# - QuickNode
```

### Issue: "Insufficient gas"

**Solution:**
```bash
# Check gas prices
cast gas-price --rpc-url $BSC_MAINNET_RPC

# Estimate deployment gas
forge script script/Deploy.s.sol \
  --rpc-url $BSC_MAINNET_RPC \
  --private-key $PRIVATE_KEY \
  -vvv | grep "gas:"
```

---

## Advanced Features

### Local Testing with Anvil

```bash
# Start Anvil (local EVM)
anvil --fork-url $BSC_MAINNET_RPC --fork-block-number 40000000

# In another terminal, deploy locally
forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb476caddbc7f721e0332c6391821 \
  --broadcast
```

### Debug Transactions

```bash
# Get transaction details
cast tx <TX_HASH> --rpc-url $BSC_MAINNET_RPC

# Decode transaction
cast tx <TX_HASH> --json --rpc-url $BSC_MAINNET_RPC

# Check receipt
cast receipt <TX_HASH> --rpc-url $BSC_MAINNET_RPC
```

### Call Contract Functions

```bash
# Check owner
cast call <CONTRACT_ADDRESS> "owner()" --rpc-url $BSC_MAINNET_RPC

# Set gas refund
cast send <CONTRACT_ADDRESS> "setGasRefundUsdt(uint256)" 500000000000000000 \
  --private-key $PRIVATE_KEY \
  --rpc-url $BSC_MAINNET_RPC
```

---

## Next Steps

1. ✅ Install Foundry
2. ✅ Configure `.env`
3. ✅ Build contracts: `forge build`
4. ✅ Run tests: `forge test`
5. ✅ Deploy to testnet: `forge script ... --broadcast`
6. ✅ Verify on BscScan
7. ✅ Test arbitrage on testnet
8. ✅ Deploy to mainnet: `forge script ... --broadcast`
9. ✅ Monitor events and profits

---

**Happy deploying! 🚀**
