// contracts/deploy.js
const ethers = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function main() {
    console.log("Starting ArbitrageBot Contract Deployment...");

    const NETWORK = process.env.NETWORK || "arbitrum";

    const RPC_URLS = {
        arbitrum: "https://arb1.arbitrum.io/rpc",
        arbitrumSepolia: "https://sepolia-rollup.arbitrum.io/rpc"
    };

    const provider = new ethers.JsonRpcProvider(RPC_URLS[NETWORK] || RPC_URLS.arbitrum);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

    console.log(`Deploying on ${NETWORK} with account: ${wallet.address}`);

    // Aave V3 Pool on Arbitrum
    const AAVE_POOL = NETWORK === "arbitrum" 
        ? "0x794a61358D6845594F94dc1DB02A252b5b4814aD" 
        : "0x012bAC54348C0E8189D913f9BAa6c2e4f8dE53D9";

    // Load compiled contract from Foundry
    const contractPath = path.join(__dirname, "..", "out", "ArbitrageBot.sol", "ArbitrageBot.json");

    if (!fs.existsSync(contractPath)) {
        console.error("Contract artifact not found!");
        console.error("Please run: forge build --force");
        process.exit(1);
    }

    const artifact = JSON.parse(fs.readFileSync(contractPath, "utf8"));

    const factory = new ethers.ContractFactory(
        artifact.abi,
        artifact.bytecode.object || artifact.bytecode,
        wallet
    );

    console.log("Deploying ArbitrageBot...");

    const contract = await factory.deploy(
        AAVE_POOL,           // _aavePool
        wallet.address,      // _owner
        { 
            gasLimit: 6_000_000 
        }
    );

    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();

    console.log(`Contract deployed at: ${contractAddress}`);
    console.log(`View on Arbiscan: https://arbiscan.io/address/${contractAddress}`);

    // === Post-deployment setup (if your contract has setDexConfig) ===
    console.log("\nSetting up DEX configurations...");

    // Example: Add your DEX configs here after deployment
    // You may need to adjust these calls based on your contract's exact function signatures

    console.log("\nDeployment completed successfully!");
    console.log(`\nUpdate your .env with:`);
    console.log(`FLASH_LOAN_CONTRACT=${contractAddress}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Deployment failed:", error.shortMessage || error.message);
        process.exit(1);
    });
