import fileupload, { UploadedFile } from "express-fileupload";
import { Request, Response, Router } from "express";
import asyncHandler from "express-async-handler";
import Anki from "../db/anki";
import needUserId from "../middleware/needUserId";

class IoController {
    public static async ankiImport(req: Request, res: Response) {
        const uploadedFile = req.files!.apkg as UploadedFile;

        res.write(JSON.stringify({
            status: `Uploaded ${uploadedFile.name}.`
        }) + "\n");

        const anki = await Anki.connect(uploadedFile, res);
        const userId = res.locals.userId;
        await anki.export(userId);
        await anki.close();

        res.end();
    }
}

const router = Router();
router.use(needUserId());
router.use(fileupload());

router.post("/import/anki", asyncHandler(IoController.ankiImport));

export default router;
