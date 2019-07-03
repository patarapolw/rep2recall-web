import { Router } from "express";
import needUserId from "../middleware/needUserId";
import asyncHandler from "express-async-handler";
import Database from "../engine/db";
import auth from "../auth/token";
import { SearchParser } from "../engine/search";

const router = Router();

router.use(auth.optional);
router.use(needUserId());

router.post("/", asyncHandler(async (req, res) => {
    const {q, offset, limit, sortBy, desc} = req.body;
    const parser = new SearchParser();
    const db = new Database();
    return res.json(await db.parseCond(res.locals.userId, parser.doParse(q) || {}, {
        offset, limit, sortBy, desc,
        fields: ["deck", "front" , "back", "mnemonic", "tag", "srsLevel", "nextReview", "created", "modified",
        "data", "tFront", "tBack", "css", "js", "source", "template"]
    }));
}));

router.post("/getOne", asyncHandler(async (req, res) => {
    const {id} = req.body;
    const db = new Database();
    return res.json((await db.parseCond(res.locals.userId, {cond: {id}}, {
        limit: 1,
        fields: ["deck", "front" , "back", "mnemonic", "tag", "srsLevel", "nextReview", "created", "modified",
        "data", "tFront", "tBack", "css", "js", "source", "template"]
    })).data[0]);
}));

router.put("/", asyncHandler(async (req, res) => {
    const {id, ids, create, update} = req.body;
    const db = new Database();
    if (Array.isArray(create)) {
        const ids = await db.insertMany(res.locals.userId, create);
        return res.json({ids});
    } else if (create) {
        const ids = await db.insertMany(res.locals.userId, [create]);
        return res.json({id: ids[0]});
    } else if (ids) {
        return res.json(await db.updateMany(res.locals.userId, ids, update));
    } else {
        return res.json(await db.updateMany(res.locals.userId, [id], update));
    }
}));

router.delete("/", asyncHandler(async (req, res) => {
    const {id, ids} = req.body;
    const db = new Database();
    if (ids) {
        return res.json(await db.deleteMany(ids));
    } else {
        return res.json(await db.deleteMany([id]));
    }
}))

router.put("/editTags", asyncHandler(async (req, res) => {
    const {ids, tags} = req.body;
    const db = new Database();
    return res.json(await db.addTags(ids, tags));
}));

router.delete("/editTags", asyncHandler(async (req, res) => {
    const {ids, tags} = req.body;
    const db = new Database();
    return res.json(await db.removeTags(ids, tags));
}))

export default router;
