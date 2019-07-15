import sqlite3 from "better-sqlite3";
import Database, { INoteDataSocket } from "./db";
import { ObjectID } from "bson";
import moment from "moment";
import shortid from "shortid";
import { IProgress, escapeRegExp, normalizeArray } from "../util";

export default class ExportDb {
    public conn: sqlite3.Database;
    private cb: (p: IProgress) => void;

    constructor(filename: string, callback: (p: IProgress) => void) {
        this.cb = callback;

        this.conn = sqlite3(filename);
        this.conn.exec(`
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
    }

    public close() {
        this.conn.close();
    }

    public async export(userId: ObjectID, deckName?: string, reset?: boolean) {
        const db = new Database();
        const [
            deck,
            source,
            template,
            note,
            media,
            card
        ] = await Promise.all([
            db.deck.find({userId, 
                name: deckName ? {$regex: `^${escapeRegExp(deckName)}/?`} : undefined
            }).project({_id: 0, name: 1}).toArray(),
            db.source.find({userId}).project({_id: 0, userId: 0}).toArray(),
            db.template.aggregate([
                {$match: {userId}},
                {$lookup: {
                    from: "source",
                    localField: "sourceId",
                    foreignField: "_id",
                    as: "s"
                }},
                {$project: {_id: 0, sH: "$s.h", name: 1, model: 1, front: 1, back: 1, css: 1, js: 1}}
            ]).toArray(),
            db.note.aggregate([
                {$match: {userId}},
                ...(deckName ? [
                    {$lookup: {
                        from: "card",
                        localField: "_id",
                        foreignField: "noteId",
                        as: "c"
                    }},
                    {$unwind: {
                        path: "$c",
                        preserveNullAndEmptyArrays: true
                    }},
                    {$lookup: {
                        from: "deck",
                        localField: "deckId",
                        foreignField: "c._id",
                        as: "d"
                    }},
                    {$match: {"d.name": {$regex: `^${escapeRegExp(deckName)}/?`}}},
                ] : []),
                {$lookup: {
                    from: "source",
                    localField: "sourceId",
                    foreignField: "_id",
                    as: "s"
                }},
                {$project: {_id: 0, sH: "$s.h", key: 1, data: 1}}
            ]).toArray(),
            db.media.aggregate([
                {$match: {userId}},
                {$lookup: {
                    from: "source",
                    localField: "sourceId",
                    foreignField: "_id",
                    as: "s"
                }},
                {$project: {_id: 0, sH: "$s.h", name: 1, data: 1, h: 1}}
            ]).toArray(),
            db.card.aggregate([
                {$match: {userId}},
                {$lookup: {
                    from: "deck",
                    localField: "deckId",
                    foreignField: "_id",
                    as: "d"
                }},
                ...(deckName ? [
                    {$match: {"d.name": {$regex: `^${escapeRegExp(deckName)}/?`}}}
                ] : []),
                {$lookup: {
                    from: "template",
                    localField: "templateId",
                    foreignField: "_id",
                    as: "t"
                }},
                {$lookup: {
                    from: "note",
                    localField: "noteId",
                    foreignField: "_id",
                    as: "n"
                }},
                {$project: {_id: 0, deck: "$d.name", template: "$t.name", model: "$t.model", key: "$n.key", 
                    front: 1, back: 1, mnemonic: 1,
                    srsLevel: 1, nextReview: 1, tag: 1, created: 1, modified: 1, stat: 1}}
            ]).toArray(),
        ]);

        this.conn.transaction(() => {
            for (const d of deck) {
                this.conn.prepare("INSERT INTO deck (name) VALUES (@name)").run(d);
            }
            for (const s of source) {
                this.conn.prepare(`
                INSERT INTO source (name, h, created)
                VALUES (@name, @h, @created)`).run({
                    ...s,
                    created: s.created.toISOString()
                });
            }
        })();

        this.conn.transaction(() => {
            for (const t of template) {
                this.conn.prepare(`
                INSERT INTO template (sourceId, name, model, front, back, css, js)
                VALUES (
                    (SELECT id FROM source WHERE h = @sH),
                    @name,
                    @model,
                    @front,
                    @back,
                    @css,
                    @js
                )`).run({
                    ...t,
                    sH: normalizeArray((t as any).sH)
                });
            }
            for (const n of note) {
                this.conn.prepare(`
                INSERT INTO note (sourceId, key, data)
                VALUES (
                    (SELECT id FROM source WHERE h = @sH),
                    @key,
                    @data
                )`).run({
                    ...n,
                    sH: normalizeArray((n as any).sH),
                    data: JSON.stringify(n.data)
                });
            }
            for (const m of media) {
                this.conn.prepare(`
                INSERT INTO media (sourceId, name, data, h)
                VALUES (
                    (SELECT id FROM source WHERE h = @sH),
                    @name,
                    @data,
                    @h
                )`).run({
                    ...m,
                    sH: normalizeArray((m as any).sH),
                    data: m.data.buffer
                });
            }
        })();

        console.log(card);

        this.conn.transaction(() => {
            for (const c of card) {
                this.conn.prepare(`
                INSERT INTO card (deckId, templateId, noteId, front, back, mnemonic, srsLevel,
                    nextReview, created, modified, stat)
                VALUES (
                    (SELECT id FROM deck WHERE name = @deck),
                    (SELECT id FROM template WHERE name = @template AND model = @model),
                    (SELECT id FROM note WHERE key = @key),
                    @front, @back, @mnemonic, @srsLevel, @nextReview, @created, @modified, @stat
                )`).run({
                    ...c,
                    deck: normalizeArray((c as any).deck),
                    template: normalizeArray((c as any).template),
                    model: normalizeArray((c as any).model),
                    key: normalizeArray((c as any).key),
                    srsLevel: !reset ? c.srsLevel : null,
                    nextReview: !reset && c.nextReview ? c.nextReview.toISOString() : null,
                    created: c.created.toISOString(),
                    modified: !reset && c.modified ? c.modified.toISOString() : null,
                    stat: !reset && c.stat ? JSON.stringify(c.stat) : null
                });
            }
        })();
    }

    public async import(userId: ObjectID) {
        const db = new Database();

        const sourceHToId: {[key: string]: ObjectID} = {};
        const ss = this.conn.prepare("SELECT name, h, created FROM source").all();
        let i = 0;

        for (const s of ss) {
            const {name, h, created} = s;
            this.cb({
                text: `Creating source: ${name}`,
                current: i,
                max: ss.length
            });

            sourceHToId[h] = (await db.source.findOneAndUpdate({userId, h}, {$setOnInsert: {
                userId,
                name,
                h,
                created: moment(created).toDate()
            }}, {upsert: true, returnOriginal: false})).value!._id!;

            i++;
        }

        const deckNameToId: {[key: string]: ObjectID} = {};
        const ds = this.conn.prepare("SELECT name FROM deck").all();
        i = 0;

        for (const d of ds) {
            const {name} = d;
            this.cb({
                text: `Creating deck: ${d}`,
                current: i,
                max: ds.length
            });

            deckNameToId[name] = (await db.deck.findOneAndUpdate({userId, name}, {$setOnInsert: {
                userId,
                name
            }}, {upsert: true, returnOriginal: false})).value!._id!;

            i++;
        }

        const templateKeyToId: {[key: string]: ObjectID} = {};
        const ts = this.conn.prepare("SELECT name, model, front, back, css, js FROM template").all();
        i = 0

        for (const t of ts) {
            const {name, model, front, back, css, js} = t;
            this.cb({
                text: `Creating template: ${model ? `${model}/` : ""}${name}`,
                current: i,
                max: ts.length
            });

            const key = `${name}\x1f${model}`;
            templateKeyToId[key] = (await db.template.findOneAndUpdate({userId, name, model}, {$setOnInsert: {
                userId,
                name, model, front, back, css, js
            }}, {upsert: true, returnOriginal: false})).value!._id!;

            i++;
        }

        const ms = this.conn.prepare("SELECT name, data, h FROM media").all();
        i = 0

        for (const m of ms) {
            const {name, data, h} = m;
            this.cb({
                text: `Creating media: ${name}`,
                current: i,
                max: ms.length
            })

            try {
                await db.media.insertOne({
                    _id: shortid.generate(), 
                    userId, name, data, h
                });
            } catch (e) {}

            i++;
        }

        const ns = this.conn.prepare(`
        SELECT
            key, data,
            s.h AS sourceH
        FROM note AS n
        LEFT JOIN source AS s ON s.id = n.sourceId`).all();
        const noteKeyToId: {[key: string]: ObjectID} = {};
        let max = ns.length;
        i = 0
        let subList = ns.splice(0, 1000);

        while (subList.length > 0) {
            this.cb({
                text: `Inserting notes`,
                current: i,
                max
            });

            const {insertedIds} = await db.note.insertMany(subList.map((n) => {
                const {key, data, sourceH} = n;

                return {
                    userId,
                    key,
                    data: JSON.parse(data) || [],
                    sourceId: sourceH ? sourceHToId[sourceH] : undefined
                };
            }));

            for (const [index, value] of Object.entries(insertedIds)) {
                noteKeyToId[subList[index as unknown as number].key] = value;
            }

            i += 1000;
            subList = ns.splice(0, 1000);
        }

        const cs = this.conn.prepare(`
        SELECT
            c.id AS id, c.front AS front, c.back AS back, mnemonic, srsLevel, nextReview, created, modified, stat,
            d.name AS deck,
            key,
            t.name AS template, model
        FROM card AS c
        LEFT JOIN deck AS d ON d.id = c.deckId
        LEFT JOIN note AS n ON n.id = c.noteId
        LEFT JOIN template AS t ON t.id = c.templateId`).all();
        max = cs.length;
        i = 0;
        subList = cs.splice(0, 1000);

        while (subList.length > 0) {
            this.cb({
                text: "Inserting cards",
                current: i,
                max
            });

            await db.card.insertMany(subList.map((c) => {
                const {
                    id, front, back, mnemonic, srsLevel, nextReview, created, modified, stat,
                    deck,
                    key,
                    template, model
                } = c;

                const tag = this.conn.prepare(`
                SELECT name FROM tag AS t
                INNER JOIN cardTag AS ct ON ct.tagId = t.id
                INNER JOIN card AS c ON c.id = ct.cardId
                WHERE c.id = ?`).all(id).map((t) => t.name);

                return {
                    userId,
                    front, back, mnemonic, srsLevel,
                    nextReview: nextReview ? moment(nextReview).toDate() : undefined,
                    created: moment(created).toDate(),
                    modified: modified ? moment(modified).toDate() : undefined,
                    stat: stat ? JSON.parse(stat) : undefined,
                    deckId: deckNameToId[deck],
                    noteId: key ? noteKeyToId[key] : undefined,
                    templateId: template ? templateKeyToId[`${template}\x1f${model}`] : undefined,
                    tag: tag.length > 0 ? tag : undefined
                }
            }))

            i += 1000;
            subList = cs.splice(0, 1000);
        }
    }
}