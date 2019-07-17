import { Router } from "express";
import asyncHandler from "express-async-handler";
import fileUpload, { UploadedFile } from "express-fileupload";
import needUserId from "../middleware/needUserId";
import auth from "../auth/token";
import uuid from "uuid/v4";
import path from "path";
import fs from "fs";
import Anki from "../engine/db/anki";
import { g } from "../config";
import sanitize from "sanitize-filename";
import MongoDatabase from "../engine/db/mongo";
import ExportDb from "../engine/db/compat";
import SqliteDatabase from "../engine/db/sqlite";

const router = Router();
router.use(fileUpload());
router.use(auth.optional);
router.use(needUserId());

const idToFilename: {[key: string]: string} = {};

router.post("/import", asyncHandler(async (req, res) => {
    const id = uuid();
    const file = req.files!.file as UploadedFile;

    fs.writeFileSync(path.join(g.tempFolder, id), file.data);
    idToFilename[id] = file.name;

    return res.json({id});
}));

router.get("/export", asyncHandler(async (req, res) => {
    const {deck, id} = req.query;
    const tempFilename = path.join(g.tempFolder, id);
    return res.download(tempFilename, `${sanitize(deck)}.db`);
}));

g.io!.on("connection", (socket) => {
    async function getUserId() {
        const db = g.db!;
        if (db instanceof MongoDatabase) {
            const email = process.env.DEFAULT_USER || socket.request.session.passport.user.emails[0].value;
            const u = await db.user.findOne({email});
            return u!._id!;
        }

        return "";
    }

    socket.on("import", async (msg: any) => {
        try {
            g.db!.userId = await getUserId();

            const {id, type} = msg;
            if (type === ".apkg") {
                const anki = await Anki.connect(path.join(g.tempFolder, id), idToFilename[id], (p) => {
                    g.io!.send(p);
                });
        
                await anki.export();
                await anki.close();
            } else {
                const xdb = await ExportDb.connect(path.join(g.tempFolder, id));
                await xdb.import((p) => {
                    g.io!.send(p);
                });
                await xdb.close();
            }
            g.io!.send({});
        } catch (e) {
            console.error(e);
            g.io!.send({
                error: e.toString()
            });
        }
    });

    socket.on("export", async (msg: any) => {
        try {
            g.db!.userId = await getUserId();

            const {deck, reset} = msg;
            const fileId = uuid();
            const tempFilename = path.join(g.tempFolder, fileId);
            const newFile = await SqliteDatabase.connect(tempFilename);

            await newFile.export(deck, reset, (p) => {
                g.io!.send(p);
            });
            newFile.close();   
            
            g.io!.send({id: fileId, deck});
        } catch (e) {
            console.error(e);
            g.io!.send({
                error: e.toString()
            });
        }
    });
});

export default router;
