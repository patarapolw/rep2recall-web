import { Router } from "express";
import asyncHandler from "express-async-handler";
import fileUpload, { UploadedFile } from "express-fileupload";
import needUserId from "../middleware/needUserId";
import auth from "../auth/token";
import Database from "../engine/db";

const router = Router();
router.use(fileUpload());
router.use(auth.optional);
router.use(needUserId());

router.post("/restore", asyncHandler(async (req, res) => {
    const f = req.files!.file as UploadedFile;
    const db = new Database();

    const ids = await db.insertMany(res.locals.userId, f.data.toString("utf8")
    .split("\n")
    .filter((row) => row)
    .map((row) => JSON.parse(row)));

    return res.json({ids});
}));

router.post("/backup", asyncHandler(async (req, res) => {
    const db = new Database();

    res.setHeader('Content-disposition', 'attachment; filename=zhdiary.ndjson');
    for (const row of await db.downloadAll()) {
        res.write(JSON.stringify(row) + "\n");
    }

    res.end();
}));

export default router;
