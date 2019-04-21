import fs from "fs";
import path from "path";
import mustache from "mustache";
import crypto from "crypto";
import sqlite3 from "better-sqlite3";
import Database, { ITemplate, IEntry, IMedia } from ".";
import { ObjectID } from "bson";
import AdmZip from "adm-zip";

export default class Anki {
    public db: sqlite3.Database;
    private mediaNameToId: any = {};
    private filename: string;
    private dir: string;
    private callback: (res: any) => any;

    constructor(filename: string, fileId: string, callback: (res: any) => any) {
        this.dir = path.join("tmp", fileId);
        this.filename = filename;
        this.callback = callback;

        const zip = new AdmZip(path.join(this.dir, filename));
        const zipCount = zip.getEntries().length;

        callback({
            text: `Unzipping Apkg. File count: ${zipCount}`,
            max: 0
        });

        zip.extractAllTo(this.dir);

        this.db = new sqlite3(path.join(this.dir, "collection.anki2"));

        const { decks, models } = this.db.prepare("SELECT decks, models FROM col").get();

        this.db.exec(`
        CREATE TABLE decks (
            id      INTEGER NOT NULL PRIMARY KEY,
            name    VARCHAR NOT NULL
        )`);

        const stmt = this.db.prepare("INSERT INTO decks (id, name) VALUES (?, ?)");

        Object.values(JSON.parse(decks as string)).forEach((deck: any) => {
            stmt.run(deck.id, deck.name);
        });

        this.db.exec(`
        CREATE TABLE models (
            id      INTEGER NOT NULL PRIMARY KEY,
            name    VARCHAR NOT NULL,
            flds    VARCHAR NOT NULL,
            css     VARCHAR
        )`);

        this.db.exec(`
        CREATE TABLE templates (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            mid     INTEGER REFERENCES models(id),
            name    VARCHAR NOT NULL,
            qfmt    VARCHAR NOT NULL,
            afmt    VARCHAR
        )`);

        const modelInsertStmt = this.db.prepare("INSERT INTO models (id, name, flds, css) VALUES (?, ?, ?, ?)");
        const templateInsertStmt = this.db.prepare("INSERT INTO templates (mid, name, qfmt, afmt) VALUES (?, ?, ?, ?)");

        Object.values(JSON.parse(models as string)).forEach((model: any) => {
            modelInsertStmt.run(model.id, model.name, model.flds.map((f: any) => f.name).join("\x1f"), model.css);

            model.tmpls.forEach((t: any) => {
                templateInsertStmt.run(model.id, t.name, t.qfmt, t.afmt);
            });
        });

        callback({
            text: "Prepared Anki SQLite file.",
            max: 0
        });
    }

    public async export(userId: ObjectID) {
        const db = new Database();

        const sourceId = (await db.source.insertOne({
            userId,
            name: this.filename,
            h: md5hasher(fs.readFileSync(path.join(this.dir, this.filename))),
            created: new Date()
        })).insertedId;

        this.mediaNameToId = {} as any;
        const media = JSON.parse(fs.readFileSync(path.join(this.dir, "media"), "utf8"));

        const mediaList = Object.keys(media).map((k, i) => {
            const data = fs.readFileSync(path.join(this.dir, k));
            const h = md5hasher(data);

            return {
                sourceId,
                name: media[k],
                data,
                h
            } as IMedia;
        });

        let insertFrom = 0;
        let batch = 100;
        let total = Object.keys(media).length;

        while (mediaList.length > 0) {
            this.callback({
                text: "Uploading media",
                current: insertFrom,
                max: total
            });
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
            this.callback({
                text: "Uploading templates",
                current: insertFrom,
                max: total
            });

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
            this.callback({
                text: "Uploading notes",
                current: insertFrom,
                max: total
            });

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
