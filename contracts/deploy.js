// deploy.js
const ethers = require("ethers");
const fs = require("fs");
const path = require("path");

async function main() {
    // ====================== CONFIG ======================
    const NETWORK = "bsc";                    // Change if needed
    const PRIVATE_KEY = process.env.PRIVATE_KEY; // Load from .env

    if (!PRIVATE_KEY) {
        console.error(" PRIVATE_KEY not set in environment variables");
        process.exit(1);
    }

    // RPC for BSC Mainnet (you can use your own or Ankr/Alchemy)
    const RPC_URL = "https://bsc-dataseed.binance.org/";

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log(`Deploying from: ${wallet.address}`);
    // ===================================================

    const contractPath = path.join(__dirname, "out", "PancakeArbFlashLoan.sol", "PancakeArbFlashLoan.json");

    if (!fs.existsSync(contractPath)) {
        console.error(" Contract not compiled. Run:");
        console.error("   forge build contracts/PancakeArbFlashLoan.sol --out contracts/out");
        process.exit(1);
    }

    const artifact = JSON.parse(fs.readFileSync(contractPath, "utf8"));
    const { abi, bytecode } = artifact;

    // Debug constructor to avoid future confusion
    const constructor = abi.find(x => x.type === "constructor");
    console.log("Constructor arguments expected:", constructor ? constructor.inputs.length : 0);

    const factory = new ethers.ContractFactory(abi, bytecode, wallet);

    console.log("\n Deploying PancakeArbFlashLoan...");

    try {
        const contract = await factory.deploy({
            gasLimit: 3_500_000,     // Increased a bit for safety
        });

        console.log(`Transaction hash: ${contract.deploymentTransaction().hash}`);

        console.log("Waiting for confirmation...");
        await contract.waitForDeployment();

        const contractAddress = await contract.getAddress();

        console.log(`\n SUCCESS! Contract deployed at:`);
        console.log(`   ${0x5954b7c5e9b9FE331E902Da62C9F998f90AcC16F}`);
        console.log(`\nExplorer: https://bscscan.com/address/${0x5954b7c5e9b9FE331E902Da62C9F998f90AcC16F}`);

        // Optional: Verify on BscScan (you can run this manually later)
        // forge verify-contract <address> PancakeArbFlashLoan --chain bsc

    } catch (error) {
        console.error("\n Deployment failed:");
        console.error(error.message);
        
        if (error.message.includes("constructor")) {
            console.error("\n Hint: Make sure you recompiled after last change:");
            console.error("   forge build --force");
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
