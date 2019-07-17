import { Router } from "express";
import asyncHandler from "express-async-handler";
import needUserId from "../middleware/needUserId";
import auth from "../auth/token";
import { g } from "../config";

const router = Router();
router.use(auth.optional);
router.use(needUserId());

router.get("/:id", asyncHandler(async (req, res) => {
    const db = g.db!;
    const m = await db.media.findOne({_id: new req.params.id})

    return res.send(m ? m.data.buffer : "");
}));

export default router;