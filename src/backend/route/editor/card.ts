import { Request, Response, Router } from "express";
import SearchResource from "../../db/SearchResource";
import mustache from "mustache";
import Database from "../../db";
import { ObjectID } from "bson";
import asyncHandler from "express-async-handler";

class EditorController {
    public static async find(req: Request, res: Response): Promise<Response> {
        const rSearch = new SearchResource();
        const cond = rSearch.parse(req.body.q);
        const userId = res.locals.userId;

        const offset: number = req.body.offset;
        const limit: number = req.body.limit;
        const sortBy: string = req.body.sortBy || "deck";
        const desc: boolean = req.body.desc || false;

        const q = await rSearch.getQuery(userId, cond, [
            {$facet: {
                data: [
                    {$sort: {[sortBy]: desc ? -1 : 1}},
                    {$skip: offset},
                    {$limit: limit}
                ],
                count: [{$group: {
                    _id: null,
                    count: {$sum: 1}
                }}]
            }}
        ]).toArray();

        return res.json({
            data: q[0].data.map((c: any) => {
                const cData = c.data || {};
                if (/@md5\n/.test(c.front)) {
                    c.front = mustache.render(c.tFront, cData);
                    c.back = c.back || mustache.render(c.tBack || "", cData);
                }

                return c;
            }),
            count: q[0].count[0].count
        });
    }

    public static async findOne(req: Request, res: Response): Promise<Response> {
        const rSearch = new SearchResource();
        const cond = {id: req.body.id};
        const userId = res.locals.userId;

        const q = await rSearch.getQuery(userId, cond, [
            {$limit: 1}
        ]).toArray();
        const c: any = q[0];

        if (/@md5\n/.test(c.front)) {
            c.front = c.tFront;
            c.back = c.back || c.tBack;
        }

        return res.json(c);
    }

    public static async create(req: Request, res: Response): Promise<Response> {
        const db = new Database();
        const userId = res.locals.userId;
        const _id = (await db.insertMany(userId, [req.body.create]))[0];

        return res.json({id: _id.toHexString()});
    }

    public static async update(req: Request, res: Response): Promise<Response> {
        if (req.body.create) {
            return EditorController.create(req, res);
        }

        const db = new Database();
        const userId = res.locals.userId;
        const id: string = req.body.id;

        if (req.body.update) {
            const u = req.body.update;
            await db.update(userId, {
                _id: new ObjectID(id),
                ...u
            });
        } else {
            const fieldName: string = req.body.fieldName;
            const fieldData: any = req.body.fieldData;
            await db.update(userId, {
                _id: new ObjectID(id),
                [fieldName]: fieldData
            });
        }

        return res.sendStatus(201);
    }

    public static async delete(req: Request, res: Response): Promise<Response> {
        const id: string = req.body.id;
        const db = new Database();
        await db.card.deleteOne({_id: new ObjectID(id)});

        return res.sendStatus(201);
    }
}

export const router = Router();

router.post("/", asyncHandler(EditorController.find));
router.post("/findOne", asyncHandler(EditorController.findOne));
router.post("/create", asyncHandler(EditorController.create));
router.put("/", asyncHandler(EditorController.update));
router.delete("/", asyncHandler(EditorController.delete));

export default router;
