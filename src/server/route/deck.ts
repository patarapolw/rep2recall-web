import { Request, Response, Router } from "express";
import XRegExp from "xregexp";
import SearchResource from "../db/SearchResource";
import moment from "moment";
import asyncHandler from "express-async-handler";
import needUserId from "../middleware/needUserId";

class DeckController {
    public static async filter(req: Request, res: Response): Promise<Response> {
        const search = new SearchResource();

        let cond: any = {};
        try {
            cond = search.parse(req.body.q);
        } catch (e) {}

        if (req.body.deck) {
            cond.deck = {$regex: `${XRegExp.escape(req.body.deck)}(/.+)?`};
        }
        if (req.body.due) {
            const due: any[] = req.body.due;
            cond.nextReview = {$lt: moment().add(due[0], due[1]).toDate()};
        }

        const decks = (await search.getQuery(res.locals.userId, cond).project({deck: 1}).toArray())
        .map((d: any) => d.deck);

        return res.json(decks.filter((d, i) => decks.indexOf(d) === i));
    }

    public static async stat(req: Request, res: Response): Promise<Response> {
        const search = new SearchResource();

        let cond: any = {};
        try {
            cond = search.parse(req.body.q);
        } catch (e) {}

        if (req.body.deck) {
            cond.deck = {$regex: `${XRegExp.escape(req.body.deck)}(/.+)?`};
        }
        if (req.body.due) {
            const due: any[] = req.body.due;
            cond.nextReview = {$lt: moment().add(due[0], due[1]).toDate()};
        }

        const cards = await search.getQuery(res.locals.userId, cond).project({nextReview: 1, srsLevel: 1}).toArray();

        const now = new Date();

        return res.json({
            new: cards.filter((c) => !c.nextReview).length,
            due: cards.filter((c) => c.nextReview < now).length,
            leech: cards.filter((c) => c.srsLevel === 0).length
        });
    }
}

const router = Router();
router.use(needUserId());

router.post("/filter", asyncHandler(DeckController.filter));
router.post("/stat", asyncHandler(DeckController.stat));

export default router;
