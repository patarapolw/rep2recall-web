import { Request, Response, Router } from "express";
import asyncHandler from "express-async-handler";
import Database from "../db";
import { ObjectID } from "bson";
import needUserId from "../middleware/needUserId";

class MediaController {
    public static async get(req: Request, res: Response): Promise<Response> {
        const db = new Database();
        const _id = new ObjectID(req.params[0]);
        const m = await db.media.findOne({_id});

        return res.send(m!.data.buffer);
    }
}

const router = Router();
router.use(needUserId());

router.get("/*", asyncHandler(MediaController.get));

export default router;
