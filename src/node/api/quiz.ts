import { Router } from "express";
import asyncHandler from "express-async-handler";
import needUserId from "../middleware/needUserId";
import auth from "../auth/token";
import Database from "../engine/db";

const router = Router();
router.use(auth.optional);
router.use(needUserId());

router.post("/", asyncHandler(async (req, res) => {
    const {cond} = req.body;
    const db = new Database();
    const cards = await db.parseCond(res.locals.userId, cond, {
        fields: ["_id", "entry", "type"]
    });

    return res.json(cards);
}));

router.post("/render", asyncHandler(async (req, res) => {
    const {id, entry, type} = req.body;
    const db = new Database();
    if (id) {
        return res.json(await db.renderFromId(res.locals.userId, id));
    } else {
        return res.json(await db.render(entry, type));
    }
}));

router.put("/right", asyncHandler(async (req, res) => {
    const {id, data} = req.body;
    const db = new Database();
    return res.json({
        id: await db.markRight(res.locals.userId, id, data)
    });
}));

router.put("/wrong", asyncHandler(async (req, res) => {
    const {id, data} = req.body;
    const db = new Database();
    return res.json({
        id: await db.markWrong(res.locals.userId, id, data)
    });
}));

export default router;
