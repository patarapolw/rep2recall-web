import { Router } from "express";
import needUserId from "../middleware/needUserId";
import asyncHandler from "express-async-handler";
import auth from "../auth/token";
import { SearchParser } from "../engine/search";
import { g } from "../config";

const router = Router();

router.use(auth.optional);
router.use(needUserId());

router.post("/", asyncHandler(async (req, res) => {
    const {q, offset, limit, sortBy, desc, fields} = req.body;
    const parser = new SearchParser();
    const db = g.db!;
    return res.json(await db.parseCond(parser.doParse(q) || {}, {
        offset, limit: limit || 10, sortBy, desc,
        fields: fields || ["deck", "front" , "back", "mnemonic", "tag", "srsLevel", "nextReview", "created", "modified",
        "data", "tFront", "tBack", "css", "js", "source", "template", "_meta", "_id"]
    }));
}));

router.post("/getOne", asyncHandler(async (req, res) => {
    const {_id} = req.body;
    const db = g.db!;
    return res.json((await db.parseCond({cond: {_id}}, {
        limit: 1,
        fields: ["deck", "front" , "back", "mnemonic", "tag", "srsLevel", "nextReview", "created", "modified",
        "data", "tFront", "tBack", "css", "js", "source", "template", "_meta", "_id"]
    })).data[0]);
}));

router.put("/", asyncHandler(async (req, res) => {
    const {id, ids, create, update} = req.body;
    const db = g.db!;
    if (Array.isArray(create)) {
        const ids = await db.insertMany(create);
        return res.json({ids});
    } else if (create) {
        const ids = await db.insertMany([create]);
        return res.json({id: ids[0]});
    } else if (ids) {
        return res.json(await db.updateMany(ids, update));
    } else {
        return res.json(await db.updateMany([id], update));
    }
}));

router.delete("/", asyncHandler(async (req, res) => {
    const {id, ids} = req.body;
    const db = g.db!;
    if (ids) {
        return res.json(await db.deleteMany(ids));
    } else {
        return res.json(await db.deleteMany([id]));
    }
}))

router.put("/editTags", asyncHandler(async (req, res) => {
    const {ids, tags} = req.body;
    const db = g.db!;
    return res.json(await db.addTags(ids, tags));
}));

router.delete("/editTags", asyncHandler(async (req, res) => {
    const {ids, tags} = req.body;
    const db = g.db!;
    return res.json(await db.removeTags(ids, tags));
}))

export default router;
