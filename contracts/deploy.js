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
 *
 * After deployment, paste the printed contract address into
 * artifacts/api-server/src/services/flashLoanExecutor.ts
 * (replace the placeholder in CONTRACT_ADDRESSES).
 */

const { ethers } = require("ethers");
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
// dexType:
//   0 = UniswapV3  1 = UniswapV2  2 = TraderJoeV21
//   3 = BalancerV2  4 = VelodromeV2  5 = Curve  6 = GMX  7 = CamelotV3

const DEX_CONFIGS = {
  // ── Avalanche ──────────────────────────────────────────────────────────────
  avalanche: [
    {
      id: 0,
      name: "Trader Joe V2.1",
      router:   "0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30",
      dexType:  2,   // TraderJoeV21
      feeTier:  0,
      balancerPoolId: ethers.ZeroHash,
      curveIndexIn:  0,
      curveIndexOut: 0,
      veloFactory:   ethers.ZeroAddress,
      veloStable:    false,
      lbBinStep:     15, // 15-bip bin step for USDT/WBTC pool
    },
    {
      id: 1,
      name: "Pangolin",
      router:   "0xE54Ca86531e17Ef3616d22Ca28b0D458b6C89106",
      dexType:  1,   // UniswapV2
      feeTier:  0,
      balancerPoolId: ethers.ZeroHash,
      curveIndexIn:  0,
      curveIndexOut: 0,
      veloFactory:   ethers.ZeroAddress,
      veloStable:    false,
      lbBinStep:     0,
    },
    {
      id: 2,
      name: "SushiSwap",
      router:   "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
      dexType:  1,   // UniswapV2
      feeTier:  0,
      balancerPoolId: ethers.ZeroHash,
      curveIndexIn:  0,
      curveIndexOut: 0,
      veloFactory:   ethers.ZeroAddress,
      veloStable:    false,
      lbBinStep:     0,
    },
    {
      id: 3,
      name: "GMX",
      // GMX Router on Avalanche
      router:   "0x5F719c2F1095F7B9fc68a68e35B51194f4b6abe8",
      dexType:  6,   // GMX
      feeTier:  0,
      balancerPoolId: ethers.ZeroHash,
      curveIndexIn:  0,
      curveIndexOut: 0,
      veloFactory:   ethers.ZeroAddress,
      veloStable:    false,
      lbBinStep:     0,
    },
  ],

  // ── Arbitrum ───────────────────────────────────────────────────────────────
  arbitrum: [
    {
      id: 0,
      name: "Uniswap V3",
      router:   "0xE592427A0AEce92De3Edee1F18E0157C05861564",
      dexType:  0,   // UniswapV3
      feeTier:  500, // 0.05% pool — deepest WBTC/USDT liquidity
      balancerPoolId: ethers.ZeroHash,
      curveIndexIn:  0,
      curveIndexOut: 0,
      veloFactory:   ethers.ZeroAddress,
      veloStable:    false,
      lbBinStep:     0,
    },
    {
      id: 1,
      name: "SushiSwap",
      router:   "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
      dexType:  1,   // UniswapV2
      feeTier:  0,
      balancerPoolId: ethers.ZeroHash,
      curveIndexIn:  0,
      curveIndexOut: 0,
      veloFactory:   ethers.ZeroAddress,
      veloStable:    false,
      lbBinStep:     0,
    },
    {
      id: 2,
      name: "Camelot V3",
      router:   "0x1F98431c8aD98523631AE4a59f267346ea31F984",
      dexType:  7,   // CamelotV3
      feeTier:  0,
      balancerPoolId: ethers.ZeroHash,
      curveIndexIn:  0,
      curveIndexOut: 0,
      veloFactory:   ethers.ZeroAddress,
      veloStable:    false,
      lbBinStep:     0,
    },
    {
      id: 3,
      name: "GMX",
      router:   "0xaBBc5F99639c9B6bCb58544ddf04EFA6802F4064",
      dexType:  6,   // GMX
      feeTier:  0,
      balancerPoolId: ethers.ZeroHash,
      curveIndexIn:  0,
      curveIndexOut: 0,
      veloFactory:   ethers.ZeroAddress,
      veloStable:    false,
      lbBinStep:     0,
    },
    {
      id: 4,
      name: "Balancer V2",
      // Balancer Vault is the same address across networks
      router:   "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
      dexType:  3,   // BalancerV2
      feeTier:  0,
      // WBTC/USDT Balancer pool on Arbitrum
      balancerPoolId: "0x64541216bafffeec8ea535bb71fbc927831d0595000100000000000000000002",
      curveIndexIn:  0,
      curveIndexOut: 0,
      veloFactory:   ethers.ZeroAddress,
      veloStable:    false,
      lbBinStep:     0,
    },
  ],

  // ── Optimism ───────────────────────────────────────────────────────────────
  optimism: [
    {
      id: 0,
      name: "Uniswap V3",
      router:   "0xE592427A0AEce92De3Edee1F18E0157C05861564",
      dexType:  0,   // UniswapV3
      feeTier:  3000, // 0.3% — primary WBTC/USDT pool on Optimism
      balancerPoolId: ethers.ZeroHash,
      curveIndexIn:  0,
      curveIndexOut: 0,
      veloFactory:   ethers.ZeroAddress,
      veloStable:    false,
      lbBinStep:     0,
    },
    {
      id: 1,
      name: "Velodrome V2",
      router:   "0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858",
      dexType:  4,   // VelodromeV2
      feeTier:  0,
      balancerPoolId: ethers.ZeroHash,
      curveIndexIn:  0,
      curveIndexOut: 0,
      // Velodrome PoolFactory on Optimism
      veloFactory:   "0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a",
      veloStable:    false,
      lbBinStep:     0,
    },
    {
      id: 2,
      name: "Beethoven X",
      // Beethoven X uses the Balancer V2 Vault
      router:   "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
      dexType:  3,   // BalancerV2
      feeTier:  0,
      // Beethoven X WBTC/USDT pool on Optimism
      balancerPoolId: "0x39965c9dab5448482cf7e002f583c812ceb53046000100000000000000000003",
      curveIndexIn:  0,
      curveIndexOut: 0,
      veloFactory:   ethers.ZeroAddress,
      veloStable:    false,
      lbBinStep:     0,
    },
    {
      id: 3,
      name: "Curve",
      // Curve USDT/WBTC pool on Optimism
      router:   "0x061b87122Ed14b9526A813209C8a59a633257bAb",
      dexType:  5,   // Curve
      feeTier:  0,
      balancerPoolId: ethers.ZeroHash,
      // In the Curve USDT/WBTC pool: index 0 = USDT, index 1 = WBTC
      curveIndexIn:  0,
      curveIndexOut: 1,
      veloFactory:   ethers.ZeroAddress,
      veloStable:    false,
      lbBinStep:     0,
    },
  ],
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

  const provider = new ethers.JsonRpcProvider(net.rpc);
  const wallet   = new ethers.Wallet(privateKey, provider);
  const balance  = await provider.getBalance(wallet.address);

  console.log(`\nNetwork  : ${networkName} (chainId ${net.chainId})`);
  console.log(`Deployer : ${wallet.address}`);
  console.log(`Balance  : ${ethers.formatEther(balance)} native`);

  const bytecode = loadBytecode();
  const factory  = new ethers.ContractFactory(ABI, bytecode, wallet);

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
       CONTRACT_ADDRESSES["${networkName}"] = "${address}";

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
