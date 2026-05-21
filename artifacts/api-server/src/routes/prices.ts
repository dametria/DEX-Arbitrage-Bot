import { Router } from "express";
import { fetchAllPrices } from "../services/priceMonitor.js";

const router = Router();

router.get("/prices", async (req, res) => {
  try {
    const prices = await fetchAllPrices();
    res.json(prices);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch prices");
    res.status(500).json({ error: "Failed to fetch prices" });
  }
});

export default router;
