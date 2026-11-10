import { Router, type IRouter } from "express";
import healthRouter from "./health";
import chatRouter from "./chat";
import imageChatRouter from "./image-chat";
import agentRouter from "./agent";
import liveRouter from "./live";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chatRouter);
router.use(imageChatRouter);
router.use(agentRouter);
router.use(liveRouter);

export default router;
