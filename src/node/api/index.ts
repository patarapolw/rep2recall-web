import { Router } from "express";
import needUserId from "../middleware/needUserId";
import asyncHandler from "express-async-handler";
import Database from "../engine/db";
import auth from "../auth/token";
import { SearchParser } from "../engine/search";

const router = Router();

router.use(auth.optional);
router.use(needUserId());

router.delete("/reset", asyncHandler(async (req, res) => {
    const parser = new SearchParser();
    const db = new Database();
    await db.reset(res.locals.userId);
    return res.json({error: null});
}));

export default router;
