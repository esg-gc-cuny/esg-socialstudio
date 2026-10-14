import { Router, type IRouter } from "express";
import healthRouter from "./health";
import researchSocialRouter from "./research-social";

const router: IRouter = Router();

router.use(healthRouter);
router.use(researchSocialRouter);

export default router;
