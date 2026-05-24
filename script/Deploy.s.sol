// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../contracts/PancakeArbFlashLoan.sol";

/**
 * @title DeployPancakeArb
 * @notice Foundry deployment script for PancakeArbFlashLoan contract
 * 
 * Usage:
 * ------
 * 
 * Testnet Deployment:
 *   forge script script/Deploy.s.sol --rpc-url $BSC_TESTNET_RPC --private-key $PRIVATE_KEY --broadcast --verify
 * 
 * Mainnet Deployment (DRY RUN):
 *   forge script script/Deploy.s.sol --rpc-url $BSC_MAINNET_RPC --private-key $PRIVATE_KEY
 * 
 * Mainnet Deployment (BROADCAST):
 *   forge script script/Deploy.s.sol --rpc-url $BSC_MAINNET_RPC --private-key $PRIVATE_KEY --broadcast --verify
 * 
 * With BscScan Verification:
 *   forge script script/Deploy.s.sol \
 *     --rpc-url $BSC_MAINNET_RPC \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast \
 *     --verify \
 *     --verifier blockscout \
 *     --verifier-url https://api.bscscan.com/api
 */

contract DeployPancakeArb is Script {
    // ─────────────────────────────────────────────────────────────────────────
    // DEPLOYMENT FUNCTION
    // ─────────────────────────────────────────────────────────────────────────

    function run() external {
        // Get deployer address from private key
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("═══════════════════════════════════════════════════════════");
        console.log("Deploying PancakeArbFlashLoan Contract");
        console.log("═══════════════════════════════════════════════════════════");
        console.log("Deployer Address:", deployer);
        console.log("Chain ID:", block.chainid);
        console.log("");

        // Verify chain ID
        _verifyChain(block.chainid);

        // Start broadcast (requires --broadcast flag)
        vm.startBroadcast(deployerPrivateKey);

        // Deploy contract
        PancakeArbFlashLoan arbitrageContract = new PancakeArbFlashLoan();
        address deployedAddress = address(arbitrageContract);

        vm.stopBroadcast();

        // Print results
        console.log("");
        console.log("═══════════════════════════════════════════════════════════");
        console.log("✅ DEPLOYMENT SUCCESSFUL");
        console.log("═══════════════════════════════════════════════════════════");
        console.log("Contract Address:", deployedAddress);
        console.log("Owner Address:", deployer);
        console.log("");

        // Print verification command
        _printVerificationCommand(deployedAddress);

        // Print next steps
        _printNextSteps(deployedAddress);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPER FUNCTIONS
    // ─────────────────────────────────────────────────────────────────────────

    function _verifyChain(uint256 chainId) internal view {
        string memory networkName;
        bool isValidChain = false;

        if (chainId == 56) {
            networkName = "BSC Mainnet";
            isValidChain = true;
        } else if (chainId == 97) {
            networkName = "BSC Testnet";
            isValidChain = true;
        } else if (chainId == 1) {
            networkName = "Ethereum Mainnet";
            isValidChain = false;
        } else if (chainId == 137) {
            networkName = "Polygon Mainnet";
            isValidChain = false;
        } else {
            networkName = "Unknown Network";
            isValidChain = false;
        }

        console.log("Network:", networkName);

        if (!isValidChain) {
            revert(string(abi.encodePacked("Invalid chain! Only BSC supported. Got chainId: ", vm.toString(chainId))));
        }
    }

    function _printVerificationCommand(address contractAddress) internal view {
        uint256 chainId = block.chainid;
        string memory verifierUrl;

        if (chainId == 56) {
            verifierUrl = "https://api.bscscan.com/api";
        } else if (chainId == 97) {
            verifierUrl = "https://api-testnet.bscscan.com/api";
        }

        console.log("");
        console.log("Verify on BscScan:");
        console.log("─────────────────────────────────────────────────────────");
        console.log("forge verify-contract \\");
        console.log(vm.toString(contractAddress), " \\");
        console.log("PancakeArbFlashLoan \\");
        console.log("--rpc-url $BSC_RPC \\");
        console.log("--verifier blockscout \\");
        console.log(string(abi.encodePacked("--verifier-url ", verifierUrl)));
        console.log("");
    }

    function _printNextSteps(address contractAddress) internal pure {
        console.log("═══════════════════════════════════════════════════════════");
        console.log("Next Steps:");
        console.log("═══════════════════════════════════════════════════════════");
        console.log("1. Fund the contract with USDT and BNB for gas:");
        console.log("   - USDT: For flash-loan repayment + profit");
        console.log("   - BNB: For gas fees");
        console.log("");
        console.log("2. Verify contract on BscScan (see command above)");
        console.log("");
        console.log("3. Test with small loan amount first:");
        console.log("   - Start with 100 USDT");
        console.log("   - Monitor events and profits");
        console.log("   - Scale up gradually");
        console.log("");
        console.log("4. Monitor arbitrage events:");
        console.log("   - ArbitrageExecuted");
        console.log("   - GasRefundSucceeded");
        console.log("   - MinProfitNotMet (indicates no opportunity)");
        console.log("");
        console.log("5. Tune parameters:");
        console.log("   - gasRefundUsdt: Amount to refund for gas");
        console.log("   - minProfit: Minimum required profit");
        console.log("   - loanAmount: Size of flash-loan");
        console.log("");
        console.log("Contract Address: ", contractAddress);
        console.log("═══════════════════════════════════════════════════════════");
    }
}
