import { ethers } from "ethers";
import { logger } from "../lib/logger.js";

const CONTRACT_ADDRESSES: Record<string, string> = {
  avalanche: "",
  arbitrum:  "0x818D057F20A6aC398046444e156981B2d9FD500C",
  optimism:  "",
};

const USDT_ADDRESSES: Record<string, string> = {
  avalanche: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7",
  arbitrum:  "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  optimism:  "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
};

const RPC_URLS: Record<string, string> = {
  avalanche: "https://api.avax.network/ext/bc/C/rpc",
  arbitrum:  "https://arb1.arbitrum.io/rpc",
  optimism:  "https://mainnet.optimism.io",
};

const WITHDRAW_ABI = [
  "function withdraw(address token, address to) external",
];

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

export interface WithdrawResult {
  txHash:          string | undefined;
  network:         string;
  contractAddress: string;
  toAddress:       string;
  status:          "success" | "failed";
  errorMessage:    string | undefined;
}

export async function withdrawFromContract(
  network: string,
  privateKey: string,
  toAddress: string,
): Promise<WithdrawResult> {
  const contractAddress = CONTRACT_ADDRESSES[network];
  const usdtAddress     = USDT_ADDRESSES[network];
  const rpcUrl          = RPC_URLS[network];

  if (!contractAddress) {
    return {
      txHash: undefined, network,
      contractAddress: contractAddress ?? "",
      toAddress, status: "failed",
      errorMessage: `No contract deployed on ${network}`,
    };
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet   = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(contractAddress, WITHDRAW_ABI, wallet);

    // Check balance before withdrawing
    const usdt    = new ethers.Contract(usdtAddress, ERC20_ABI, provider);
    const balance = await usdt.balanceOf(contractAddress) as bigint;

    if (balance === 0n) {
      return {
        txHash: undefined, network, contractAddress, toAddress,
        status: "failed",
        errorMessage: "Contract USDT balance is zero — nothing to withdraw",
      };
    }

    logger.info(
      { network, contractAddress, toAddress, balanceRaw: balance.toString() },
      "Sending withdraw transaction",
    );

    const tx      = await contract.withdraw(usdtAddress, toAddress);
    const receipt = await tx.wait();
    const success = receipt?.status === 1;

    logger.info(
      { txHash: receipt?.hash, status: receipt?.status },
      success ? "Withdraw succeeded" : "Withdraw reverted",
    );

    return {
      txHash:          receipt?.hash,
      network, contractAddress, toAddress,
      status:          success ? "success" : "failed",
      errorMessage:    success ? undefined : "Withdrawal transaction reverted",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, network }, "Withdraw threw");
    return {
      txHash: undefined, network, contractAddress, toAddress,
      status: "failed",
      errorMessage: message.slice(0, 200),
    };
  }
}
