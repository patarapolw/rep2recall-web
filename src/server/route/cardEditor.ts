import { Request, Response, Router } from "express";
import SearchResource from "../db/SearchResource";
import moment from "moment";
import asyncHandler from "express-async-handler";
import Database from "../db";
import { ObjectID } from "bson";
import needUserId from "../middleware/needUserId";

class CardEditorController {
    public static async find(req: Request, res: Response): Promise<Response> {
        const search = new SearchResource();

        let cond: any = {};
        try {
            cond = search.parse(req.body.q);
        } catch (e) {}

        const offset: number = req.body.offset;
        const limit: number = req.body.limit;

        const q = search.getQuery(res.locals.userId, cond);

        const [data, ids] = await Promise.all([
            q.sort({deck: 1, srsLevel: 1}).skip(offset).limit(limit).toArray(),
            q.project({id: 1}).toArray()
        ]);

        return res.json({
            data,
            total: ids.length
        });
    }

    public static async create(req: Request, res: Response): Promise<Response> {
        const db = new Database();
        const {deck, ...c} = req.body.create;

        const deckId = (await db.deck.findOneAndUpdate(
            {name: deck},
            {$setOnInsert: {
                userId: new ObjectID(res.locals.userId),
                name: deck
            }},
            {
                upsert: true,
                returnOriginal: false
            })).value!._id!;

        return res.json({
            id: (await db.card.insertOne({deckId, ...c})).insertedId.toHexString()
        });
    }

    public static async update(req: Request, res: Response): Promise<Response> {
        if (req.body.create) {
            return await CardEditorController.create(req, res);
        }

        const db = new Database();
        const _id: ObjectID = new ObjectID(req.body.id);

        if (req.body.update) {
            const {deck, ...x} = req.body.update;

            const deckId = (await db.deck.findOneAndUpdate(
                {name: deck},
                {$setOnInsert: {
                    userId: new ObjectID(res.locals.userId),
                    name: deck
                }},
                {
                    upsert: true,
                    returnOriginal: false
                })).value!._id!;

            await db.card.updateOne({_id}, {$set: {
                deckId,
                ...x
            }});
        } else {
            let fieldName: string = req.body.fieldName;
            let fieldData: any = req.body.fieldData;

            switch (fieldName) {
                case "deck":
                    fieldData = (await db.deck.findOneAndUpdate(
                        {name: fieldData},
                        {$setOnInsert: {
                            userId: new ObjectID(res.locals.userId),
                            name: fieldData
                        }},
                        {
                            upsert: true,
                            returnOriginal: false
                        })).value!._id!;
                    fieldName = "deckId";
                    break;
                case "nextReview":
                    if (!moment(fieldData).isValid()) {
                        throw new Error("Invalid date");
                    }
                    fieldData = moment(fieldData).toDate();
                    break;
                case "srsLevel":
                    fieldData = parseInt(fieldData);
                    break;
            }

            await db.card.updateOne({_id}, {$set: {
                [fieldName]: fieldData
            }});
        }

        return res.sendStatus(201);
    }

    public static async delete(req: Request, res: Response): Promise<Response> {
        const db = new Database();
        const _id: ObjectID = new ObjectID(req.body.id);
        await db.card.deleteOne({_id});

        return res.sendStatus(201);
    }
}

export const router = Router();
router.use(needUserId());

router.post("/", asyncHandler(CardEditorController.find));
router.post("/create", asyncHandler(CardEditorController.create));
router.put("/", asyncHandler(CardEditorController.update));
router.delete("/", asyncHandler(CardEditorController.delete));

export default router;
