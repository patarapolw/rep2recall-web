import { Router } from "express";
import needUserId from "../middleware/needUserId";
import asyncHandler from "express-async-handler";
import auth from "../auth/token";
import { g } from "../config";

const router = Router();

router.use(auth.optional);
router.use(needUserId());

router.delete("/reset", asyncHandler(async (req, res) => {
    const db = g.db!;
    await db.reset();
    return res.json({error: null});
}));

export default router;
