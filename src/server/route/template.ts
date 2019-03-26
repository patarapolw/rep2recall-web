import { Request, Response, Router } from "express";
import asyncHandler from "express-async-handler";
import Database from "../db";
import nunjucks from "nunjucks";
import needUserId from "../middleware/needUserId";

export class TemplateController {
    public static async get(req: Request, res: Response): Promise<Response> {
        const template: string = req.body.template;
        const [templateName, entry] = template.split("/");

        const db = new Database();
        const t = (await db.templateData.aggregate([
            {$match: {entry}},
            {$lookup: {
                from: "template",
                localField: "templateId",
                foreignField: "_id",
                as: "t"
            }},
            {$unwind: "$t"},
            {$match: {
                "t.name": templateName,
                "t.userId": res.locals.userId
            }},
            {$project: {
                front: "$t.front",
                back: "$t.back",
                note: "$t.note",
                data: 1
            }}
        ]).limit(1).toArray()) as any[];

        function convert(k: string) {
            return t[0] && t[0][k] ? nunjucks.render(t[0][k], t[0].data) : undefined;
        }

        const output = {} as any;
        ["front", "back", "note"].forEach((k) => output[k] = convert(k));

        return res.json(output);
    }
}

export const router = Router();
router.use(needUserId());

router.post("/", asyncHandler(TemplateController.get));

export default router;
