import fs from "fs";
import AdmZip from "adm-zip";
import path from "path";
import sqlite from "sqlite";
import { IDataSocket } from ".";
import SparkMD5 from "spark-md5";
import shortid from "shortid";
import { ankiMustache, IProgress, asyncP } from "../../util";
import Bluebird from "bluebird";
import uuid from "uuid/v4";
import { g } from "../../config";
import MongoDatabase from "./mongo";
import rimraf from "rimraf";

global.Promise = Bluebird as any;

export default class Anki {
    public static async connect(filepath: string, filename: string, cb: (p: IProgress) => void): Promise<Anki> {
        fs.renameSync(filepath, `${filepath}.apkg`)
        fs.mkdirSync(filepath);

        const zip = new AdmZip(`${filepath}.apkg`);
        const zipCount = zip.getEntries().length;

        cb({
            text: `Unzipping Apkg. File count: ${zipCount}`,
            max: 0
        });

        zip.extractAllTo(filepath);

        cb({
            text: "Preparing Anki resources.",
            max: 0
        });

        const sql = await sqlite.open(path.join(filepath, "collection.anki2"));

        const { decks, models } = await sql.get("SELECT decks, models FROM col");

        await sql.exec(`
        CREATE TABLE decks (
            id      INTEGER PRIMARY KEY,
            name    VARCHAR NOT NULL
        )`);

        await Promise.all(Object.values(JSON.parse(decks as string)).map((d: any) => {
            return sql.run("INSERT INTO decks (id, name) VALUES (?, ?)", d.id, d.name);
        }));

        await sql.exec(`
        CREATE TABLE models (
            id      INTEGER PRIMARY KEY,
            name    VARCHAR NOT NULL,
            flds    VARCHAR NOT NULL,
            css     VARCHAR
        )`);

        await sql.exec(`
        CREATE TABLE templates (
            id      VARCHAR PRIMARY KEY,
            mid     INTEGER REFERENCES models(id),
            name    VARCHAR NOT NULL,
            qfmt    VARCHAR NOT NULL,
            afmt    VARCHAR
        )`);

        await Promise.all(Object.values(JSON.parse(models as string)).map((model: any) => {
            return asyncP(async () => {
                await sql.run("INSERT INTO models (id, name, flds, css) VALUES (?, ?, ?, ?)",
                model.id, model.name, model.flds.map((f: any) => f.name).join("\x1f"), model.css);

                await Promise.all(model.tmpls.map((t: any) => {
                    return sql.run("INSERT INTO templates (id, mid, name, qfmt, afmt) VALUES (?, ?, ?, ?, ?)",
                    uuid(), model.id, t.name, t.qfmt, t.afmt);
                }));
            })
        }));

        return new Anki({sql, filename, filepath, cb})
    }

    private sql: sqlite.Database;
    private mediaNameToId: any = {};
    private filename: string;
    private filepath: string;
    private cb: (res: any) => any;

    private constructor(params: any) {
        this.sql = params.sql;
        this.filename = params.filename;
        this.filepath = params.filepath;
        this.cb = params.cb;
    }

    public async export() {
        const db = g.db!;
        let userId: string = "";
        if (db instanceof MongoDatabase) {
            userId = db.userId!;
        }

        this.cb({
            text: "Writing to database",
            max: 0
        });

        let sourceId: string;
        let sourceH: string;
        try {
            sourceH = SparkMD5.ArrayBuffer.hash(fs.readFileSync(`${this.filepath}.apkg`))
            const _id = uuid();
            await db.source.insertOne({
                _id,
                userId,
                name: this.filename,
                h: sourceH,
                created: new Date()
            });

            sourceId = _id;
        } catch (e) {
            console.error(e);
            this.cb({
                error: `Duplicated resource: ${this.filename}`
            });
            return;
        }

        this.mediaNameToId = {} as any;
        const mediaJson = JSON.parse(fs.readFileSync(path.join(this.filepath, "media"), "utf8"));

        const total = Object.keys(mediaJson).length;
        this.cb({
            text: "Uploading media",
            max: total
        });

        const mediaIToName: any = {};

        (await Promise.all(Object.keys(mediaJson).map((k, i) => {
            const data = fs.readFileSync(path.join(this.filepath, k));
            const h = SparkMD5.ArrayBuffer.hash(data);
            const _id = shortid.generate();
            const media = {
                _id,
                userId,
                sourceId,
                name: mediaJson[k],
                data,
                h
            };

            mediaIToName[i] = media.name;

            return asyncP(async () => {
                if (db instanceof MongoDatabase) {
                    this.mediaNameToId[mediaJson[k]] = (await db.media.findOneAndUpdate({h}, {
                        $setOnInsert: media
                    }, {upsert: true, returnOriginal: false})).value!._id;
                } else {
                    this.mediaNameToId[mediaJson[k]] = (await db.media.getOrCreate({h}, {
                        $setOnInsert: media
                    }))._id;
                }
            });
        })));

        const templates = (await this.sql.all(`
        SELECT t.name AS tname, m.name AS mname, qfmt, afmt, css
        FROM templates AS t
        INNER JOIN models AS m ON m.id = t.mid`)).map((t) => {
            const { tname, mname, qfmt, afmt, css } = t;
            return {
                _id: uuid(),
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
                this.cb({
                    text: "Uploading templates",
                    current: from,
                    max: total
                });

                await db.template.insertMany(subList);
                subList = templates.splice(0, batch);
                from += batch;
            }
        })();

        const count = (await this.sql.get(`
        SELECT
            COUNT(*) AS count
        FROM cards AS c`)).count;

        const entries = [] as any[];
        const frontSet = new Set();
        let current = 0;

        (await this.sql.all(`
        SELECT
            n.flds AS "values",
            m.flds AS keys,
            t.name AS tname,
            m.name AS mname,
            d.name AS deck,
            qfmt,
            afmt,
            tags
        FROM cards AS c
        INNER JOIN decks AS d ON d.id = did
        INNER JOIN notes AS n ON n.id = nid
        INNER JOIN models AS m ON m.id = n.mid
        INNER JOIN templates AS t ON t.mid = n.mid`)).map((c) => {
            if (!(current % 1000)) {
                this.cb({
                    text: "Reading notes",
                    current,
                    max: count
                });
            }
            current++;

            const { keys, values, tname, mname, deck, qfmt, afmt, tags } = c;
            const vs = (values as string).split("\x1f");

            const dataDict: Record<string, string> = {};
            const data = (keys as string).split("\x1f").map((k, i) => {
                dataDict[k] = vs[i];

                return {
                    key: k,
                    value: vs[i]
                };
            }) as IDataSocket[];

            let front = ankiMustache(qfmt as string, dataDict);
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
                key: `${this.filename}/${mname}/${vs[0]}`,
                data,
                front,
                back: `@md5\n${SparkMD5.hash(this.convertLink(ankiMustache(afmt as string, dataDict)))}`,
                tag,
                sourceH
            });
        });

        await (async () => {
            const batch = 1000;
            const total = entries.length;
            let subList = entries.splice(0, batch);
            let from = 0;

            while (subList.length > 0) {
                this.cb({
                    text: "Uploading notes",
                    current: from,
                    max: total
                });

                await db.insertMany(subList);
                subList = entries.splice(0, batch);
                from += batch;
            }
        })();
    }

    public async close() {
        await this.sql.close();
        rimraf.sync(this.filepath);
        fs.unlinkSync(`${this.filepath}.apkg`);
        this.cb({});
    }

    private convertLink(s: string) {
        return s.replace(/(?:(?:href|src)=")([^"]+)(?:")/, (m, p1) => {
            return `/media/${this.mediaNameToId[p1]}`;
        });
    }
}