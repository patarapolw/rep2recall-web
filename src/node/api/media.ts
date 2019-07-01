import { Router } from "express";
import Database from "../engine/db";
import asyncHandler from "express-async-handler";
import needUserId from "../middleware/needUserId";
import auth from "../auth/token";

const router = Router();
router.use(auth.optional);
router.use(needUserId());

router.get("/:id", asyncHandler(async (req, res) => {
    const db = new Database();
    const m = await db.media.findOne({_id: new req.params.id})

    return res.send(m ? m.data.buffer : "");
}));

export default router;