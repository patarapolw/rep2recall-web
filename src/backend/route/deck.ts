import { Request, Response, Router } from "express";
import XRegExp from "xregexp";
import moment from "moment";
import asyncHandler from "express-async-handler";
import needUserId from "../middleware/needUserId";
import SearchResource from "../db/SearchResource";

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

class DeckController {
    public static async treeview(req: Request, res: Response): Promise<Response> {
        function recurseParseData(data: ITreeViewItem[], deck: string[], _depth = 0) {
            let doLoop = true;

            while (_depth < deck.length - 1) {
                for (const c of data) {
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
                const thisDeckData = deckData.filter((d) => new RegExp(`^${XRegExp.escape(fullName)}`).test(d.deck));

                data.push({
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

        const rSearch = new SearchResource();
        const cond = req.body.cond;
        const userId = res.locals.userId;

        const deckData = await rSearch.getQuery(userId, cond).project({nextReview: 1, srsLevel: 1, deck: 1}).toArray();
        const now = new Date();

        const deckList: string[] = deckData.map((d: any) => d.deck);
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
    }
}

const router = Router();
router.use(needUserId());
router.post("/treeview", asyncHandler(DeckController.treeview));

export default router;
