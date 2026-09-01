import { Router, type IRouter } from "express";
import healthRouter from "./health";
import articlesRouter from "./articles";
import publishJobsRouter from "./publish-jobs";
import saveArticleRouter from "./save-article";

const router: IRouter = Router();

router.use(healthRouter);
router.use(articlesRouter);
router.use(publishJobsRouter);
router.use(saveArticleRouter);

export default router;
