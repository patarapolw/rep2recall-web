import { Router } from "express";
import asyncHandler from "express-async-handler";
import needUserId from "../middleware/needUserId";
import auth from "../auth/token";
import Database from "../engine/db";
import { SearchParser } from "../engine/search";
import moment from "moment";
import { escapeRegExp } from "../util";

interface ITreeViewStat {
    new: number;
    leech: number;
    due: number;
}

export interface ITreeViewItem {
    name: string;
    fullName: string;
    isOpen: boolean;
    children?: ITreeViewItem[];
    stat: ITreeViewStat;
}

const router = Router();
router.use(auth.optional);
router.use(needUserId());

router.post("/treeview", asyncHandler(async (req, res) => {
    function recurseParseData(treeData: ITreeViewItem[], deck: string[], _depth = 0) {
        let doLoop = true;

        while (_depth < deck.length - 1) {
            for (const c of treeData) {
                if (c.name === deck[_depth]) {
                    c.children = c.children || [];
                    recurseParseData(c.children, deck, _depth + 1);
                    doLoop = false;
                    break;
                }
            }

            _depth++;

            if (!doLoop) {
                break;
            }
        }

        if (doLoop && _depth === deck.length - 1) {
            const fullName = deck.join("/");
            const thisDeckData = data.filter((d) => {
                return d.deck === fullName || d.deck.indexOf(`${fullName}/`) === 0;
            });

            treeData.push({
                name: deck[_depth],
                fullName,
                isOpen: _depth < 2,
                stat: {
                    new: thisDeckData.filter((d) => !d.nextReview).length,
                    leech: thisDeckData.filter((d) => d.srsLevel === 0).length,
                    due: thisDeckData.filter((d) => d.nextReview && moment(d.nextReview).toDate() < now).length
                }
            });
        }
    }

    const parser = new SearchParser();
    const cond = parser.doParse(req.body.q) || {};

    const db = new Database();
    const {data} = await db.parseCond(res.locals.userId, cond, {
        fields: ["_id", "srsLevel", "nextReview", "deck"]
    });

    const now = new Date();

    const deckList: string[] = data.map((d) => d.deck);
    const deckWithSubDecks: string[] = [];

    deckList.filter((d, i) => deckList.indexOf(d) === i).sort().forEach((d) => {
        const deck = d.split("/");
        deck.forEach((seg, i) => {
            const subDeck = deck.slice(0, i + 1).join("/");
            if (deckWithSubDecks.indexOf(subDeck) === -1) {
                deckWithSubDecks.push(subDeck);
            }
        });
    });

    const fullData = [] as ITreeViewItem[];
    deckWithSubDecks.forEach((d) => {
        const deck = d.split("/");
        recurseParseData(fullData, deck);
    });

    return res.json(fullData);
}));

router.post("/", asyncHandler(async (req, res) => {
    const parser = new SearchParser();
    const {cond} = parser.doParse(req.body.q) || {} as any;
    const andCond: any[] = [];
    if (cond) {
        andCond.push(cond);
    }

    if (req.body.deck) {
        andCond.push({deck: {$regex: `^${escapeRegExp(req.body.deck)}(/.+)?$`}});
    }

    if (req.body.type !== "all") {
        const type: string = req.body.type;
        if (type === "due") {
            andCond.push({nextReview: {$lte: moment().toISOString()}});
        } else if (type === "leech") {
            andCond.push({srsLevel: 0});
        } else if (type === "new") {
            andCond.push({nextReview: {$exists: false}});
        } else {
            andCond.push({$or: [
                {nextReview: {$exists: false}},
                {nextReview: {$lte: moment().toISOString()}}
            ]});
        }
    }

    const due = req.body.due;
    if (due) {
        const m = /(-?\d+(?:\.\d+)?\S+)/.exec(due);
        if (m) {
            andCond.push({nextReview: {$lte: moment().add(parseFloat(m[1]), m[2] as any).toISOString()}})
        } else {
            andCond.push({$or: [
                {nextReview: {$exists: false}},
                {nextReview: {$lte: moment().toISOString()}}
            ]})
        }
    }

    const db = new Database();
    const {data} = await db.parseCond(res.locals.userId, {
        cond: {$and: andCond},
        fields: new Set(["deck"])
    }, {
        fields: ["_id"]
    });

    return res.json({
        ids: data.map((c) => c._id)
    });
}));

router.post("/render", asyncHandler(async (req, res) => {
    const {id} = req.body;
    const db = new Database();
    
    return res.json(await db.render(res.locals.userId, id));
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
