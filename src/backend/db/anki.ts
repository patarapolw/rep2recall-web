import fs from "fs";
import unzipper from "unzipper";
// @ts-ignore;
import etl from "etl";
import path from "path";
import mustache from "mustache";
import crypto from "crypto";
import { Readable, Stream } from "stream";
import sqlite3 from "better-sqlite3";
import uuid from "uuid/v4";
import Database, { ITemplate, IEntry, IMedia } from ".";
import { ObjectID } from "bson";
import { Response } from "express";
import { UploadedFile } from "express-fileupload";

export default class Anki {
    public static async connect(upload: UploadedFile, res: Response) {
        let media = {} as any;
        const dir = uuid();

        try {
            fs.mkdirSync(`tmp/${dir}`, {recursive: true});
        } catch (e) {}

        await new Promise((resolve) => {
            let stream: Stream;
            stream = new Readable({
                read() {
                    this.push(upload.data);
                    this.push(null);
                }
            });

            stream
                .pipe(unzipper.Parse())
                .pipe(etl.map(async (entry: any) => {
                    if (entry.path === "media") {
                        media = JSON.parse((await entry.buffer()).toString());
                    } else {
                        fs.writeFileSync(path.join("tmp", dir, entry.path), await entry.buffer());
                    }
                }))
                .on("finish", resolve);
        });

        const db = new sqlite3(path.join("tmp", dir, "collection.anki2"));

        const { decks, models } = db.prepare("SELECT decks, models FROM col").get();

        db.exec(`
        CREATE TABLE decks (
            id      INTEGER NOT NULL PRIMARY KEY,
            name    VARCHAR NOT NULL
        )`);

        const stmt = db.prepare("INSERT INTO decks (id, name) VALUES (?, ?)");

        Object.values(JSON.parse(decks as string)).forEach((deck: any) => {
            stmt.run(deck.id, deck.name);
        });

        db.exec(`
        CREATE TABLE models (
            id      INTEGER NOT NULL PRIMARY KEY,
            name    VARCHAR NOT NULL,
            flds    VARCHAR NOT NULL,
            css     VARCHAR
        )`);

        db.exec(`
        CREATE TABLE templates (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            mid     INTEGER REFERENCES models(id),
            name    VARCHAR NOT NULL,
            qfmt    VARCHAR NOT NULL,
            afmt    VARCHAR
        )`);

        const modelInsertStmt = db.prepare("INSERT INTO models (id, name, flds, css) VALUES (?, ?, ?, ?)");
        const templateInsertStmt = db.prepare("INSERT INTO templates (mid, name, qfmt, afmt) VALUES (?, ?, ?, ?)");

        Object.values(JSON.parse(models as string)).forEach((model: any) => {
            modelInsertStmt.run(model.id, model.name, model.flds.map((f: any) => f.name).join("\x1f"), model.css);

            model.tmpls.forEach((t: any) => {
                templateInsertStmt.run(model.id, t.name, t.qfmt, t.afmt);
            });
        });

        res.write(JSON.stringify({
            status: "Prepared Anki SQLite file."
        }) + "\n");

        return new Anki({ media, db, dir, res, upload });
    }

    public db: sqlite3.Database;
    public media: any;
    private dir: string;
    private res: Response;
    private mediaNameToId: any = {};
    private upload: UploadedFile;

    private constructor({ media, db, dir, res, upload }: any) {
        this.dir = dir;
        this.media = media;
        this.db = db;
        this.res = res;
        this.upload = upload;
    }

    public async export(userId: ObjectID) {
        const db = new Database();

        const sourceId = (await db.source.insertOne({
            userId,
            name: this.upload.name,
            h: md5hasher(this.upload.data),
            created: new Date()
        })).insertedId;

        this.mediaNameToId = {} as any;
        const mediaList = Object.keys(this.media).map((k, i) => {
            const data = fs.readFileSync(path.join("tmp", this.dir, k));
            const h = md5hasher(data);

            return {
                sourceId,
                name: this.media[k],
                data,
                h
            } as IMedia;
        });

        let insertFrom = 0;
        let batch = 100;
        let total = Object.keys(this.media).length;

        while (mediaList.length > 0) {
            this.res.write(JSON.stringify({
                status: "Uploading media",
                progress: {
                    from: insertFrom,
                    to: insertFrom + batch,
                    total
                }
            }) + "\n");
            const subList = mediaList.splice(0, 100);
            const mediaIds = (await db.media.insertMany(subList)).insertedIds;
            subList.forEach((m, i) => {
                this.mediaNameToId[m.name] = mediaIds[i];
            });

            insertFrom += batch;
        }

        const templates = this.db.prepare(`
        SELECT t.name AS name, m.name AS model, qfmt AS front, afmt AS back, css
        FROM templates AS t
        INNER JOIN models AS m ON m.id = t.mid`).all().map((t) => {
            const {name, model, front, back, css} = t;
            return {
                sourceId,
                name, model,
                front: this.convertLink(front),
                back: this.convertLink(back),
                css: this.convertLink(css)
            } as ITemplate;
        });

        insertFrom = 0;
        batch = 1000;
        total = templates.length;

        while (templates.length > 0) {
            this.res.write(JSON.stringify({
                status: "Uploading template",
                progress: {
                    from: insertFrom,
                    to: insertFrom + batch,
                    total
                }
            }) + "\n");

            const subList = templates.splice(0, batch);
            await db.template.insertMany(subList);
            insertFrom += batch;
        }

        const entries = [] as IEntry[];
        const _e = [] as string[];

        this.db.prepare(`
        SELECT
            n.flds AS "values",
            m.flds AS keys,
            t.name AS tname,
            m.name AS mname,
            d.name AS deck,
            qfmt,
            tags
        FROM cards AS c
        INNER JOIN decks AS d ON d.id = did
        INNER JOIN notes AS n ON n.id = nid
        INNER JOIN models AS m ON m.id = n.mid
        INNER JOIN templates AS t ON t.mid = n.mid`).all().map((raw) => {
            const { keys, values, tname, mname, deck, qfmt, tags } = raw;
            const data = {} as any;
            const vs = (values as string).split("\x1f");
            const ks = (keys as string).split("\x1f");
            ks.forEach((k, i) => {
                data[k] = vs[i];
            });

            let front = mustache.render(qfmt as string, data);
            if (front === mustache.render(qfmt as string, {})) {
                return;
            }

            front = `@md5\n${md5hasher(front)}`;

            if (_e.indexOf(front) !== -1) {
                return;
            }
            _e.push(front);

            const entry: IEntry = {
                deck: (deck as string).replace(/::/g, "/"),
                model: mname,
                template: tname,
                entry: vs[0],
                data,
                front,
                tag: (tags as string).split(" "),
                sourceId
            };
            entries.push(entry);
        });

        insertFrom = 0;
        batch = 1000;
        total = entries.length;

        while (entries.length > 0) {
            this.res.write(JSON.stringify({
                status: "Uploading notes",
                progress: {
                    from: insertFrom,
                    to: insertFrom + batch,
                    total
                }
            }) + "\n");

            const subList = entries.splice(0, batch);
            await db.insertMany(userId, subList);
            insertFrom += batch;
        }
    }

    public close() {
        this.db.close();
    }

    private convertLink(s: string): string {
        return s.replace(/(?:(?:href|src)=")([^"]+)(?:")/, (m, p1) => {
            return `/media/${this.mediaNameToId[p1]}`;
        });
    }
}

export function md5hasher(s: string | Buffer) {
    return crypto.createHash("md5").update(s).digest("hex");
}
