import { Router } from "express";
import needUserId from "../middleware/needUserId";
import cardEditorRouter from "./editor/card";

export const router = Router();
router.use(needUserId());

router.use("/editor", cardEditorRouter);

export default router;
