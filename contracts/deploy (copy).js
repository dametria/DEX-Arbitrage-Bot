// contracts/deploy.js
const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  console.log("🚀 Starting FlashLoan Arbitrage Contract Deployment...");

  const NETWORK = process.env.NETWORK || "arbitrum";

  const RPC_URLS = {
    arbitrum: "https://arb1.arbitrum.io/rpc",
    arbitrumSepolia: "https://sepolia-rollup.arbitrum.io/rpc"
  };

  const provider = new ethers.JsonRpcProvider(RPC_URLS[NETWORK] || RPC_URLS.arbitrum);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log(`📍 Deploying on ${NETWORK} with account: ${wallet.address}`);

  // Aave FlashLoan Provider on Arbitrum
  const AAVE_FLASHLOAN_PROVIDER = NETWORK === "arbitrum" 
    ? "0x794a61358D6845594F94dc1DB02A252b5b4814aD" 
    : "0x012bAC54348C0E8189D913f9BAa6c2e4f8dE53D9"; // Sepolia testnet

  // Contract Factory
  const FlashLoanArbitrage = await ethers.getContractFactory("FlashLoanArbitrage", wallet);

  console.log("📄 Deploying FlashLoanArbitrage contract...");

  const contract = await FlashLoanArbitrage.deploy(AAVE_FLASHLOAN_PROVIDER);

  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  console.log(`✅ Contract deployed at: ${contractAddress}`);
  console.log(`🔗 View on Arbiscan: https://arbiscan.io/address/${contractAddress}`);

  // === Configure DEX Routers ===
  console.log("⚙️ Setting up DEX configurations...");

  const DEX_CONFIG = {
    uniswap: {
      router: "0x4752ba5DBc23f44D87826275F1D0C0e1A2d9c2A8", // Uniswap V3 Router on Arbitrum (or V2)
      fee: 3000
    },
    sushiswap: {
      router: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
      fee: 3000
    },
    camelot: {
      router: "0xc873fEcbd354f5A56E8E3b97e39D2a2A9f4dA2f4",
      fee: 2500
    }
  };

  for (const [name, config] of Object.entries(DEX_CONFIG)) {
    try {
      const tx = await contract.setDexConfig(
        name,
        config.router,
        config.fee
      );
      await tx.wait();
      console.log(`✅ Configured ${name} router`);
    } catch (e) {
      console.warn(`⚠️ Failed to configure ${name}:`, e.shortMessage || e.message);
    }
  }

  console.log("\n🎉 Deployment completed successfully!");
  console.log(`\nUpdate your .env file with:`);
  console.log(`FLASH_LOAN_CONTRACT=${contractAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });