// deploy-and-test.js
const ethers = require("ethers");
const fs = require("fs");
const path = require("path");

async function main() {
    // ===================== CONFIG =====================
    const RPC_URL = "https://bsc-dataseed.binance.org/";
    const PRIVATE_KEY = process.env.PRIVATE_KEY;

    if (!PRIVATE_KEY) {
        console.error("Set PRIVATE_KEY environment variable!");
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log(`Deploying from: ${wallet.address}`);
    // ================================================

    const contractPath = path.join(__dirname, "out", "PancakeArbFlashLoan.sol", "PancakeArbFlashLoan.json");

    if (!fs.existsSync(contractPath)) {
        console.error("Artifact not found. Run: forge build --force");
        process.exit(1);
    }

    const artifact = JSON.parse(fs.readFileSync(contractPath, "utf8"));
    const { abi, bytecode } = artifact;

    const factory = new ethers.ContractFactory(abi, bytecode.object || bytecode, wallet);

    console.log("\n Deploying PancakeArbFlashLoan...");

    const deployment = await factory.deploy({
        gasLimit: 4_000_000,
        gasPrice: ethers.parseUnits("1.2", "gwei")
    });

    console.log(`Tx Hash: ${deployment.deploymentTransaction().hash}`);
    await deployment.waitForDeployment();

    const contractAddress = await deployment.getAddress();
    console.log(`Contract deployed at: ${contractAddress}`);
    console.log(`https://bscscan.com/address/${contractAddress}`);

    const contract = new ethers.Contract(contractAddress, abi, wallet);

     // =============== SAFER TEST CALL ===============
    console.log("\n Testing executeArbitrage with safer slippage...");

    const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
    const USDT = "0x55d398326f99059fF775485246999027B3197955";

    try {
        const loanAmount = ethers.parseUnits("1000", 18);   // 1000 USDT

        const tx = await contract.executeArbitrage(
            WBNB,                                      // tokenIn
            USDT,                                      // tokenOut
            loanAmount,
            true,                                      // v2First
            500,                                       // v3Fee
            ethers.parseUnits("0.3", 18),             // minProfit = 0.3 USDT
            ethers.parseUnits("970", 18),             // minOut1 → ~3% slippage
            ethers.parseUnits("970", 18)              // minOut2 → ~3% slippage
        );

        console.log(`Transaction sent: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log("Arbitrage executed successfully!");

    } catch (error) {
        console.error("Failed:");
        console.error(error.shortMessage || error.message);
    }

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
