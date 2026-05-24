// contracts/deploy.js
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function main() {
  console.log("Starting PancakeArbFlashLoan Deployment...\n");

  const NETWORK = process.env.NETWORK || "bsc";

  const RPC_URLS = {
    bsc: "https://bsc-dataseed1.binance.org/",
    bscTestnet: "https://data-seed-prebsc-1-b7b35bf8.mgrpc.io:8545",
  };

  const PANCAKE_ROUTER_ADDRESSES = {
    bsc: "0x10ED43C718714eb63d5aA57B78f985283df5f054",
    bscTestnet: "0xD99D0BC5f3F99870533cd0b32547014dacf888e8",
  };

  const provider = new ethers.JsonRpcProvider(RPC_URLS[NETWORK] || RPC_URLS.bsc);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log(`Network: ${NETWORK}`);
  console.log(`Deployer: ${wallet.address}\n`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.formatEther(balance)} BNB\n`);

  if (balance < ethers.parseEther("0.0001")) {
    console.error("ERROR: Insufficient balance. Need at least 0.0001 BNB for deployment.");
    process.exit(1);
  }

  // Read compiled bytecode
  const contractPath = path.join(__dirname, "out", "PancakeArbFlashLoan.sol", "PancakeArbFlashLoan.json");
  if (!fs.existsSync(contractPath)) {
    console.error("ERROR: Contract not compiled. Run: forge build contracts/PancakeArbFlashLoan.sol --out contracts/out");
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const { abi, bytecode } = artifact;

  const pancakeRouter = PANCAKE_ROUTER_ADDRESSES[NETWORK] || PANCAKE_ROUTER_ADDRESSES.bsc;

  console.log(`PancakeSwap Router: ${pancakeRouter}`);

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);

  console.log("Deploying PancakeArbFlashLoan...");

  const contract = await factory.deploy(pancakeRouter,{gasLimit: 3_000_000,
  });

  console.log(`Transaction hash: ${contract.deploymentTransaction().hash}`);
  console.log("Waiting for confirmation...");

  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  console.log(`\nContract deployed at: ${contractAddress}\n`);

  // Configure DEXs
  const DEX_CONFIGS = {
    bsc: [
      // dexId 0: PancakeSwap V3
      {
        dexId: 0,
        router: "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
        dexType: 0,
        feeTier: 2500,
      },
      // dexId 1: PancakeSwap V2
      {
        dexId: 1,
        router: "0x10ED43C718714eb63d5aA57B78f985283df5f054",
        dexType: 1,
        feeTier: 0,
      },
    ],
    bscTestnet: [
      // Testnet configs
      {
        dexId: 0,
        router: "0xD99D0BC5f3F99870533cd0b32547014dacf888e8",
        dexType: 1,
        feeTier: 0,
      },
    ],
  };

  const dexConfigs = DEX_CONFIGS[NETWORK] || DEX_CONFIGS.bsc;

  console.log("Configuring DEX routers...\n");

  for (const cfg of dexConfigs) {
    try {
      const tx = await contract.setDexConfig(cfg.dexId, {
        router: cfg.router,
        dexType: cfg.dexType,
        feeTier: cfg.feeTier || 0,
        balancerPoolId: ethers.zeroPadBytes("0x", 32),
        curveIndexIn: 0,
        curveIndexOut: 0,
        veloFactory: ethers.ZeroAddress,
        veloStable: false,
        lbBinStep: 0,
      });
      await tx.wait();
      console.log(`DEX ${cfg.dexId} configured: router=${cfg.router}`);
    } catch (e) {
      console.error(`Failed to configure DEX ${cfg.dexId}: ${e.message}`);
    }
  }

  console.log("\n========================================");
  console.log("DEPLOYMENT COMPLETE");
  console.log("========================================");
  console.log(`Contract Address: ${contractAddress}`);
  console.log(`Network: ${NETWORK}`);
  console.log(`\nUpdate your configuration:\n`);
  console.log(`CONTRACT_ADDRESSES: {`);
  console.log(`  ${NETWORK}: "${contractAddress}",`);
  console.log(`}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
  const contractPath = path.join(__dirname, "out", "PancakeArbFlashLoan.sol", "PancakeArbFlashLoan.json");
  if (!fs.existsSync(contractPath)) {
    console.error("ERROR: Contract not compiled. Run: forge build contracts/PancakeArbFlashLoan.sol --out contracts/out");
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const { abi, bytecode } = artifact;

//  const aavePool = AAVE_POOL_ADDRESSES[NETWORK] || AAVE_POOL_ADDRESSES.bsc;

//  console.log(`Aave Pool: ${aavePool}`);

//  const factory = new ethers.ContractFactory(abi, bytecode, wallet);

//  console.log("Deploying PancakeArbFlashLoanp...");

//  const contract = await factory.deploy(aavePool, wallet.address, {
//    gasLimit: 3_000_000,
//  });

//  console.log(`Transaction hash: ${contract.deploymentTransaction().hash}`);
//  console.log("Waiting for confirmation...");

//  await contract.waitForDeployment();
//  const contractAddress = await contract.getAddress();

//  console.log(`\nContract deployed at: ${contractAddress}\n`);

  // Configure DEXs
//  const DEX_CONFIGS = {
//    arbitrum: [
      // dexId 0: PancakeSwap V3
//      {
//        dexId: 0,
//        router: "0x1A1f72651F34782990d2fDb087a9235630F73569",
//        dexType: 0,
//        feeTier: 3000,
//      },
      // dexId 1: Uniswap V3
//      {
//        dexId: 1,
//        router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
//        dexType: 0,
//        feeTier: 3000,
//      },
      // dexId 2: SushiSwap
//      {
//        dexId: 2,
//        router: "0x1b02dA8Cb0d097eB8D57A175b8897D913111F124",
//        dexType: 1,
//        feeTier: 0,
//      },
      // dexId 3: Camelot V3
//      {
//        dexId: 3,
//        router: "0xc7DD1dD2E5B14f51c08a9A7418E3595566Bb0932",
//        dexType: 7,
//        feeTier: 10000,
//      },
//    ],
//    arbitrumSepolia: [
      // Testnet configs
//      {
//        dexId: 0,
//        router: "0x1A1f72651F34782990d2fDb087a9235630F73569",
//        dexType: 0,
//        feeTier: 3000,
//      },
//    ],
//  };

//  const dexConfigs = DEX_CONFIGS[NETWORK] || DEX_CONFIGS.bsc;

//  console.log("Configuring DEX routers...\n");

//  for (const cfg of dexConfigs) {
//    try {
//      const tx = await contract.setDexConfig(cfg.dexId, {
//        router: cfg.router,
//        dexType: cfg.dexType,
//        feeTier: cfg.feeTier || 0,
//        balancerPoolId: ethers.zeroPadBytes("0x", 32),
//        curveIndexIn: 0,
//        curveIndexOut: 0,
//        veloFactory: ethers.ZeroAddress,
//        veloStable: false,
//        lbBinStep: 0,
//      });
//      await tx.wait();
//      console.log(`DEX ${cfg.dexId} configured: router=${cfg.router}`);
//    } catch (e) {
//      console.error(`Failed to configure DEX ${cfg.dexId}: ${e.message}`);
//    }
//  }

//  console.log("\n========================================");
//  console.log("DEPLOYMENT COMPLETE");
//  console.log("========================================");
//  console.log(`Contract Address: ${contractAddress}`);
//  console.log(`Network: ${NETWORK}`);
//  console.log(`\nUpdate your configuration:\n`);
//  console.log(`CONTRACT_ADDRESSES: {`);
//  console.log(`  ${NETWORK}: "${contractAddress}",`);
//  console.log(`}`);
//}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
