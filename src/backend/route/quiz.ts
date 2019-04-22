import { Request, Response, Router } from "express";
import XRegExp from "xregexp";
import asyncHandler from "express-async-handler";
import needUserId from "../middleware/needUserId";
import Database from "../db";
import { ObjectID } from "bson";
import QuizResource from "../db/QuizResource";
import SearchResource from "../db/SearchResource";
import mustache from "mustache";

class QuizController {
    public static async build(req: Request, res: Response): Promise<Response> {
        const search = new SearchResource();
        let cond = search.parse(req.body.q);

        if (req.body.deck) {
            cond.deck = {$regex: `${XRegExp.escape(req.body.deck)}(/.+)?`};
        }

        cond = {$and: [
            cond,
            {$or: [
                {nextReview: {$exists: false}},
                {nextReview: {$in: [null, ""]}},
                {nextReview: {$lt: new Date()}}
            ]}
        ]};

        const cards = await search.getQuery(res.locals.userId, cond, [
            {$project: {id: 1}}
        ]).toArray();

        return res.json(cards.map((c: any) => c.id));
    }

    public static async render(req: Request, res: Response): Promise<Response> {
        const db = new Database();
        const _id = new ObjectID(req.body.id);

        const card = (await db.card.find({_id}).project({
            front: 1, back: 1,
            template: 1, note: 1
        }).limit(1).toArray())[0];

        if (/@md5\n/.test(card.front)) {
            const t = card.template;
            const n = card.note;

            card.front = mustache.render(t!.front, n!.data);
            card.back = mustache.render(t!.back || "", n!.data);
        }

        return res.json(card);
    }

    public static right(req: Request, res: Response): Response {
        const db = new Database();
        const _id = new ObjectID(req.body.id);

        db.card.find({_id}).limit(1).forEach((c) => {
            c.srsLevel = (c.srsLevel || 0) + 1;
            if (c.srsLevel >= QuizResource.srsMap.length) {
                c.srsLevel = QuizResource.srsMap.length - 1;
            }
            c.nextReview = QuizResource.getNextReview(c.srsLevel);
            db.card.updateOne({_id}, {$set: {
                srsLevel: c.srsLevel,
                nextReview: c.nextReview,
                modified: new Date()
            }});
        });

        return res.sendStatus(201);
    }

    public static wrong(req: Request, res: Response): Response {
        const db = new Database();
        const _id = new ObjectID(req.body.id);

        db.card.find({_id}).limit(1).forEach((c) => {
            c.srsLevel = (c.srsLevel || 0) - 1;
            if (c.srsLevel < 0) {
                c.srsLevel = 0;
            }
            c.nextReview = QuizResource.repeat();
            db.card.updateOne({_id}, {$set: {
                srsLevel: c.srsLevel,
                nextReview: c.nextReview,
                modified: new Date()
            }});
        });

        return res.sendStatus(201);
    }
}

const router = Router();
router.use(needUserId());

router.post("/", asyncHandler(QuizController.build));
router.post("/render", asyncHandler(QuizController.render));
router.put("/right", QuizController.right);
router.put("/wrong", QuizController.wrong);

export default router;
