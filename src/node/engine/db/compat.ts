import { IDataSocket } from ".";
import moment from "moment";
import shortid from "shortid";
import { IProgress, asyncP, fromString } from "../../util";
import sqlite from "sqlite";
import { g } from "../../config";
import MongoDatabase from "./mongo";
import uuid from "uuid/v4";

export default class ExportDb {
    public static async connect(filename: string): Promise<ExportDb> {
        const sql = await sqlite.open(filename);
        await sql.exec(`
        CREATE TABLE IF NOT EXISTS deck (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            name    VARCHAR UNIQUE NOT NULL
        );
        CREATE TABLE IF NOT EXISTS source (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        VARCHAR NOT NULL /* NOT UNIQUE */,
            h           VARCHAR UNIQUE,
            created     VARCHAR NOT NULL
        );
        CREATE TABLE IF NOT EXISTS template (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            sourceId    INTEGER REFERENCES source(id),
            name        VARCHAR,
            model       VARCHAR,
            front       VARCHAR NOT NULL,
            back        VARCHAR,
            css         VARCHAR,
            js          VARCHAR,
            UNIQUE (sourceId, name, model)
        );
        CREATE TABLE IF NOT EXISTS note (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            sourceId    INTEGER REFERENCES source(id),
            key         VARCHAR,
            data        VARCHAR NOT NULL /* JSON */
            /* UNIQUE (sourceId, key) */
        );
        CREATE TABLE IF NOT EXISTS media (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            sourceId    INTEGER REFERENCES source(id),
            name        VARCHAR NOT NULL,
            data        BLOB NOT NULL,
            h           VARCHAR NOT NULL
        );
        CREATE TABLE IF NOT EXISTS card (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            deckId      INTEGER NOT NULL REFERENCES deck(id),
            templateId  INTEGER REFERENCES template(id),
            noteId      INTEGER REFERENCES note(id),
            front       VARCHAR NOT NULL,
            back        VARCHAR,
            mnemonic    VARCHAR,
            srsLevel    INTEGER,
            nextReview  VARCHAR,
            /* tag */
            created     VARCHAR,
            modified    VARCHAR,
            stat        VARCHAR
        );
        CREATE TABLE IF NOT EXISTS tag (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            name    VARCHAR UNIQUE NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cardTag (
            cardId  INTEGER NOT NULL REFERENCES card(id) ON DELETE CASCADE,
            tagId   INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
            PRIMARY KEY (cardId, tagId)
        );
        `);

        return new ExportDb(sql);
    }

    public sql: sqlite.Database;;

    private constructor(sql: sqlite.Database) {
        this.sql = sql;
    }

    public async close() {
        await this.sql.close();
    }

    public async import(cb: (p: IProgress) => void) {
        const db = g.db!;
        let userId: string | undefined;

        if (db instanceof MongoDatabase) {
            userId = db.userId;
        }

        const sourceHToId: {[key: string]: string} = {};
        const ss = await this.sql.all("SELECT name, h, created FROM source");
        let i = 0;

        for (const s of ss) {
            const {name, h, created} = s;
            cb({
                text: `Creating source: ${name}`,
                current: i,
                max: ss.length
            });

            if (db instanceof MongoDatabase) {
                sourceHToId[h] = (await db.source.findOneAndUpdate({userId, h}, {$setOnInsert: {
                    _id: uuid(),
                    userId,
                    name,
                    h,
                    created: moment(created).toDate()
                }}, {upsert: true, returnOriginal: false})).value!._id!;
            } else {
                await db.sql.run(`
                INSERT INTO source (_id, name, h, created)
                VALUES (?, ?, ?, ?)
                ON CONFLICT DO NOTHING`,
                uuid(), name, h, created);

                sourceHToId[h] = (await db.sql.get(`
                SELECT _id FROM source WHERE h = ?`, h))._id;
            }

            i++;
        }

        const deckNameToId: {[key: string]: string} = {};
        const ds = await this.sql.all("SELECT name FROM deck");
        i = 0;

        for (const d of ds) {
            const {name} = d;
            cb({
                text: `Creating deck: ${d}`,
                current: i,
                max: ds.length
            });

            if (db instanceof MongoDatabase) {
                deckNameToId[name] = (await db.deck.findOneAndUpdate({userId, name}, {$setOnInsert: {
                    _id: uuid(),
                    userId,
                    name
                }}, {upsert: true, returnOriginal: false})).value!._id!;
            } else {
                await db.sql.run(`
                INSERT INTO deck (_id, name)
                VALUES (?, ?)
                ON CONFLICT DO NOTHING`,
                uuid(), name);

                deckNameToId[name] = (await db.sql.get(`
                SELECT _id FROM deck WHERE name = ?`, name));
            }

            i++;
        }

        const templateKeyToId: {[key: string]: string} = {};
        const ts = await this.sql.all("SELECT name, model, front, back, css, js FROM template");
        i = 0

        for (const t of ts) {
            const {name, model, front, back, css, js} = t;
            cb({
                text: `Creating template: ${model ? `${model}/` : ""}${name}`,
                current: i,
                max: ts.length
            });

            const key = `${name}\x1f${model}`;
            if (db instanceof MongoDatabase) {
                templateKeyToId[key] = (await db.template.findOneAndUpdate({userId, name, model}, {$setOnInsert: {
                    userId,
                    _id: uuid(), name, model, front, back, css, js
                }}, {upsert: true, returnOriginal: false})).value!._id!;
            } else {
                await db.sql.run(`
                INSERT INTO template (_id, name, model, front, back, css, js)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT DO NOTHING`,
                uuid(), name, model, front, back, css, js);

                templateKeyToId[key] = (await db.sql.get(`
                SELECT _id FROM template WHERE name = ? AND model = ?`, name, model))._id;
            }

            i++;
        }

        const ms = await this.sql.all("SELECT name, data, h FROM media");
        i = 0

        for (const m of ms) {
            const {name, data, h} = m;
            cb({
                text: `Creating media: ${name}`,
                current: i,
                max: ms.length
            })

            if (db instanceof MongoDatabase) {
                try {
                    await db.media.insertOne({
                        _id: shortid.generate(), 
                        userId: userId!, name, data, h
                    });
                } catch (e) {}
            } else {
                await db.sql.run(`
                INSERT INTO media (_id, name, data, h)
                VALUES (?, ?, ?, ?)
                ON CONFLICT DO NOTHING`,
                shortid.generate(), name, data, h);
            }

            i++;
        }

        const ns = await this.sql.all(`
        SELECT
            key, data,
            s.h AS sourceH
        FROM note AS n
        LEFT JOIN source AS s ON s.id = n.sourceId`);
        const noteKeyToId: {[key: string]: string} = {};
        let max = ns.length;
        i = 0;
        let subList = ns.splice(0, 1000);

        while (subList.length > 0) {
            cb({
                text: `Inserting notes`,
                current: i,
                max
            });

            const notePromiseList: any[] = [];
            const keyList: string[] = [];

            for (const n of subList) {
                const {key, data, sourceH} = n;
                if (keyList.includes(key)) {
                    continue;   
                } else {
                    keyList.push(key);
                }

                const dataProper: Record<string, any> = {};
                const order: Record<string, number> = {};
                let seq = 1;

                for (const kv of (JSON.parse(data) || [] as IDataSocket[])) {
                    dataProper[kv.key] = kv.value;
                    order[kv.key] = seq;
                    seq++;
                }

                if (db instanceof MongoDatabase) {
                    notePromiseList.push(asyncP(async () => {
                        const r = await db.note.findOneAndUpdate({userId, key}, {
                            $setOnInsert: {
                                _id: uuid(),
                                userId,
                                _meta: {order},
                                key,
                                data: dataProper,
                                sourceId: sourceH ? sourceHToId[sourceH] : undefined
                            }
                        }, {upsert: true, returnOriginal: false});

                        noteKeyToId[key] = r.value!._id;
                    }));
                } else {
                    notePromiseList.push(asyncP(async () => {
                        await db.sql.run(`
                        INSERT INTO note (_id, _meta, key, data, sourceId)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT DO NOTHING`,
                        uuid(), JSON.stringify({order}), key, JSON.stringify(dataProper), 
                        sourceH ? sourceHToId[sourceH] : null)

                        noteKeyToId[key] = (await db.sql.get(`
                        SELECT _id FROM note WHERE key = ?`, key))._id;
                    }));
                }
            }

            await Promise.all(notePromiseList);

            i += 1000;
            subList = ns.splice(0, 1000);
        }

        const cs = await this.sql.all(`
        SELECT
            c.id AS id, c.front AS front, c.back AS back, mnemonic, srsLevel, nextReview, created, modified, stat,
            d.name AS deck,
            key,
            t.name AS template, model
        FROM card AS c
        LEFT JOIN deck AS d ON d.id = c.deckId
        LEFT JOIN note AS n ON n.id = c.noteId
        LEFT JOIN template AS t ON t.id = c.templateId`);
        max = cs.length;
        i = 0;
        subList = cs.splice(0, 1000);

        while (subList.length > 0) {
            cb({
                text: "Inserting cards",
                current: i,
                max
            });

            if (db instanceof MongoDatabase) {
                await db.card.insertMany(await Promise.all(subList.map((c) => {
                    return asyncP(async () => {
                        const {
                            _id, front, back, mnemonic, srsLevel, nextReview, created, modified, stat,
                            deck,
                            key,
                            template, model
                        } = c;
        
                        const tag = (await this.sql.all(`
                        SELECT name FROM tag AS t
                        INNER JOIN cardTag AS ct ON ct.tagId = t._id
                        INNER JOIN card AS c ON c._id = ct.cardId
                        WHERE c._id = ?`, _id)).map((t) => t.name);
        
                        return {
                            _id,
                            userId: userId!,
                            front, back, mnemonic, srsLevel,
                            nextReview: fromString(nextReview, true),
                            created: fromString(created, true),
                            modified: fromString(modified, true),
                            stat: fromString(stat),
                            deckId: deckNameToId[deck],
                            noteId: key ? noteKeyToId[key] : undefined,
                            templateId: template ? templateKeyToId[`${template}\x1f${model}`] : undefined,
                            tag: tag.length > 0 ? tag : undefined
                        }
                    })
                })));
            } else {
                await Promise.all(subList.map((c) => {
                    return asyncP(async () => {
                        const {
                            id, front, back, mnemonic, srsLevel, nextReview, created, modified, stat,
                            deck,
                            key,
                            template, model
                        } = c;
        
                        const tag = (await this.sql.all(`
                        SELECT name FROM tag AS t
                        INNER JOIN cardTag AS ct ON ct.tagId = t.id
                        INNER JOIN card AS c ON c.id = ct.cardId
                        WHERE c.id = ?`, id)).map((t) => t.name);

                        const _id = uuid();

                        await db.sql.run(`
                        INSERT INTO card (
                            _id, front, back, mnemonic, srsLevel, nextReview, created, modified, stat,
                            deckId, noteId, templateId
                        )`,
                        _id, front, back, mnemonic, srsLevel, nextReview, created, modified, stat,
                        deckNameToId[deck],
                        key ? noteKeyToId[key] : null,
                        template ? templateKeyToId[`${template}\x1f${model}`] : null);

                        await db.addTags([_id], tag);
                    });
                }));
            }

            i += 1000;
            subList = cs.splice(0, 1000);
        }
    }
}