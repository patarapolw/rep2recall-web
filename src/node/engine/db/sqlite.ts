import SparkMD5 from "spark-md5";
import uuid from "uuid/v4";
import { ankiMustache, toString, asyncP, shuffle, IProgress, escapeRegExp, escapeSqlLike, fromString } from "../../util";
import { ISearchParserResult, mongoFilter, sorter } from "../search";
import { srsMap, getNextReview, repeatReview } from "../quiz";
import sqlite from "sqlite";
import Bluebird from "bluebird";
import shortid from "shortid";
import { ICondOptions, IPagedOutput, IDataSocket } from ".";
import moment from "moment";
import { g } from "../../config";
import MongoDatabase, { IDbDeck, IDbSource, IDbTemplate, IDbNote, IDbMedia, IDbCard } from "./mongo";

global.Promise = Bluebird as any;

export class SqliteDatabase {
    public static async connect(filename: string): Promise<SqliteDatabase> {
        const sql = await sqlite.open(filename);
        await SqliteDatabase.build(sql);

        return new SqliteDatabase(sql);
    }

    private static async build(sql: sqlite.Database) {
        await sql.exec(`
        CREATE TABLE IF NOT EXISTS deck (
            _id     VARCHAR PRIMARY KEY,
            name    VARCHAR UNIQUE NOT NULL
        );

        CREATE TABLE IF NOT EXISTS source (
            _id         VARCHAR PRIMARY KEY,
            name        VARCHAR NOT NULL,
            h           VARCHAR UNIQUE,
            created     VARCHAR NOT NULL
        );

        CREATE TABLE IF NOT EXISTS template (
            _id         VARCHAR PRIMARY KEY,
            sourceId    VARCHAR REFERENCES source(_id),
            name        VARCHAR,
            model       VARCHAR,
            front       VARCHAR NOT NULL,
            back        VARCHAR,
            css         VARCHAR,
            js          VARCHAR,
            UNIQUE (sourceId, name, model)
        );

        CREATE TABLE IF NOT EXISTS note (
            _id         VARCHAR PRIMARY KEY,
            _meta       VARCHAR NOT NULL, /* JSON */
            sourceId    VARCHAR REFERENCES source(_id),
            key         VARCHAR,
            data        VARCHAR NOT NULL /* JSON */
            /* UNIQUE (sourceId, key) */
        );

        CREATE TABLE IF NOT EXISTS media (
            _id         VARCHAR PRIMARY KEY,
            sourceId    VARCHAR REFERENCES source(_id),
            name        VARCHAR NOT NULL,
            data        BLOB NOT NULL,
            h           VARCHAR NOT NULL
        );

        CREATE TABLE IF NOT EXISTS card (
            _id         VARCHAR PRIMARY KEY,
            deckId      VARCHAR NOT NULL REFERENCES deck(_id),
            templateId  VARCHAR REFERENCES template(_id),
            noteId      VARCHAR REFERENCES note(_id),
            front       VARCHAR NOT NULL,
            back        VARCHAR,
            mnemonic    VARCHAR,
            srsLevel    INTEGER,
            nextReview  VARCHAR,
            /* tag */
            created     VARCHAR,
            modified    VARCHAR,
            stat        VARCHAR /* JSON */
        );

        CREATE TABLE IF NOT EXISTS tag (
            _id     VARCHAR PRIMARY KEY,
            name    VARCHAR UNIQUE NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cardTag (
            cardId  VARCHAR NOT NULL REFERENCES card(_id) ON DELETE CASCADE,
            tagId   VARCHAR NOT NULL REFERENCES tag(_id) ON DELETE CASCADE,
            PRIMARY KEY (cardId, tagId)
        );`)
    }

    public sql: sqlite.Database;
    public userId?: string;  // Stub

    private constructor(sql: sqlite.Database) {
        this.sql = sql;
    }
    
    public async reset() {
        await Promise.all(await this.sql.all(`SELECT name FROM sqlite_master WHERE type='table'`)).map((t) => {
            return this.sql.exec(`DROP TABLE ${t.name}`);
        });
        await SqliteDatabase.build(this.sql);
    }

    public async insertMany(entries: any[]): Promise<string[]> {
        entries = await Promise.all(entries.map((e) => this.transformCreateOrUpdate(null, e)));
        const now = new Date().toISOString();

        let sourceMap: Record<string, string> = {};
        let sourceValidKey = entries.filter((e) => e.sourceH).map((e) => e.sourceH);
        await Promise.all(entries.filter((e, i) => e.sourceH && sourceValidKey.indexOf(e.sourceH) === i).map((e) => {
            return asyncP(async () => {
                const s = await this.sql.get(`SELECT _id FROM source WHERE h = ?`, e.sourceH);
                if (s) {
                    sourceMap[e.sourceH] = s._id;
                } else {
                    const _id = uuid();
                    await this.sql.run(`
                    INSERT INTO source (_id, name, created, h)
                    VALUES (?, ?, ?, ?)`,
                    _id, e.source, e.sourceCreated || now, e.sourceH);

                    sourceMap[e.sourceH] = _id;
                }
            });
        }));

        const tMap: Record<string, string> = {};
        const tValidKey = entries.filter((e) => e.template && e.model).map((e) => `${e.template}\x1f${e.model}`);
        await Promise.all(entries.filter((e, i) => e.template && e.model &&
        tValidKey.indexOf(`${e.template}\x1f${e.model}`) === i).map((e) => {
            return asyncP(async () => {
                const key = `${e.template}\x1f${e.model}`;
                const t = await this.sql.get(`
                SELECT _id FROM template WHERE
                    name = ? AND model = ?`, e.template, e.model);

                if (t) {
                    tMap[key] = t._id!;
                } else {
                    const _id = uuid();
                    await this.sql.run(`
                    INSERT INTO template (_id, name, model, front, back, css, js, sourceId)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    _id, e.template, e.model, e.tFront, e.tBack, e.css, e.js, sourceMap[e.sourceH]);

                    tMap[key] = _id;
                }
            });
        }));

        const nMap: Record<string, string> = {};
        const nValidKey = entries.filter((e) => e.data && e.key).map((e) => e.key);

        await Promise.all(entries.filter((e, i) => e.data && e.key && nValidKey.indexOf(e.key) === i).map((e) => {
            return asyncP(async () => {
                const n = await this.sql.get(`SELECT _id FROM note WHERE key = ?`, e.key);

                if (n) {
                    nMap[e.key] = n._id;
                    return;
                }

                const dataProper: Record<string, any> = {};
                const order: Record<string, number> = {};
                let seq = 1;

                for (const kv of (e.data as IDataSocket[])) {
                    dataProper[kv.key] = kv.value;
                    order[kv.key] = seq;
                    seq++;
                }

                const _id = uuid();

                await this.sql.run(`
                INSERT INTO note (_id, _meta, key, data, sourceId)
                VALUES (?, ?, ?, ?, ?)`,
                _id, JSON.stringify({order}), e.key, JSON.stringify(dataProper), sourceMap[e.sourceH]);

                nMap[e.key] = _id;
            });
        }));

        const dMap: {[key: string]: string} = {};

        for (const d of entries.map((e) => e.deck)) {
            if (!dMap[d]) {
                dMap[d] = await this.getOrCreateDeck(d);
            }
        }

        const tags: string[] = entries.map((e) => e.tag).filter((t) => t).reduce((a, b) => [...a, ...b]);
        await Promise.all(tags.filter((t, i) => tags.indexOf(t) === i).map((t) => {
            return this.sql.run(`
            INSERT INTO tag (_id, name)
            VALUES (?, ?)
            ON CONFLICT DO NOTHING`,
            uuid(), t);
        }));
        const _ids: string[] = [];

        await Promise.all(entries.map((e) => {
            return asyncP(async () => {
                const _id = uuid();
                await this.sql.run(`
                INSERT INTO card (_id, front, back, mnemonic, srsLevel, nextReview, deckId, noteId, templateId, created)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                _id, e.front, e.back, e.mnemonic, e.srsLevel, toString(e.nextReview),
                dMap[e.deck], nMap[e.key], tMap[`${e.template}\x1f${e.model}`], now);

                if (e.tag) {
                    await Promise.all(e.tag.map((t: string) => {
                        return this.sql.run(`
                        INSERT INTO cardTag (cardId, tagId)
                        VALUES (?,
                            (SELECT _id FROM tag WHERE name = ?)
                        )`, _id, t);
                    }));
                }

                _ids.push(_id);
            });
        }));

        return _ids;
    }

    public async parseCond(
        cond: Partial<ISearchParserResult>,
        options: ICondOptions = {}
    ): Promise<IPagedOutput<any>> {
        cond.cond = cond.cond || {};

        if ((!options.fields && !cond.fields) || !options.fields) {
            return {
                data: [],
                count: 0
            };
        }

        const allFields = new Set(options.fields || []);
        for (const f of (cond.fields || [])) {
            allFields.add(f);
        }

        const joinSegments: string[] = [];
        let isNoteJoined = false;

        if (["data", "key", "_meta"].some((k) => allFields.has(k))) {
            joinSegments.push("JOIN note AS n ON n._id = noteId");
            isNoteJoined = true;
        }
        
        if (["deck"].some((k) => allFields.has(k))) {
            joinSegments.push("JOIN deck AS d ON d._id = deckId");
        }
        
        if (["sCreated", "sH", "source"].some((k) => allFields.has(k))) {
            if (!isNoteJoined) {
                joinSegments.push("JOIN note AS n ON n._id = noteId");
            }

            joinSegments.push("JOIN source AS s ON s._id = n.sourceId");
        }
        
        if (["tFront", "tBack", "template", "model", "css", "js"].some((k) => allFields.has(k))) {
            joinSegments.push("JOIN template AS t ON t._id = templateId");
        }

        const selectSegments: string[] = [];

        for (let k of allFields) {
            if (["data", "key", "_meta"].includes(k)) {
                selectSegments.push(`n.${k} AS ${k}`);
            } else if (k === "deck") {
                selectSegments.push(`d.name AS ${k}`);
            } else if (["sCreated", "sH", "source"].includes(k)) {
                if (k === "source") {
                    selectSegments.push(`s.name AS ${k}`)
                } else {
                    selectSegments.push(`s.${k.substr(1).toLocaleLowerCase()} AS ${k}`);
                }
            } else if (["tFront", "tBack", "template", "model", "css", "js"].includes(k)) {
                if (k === "template") {
                    selectSegments.push(`t.name AS ${k}`)
                } else if (["model", "css", "js"].includes(k)) {
                    selectSegments.push(`t.${k} AS ${k}`);
                } else {
                    selectSegments.push(`t.${k.substr(1).toLocaleLowerCase()} AS ${k}`);
                }
            } else if (k !== "tag") {
                selectSegments.push(`   `)
            }
        }

        let q = await this.sql.all(`
        SELECT ${selectSegments.join(",")}
        FROM card AS c
        ${joinSegments.join("\n")}`).map((el) => {
            for (const [k, v] of Object.entries(el)) {
                if (["_meta", "data", "stat"].includes(k)) {
                    el[k] = fromString(v as string);
                }
            }

            return el;
        });

        if (allFields.has("tag")) {
            q = await Promise.all(q.map((el) => {
                return asyncP(async () => {
                    const ts = await this.sql.all(`
                    SELECT t.name AS tName
                    FROM tag AS t
                    INNER JOIN cardTag AS ct ON ct.tagId = t._id
                    INNER JOIN card AS c ON c._id = ct.cardId
                    WHERE c._id = ?`, el._id);

                    el.tag = ts.map((t) => t.tName);
                    return el;
                });
            }));
        };

        q = q.filter(mongoFilter(cond.cond || {}));

        if (cond.is) {
            if (cond.is.has("distinct")) {
                const distinctSet = new Set<string>();
                const items: any[] = [];

                for (const el of q) {
                    if (el.key) {
                        if (!distinctSet.has(el.key)) {
                            items.push(el);
                            distinctSet.add(el.key);
                        }
                    } else {
                        items.push(el);
                    }
                }

                q = shuffle(items);
            }
            
            if (cond.is.has("duplicate")) {
                const frontDict: Record<string, any[]> = {};
                const items: any[] = [];

                for (const el of q) {
                    if (!frontDict[el.front]) {
                        frontDict[el.front] = [];
                    }

                    frontDict[el.front].push(el);
                }

                for (const v of Object.values(frontDict)) {
                    if (v.length > 1) {
                        items.push(...v);
                    }
                }

                q = items;
            }
            
            if (cond.is.has("random")) {
                options.sortBy = "random";
            }
        }

        const count = q.length;
        if (options.sortBy) {
            if (options.sortBy === "random") {
                shuffle(q);
            } else {
                q = q.sort(sorter(options.sortBy, options.desc));
            }
        }

        options.offset = options.offset || 0;
        const end = options.limit ? options.limit + options.offset : undefined;

        return {
            data: q.slice(options.offset || 0, end).map((el) => {
                for (const k of Object.keys(el)) {
                    if (!options.fields!.includes(k)) {
                        delete el[k];
                    }
                }

                return el;
            }),
            count
        };
    }

    public async updateMany(ids: string[], u: any) {
        return await Promise.all(ids.map((id) => this.updateOne(id, u)));
    }

    private async updateOne(cardId: string, u: any) {
        u = await this.transformCreateOrUpdate(cardId, u);

        const updatePromises: Promise<any>[] = [];

        for (const [k, v] of Object.entries(u)) {
            if (k === "deck") {
                updatePromises.push(asyncP(async () => {
                    const deckId = await this.getOrCreateDeck(v as string);
                    await this.sql.run(`
                    UPDATE card
                    SET deckId = ?
                    WHERE _id = ?`, deckId, cardId);
                }));
            } else if (["nextReview", "created", "modified"].includes(k)) {
                updatePromises.push(this.sql.run(`
                UPDATE card
                SET ${k} = ?
                WHERE _id = ?`,
                v ? moment(v as string).toISOString() : null, cardId));
            } else if (["front", "back", "mnemonic", "srsLevel"].includes(k)) {
                updatePromises.push(this.sql.run(`
                UPDATE card
                SET ${k} = ?
                WHERE _id = ?`,
                v, cardId));
            } else if (k === "tag") {
                updatePromises.push(asyncP(async () => {
                    const oldTags = await this.getTags([cardId]);
                    const currentTags = v as string[];
                    const newTags = currentTags.filter((t) => !oldTags.includes(t));
                    const obsoleteTags = oldTags.filter((t) => !currentTags.includes(t));

                    await Promise.all([
                        this.addTags([cardId], newTags),
                        this.removeTags([cardId], obsoleteTags)
                    ]);
                }))
            } else if (["css", "js"].includes(k)) {
                updatePromises.push(this.sql.run(`
                UPDATE note
                SET ${k} = ?
                WHERE _id = (
                    SELECT noteId FROM card WHERE _id = ?
                )`,
                v, cardId));
            } else if (["tFront", "tBack"].includes(k)) {
                updatePromises.push(this.sql.run(`
                UPDATE template
                SET ${k.substr(1).toLocaleLowerCase()} = ?
                WHERE _id = (
                    SELECT templateId FROM card WHERE _id = ?
                )`,
                v, cardId));
            } else if (k.startsWith("data")) {
                updatePromises.push(asyncP(async () => {
                    const c = await this.sql.get(`SELECT noteId FROM card WHERE _id = ?`, cardId);

                    if (c) {
                        let isUpdated = false;
                        if (c.noteId) {
                            const n = await this.sql.get(`SELECT data, _meta FROM note WHERE _id = ?`, c.noteId);
                            if (n) {
                                const data = JSON.parse(n.data || "{}");
                                const _meta = JSON.parse(n._meta || "{}");
                                const max = Math.max(...Object.values(_meta.order) as number[]);
    
                                if (k === "data") {
                                    for (const [k0, v0] of Object.entries(v as Record<string, any>)) {
                                        data[k0] = v0;
    
                                        if (!_meta.order[k0]) {
                                            _meta.order[k0] = max + 1;
                                        }
                                    }
                                } else {
                                    const k0 = k.slice("data.".length);
                                    data[k0] = v;
    
                                    if (!_meta.order[k0]) {
                                        _meta.order[k0] = max + 1;
                                    }
                                }

                                await this.sql.run(`
                                UPDATE note
                                SET
                                    data = ?.
                                    _meta = ?
                                WHERE _id = ?`,
                                JSON.stringify(data), JSON.stringify(_meta), c.noteId);
                            }
                        }
    
                        if (!isUpdated) {
                            const noteId = uuid();
                            await this.sql.run(`
                            INSERT INTO note (_id, _meta, key, data)
                            VALUES (?, ?, ?, ?)`,
                            noteId, JSON.stringify({order: {[k]: 1}}), uuid(), JSON.stringify({[k]: v}));

                            await this.sql.run(`
                            UPDATE card
                            SET noteId = ?
                            WHERE _id = ?`,
                            noteId, cardId);
                        }
                    }
                }));
            }
        }
    }

    public async getTags(ids: string[]): Promise<string[]> {
        const ts = await this.sql.all(`
        SELECT name FROM tag WHERE _id IN (
            SELECT tagId FROM cardTag WHERE cardId IN (${new Array(ids.length).fill("?").join(",")})
        )`, ...ids);

        return ts.map((t) => t.name);
    }

    public async addTags(ids: string[], tags: string[]) {
        await Promise.all(tags.map((t) => {
            return asyncP(async () => {
                await this.sql.run(`
                INSERT INTO tag (_id, name)
                VALUES (?, ?)
                ON CONFLICT DO NOTHING`, uuid(), t);

                await Promise.all(ids.map((id) => {
                    return this.sql.run(`
                    INSERT INTO cardTag (cardId, tagId)
                    VALUES (
                        ?,
                        (SELECT _id FROM tag WHERE name = ?)
                    )
                    ON CONFLICT DO NOTHING`, id, t);
                }));
            });
        }));

        await this.sql.run(`
        UPDATE card
        SET modified = ?
        WHERE _id IN (${new Array(ids.length).fill("?").join(",")})`, new Date().toISOString(), ...ids);
    }

    public async removeTags(ids: string[], tags: string[]) {
        await this.sql.run(`
        DELETE FROM cardTag
        WHERE
            cardId IN (${new Array(ids.length).fill("?").join(",")}) AND
            tagId IN (
                SELECT _id FROM tag WHERE name IN (${new Array(tags.length).fill("?").join(",")})
            )
        `, ...ids, ...tags);

        await this.sql.run(`
        UPDATE card
        SET modified = ?
        WHERE _id IN (${new Array(ids.length).fill("?").join(",")})`, new Date().toISOString(), ...ids);
    }

    public async deleteMany(ids: string[]) {
        await this.sql.run(`DELETE FROM card WHERE _id IN (${new Array(ids.length).fill("?").join(",")})`, ...ids);
    }

    public async render(cardId: string): Promise<any> {
        const r = await this.parseCond({
            cond: {_id: cardId}
        }, {
            limit: 1,
            fields: ["_id", "front", "back", "mnemonic", "tFront", "tBack", "data", "css", "js"]
        });

        const c = r.data[0];
        const {tFront, tBack, data} = c;
        
        if (/@md5\n/.test(c.front)) {
            c.front = ankiMustache(tFront || "", data);
        }

        if (/@md5\n/.test(c.back)) {
            c.back = ankiMustache(tBack || "", data, c.front);
        }

        return c;
    }

    public async markRight(cardId?: string, cardData?: Partial<IDbCard>): Promise<string | null> {
        return await this.createAndUpdateCard(+1, cardId, cardData);
    }

    public async markWrong(cardId?: string, cardData?: Partial<IDbCard>): Promise<string | null> {
        return await this.createAndUpdateCard(-1, cardId, cardData);
    }

    private async createAndUpdateCard(dSrsLevel: number,
            cardId?: string, card?: Partial<IDbCard>): Promise<string | null> {
        if (cardId) {
            card = await this.sql.get(`
            SELECT srsLevel, stat AS _stat
            FROM card WHERE _id = ?`, cardId);
        }

        if (!card) {
            return null;
        }

        if ((card as any)._stat) {
            card.stat = JSON.parse((card as any)._stat);
        }

        let {srsLevel, stat} = card;

        srsLevel = srsLevel || 0;
        const streak = (stat || {} as any).streak || {
            right: 0,
            wrong: 0
        };

        if (dSrsLevel > 0) {
            streak.right++;
        } else if (dSrsLevel < 0) {
            streak.wrong--;
        }

        srsLevel += dSrsLevel;

        if (srsLevel >= srsMap.length) {
            srsLevel = srsMap.length - 1;
        }

        if (srsLevel < 0) {
            srsLevel = 0;
        }

        let nextReview: Date;

        if (dSrsLevel > 0) {
            nextReview = getNextReview(srsLevel);
        } else {
            nextReview = repeatReview();
        }

        (stat || {} as any).streak = streak;

        if (!cardId) {
            cardId = (await this.insertMany([{
                ...card,
                srsLevel,
                stat,
                nextReview
            }]))[0];
        } else {
            await this.updateMany([cardId], {srsLevel, stat, nextReview});
        }

        return cardId!;
    }

    private async transformCreateOrUpdate(cardId: string | null, u: {[key: string]: any} = {}):
    Promise<{[key: string]: any}> {
        let data: Record<string, any> | null = null;
        let front: string = "";

        if (cardId) {
            u.modified = new Date().toISOString();
        } else {
            u.created = new Date().toISOString();
        }

        if (u.front && u.front.startsWith("@template\n")) {
            if (!data) {
                if (cardId) {
                    data = await this.getData(cardId);
                } else {
                    data = u.data || {};
                }
            }

            u.tFront = u.front.substr("@template\n".length);
        }

        if (u.tFront) {
            front = ankiMustache(u.tFront, data);
            u.front = "@md5\n" + SparkMD5.hash(front);
        }

        if (u.back && u.back.startsWith("@template\n")) {
            if (!data) {
                if (cardId) {
                    data = await this.getData(cardId);
                } else {
                    data = u.data || {};
                }
            }

            u.tBack = u.front.substr("@template\n".length);
            if (!front && cardId) {
                front = await this.getFront(cardId);
            }
        }

        if (u.tBack) {
            const back = ankiMustache(u.tBack, data, front);
            u.back = "@md5\n" + SparkMD5.hash(back);
        }

        return u;
    }

    private async getData(cardId: string): Promise<Record<string, any> | null> {
        const c = await this.sql.get(`SELECT noteId, front FROM card WHERE _id = ?`, cardId);
        if (c && c.noteId) {
            const n = await this.sql.get(`SELECT data FROM note WHERE _id = ?`, c.noteId);;
            if (n) {
                return JSON.parse(n.data);
            }
        }

        return null;
    }

    private async getFront(cardId: string): Promise<string> {
        const c = await this.sql.get(`SELECT templateId, front FROM card WHERE _id = ?`, cardId);
        if (c) {
            if (c.front.startsWith("@md5\n") && c.templateId) {
                const [t, data] = await Promise.all([
                    this.sql.get(`SELECT front FROM template WHERE _id = ?`, c.templateId),
                    this.getData(cardId)
                ]);

                if (t) {
                    return ankiMustache(t.front, data);
                }
            }

            return c.front;
        }

        return "";
    }

    private async getOrCreateDeck(deckName: string): Promise<string> {
        const d = await this.sql.get(`SELECT _id FROM deck WHERE name = ?`, deckName);

        if (!d) {
            const _id = uuid();
            await this.sql.run(`INSERT INTO deck (_id, name) VALUES (?, ?)`, _id, deckName);
            return _id;
        }

        return d._id;
    }

    public async close() {
        await this.sql.close();
    }

    public async export(
        deckName: string, reset: boolean = false,
        cb: (p: IProgress) => void
    ) {
        cb({
            text: `Reading database`
        });

        const db = g.db!;
        let deck: IDbDeck[];
        let source: IDbSource[];
        let template: IDbTemplate[];
        let note: IDbNote[];
        let media: IDbMedia[];
        let card: IDbCard[];
        
        if (db instanceof MongoDatabase) {
            const userId = db.userId;

            [
                deck,
                source,
                template,
                note,
                media,
                card
            ] = await Promise.all([
                db.deck.find({userId, 
                    name: deckName ? {$regex: `^${escapeRegExp(deckName)}/?`} : undefined
                }).project({userId: 0}).toArray(),
                db.source.find({userId}).project({userId: 0}).toArray(),
                db.template.find({userId}).project({userId: 0}).toArray(),
                db.note.aggregate([
                    {$match: {userId}},
                    ...(deckName ? [
                        {$lookup: {
                            from: "card",
                            localField: "_id",
                            foreignField: "noteId",
                            as: "c"
                        }},
                        {$unwind: "$c._id"},
                        {$lookup: {
                            from: "deck",
                            localField: "deckId",
                            foreignField: "c._id",
                            as: "d"
                        }},
                        {$match: {"d.name": {$regex: `^${escapeRegExp(deckName)}/?`}}},
                    ] : []),
                    {$project: {userId: 0, c: 0, d: 0}}
                ]).toArray(),
                db.media.find({userId}).project({userId: 0}).toArray(),
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
                    {$project: {userId: 0, d: 0}}
                ]).toArray(),
            ]);
        } else {
            [
                deck,
                source,
                template,
                note,
                media,
                card
            ] = await Promise.all([
                this.sql.all(`SELECT * FROM deck WHERE name = ? OR name LIKE ?`,
                deckName, `${escapeSqlLike(deckName)}/%`),
                this.sql.all(`SELECT * FROM source`),
                this.sql.all(`SELECT * FROM template`),
                this.sql.all(`SELECT
                    n._id AS _id, _meta, sourceId, key, data
                FROM note AS n
                JOIN card AS c ON c.noteId = n._id
                JOIN deck AS d ON d._id = c.deckId
                WHERE d.name = ? OR d.name LIKE ?`,
                deckName, `${escapeSqlLike(deckName)}/%`),
                this.sql.all(`SELECT * FROM media`),
                asyncP(async () => {
                    const cs = await this.sql.all(`SELECT
                        c._id AS _id, deckId, templateId, noteId, front, back, mnemonic, srsLevel,
                        nextReview, created, modified, stat
                    FROM card AS c
                    JOIN deck AS d ON d._id = c.deckId
                    WHERE d.name = ? OR d.name LIKE ?`,
                    deckName, `${escapeSqlLike(deckName)}/%`);

                    await Promise.all(cs.map((c) => {
                        return asyncP(async () => {
                            const ts = await this.sql.all(`
                            SELECT t.name AS tName
                            FROM tag AS t
                            INNER JOIN cardTag AS ct ON ct.tagId = t._id
                            INNER JOIN card AS c ON c._id = ct.cardId
                            WHERE c._id = ?`, c._id);

                            c.tag = ts.map((t) => t.tName);
                        })
                    }))
                })
            ]);
        }

        cb({
            text: `Exporting decks, source and template`,
            max: deck.length
        });

        await Promise.all([
            ...deck.map((d) => {
                return this.sql.run(`
                INSERT INTO deck (_id, name)
                VALUES (?, ?)`,
                d._id, d.name)
            }),
            ...source.map((s) => {
                return this.sql.run(`
                INSERT INTO source (_id, name, h, created)
                VALUES (?, ?, ?, ?)`,
                s._id, s.name, s.h, toString(s.created))
            }),
            ...template.map((t) => {
                return this.sql.run(`
                INSERT INTO template (_id, sourceId, name, model, front, back, css, js)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                t._id, t.sourceId, t.name, t.model, t.front, t.back, t.css, t.js)
            })
        ]);

        let i = 0;

        for (const m of media) {
            cb({
                text: `Exporting media`,
                current: i,
                max: media.length
            });
            i++;

            await this.sql.run(`
            INSERT INTO media (_id, sourceId, name, data, h)
            VALUES (?, ?, ?, ?, ?)`,
            m._id, m.sourceId, m.name, m.data.buffer, m.h);
        }

        let count = note.length;
        let subNote = note.splice(0, 1000);
        i = 0;

        while (subNote.length > 0) {
            cb({
                text: `Exporting notes`,
                current: i,
                max: count
            });

            await Promise.all(subNote.map((n) => {
                return this.sql.run(`
                INSERT INTO note (_id, _meta, sourceId, key, data)`,
                n._id, toString(n._meta), n.sourceId, n.key, toString(n.data));
            }));

            subNote = note.splice(0, 1000);
            i += 1000;
        }

        count = card.length;
        let subCard = card.splice(0, 1000);
        i = 0;

        while (subCard.length > 0) {
            cb({
                text: `Exporting cards`,
                current: i,
                max: count
            });

            await Promise.all(subCard.map((c) => {
                if (reset) {
                    delete c.srsLevel;
                    delete c.nextReview;
                    delete c.stat;
                }
                
                return asyncP(async () => {
                    await this.sql.run(`
                    INSERT INTO card (_id, deckId, templateId, noteId, front, back, mnemonic, srsLevel,
                        nextReview, created, modified, stat)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?)`,
                    c._id, c.deckId, c.templateId, c.noteId, c.front, c.back, c.mnemonic, c.srsLevel,
                        toString(c.nextReview), toString(c.created), toString(c.modified), toString(c.stat));
                    
                    if (c.tag) {
                        await Promise.all(c.tag.map((t: string) => {
                            return this.sql.run(`
                            INSERT INTO cardTag (cardId, tagId)
                            VALUES (?,
                                (SELECT _id FROM tag WHERE name = ?)
                            )`, c._id, t);
                        }));
                    }   
                });
            }));

            subCard = card.splice(0, 1000);
            i += 1000;
        }
    }

    public async import(cb: (p: IProgress) => void) {
        const db = g.db!;
        let userId: string | undefined;

        if (db instanceof MongoDatabase) {
            userId = db.userId;
        }

        const sourceHToId: {[key: string]: string} = {};
        const ss = await this.sql.all("SELECT * FROM source");
        let i = 0;

        for (const s of ss) {
            const {_id, name, h, created} = s;
            cb({
                text: `Creating source: ${name}`,
                current: i,
                max: ss.length
            });

            if (db instanceof MongoDatabase) {
                sourceHToId[h] = (await db.source.findOneAndUpdate({userId, h}, {$setOnInsert: {
                    _id,
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
                _id, name, h, created);

                sourceHToId[h] = (await db.sql.get(`
                SELECT _id FROM source WHERE h = ?`, h))._id;
            }

            i++;
        }

        const deckNameToId: {[key: string]: string} = {};
        const ds = await this.sql.all("SELECT * FROM deck");
        i = 0;

        for (const d of ds) {
            const {_id, name} = d;
            cb({
                text: `Creating deck: ${d}`,
                current: i,
                max: ds.length
            });

            if (db instanceof MongoDatabase) {
                deckNameToId[name] = (await db.deck.findOneAndUpdate({userId, name}, {$setOnInsert: {
                    _id,
                    userId,
                    name
                }}, {upsert: true, returnOriginal: false})).value!._id!;
            } else {
                await db.sql.run(`
                INSERT INTO deck (_id, name)
                VALUES (?, ?)
                ON CONFLICT DO NOTHING`,
                _id, name);

                deckNameToId[name] = (await db.sql.get(`
                SELECT _id FROM deck WHERE name = ?`, name));
            }

            i++;
        }

        const templateKeyToId: {[key: string]: string} = {};
        const ts = await this.sql.get("SELECT * FROM template");
        i = 0

        for (const t of ts) {
            const {_id, name, model, front, back, css, js} = t;
            cb({
                text: `Creating template: ${model ? `${model}/` : ""}${name}`,
                current: i,
                max: ts.length
            });

            const key = `${name}\x1f${model}`;
            if (db instanceof MongoDatabase) {
                templateKeyToId[key] = (await db.template.findOneAndUpdate({userId, name, model}, {$setOnInsert: {
                    userId,
                    _id, name, model, front, back, css, js
                }}, {upsert: true, returnOriginal: false})).value!._id!;
            } else {
                await db.sql.run(`
                INSERT INTO template (_id, name, model, front, back, css, js)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT DO NOTHING`,
                _id, name, model, front, back, css, js);

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
            _id, _meta, key, data,
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
                const {_id, _meta, key, data, sourceH} = n;
                if (keyList.includes(key)) {
                    continue;   
                } else {
                    keyList.push(key);
                }

                if (db instanceof MongoDatabase) {
                    notePromiseList.push(asyncP(async () => {
                        const r = await db.note.findOneAndUpdate({userId, key}, {
                            $setOnInsert: {
                                _id,
                                userId,
                                _meta: fromString(_meta),
                                key,
                                data: fromString(data),
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
                        _id, _meta, key, data, sourceH ? sourceHToId[sourceH] : null)

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
            c._id AS _id, c.front AS front, c.back AS back, mnemonic, srsLevel, nextReview, created, modified, stat,
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
                }))
            }

            i += 1000;
            subList = cs.splice(0, 1000);
        }
    }

    public source = {
        insertOne: async (s: IDbSource) => {
            await this.sql.run(`
            INSERT INTO source (_id, name, h, created)
            VALUES (?, ?, ?, ?)`,
            s._id, s.name, s.h, toString(s.created));
        }
    };

    public media = {
        getOrCreate: async (cond: any, update: any) => {
            const {h} = cond;
            const {_id, sourceId, name, data} = update.$setOnInsert;
            
            await this.sql.run(`
            INSERT INTO media (_id, sourceId, name, data, h)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT DO NOTHING`,
            _id, sourceId, name, data, h);

            return await this.sql.get("SELECT _id FROM media WHERE h = ?");
        },
        findOne: async (cond: any) => {
            return await this.sql.get(`
            SELECT data FROM media WHERE _id = ?`, cond._id);
        }
    };

    public template = {
        insertMany: async (ts: IDbTemplate[]) => {
            await Promise.all(ts.map((t) => {
                return this.sql.run(`
                INSERT INTO template (_id, name, model, front, back, css, js, sourceId)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                t._id, t.name, t.model, t.front, t.back, t.css, t.js, t.sourceId);
            }))
        }
    };
}

export default SqliteDatabase;