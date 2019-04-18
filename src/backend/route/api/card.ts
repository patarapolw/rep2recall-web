import { Router, Request, Response } from "express";
import { ObjectID } from "bson";
import Database, { IEntry } from "../../db";
import asyncHandler from "express-async-handler";

class CardApiController {
    public static async insertMany(req: Request, res: Response): Promise<Response> {
        const entries: IEntry[] = req.body.cards;
        const userId = new ObjectID((req as any).payload.id);
        const db = new Database();

        return res.json(await db.insertMany(userId, entries));
    }
}

const router = Router();
router.post("/insertMany", asyncHandler(CardApiController.insertMany));

export default router;
