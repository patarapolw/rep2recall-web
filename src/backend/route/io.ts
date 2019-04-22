import { Router, Request, Response } from "express";
import Anki from "../db/anki";
import fileUpload, { UploadedFile } from "express-fileupload";
import fs from "fs";
import path from "path";
import uuid from "uuid/v4";
import needUserId from "../middleware/needUserId";
import asyncHandler from "express-async-handler";
import SearchResource from "../db/SearchResource";
import XRegExp from "xregexp";
import { LokiDb } from "../loki";
import sanitize from "sanitize-filename";
import { ObjectID } from "bson";

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

    public static lokiImport(req: Request, res: Response): Response {
        const file = req.files!.r2r as UploadedFile;
        const id = uuid();

        try {
            fs.mkdirSync(path.join("tmp", id), {recursive: true});
        } catch (e) {}

        fs.writeFileSync(path.join("tmp", id, file.name), file.data);

        return res.json({fileId: id});
    }

    public static async lokiImportProgress(req: Request, res: Response) {
        const fileId: string = req.body.fileId;
        const filename: string = req.body.filename;

        res.writeHead(200, {
            "Content-Type": "application/ndjson",
            "Transfer-Encoding": "chunked",
            "X-Content-Type-Options": "nosniff"
        });

        const lkFilename = path.join("tmp", fileId, filename);
        const lk = await LokiDb.connect(lkFilename);
        const userId: ObjectID = res.locals.userId;

        lk.toMongo(userId, (s) => {
            console.log(s);
            res.write(JSON.stringify(s) + "\n");
        });

        res.write(JSON.stringify({
            text: "Done."
        }) + "\n");

        return res.end();
    }

    public static async lokiExport(req: Request, res: Response) {
        const search = new SearchResource();
        const cond = search.parse(req.body.q);

        if (req.body.deck) {
            cond.deck = {$regex: `${XRegExp.escape(req.body.deck)}(/.+)?`};
        }

        const fileId = uuid();
        try {
            fs.mkdirSync(path.join("tmp", fileId), {recursive: true});
        } catch (e) {}

        const lkFilename = path.join("tmp", fileId, sanitize(req.body.deck) + ".r2r");
        const lk = await LokiDb.connect(lkFilename);

        lk.fromMongo(res.locals.userId, cond, (s: any) => {
            console.log(s);
        });

        await lk.loki.close();

        return res.download(lkFilename);
    }
}

const router = Router();
router.use(needUserId());
router.use(fileUpload());
router.post("/import/anki", IoController.ankiImport);
router.post("/import/anki/progress", asyncHandler(IoController.ankiImportProgress));
router.post("/import/loki", IoController.lokiImport);
router.post("/import/loki/progress", asyncHandler(IoController.lokiImportProgress));
router.post("/export/loki", asyncHandler(IoController.lokiExport));

export default router;
