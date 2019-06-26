import fs from "fs";
import AdmZip from "adm-zip";
import path from "path";
import sqlite3 from "better-sqlite3";
import Database from "./db";
import { ObjectID } from "bson";
import SparkMD5 from "spark-md5";
import shortid from "shortid";
import { ankiMustache } from "./util";

export default class Anki {
    private db: sqlite3.Database;
    private mediaNameToId: any = {};
    private filename: string;
    private filepath: string;
    private dir: string;
    private callback: (res: any) => any;

    constructor(filepath: string, filename: string, callback: (res: any) => any) {
        this.filename = filename;
        this.filepath = filepath;
        this.dir = path.dirname(filepath);
        this.callback = callback;

        const zip = new AdmZip(filepath);
        const zipCount = zip.getEntries().length;

        this.callback({
            text: `Unzipping Apkg. File count: ${zipCount}`,
            max: 0
        });

        zip.extractAllTo(this.dir);

        this.callback({
            text: "Preparing Anki resources.",
            max: 0
        });

        this.db = new sqlite3(path.join(this.dir, "collection.anki2"));

        const { decks, models } = this.db.prepare("SELECT decks, models FROM col").get();

        this.db.exec(`
        CREATE TABLE decks (
            id      INTEGER NOT NULL PRIMARY KEY,
            name    VARCHAR NOT NULL
        )`);

        const stmt = this.db.prepare("INSERT INTO decks (id, name) VALUES (?, ?)");
        this.db.transaction(() => {
            Object.values(JSON.parse(decks as string)).forEach((deck: any) => {
                stmt.run([deck.id, deck.name]);
            });
        })();

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
            mid     INTEGER REFERENCES model(id),
            name    VARCHAR NOT NULL,
            qfmt    VARCHAR NOT NULL,
            afmt    VARCHAR
        )`);

        const modelInsertStmt = this.db.prepare("INSERT INTO models (id, name, flds, css) VALUES (?, ?, ?, ?)");
        const templateInsertStmt = this.db.prepare("INSERT INTO templates (mid, name, qfmt, afmt) VALUES (?, ?, ?, ?)");

        this.db.transaction(() => {
            Object.values(JSON.parse(models as string)).forEach((model: any) => {
                modelInsertStmt.run([model.id, model.name, model.flds.map((f: any) => f.name).join("\x1f"), model.css]);
    
                model.tmpls.forEach((t: any) => {
                    templateInsertStmt.run([model.id, t.name, t.qfmt, t.afmt]);
                });
            });
        })();
    }

    public async export(userId: ObjectID) {
        const db = new Database();

        this.callback({
            text: "Writing to database",
            max: 0
        });

        let sourceId: ObjectID;
        try {
            sourceId = (await db.source.insertOne({
                userId,
                name: this.filename,
                h: SparkMD5.ArrayBuffer.hash(fs.readFileSync(this.filepath)),
                created: new Date()
            })).insertedId;
        } catch (e) {
            this.callback({
                error: `Duplicated resource: ${this.filename}`
            });
            return;
        }

        this.mediaNameToId = {} as any;
        const mediaJson = JSON.parse(fs.readFileSync(path.join(this.dir, "media"), "utf8"));

        const total = Object.keys(mediaJson).length;
        this.callback({
            text: "Uploading media",
            max: total
        });

        const mediaIToName: any = {};

        (await Promise.all(Object.keys(mediaJson).map((k, i) => {
            const data = fs.readFileSync(path.join(this.dir, k));
            const h = SparkMD5.ArrayBuffer.hash(data);
            const media = {
                _id: shortid.generate(),
                userId,
                sourceId,
                name: mediaJson[k],
                data,
                h
            };

            mediaIToName[i] = media.name;

            return db.media.updateOne({h}, {
                $setOnInsert: media
            }, {upsert: true});
        }))).map((m, i) => {
            this.mediaNameToId[mediaIToName[i]] = m.upsertedId._id;
        });

        const templates = this.db.prepare(`
        SELECT t.name AS tname, m.name AS mname, qfmt, afmt, css
        FROM templates AS t
        INNER JOIN models AS m ON m.id = t.mid`).all().map((t) => {
            const { tname, mname, qfmt, afmt, css } = t;
            return {
                userId,
                name: tname as string,
                model: mname as string,
                front: this.convertLink(qfmt as string),
                back: this.convertLink(afmt as string),
                css: this.convertLink(css as string),
                sourceId
            }
        });

        await (async () => {
            const batch = 1000;
            const total = templates.length;
            let subList = templates.splice(0, batch);
            let from = 0;

            while (subList.length > 0) {
                this.callback({
                    text: "Uploading templates",
                    current: from,
                    max: total
                });

                await db.template.insertMany(subList);
                subList = templates.splice(0, batch);
                from += batch;
            }
        })();

        const count = this.db.prepare(`
        SELECT
            COUNT(*) AS count
        FROM cards AS c
        INNER JOIN decks AS d ON d.id = did
        INNER JOIN notes AS n ON n.id = nid
        INNER JOIN models AS m ON m.id = n.mid
        INNER JOIN templates AS t ON t.mid = n.mid`).get().count;

        const entries = [] as any[];
        const frontSet = new Set();
        let current = 0;

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
        INNER JOIN templates AS t ON t.mid = n.mid`).all().map((c) => {
            if (!(current % 1000)) {
                this.callback({
                    text: "Reading notes",
                    current,
                    max: count
                });
            }
            current++;

            const { keys, values, tname, mname, deck, qfmt, tags } = c;
            const vs = (values as string).split("\x1f");

            const data = (keys as string).split("\x1f").map((k, i) => {
                return {
                    key: k,
                    value: vs[i]
                };
            });

            let front = ankiMustache(qfmt as string, data);
            if (front === ankiMustache(qfmt as string, null)) {
                return;
            }

            front = `@md5\n${SparkMD5.hash(this.convertLink(front))}`;

            if (frontSet.has(front)) {
                return;
            }
            frontSet.add(front);

            let tag = (tags as string).split(" ");
            tag = tag.filter((t, i) => t && tag.indexOf(t) === i);

            entries.push({
                deck: (deck as string).replace(/::/g, "/"),
                model: mname as string,
                template: tname as string,
                entry: vs[0],
                data,
                front,
                tag,
                sourceId
            });
        });

        await (async () => {
            const batch = 1000;
            const total = entries.length;
            let subList = entries.splice(0, batch);
            let from = 0;

            while (subList.length > 0) {
                this.callback({
                    text: "Uploading notes",
                    current: from,
                    max: total
                });

                await db.insertMany(userId, subList);
                subList = entries.splice(0, batch);
                from += batch;
            }
        })();
    }

    public close() {
        fs.unlinkSync(this.filepath);
        this.callback({});
        this.db.close();
    }

    private convertLink(s: string) {
        return s.replace(/(?:(?:href|src)=")([^"]+)(?:")/, (m, p1) => {
            return `/media/${this.mediaNameToId[p1]}`;
        });
    }
}