import { Router } from "express";
import { getCurrentOpportunities } from "../services/botEngine.js";
import { detectOpportunities } from "../services/arbitrageDetector.js";
import { fetchAllPrices } from "../services/priceMonitor.js";

const router = Router();

router.get("/opportunities", async (req, res) => {
  try {
    const fromBot = getCurrentOpportunities();
    if (fromBot.length > 0) {
      res.json(fromBot);
      return;
    }
    // If bot isn't running, do a fresh scan for preview purposes
    const prices = await fetchAllPrices();
    const opps = detectOpportunities(prices, 0.15, ["avalanche", "arbitrum", "optimism"]);
    res.json(opps);
  } catch (err) {
    req.log.error({ err }, "Failed to get opportunities");
    res.status(500).json({ error: "Failed to get opportunities" });
  }
});

export default router;
