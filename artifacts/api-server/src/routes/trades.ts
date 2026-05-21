import { Router } from "express";
import { getTradeHistory } from "../services/botEngine.js";

const router = Router();

router.get("/trades", (req, res) => {
  const trades = getTradeHistory();
  res.json(trades);
});

export default router;
