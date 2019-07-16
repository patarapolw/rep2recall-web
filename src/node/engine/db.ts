import { MongoClient, Db, Collection, ObjectID } from "mongodb";
import { ISearchParserResult } from "./search";
import { srsMap, getNextReview, repeatReview } from "./quiz";
import dotenv from "dotenv";
import SparkMD5 from "spark-md5";
import { ankiMustache } from "../util";
import moment from "moment";
import uuid from "uuid/v4";
dotenv.config();

export const mongoClient = new MongoClient(process.env.MONGO_URI!, { useNewUrlParser: true });

export interface IDbUser {
    _id?: ObjectID;
    email: string;
    secret: string;
    picture: string;
}

export interface IDbDeck {
    _id?: ObjectID;
    userId: ObjectID;
    name: string;
}

export interface IDbSource {
    _id?: ObjectID;
    userId: ObjectID;
    name: string;
    h: string;
    created: Date;
}

export interface IDbTemplate {
    _id?: ObjectID;
    userId: ObjectID;
    sourceId: ObjectID;
    name: string;
    model?: string;
    front: string;
    back?: string;
    css?: string;
    js?: string;
}

export interface IDbNote {
    _id?: ObjectID;
    _meta: {
        order: Record<string, number>;
    };
    userId: ObjectID;
    sourceId?: ObjectID;
    key: string;
    data: Record<string, any>;
}

export interface IDataSocket {
    key: string;
    value: any;
}

export interface IDbMedia {
    _id: string;
    userId: ObjectID;
    sourceId?: ObjectID;
    name: string;
    data: Buffer;
    h: string;
}

export interface IDbCard {
    _id?: ObjectID;
    userId: ObjectID;
    deckId: ObjectID;
    templateId?: ObjectID;
    noteId?: ObjectID;
    front: string;
    back?: string;
    mnemonic?: string;
    srsLevel?: number;
    nextReview?: Date;
    tag?: string[];
    created: Date;
    modified?: Date;
    stat?: {
        streak: {right: number; wrong: number};
    }
}

interface ICondOptions {
    offset?: number;
    limit?: number;
    sortBy?: string;
    desc?: boolean;
    fields?: string[];
}

interface IPagedOutput<T> {
    data: T[];
    count: number;
}

export class Database {
    public user: Collection<IDbUser>;

    public deck: Collection<IDbDeck>;
    public source: Collection<IDbSource>;
    public template: Collection<IDbTemplate>;
    public note: Collection<IDbNote>;
    public media: Collection<IDbMedia>;
    public card: Collection<IDbCard>;

    private db: Db;

    constructor() {
        this.db = mongoClient.db("rep2recall");

        this.user = this.db.collection("user");

        this.deck = this.db.collection("deck");
        this.source = this.db.collection("source");
        this.template = this.db.collection("template");
        this.note = this.db.collection("note");
        this.media = this.db.collection("media");
        this.card = this.db.collection("card");
    }

    public async build() {
        try {
            return await Promise.all([
                this.user.createIndex({email: 1}, {unique: true}),
                this.deck.createIndex({userId: 1, name: 1}, {unique: true}),
                this.source.createIndex({userId: 1, h: 1}, {unique: true}),
                this.template.createIndex({userId: 1, sourceId: 1, name: 1, model: 1}, {unique: true}),
                // this.note.createIndex({userId: 1, sourceId: 1, key: 1}, {unique: true}),
                this.media.createIndex({userId: 1, h: 1}, {unique: true}),
                // this.card.createIndex({userId: 1, front: 1}, {unique: true}),
            ]);
        } catch (e) {}

        return;
    }

    public async reset(userId: ObjectID) {
        await Promise.all([
            this.user.deleteOne({_id: userId}),
            this.deck.deleteMany({userId}),
            this.source.deleteMany({userId}),
            this.template.deleteMany({userId}),
            this.note.deleteMany({userId}),
            this.media.deleteMany({userId}),
            this.card.deleteMany({userId})
        ]);
    }

    public async insertMany(userId: ObjectID, entries: any[]): Promise<ObjectID[]> {
        entries = await Promise.all(entries.map((e) => this.transformCreateOrUpdate(null, e)));
        const now = new Date();

        let sourceMap: Record<string, ObjectID> = {};
        let sourceValidKey = entries.filter((e) => e.sourceH).map((e) => e.sourceH);
        for (const e of entries.filter((e, i) => e.sourceH && sourceValidKey.indexOf(e.sourceH) === i)) {
            const s = await this.source.findOne({h: e.sourceH, userId});
            if (s) {
                sourceMap[e.sourceH] = s._id!;
            } else {
                sourceMap[e.sourceH] = (await this.source.insertOne({
                    userId,
                    name: e.source,
                    created: e.sourceCreated || now,
                    h: e.sourceH
                })).insertedId;
            }
        }

        const tMap: Record<string, ObjectID> = {};
        const tValidKey = entries.filter((e) => e.template && e.model).map((e) => `${e.template}\x1f${e.model}`);

        for (const e of entries.filter((e, i) => e.template && e.model &&
        tValidKey.indexOf(`${e.template}\x1f${e.model}`) === i)) {
            const key = `${e.template}\x1f${e.model}`;
            const t = await this.template.findOne({name: e.template, model: e.model, userId});

            if (t) {
                tMap[key] = t._id!;
            } else {
                tMap[key] = (await this.template.insertOne({
                    userId,
                    name: e.template,
                    model: e.model,
                    front: e.tFront,
                    back: e.tBack,
                    css: e.css,
                    js: e.js,
                    sourceId: sourceMap[e.sourceH]
                })).insertedId;
            }
        }

        const nMap: Record<string, ObjectID> = {};
        const nUpsert: any[] = [];

        for (const e of entries.filter((e) => e.data && e.key)) {
            const data: Record<string, any> = {};
            const order: Record<string, number> = {};
            let seq = 1;

            for (const kv of (e.data as IDataSocket[])) {
                data[kv.key] = kv.value;
                order[kv.key] = seq;
                seq++;
            }

            nUpsert.push(this.note.findOneAndUpdate({userId, key: e.key}, {$setOnInsert: {
                userId,
                _meta: {order},
                key: e.key,
                data,
                sourceId: sourceMap[e.sourceH]
            }}, {upsert: true, returnOriginal: false}));
        }

        (await Promise.all(nUpsert)).map((upsertResult) => {
            nMap[upsertResult.value!.key] = upsertResult.value!._id!;
        })

        const dMap: {[key: string]: ObjectID} = {};

        for (const d of entries.map((e) => e.deck)) {
            if (!dMap[d]) {
                dMap[d] = await this.getOrCreateDeck(userId, d);
            }
        }

        return await Object.values((await this.card.insertMany(entries.map((e) => {
            return {
                userId,
                front: e.front,
                back: e.back,
                mnemonic: e.mnemonic,
                srsLevel: e.srsLevel,
                nextReview: e.nextReview,
                deckId: dMap[e.deck],
                noteId: nMap[e.key],
                templateId: tMap[`${e.template}\x1f${e.model}`],
                created: now,
                tag: e.tag
            }
        }), {ordered: false})).insertedIds);
    }

    public async parseCond(
        userId: ObjectID,
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

        const proj = {} as {[k: string]: 1 | 0};

        if (["data", "key"].some((k) => allFields.has(k))) {
            proj.noteId = 1;
        }
        
        if (["deck"].some((k) => allFields.has(k))) {
            proj.deckId = 1;
        }
        
        if (["sCreated", "sH", "source"].some((k) => allFields.has(k))) {
            proj.sourceId = 1;
        }
        
        if (["tFront", "tBack", "template", "model", "css", "js"].some((k) => allFields.has(k))) {
            proj.templateId = 1;
        }

        for (const f of allFields) {
            proj[f] = 1;
        }

        const outputProj = {id: 1} as {[k: string]: 1 | 0};

        for (const f of options.fields) {
            proj[f] = 1;
            outputProj[f] = 1;
        }

        const collectionSize = await this.card.countDocuments();

        const q = await this.card.aggregate<any>([
            {$match: {userId}},
            {$project: proj},
            ...(proj.noteId || proj.sourceId ? [
                {$lookup: {
                    from: "note",
                    localField: "noteId",
                    foreignField: "_id",
                    as: "n"
                }},
                {$unwind: {
                    path: "$n",
                    preserveNullAndEmptyArrays: true
                }}
            ] : []),
            ...(proj.deckId ? [
                {$lookup: {
                    from: "deck",
                    localField: "deckId",
                    foreignField: "_id",
                    as: "d"
                }},
                {$unwind: {
                    path: "$d",
                    preserveNullAndEmptyArrays: true
                }}
            ] : []),
            ...(proj.sourceId ? [
                {$lookup: {
                    from: "source",
                    localField: "n.sourceId",
                    foreignField: "_id",
                    as: "s"
                }},
                {$unwind: {
                    path: "$s",
                    preserveNullAndEmptyArrays: true
                }}
            ] : []),
            ...(proj.templateId ? [
                {$lookup: {
                    from: "template",
                    localField: "templateId",
                    foreignField: "_id",
                    as: "t"
                }},
                {$unwind: {
                    path: "$t",
                    preserveNullAndEmptyArrays: true
                }}
            ] : []),
            {$project: {
                ...outputProj,
                id: {$toString: "$_id"},
                deck: proj.deckId ? "$d.name" : undefined,
                ...(proj.templateId ? {
                    template: "$t.name",
                    model: "$t.model",
                    tFront: "$t.front",
                    tBack: "$t.back",
                    css: "$t.css",
                    js: "$t.js",
                } : {}),
                ...(proj.noteId ? {
                    key: "$n.key",
                    data: "$n.data",
                    _meta: "$n._meta"
                } : {}),
                ...(proj.sourceId ? {
                    source: "$s.name",
                    sH: "$s.h",
                    sCreated: "$s.created"
                } : {})
            }},
            {$match: cond.cond},
            ...(() => {
                let filter: any[] = [];
                const getGroupStmt = (k0: string) => {
                    return {$group: {_id: `$${k0}`, repeat: {$sum: 1}, data: {$addToSet: (() => {
                        const newProj = {} as any;
    
                        for (const k of Object.keys(outputProj)) {
                            newProj[k] = `$${k}`;
                        }
    
                        return newProj;
                    })() }}};
                }
                const projStmt = (() => {
                    const newProj = {} as any;

                    for (const k of Object.keys(outputProj)) {
                        newProj[k] = `$data.${k}`;
                    }

                    return newProj;
                })();

                if (cond.is) {
                    if (cond.is.has("distinct")) {
                        filter.push(...[
                            {$sample: {size: collectionSize}},
                            getGroupStmt("key"),
                            {$project: {data: {$arrayElemAt: ["$data", 0]}}},
                            {$project: projStmt}
                        ]);
                    }
                    
                    if (cond.is.has("duplicate")) {
                        filter.push(...[
                            getGroupStmt("front"),
                            {$match: {repeat: {$gt: 1}}},
                            {$unwind: "$data"},
                            {$project: projStmt}
                        ]);
                    }
                    
                    if (cond.is.has("random")) {
                        options.sortBy = "random"
                    }
                }

                return filter;
            })(),
            {$facet: {
                data: (() => {
                    let dataFacet: any[] = [{$match: {}}];

                    if (options.sortBy && options.sortBy === "random") {
                        dataFacet.push({$sample: {size: options.limit || collectionSize}});
                    } else {
                        if (options.sortBy) {
                            dataFacet.push({$sort: {[options.sortBy]: options.desc ? -1 : 1}});
                        }

                        if (options.offset) {
                            dataFacet.push({$skip: options.offset});
                        }

                        if (options.limit) {
                            dataFacet.push({$limit: options.limit})
                        }
                    }

                    dataFacet.push({$project: {
                        ...outputProj
                    }});

                    return dataFacet;
                })(),
                count: [
                    {$count: "count"}
                ]
            }}
        ], {allowDiskUse: true}).toArray();

        return {
            data: q[0].data,
            count: q[0].count.length > 0 ? q[0].count[0].count : 0
        };
    }

    public async updateMany(userId: ObjectID, ids: ObjectID[], u: any) {
        return await Promise.all(ids.map((id) => this.updateOne(userId, id, u)));
    }

    private async updateOne(userId: ObjectID, cardId: ObjectID, u: any) {
        u = await this.transformCreateOrUpdate(cardId, u);
        for (const [k, v] of Object.entries(u)) {
            if (k === "deck") {
                const deckId = await this.getOrCreateDeck(userId, v as string);
                await this.card.findOneAndUpdate({_id: cardId}, {$set: {deckId}});
            } else if (["nextReview", "created", "modified"].includes(k)) {
                u[k] = u[k] ? moment(u[k]).toDate() : undefined;
            } else if (["front", "back", "mnemonic", "srsLevel", "tag"].includes(k)) {
                await this.card.findOneAndUpdate({_id: cardId}, {$set: {[k]: v}});
            } else if (["css", "js"].includes(k)) {
                const c = await this.card.findOne({_id: cardId});
                if (c && c.noteId) {
                    await this.note.findOneAndUpdate({_id: c.noteId}, {$set: {[k]: v}});
                }
            } else if (["tFront", "tBack"].includes(k)) {
                const c = await this.card.findOne({_id: cardId});
                if (c && c.templateId) {
                    await this.note.findOneAndUpdate({_id: c.noteId},
                        {$set: {[k.substr(1).toLocaleLowerCase()]: v}});
                }
            } else if (k.startsWith("data")) {
                const c = await this.card.findOne({_id: cardId});
                if (c) {
                    let isUpdated = false;
                    if (c.noteId) {
                        const n = await this.note.findOne({_id: c.noteId})
                        if (n) {
                            const data = n.data;
                            const _meta = n._meta;
                            const max = Math.max(...Object.values(_meta.order));

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

                            await this.note.findOneAndUpdate({_id: c.noteId}, {$set: {data, _meta}});
                        }
                    }

                    if (!isUpdated) {
                        const noteId = (await this.note.insertOne({
                            userId,
                            _meta: {order: {[k]: 1}},
                            key: uuid(),
                            data: {[k]: v}
                        })).insertedId;
                        await this.card.findOneAndUpdate({_id: cardId}, {$set: {noteId}});
                    }
                }
            }
        }
    }

    public async addTags(ids: ObjectID[], tags: string[]) {
        return (await this.card.updateMany({_id: {$in: ids}}, {
            $set: {modified: new Date()},
            $addToSet: {tag: {$each: tags}}
        })).result;
    }

    public async removeTags(ids: ObjectID[], tags: string[]) {
        return (await this.card.updateMany({_id: {$in: ids}}, {
            $set: {modified: new Date()},
            $pull: {tag: {$in: tags}}
        })).result;
    }

    public async deleteMany(ids: string[]) {
        return (await this.card.deleteMany({_id: {$in: ids.map((id) => new ObjectID(id))}})).result;
    }

    public async render(userId: ObjectID, cardId: string): Promise<any> {
        const r = await this.parseCond(userId, {
            cond: {_id: new ObjectID(cardId)}
        }, {
            limit: 1,
            fields: ["front", "back", "mnemonic", "tFront", "tBack", "data", "css", "js"]
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

    public async markRight(userId: ObjectID, cardId?: ObjectID, cardData?: {[k: string]: any}): Promise<ObjectID | null> {
        return await this.createAndUpdateCard(+1, userId, cardId, cardData);
    }

    public async markWrong(userId: ObjectID, cardId?: ObjectID, cardData?: {[k: string]: any}): Promise<ObjectID | null> {
        return await this.createAndUpdateCard(-1, userId, cardId, cardData);
    }

    private async createAndUpdateCard(dSrsLevel: number, userId: ObjectID,
            cardId?: ObjectID, card?: {[k: string]: any}): Promise<ObjectID | null> {
        if (cardId) {
            card = await this.card.findOne({_id: cardId}) || undefined;
        }

        if (!card) {
            return null;
        }

        card.srsLevel = card.srsLevel || 0;
        card.streak = card.streak || {
            right: 0,
            wrong: 0
        };

        if (dSrsLevel > 0) {
            card.streak.right++;
        } else if (dSrsLevel < 0) {
            card.streak.wrong--;
        }

        card.srsLevel += dSrsLevel;

        if (card.srsLevel >= srsMap.length) {
            card.srsLevel = srsMap.length - 1;
        }

        if (card.srsLevel < 0) {
            card.srsLevel = 0;
        }

        if (dSrsLevel > 0) {
            card.nextReview = getNextReview(card.srsLevel);
        } else {
            card.nextReview = repeatReview();
        }

        if (!cardId) {
            cardId = (await this.insertMany(userId, [card]))[0];
        } else {
            const {srsLevel, streak, nextReview} = card;
            await this.updateMany(userId, [cardId], {srsLevel, streak, nextReview});
        }

        return cardId!;
    }

    private async transformCreateOrUpdate(cardId: ObjectID | null, u: {[key: string]: any} = {}):
    Promise<{[key: string]: any}> {
        let data: Record<string, any> | null = null;
        let front: string = "";

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

    private async getData(cardId: ObjectID): Promise<Record<string, any> | null> {
        const c = await this.card.findOne({_id: cardId});
        if (c && c.noteId) {
            const n = await this.note.findOne({_id: c.noteId});
            if (n) {
                return n.data;
            }
        }

        return null;
    }

    private async getFront(cardId: ObjectID): Promise<string> {
        const c = await this.card.findOne({_id: cardId});
        if (c) {
            if (c.front.startsWith("@md5\n") && c.templateId) {
                const t = await this.template.findOne({_id: c.templateId});
                const data = await this.getData(cardId);
                if (t) {
                    return ankiMustache(t.front, data);
                }
            }

            return c.front;
        }

        return "";
    }

    private async getOrCreateDeck(userId: ObjectID, deckName: string): Promise<ObjectID> {
        const d = await this.deck.findOne({userId, name: deckName});
        if (!d) {
            return (await this.deck.insertOne({userId, name: deckName})).insertedId
        }

        return d._id!;
    }
}

export default Database;