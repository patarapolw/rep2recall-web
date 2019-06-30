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

    fs.writeFileSync(path.join(g.TMP, id), file.data);
    idToFilename[id] = file.name;

    return res.json({id});
}));

g.io.on("connection", (socket: any) => {
    socket.on("message", async (msg: any) => {
        try {
            const db = new Database();
            const user = socket.request.session.passport.user;
            const u = await db.user.findOne({email: user.emails[0].value});
            const userId = u!._id!;

            const {id, type} = msg;
            if (type === ".apkg") {
                const anki = new Anki(path.join(g.TMP, id), idToFilename[id], (p) => {
                    g.io.send(p);
                });
        
                await anki.export(userId);
                anki.close();
            } else {
                const xdb = new ExportDb(path.join(g.TMP, id), (p) => {
                    g.io.send(p);
                });
                await xdb.import(userId);
                xdb.close();
            }
            g.io.send({});
        } catch (e) {
            console.error(e);
            g.io.send({
                error: e.toString()
            });
        }
    });
});

export default router;
