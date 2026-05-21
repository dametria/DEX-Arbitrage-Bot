/**
 * deploy.js — ArbitrageBot.sol deployment + DEX registration
 *
 * Usage
 * ─────
 *   PRIVATE_KEY=0x... \
 *   NETWORK=arbitrum  \
 *   node contracts/deploy.js
 *
 * Supported NETWORK values: avalanche | arbitrum | optimism
 *
 * Requires:
 *   npm install ethers@6
 */

const { ethers, JsonRpcProvider, Wallet, ContractFactory } = require("ethers");
const fs = require("fs");
const path = require("path");

// ─── Network config ──────────────────────────────────────────────────────────

const NETWORKS = {
  avalanche: {
    rpc:      "https://api.avax.network/ext/bc/C/rpc",
    chainId:  43114,
    aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    usdt:     "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7",
    wbtc:     "0x50b7545627a5162F82A992c33b87aDc75187B218",
  },
  arbitrum: {
    rpc:      "https://arb1.arbitrum.io/rpc",
    chainId:  42161,
    aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    usdt:     "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    wbtc:     "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
  },
  optimism: {
    rpc:      "https://mainnet.optimism.io",
    chainId:  10,
    aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    usdt:     "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    wbtc:     "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
  },
};

// ─── DEX registry ────────────────────────────────────────────────────────────
// (unchanged - keeping your original DEX_CONFIGS)
const DEX_CONFIGS = {
  // ... [Your full DEX_CONFIGS object remains exactly the same]
  avalanche: [ /* ... your avalanche dexes ... */ ],
  arbitrum: [ /* ... your arbitrum dexes ... */ ],
  optimism: [ /* ... your optimism dexes ... */ ],
};

// ─── ABI (minimal — only what deploy needs) ───────────────────────────────────

const ABI = [
  "constructor(address _aavePool, address _owner)",
  `function setDexConfig(uint8 dexId, tuple(
      address router,
      uint8   dexType,
      uint24  feeTier,
      bytes32 balancerPoolId,
      int128  curveIndexIn,
      int128  curveIndexOut,
      address veloFactory,
      bool    veloStable,
      uint256 lbBinStep
   ) cfg) external`,
];

// ─── Bytecode loader ──────────────────────────────────────────────────────────

function loadBytecode() {
  const artifactPath = path.join(__dirname, "out", "ArbitrageBot.sol", "ArbitrageBot.json");
  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `Compiled artifact not found at ${artifactPath}.\n` +
      `Run: forge build   (or: solc --bin ArbitrageBot.sol)`
    );
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  return artifact.bytecode.object ?? artifact.bytecode;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const networkName = process.env.NETWORK;
  if (!networkName || !NETWORKS[networkName]) {
    console.error(`Error: set NETWORK env var to one of: ${Object.keys(NETWORKS).join(" | ")}`);
    process.exit(1);
  }

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("Error: set PRIVATE_KEY env var (0x-prefixed)");
    process.exit(1);
  }

  const net    = NETWORKS[networkName];
  const dexes  = DEX_CONFIGS[networkName];

  const provider = new JsonRpcProvider(net.rpc);
  const wallet   = new Wallet(privateKey, provider);
  const balance  = await provider.getBalance(wallet.address);

  console.log(`\nNetwork  : ${networkName} (chainId ${net.chainId})`);
  console.log(`Deployer : ${wallet.address}`);
  console.log(`Balance  : ${ethers.formatEther(balance)} native`);

  const bytecode = loadBytecode();
  const factory  = new ContractFactory(ABI, bytecode, wallet);

  console.log("\nDeploying ArbitrageBot...");
  const contract = await factory.deploy(net.aavePool, wallet.address);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`✓ ArbitrageBot deployed: ${address}`);

  console.log(`\nRegistering ${dexes.length} DEX configs...`);
  for (const dex of dexes) {
    process.stdout.write(`  [${dex.id}] ${dex.name}...`);
    const tx = await contract.setDexConfig(dex.id, {
      router:         dex.router,
      dexType:        dex.dexType,
      feeTier:        dex.feeTier,
      balancerPoolId: dex.balancerPoolId,
      curveIndexIn:   dex.curveIndexIn,
      curveIndexOut:  dex.curveIndexOut,
      veloFactory:    dex.veloFactory,
      veloStable:     dex.veloStable,
      lbBinStep:      dex.lbBinStep,
    });
    await tx.wait();
    console.log(" ✓");
  }

  console.log(`
─────────────────────────────────────────────────────
  Deployment complete on ${networkName}

  Contract : ${address}
  Aave Pool: ${net.aavePool}
  USDT     : ${net.usdt}
  WBTC     : ${net.wbtc}

  Next steps
  ──────────
  1. Add the contract address to flashLoanExecutor.ts:
       CONTRACT_ADDRESSES["\( {networkName}"] = " \){address}";

  2. Fund the contract with a small amount of native gas
     (only needed when gasSource = "contract"):
       cast send ${address} --value 0.01ether --private-key $PRIVATE_KEY

  3. Approve USDT allowance from the contract to Aave if needed
     (Aave pulls the repayment, so the contract must hold USDT).
─────────────────────────────────────────────────────
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});