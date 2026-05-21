import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import pricesRouter from "./prices.js";
import opportunitiesRouter from "./opportunities.js";
import botRouter from "./bot.js";
import tradesRouter from "./trades.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(pricesRouter);
router.use(opportunitiesRouter);
router.use(botRouter);
router.use(tradesRouter);

export default router;
