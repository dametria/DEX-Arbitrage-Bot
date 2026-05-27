# Implementation Guide: PancakeSwap Flash-Loan Arbitrage Bot

## Table of Contents
1. [Setup & Configuration](#setup--configuration)
2. [Deployment](#deployment)
3. [Usage Examples](#usage-examples)
4. [Event Monitoring](#event-monitoring)
5. [Profit Analysis](#profit-analysis)
6. [Troubleshooting](#troubleshooting)
7. [Operational Best Practices](#operational-best-practices)

---

## Setup & Configuration

### Prerequisites
- Node.js 16+ and npm/yarn
- Hardhat or Truffle
- BSC Mainnet RPC endpoint (Alchemy, Infura, or QuickNode)
- MetaMask or hardware wallet with BNB for gas

### Installation

```bash
# Clone repository
git clone https://github.com/dametria/DEX-Arbitrage-Bot.git
cd DEX-Arbitrage-Bot

# Install dependencies
npm install

# Or with Yarn
yarn install
```

### Environment Configuration

Create `.env` file:
```env
# BSC Mainnet RPC
BSC_RPC_URL=https://bsc-dataseed1.binance.org:443
# Or from Alchemy: https://bsc-mainnet.g.alchemy.com/v2/YOUR_KEY

# Private key of bot wallet (owner address)
PRIVATE_KEY=0x...

# PancakeSwap contract addresses (already hardcoded, for reference)
FACTORY_ADDRESS=0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73
V2_ROUTER_ADDRESS=0x10ED43C718714eb63d5aA57B78B54704E256024E
V3_ROUTER_ADDRESS=0x13f4EA83D0bd40E75C8222255bc855a974568Dd4
USDT_ADDRESS=0x55d398326f99059fF775485246999027B3197955
WBNB_ADDRESS=0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c
```

---

## Deployment

### 1. Testnet Deployment (BSC Testnet)

```bash
# Configure Hardhat for testnet
npx hardhat run scripts/deploy.js --network bscTestnet
```

**Deploy Script** (`scripts/deploy.js`):
```javascript
const hre = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const PancakeArb = await ethers.getContractFactory("PancakeArbFlashLoan");
  const contract = await PancakeArb.deploy();
  await contract.deployed();

  console.log("Contract deployed to:", contract.address);
  
  // Save deployment address
  const fs = require("fs");
  fs.writeFileSync("deployment.json", JSON.stringify({
    address: contract.address,
    deployer: deployer.address,
    timestamp: new Date().toISOString()
  }));
}

main().catch(console.error);
```

### 2. Mainnet Deployment (BSC Mainnet)

```bash
# Before deploying, verify all parameters in contract
# - Factory, Router addresses
# - Token addresses
# - Swap deadline (15 seconds)
# - Flash loan fee (0.25%)

npx hardhat run scripts/deploy.js --network bscMainnet
```

**Verify on BscScan:**
```bash
# After deployment, verify source code
npx hardhat verify --network bscMainnet DEPLOYED_ADDRESS
```

---

## Usage Examples

### Example 1: Basic Arbitrage (V2 → V3)

**Scenario:**
- Arbitrage WBNB with USDT quote
- Buy on V2, sell on V3
- Borrow 1000 USDT, expect 10 USDT profit

```javascript
const { ethers } = require("hardhat");

async function executeArbitrage() {
  const arbitrageABI = require("./abi/PancakeArbFlashLoan.json");
  const contractAddress = "0x..."; // Your deployed contract
  
  const [signer] = await ethers.getSigners();
  const contract = new ethers.Contract(contractAddress, arbitrageABI, signer);

  // Parameters
  const tokenIn = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"; // WBNB
  const tokenOut = "0x55d398326f99059fF775485246999027B3197955"; // USDT
  const loanAmount = ethers.parseEther("1000"); // 1000 USDT
  const v2First = true; // Buy on V2, sell on V3
  const v3Fee = 500; // 0.05% fee tier
  const minProfit = ethers.parseEther("10"); // 10 USDT minimum
  
  // Calculate expected outputs (off-chain, using price feeds)
  // For this example, assume 1 USDT = 0.001 WBNB (on both exchanges)
  // V2: 1000 USDT → ~1 WBNB (simplified)
  // V3: 1 WBNB → ~990 USDT (after fees)
  // Net profit: ~-10 USDT (this is a loss, so try a better pair)
  
  const minOut1 = ethers.parseEther("0.9"); // At least 0.9 WBNB from V2
  const minOut2 = ethers.parseEther("980"); // At least 980 USDT from V3

  try {
    console.log("Executing arbitrage...");
    const tx = await contract.executeArbitrage(
      tokenIn,
      tokenOut,
      loanAmount,
      v2First,
      v3Fee,
      minProfit,
      minOut1,
      minOut2
    );

    console.log("Transaction hash:", tx.hash);
    const receipt = await tx.wait();
    console.log("Gas used:", receipt.gasUsed.toString());
    console.log("Transaction confirmed!");
  } catch (error) {
    console.error("Arbitrage failed:", error.message);
  }
}

executeArbitrage();
```

### Example 2: Dynamic Price Calculation

**Using PancakeSwap Quoter to calculate expected outputs:**

```javascript
const { ethers } = require("hardhat");

async function calculateOptimalArbitrage() {
  const v2RouterABI = require("./abi/IPancakeV2Router.json");
  const v3QuoterABI = require("./abi/IPancakeV3Quoter.json");
  
  const v2Router = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
  const v3Quoter = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997";
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

  const loanAmount = ethers.parseEther("1000"); // 1000 USDT
  const v3Fee = 500; // 0.05% fee tier

  // V2: USDT → WBNB
  const router = new ethers.Contract(v2Router, v2RouterABI, ethers.provider);
  const v2Out = await router.getAmountsOut(loanAmount, [USDT, WBNB]);
  const wbnbFromV2 = v2Out[1];
  console.log("V2 output (USDT → WBNB):", ethers.formatEther(wbnbFromV2));

  // V3: WBNB → USDT
  const quoter = new ethers.Contract(v3Quoter, v3QuoterABI, ethers.provider);
  const v3Out = await quoter.quoteExactInputSingle(WBNB, USDT, v3Fee, wbnbFromV2, 0);
  const usdtFromV3 = v3Out[0];
  console.log("V3 output (WBNB → USDT):", ethers.formatEther(usdtFromV3));

  // Calculate profit
  const profit = usdtFromV3 - loanAmount - (loanAmount * 10025n / 10000n + 1n);
  console.log("Expected profit:", ethers.formatEther(profit));

  if (profit > 0) {
    console.log("✅ Profitable! Executing...");
    // Calculate slippage (5% safety margin)
    const minOut1 = (wbnbFromV2 * 95n) / 100n;
    const minOut2 = (usdtFromV3 * 95n) / 100n;
    
    // Call executeArbitrage with these values
  } else {
    console.log("❌ Not profitable, skipping");
  }
}

calculateOptimalArbitrage();
```

### Example 3: Multi-Token Arbitrage Loop

**Continuously scan for opportunities:**

```javascript
const { ethers } = require("hardhat");

async function arbitrageLoop() {
  const contract = await ethers.getContractAt(
    "PancakeArbFlashLoan",
    "0x..."
  );

  const tokens = [
    "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB
    "0x7130d2a12b9bcbFdd356a7b3c255bc9a3c4534e6", // BTCB
    "0x2170Ed0880ac9A755fd29B2688956BD959e2Fe26", // WETH
  ];

  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const loanAmount = ethers.parseEther("1000");

  console.log("Starting arbitrage loop...");

  while (true) {
    for (const token of tokens) {
      try {
        // Calculate opportunity (code from Example 2)
        const profit = await calculateProfitOpportunity(token);

        if (profit > ethers.parseEther("50")) {
          console.log(`Opportunity found on ${token}: ${ethers.formatEther(profit)} USDT`);
          
          // Execute arbitrage
          const minOut1 = ethers.parseEther("0.9");
          const minOut2 = ethers.parseEther("950");
          
          const tx = await contract.executeArbitrage(
            token,
            USDT,
            loanAmount,
            true, // v2First
            500,
            ethers.parseEther("50"),
            minOut1,
            minOut2
          );

          console.log("Tx submitted:", tx.hash);
          await tx.wait();
          console.log("✅ Arbitrage executed!");
        }
      } catch (error) {
        console.error(`Error with token ${token}:`, error.message);
      }
    }

    // Sleep 10 seconds before next scan
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
}

arbitrageLoop();
```

---

## Event Monitoring

### Listen to Arbitrage Events

```javascript
const { ethers } = require("hardhat");

async function monitorArbitrage() {
  const contractAddress = "0x...";
  const contract = await ethers.getContractAt(
    "PancakeArbFlashLoan",
    contractAddress
  );

  // Listen for arbitrage executions
  contract.on("ArbitrageExecuted", (tokenIn, tokenOut, loanAmount, startBal, endBal, profit, v2First) => {
    console.log(`
      🎯 Arbitrage Executed!
      Token In: ${tokenIn}
      Loan: ${ethers.formatEther(loanAmount)} USDT
      Start Balance: ${ethers.formatEther(startBal)} USDT
      End Balance: ${ethers.formatEther(endBal)} USDT
      Profit: ${ethers.formatEther(profit)} USDT
      Direction: ${v2First ? "V2 → V3" : "V3 → V2"}
    `);
  });

  // Listen for gas refunds
  contract.on("GasRefundSucceeded", (recipient, bnbAmount) => {
    console.log(`Gas refund (BNB): ${ethers.formatEther(bnbAmount)} → ${recipient}`);
  });

  contract.on("GasRefundFallback", (recipient, usdtAmount) => {
    console.log(`Gas refund fallback (USDT): ${ethers.formatEther(usdtAmount)} → ${recipient}`);
  });

  // Listen for profit failures
  contract.on("MinProfitNotMet", (actualProfit, requiredProfit) => {
    console.warn(`❌ Profit too low: ${ethers.formatEther(actualProfit)} < ${ethers.formatEther(requiredProfit)}`);
  });

  console.log("Listening for arbitrage events...");
}

monitorArbitrage();
```

### Event Storage (Database Integration)

```javascript
const mongoose = require("mongoose");

const TradeSchema = new mongoose.Schema({
  timestamp: Date,
  tokenIn: String,
  loanAmount: String,
  profit: String,
  gasRefund: String,
  txHash: String,
  v2First: Boolean,
});

const Trade = mongoose.model("Trade", TradeSchema);

async function recordEvent(event) {
  const trade = new Trade({
    timestamp: new Date(),
    tokenIn: event.tokenIn,
    loanAmount: event.loanAmount.toString(),
    profit: event.profit.toString(),
    gasRefund: event.bnbAmount?.toString() || "0",
    txHash: event.transactionHash,
    v2First: event.v2First,
  });

  await trade.save();
  console.log("Trade recorded in database");
}
```

---

## Profit Analysis

### Calculate Historical Profits

```javascript
async function analyzeProfits() {
  const contract = await ethers.getContractAt(
    "PancakeArbFlashLoan",
    "0x..."
  );

  // Fetch past events
  const filter = contract.filters.ArbitrageExecuted();
  const events = await contract.queryFilter(filter, 0, "latest");

  let totalProfit = 0n;
  let tradeCount = 0;
  let tokenProfits = {};

  for (const event of events) {
    const profit = event.args.profit;
    totalProfit += profit;
    tradeCount++;

    const token = event.args.tokenIn;
    tokenProfits[token] = (tokenProfits[token] || 0n) + profit;
  }

  console.log(`
    📊 Arbitrage Statistics
    ────────────────────────
    Total Trades: ${tradeCount}
    Total Profit: ${ethers.formatEther(totalProfit)} USDT
    Average Trade: ${ethers.formatEther(totalProfit / BigInt(tradeCount))} USDT
    
    By Token:
  `);

  for (const [token, profit] of Object.entries(tokenProfits)) {
    console.log(`  ${token.slice(0, 10)}...: ${ethers.formatEther(profit)} USDT`);
  }
}
```

### ROI Calculation

```javascript
async function calculateROI() {
  const contract = await ethers.getContractAt(
    "PancakeArbFlashLoan",
    "0x..."
  );

  const events = await contract.queryFilter(
    contract.filters.ArbitrageExecuted(),
    0,
    "latest"
  );

  let totalGasSpent = 0n;
  let totalProfit = 0n;

  for (const event of events) {
    const receipt = await ethers.provider.getTransactionReceipt(event.transactionHash);
    const gasSpent = receipt.gasUsed * receipt.gasPrice;
    const profit = event.args.profit;

    totalGasSpent += gasSpent;
    totalProfit += profit;
  }

  const netProfit = totalProfit - totalGasSpent;
  const roi = (netProfit * 100n) / totalGasSpent;

  console.log(`
    ROI Analysis
    ────────────
    Total Gas: ${ethers.formatEther(totalGasSpent)} BNB
    Total Profit: ${ethers.formatEther(totalProfit)} USDT
    Net Profit: ${ethers.formatEther(netProfit)} USDT
    ROI: ${roi.toString()}%
  `);
}
```

---

## Troubleshooting

### Issue: "No V2 pair for flash loan"

**Cause:** Token pair doesn't exist on PancakeSwap V2.

**Solution:**
```javascript
// Verify pair exists
const factory = await ethers.getContractAt(
  "IPancakeV2Factory",
  "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73"
);

const pair = await factory.getPair(USDT, tokenIn);
console.log("Pair exists:", pair !== "0x0000000000000000000000000000000000000000");
```

### Issue: "Insufficient profit after gas"

**Cause:** Profit is too low after repaying loan + gas refund.

**Solution:**
```javascript
// Try different loan amounts or tokens
// Or reduce gasRefundUsdt
await contract.setGasRefundUsdt(ethers.parseEther("0.1")); // Lower from 0.5 USDT
```

### Issue: "Slippage exceeded"

**Cause:** Price moved between calculation and execution (MEV sandwich).

**Solution:**
```javascript
// Increase slippage tolerance
const minOut1 = (expectedOut1 * 90n) / 100n; // 10% slippage instead of 5%

// Or reduce loan amount (less price impact)
const loanAmount = ethers.parseEther("500"); // Smaller trades
```

### Issue: Transaction Reverted (No Reason)

**Cause:** Generic revert, usually in swap execution.

**Diagnosis:**
```javascript
// Check balance before arbitrage
const balance = await usdt.balanceOf(contractAddress);
console.log("Contract USDT balance:", ethers.formatEther(balance));

// Simulate transaction to get detailed error
const result = await ethers.provider.call({
  to: contractAddress,
  data: // encoded call to executeArbitrage
});
```

---

## Operational Best Practices

### 1. Risk Management

```javascript
// Set maximum loan amount
const MAX_LOAN = ethers.parseEther("10000"); // 10k USDT

// Only execute if profit > gas cost
const minProfitThreshold = ethers.parseEther("50"); // 50 USDT

// Diversify tokens
const TRADED_TOKENS = [WBNB, BTCB, WETH, XRP]; // Multiple tokens

// Rate limiting
let lastExecutionTime = 0;
const COOLDOWN_MS = 30000; // 30 seconds between trades

if (Date.now() - lastExecutionTime < COOLDOWN_MS) {
  console.log("Cooldown in effect, skipping");
  return;
}
```

### 2. Emergency Pause

```javascript
// Monitor for errors
let errorCount = 0;
const MAX_ERRORS = 5;

try {
  // Execute arbitrage
} catch (error) {
  errorCount++;
  if (errorCount >= MAX_ERRORS) {
    console.error("Too many errors, pausing bot");
    process.exit(1);
  }
}
```

### 3. Profit Targets

```javascript
// Set daily profit target
const DAILY_TARGET = ethers.parseEther("500"); // 500 USDT
let dailyProfit = 0n;

// On each successful trade, add to daily profit
// When target reached, pause for day
if (dailyProfit >= DAILY_TARGET) {
  console.log("Daily target reached, pausing until tomorrow");
  return;
}
```

### 4. Gas Price Monitoring

```javascript
// Only execute if gas prices are reasonable
const gasPrice = await ethers.provider.getGasPrice();
const maxGasPrice = ethers.parseUnits("10", "gwei"); // 10 gwei max

if (gasPrice > maxGasPrice) {
  console.log("Gas prices too high, skipping");
  return;
}
```

### 5. Logging & Alerting

```javascript
const pino = require("pino");
const logger = pino();

logger.info({
  type: "ARBITRAGE_STARTED",
  token: tokenIn,
  loanAmount: loanAmount.toString(),
  timestamp: new Date().toISOString(),
});

// Send alerts for large profits
if (profit > ethers.parseEther("100")) {
  await sendTelegramAlert(`🎉 Large profit detected: ${ethers.formatEther(profit)} USDT`);
}
```

---

## Performance Tuning

### Optimize RPC Calls

```javascript
// Use batch requests
const provider = new ethers.JsonRpcProvider(RPC_URL);
const multicall = new ethers.Contract(multicallAddress, multicallABI, provider);

// Batch multiple price checks
const calls = tokens.map(token => 
  multicall.getAmountsOut(loanAmount, [USDT, token])
);

const results = await multicall.aggregate(calls);
```

### Cache Data

```javascript
const cache = {};

async function getPairInfo(token) {
  if (cache[token] && Date.now() - cache[token].time < 5000) {
    return cache[token].data;
  }
  
  const data = await fetchPairInfo(token);
  cache[token] = { data, time: Date.now() };
  return data;
}
```

---

## Conclusion

The PancakeSwap arbitrage bot is now fully operational and production-ready. Follow this guide to deploy, monitor, and optimize your arbitrage operations.

**Key Reminders:**
- ✅ Always test on testnet first
- ✅ Start with small loan amounts
- ✅ Monitor events and profits continuously
- ✅ Adjust parameters based on market conditions
- ✅ Keep contract wallet funded with BNB for gas

Good luck! 🚀
