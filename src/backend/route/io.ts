import { Router, Request, Response } from "express";
import Anki from "../db/anki";
import fileUpload, { UploadedFile } from "express-fileupload";
import fs from "fs";
import path from "path";
import uuid from "uuid/v4";
import needUserId from "../middleware/needUserId";
import asyncHandler from "express-async-handler";

class IoController {
    public static ankiImport(req: Request, res: Response): Response {
        const file = req.files!.apkg as UploadedFile;
        const id = uuid();

        try {
            fs.mkdirSync(path.join("tmp", id), {recursive: true});
        } catch (e) {}

        fs.writeFileSync(path.join("tmp", id, file.name), file.data);

        return res.json({fileId: id});
    }

    public static async ankiImportProgress(req: Request, res: Response) {
        const fileId: string = req.body.fileId;
        const filename: string = req.body.filename;

        res.writeHead(200, {
            "Content-Type": "application/ndjson",
            "Transfer-Encoding": "chunked",
            "X-Content-Type-Options": "nosniff"
        });

        const anki = new Anki(filename, fileId, (p: any) => {
            console.log(p),
            res.write(JSON.stringify(p) + "\n");
        });
        await anki.export(res.locals.userId);
        anki.close();

        res.write(JSON.stringify({
            text: "Done.",
            max: 0
        }) + "\n");

        return res.end();
    }
}

const router = Router();
router.use(needUserId());
router.use(fileUpload());
router.post("/import/anki", IoController.ankiImport);
router.post("/import/anki/progress", asyncHandler(IoController.ankiImportProgress));

export default router;
