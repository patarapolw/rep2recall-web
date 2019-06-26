import sqlite3 from "better-sqlite3";
import Database from "./db";
import { ObjectID } from "bson";

export default class ExportDb {
    public conn: sqlite3.Database;

    constructor(filename: string) {
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
            data        VARCHAR NOT NULL /* JSON */,
            UNIQUE (sourceId, key)
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

    public async export(userId: ObjectID) {
        const db = new Database();
        const [
            deck,
            source,
            template,
            note,
            media,
            card
        ] = await Promise.all([
            db.deck.find({userId}).project({_id: 0, userId: 0}).toArray(),
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
                )`).run(t);
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
                    data: m.data.buffer
                });
            }
        })();

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
                    nextReview: c.nextReview ? c.nextReview.toISOString() : null,
                    created: c.created.toISOString(),
                    modified: c.modified ? c.modified.toISOString() : null,
                    stat: c.stat ? JSON.stringify(c.stat) : null
                });
            }
        })();
    }

    public async import(userId: ObjectID): Promise<ObjectID[]> {
        const entries = this.conn.prepare(`
        SELECT
            c.id AS id,
            c.front AS front,
            c.back AS back,
            mnemonic,
            /* tag */
            srsLevel,
            nextReview,
            d.name AS deck,
            c.created AS created,
            modified,
            t.name AS template,
            t.model AS model,
            t.front AS tFront,
            t.back AS tBack,
            css,
            js,
            n.key AS "key",
            n.data AS data,
            s.name AS source,
            s.h AS sourceH,
            s.created AS sourceCreated,
            stat
        FROM card AS c
        INNER JOIN deck AS d ON d.id = deckId
        LEFT JOIN template AS t ON t.id = templateId
        LEFT JOIN note AS n ON n.id = noteId
        LEFT JOIN source AS s ON s.id = n.sourceId`).all().map((c) => {
            c.tag = this.conn.prepare(`
            SELECT name
            FROM tag
            INNER JOIN cardTag AS ct ON ct.tagId = tag.id
            WHERE ct.cardId = ?`).all(c.id).map((t) => t.name);
            c.data = JSON.parse(c.data || "{}");
            c.stat = JSON.parse(c.stat || "{}");

            return c;
        });

        const db = new Database();
        return await db.insertMany(userId, entries);
    }
}