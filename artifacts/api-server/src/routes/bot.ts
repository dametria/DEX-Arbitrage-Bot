import { Router } from "express";
import {
  startBot,
  stopBot,
  getBotStatus,
} from "../services/botEngine.js";
import { withdrawFromContract } from "../services/contractWithdraw.js";

const router = Router();

router.get("/bot/status", (req, res) => {
  const status = getBotStatus();
  res.json(status);
});

router.post("/bot/start", (req, res) => {
  const body = req.body as {
    gasSource?: string;
    networks?: string[];
    minProfitPct?: number;
    slippageTolerance?: number;
    walletAddress?: string;
    privateKey?: string;
  };

  const gasSource = body.gasSource === "contract" ? "contract" : "flashloan";
  const networks = Array.isArray(body.networks) && body.networks.length > 0
    ? body.networks
    : ["avalanche", "arbitrum", "optimism"];
  const minProfitPct =
    typeof body.minProfitPct === "number" ? body.minProfitPct : 0.15;
  const slippageTolerance =
    typeof body.slippageTolerance === "number"
      ? body.slippageTolerance
      : 0.01;
  const walletAddress = body.walletAddress ?? "";
  const privateKey = body.privateKey ?? "";

  startBot({
    gasSource,
    networks,
    minProfitPct,
    slippageTolerance,
    walletAddress,
    privateKey,
  });

  req.log.info({ networks, gasSource, minProfitPct }, "Bot start requested");
  res.json(getBotStatus());
});

router.post("/bot/stop", (req, res) => {
  stopBot();
  req.log.info("Bot stop requested");
  res.json(getBotStatus());
});

router.post("/bot/withdraw", async (req, res) => {
  const body = req.body as {
    network?: string;
    privateKey?: string;
    toAddress?: string;
  };

  const network    = typeof body.network    === "string" ? body.network    : "arbitrum";
  const privateKey = typeof body.privateKey === "string" ? body.privateKey : "";
  const toAddress  = typeof body.toAddress  === "string" ? body.toAddress  : "";

  if (!privateKey || !toAddress) {
    res.status(400).json({ error: "privateKey and toAddress are required" });
    return;
  }

  req.log.info({ network, toAddress }, "Withdraw requested");

  try {
    const result = await withdrawFromContract(network, privateKey, toAddress);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Withdraw failed");
    res.status(500).json({ error: "Withdraw failed" });
  }
});

export default router;
