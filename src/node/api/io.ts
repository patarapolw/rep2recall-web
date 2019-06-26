import { Router } from "express";
import asyncHandler from "express-async-handler";
import fileUpload, { UploadedFile } from "express-fileupload";
import needUserId from "../middleware/needUserId";
import auth from "../auth/token";
import Database from "../engine/db";
import uuid from "uuid/v4";
import path from "path";
import fs from "fs";
import Anki from "../engine/anki";
import { g } from "../config";
import ExportDb from "../engine/export";

const router = Router();
router.use(fileUpload());
router.use(auth.optional);
router.use(needUserId());

const idToFilename: {[key: string]: string} = {};

router.post("/import", asyncHandler(async (req, res) => {
    const id = uuid();
    const file = req.files!.file as UploadedFile;
    if (!fs.existsSync("tmp")) {
        fs.mkdirSync("tmp");
    }
    fs.writeFileSync(path.join("tmp", id), file.data);
    idToFilename[id] = file.name;

    return res.json({id});
}));

g.io.on("connection", (socket: any) => {
    socket.on("message", (msg: any) => {
        const db = new Database();
        const user = socket.request.session.passport.user;

        db.user.findOne({email: user.emails[0].value}).then((u) => {
            const userId = u!._id!;

            const {id, type} = msg;
            if (type === ".apkg") {
                const anki = new Anki(path.join("tmp", id), idToFilename[id], (p: any) => {
                    g.io.send(p);
                });
        
                anki.export(userId)
                .then(() => anki.close())
                .catch((e) => {
                    g.io.send(JSON.stringify({
                        error: e.toString()
                    }));
                });
            } else {
                const xdb = new ExportDb(path.join("tmp", id));
                xdb.import(userId)
                .then(() => xdb.close())
                .catch((e) => {
                    g.io.send(JSON.stringify({
                        error: e.toString()
                    }));
                });
            }
        });
    });
});

export default router;
