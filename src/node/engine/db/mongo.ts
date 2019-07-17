import { MongoClient, Collection } from "mongodb";
import { ISearchParserResult } from "../search";
import { srsMap, getNextReview, repeatReview } from "../quiz";
import SparkMD5 from "spark-md5";
import { ankiMustache } from "../../util";
import moment from "moment";
import uuid from "uuid/v4";
import { IDataSocket, ICondOptions, IPagedOutput } from ".";

export interface IDbUser {
    _id: string;
    email: string;
    secret: string;
    picture: string;
}

export interface IDbDeck {
    _id: string;
    userId: string;
    name: string;
}

export interface IDbSource {
    _id: string;
    userId: string;
    name: string;
    h: string;
    created: Date;
}

export interface IDbTemplate {
    _id: string;
    userId: string;
    sourceId: string;
    name: string;
    model?: string;
    front: string;
    back?: string;
    css?: string;
    js?: string;
}

export interface IDbNote {
    _id: string;
    _meta: {
        order: Record<string, number>;
    };
    userId: string;
    sourceId?: string;
    key: string;
    data: Record<string, any>;
}

export interface IDbMedia {
    _id: string;
    userId: string;
    sourceId?: string;
    name: string;
    data: Buffer;
    h: string;
}

export interface IDbCard {
    _id: string;
    userId: string;
    deckId: string;
    templateId?: string;
    noteId?: string;
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

export class MongoDatabase {
    public static async connect(mongo_uri: string): Promise<MongoDatabase> {
        const client = new MongoClient(mongo_uri!, { useNewUrlParser: true });
        await client.connect();

        const db = client.db("rep2recall");
        const cols = {
            user: db.collection("user"),
            deck: db.collection("deck"),
            source: db.collection("source"),
            template: db.collection("template"),
            note: db.collection("note"),
            media: db.collection("media"),
            card: db.collection("card")
        };

        try {
            await Promise.all([
                cols.user.createIndex({email: 1}, {unique: true}),
                cols.deck.createIndex({userId: 1, name: 1}, {unique: true}),
                cols.source.createIndex({userId: 1, h: 1}, {unique: true}),
                cols.template.createIndex({userId: 1, sourceId: 1, name: 1, model: 1}, {unique: true}),
                // this.note.createIndex({userId: 1, sourceId: 1, key: 1}, {unique: true}),
                cols.media.createIndex({userId: 1, h: 1}, {unique: true}),
                // this.card.createIndex({userId: 1, front: 1}, {unique: true}),
            ]);
        } catch (e) {}

        return new MongoDatabase(cols);
    }

    public user: Collection<IDbUser>;

    public deck: Collection<IDbDeck>;
    public source: Collection<IDbSource>;
    public template: Collection<IDbTemplate>;
    public note: Collection<IDbNote>;
    public media: Collection<IDbMedia>;
    public card: Collection<IDbCard>;

    public userId?: string;

    private constructor(cols: Record<string, Collection>) {
        this.user = cols.user;
        this.deck = cols.deck;
        this.source = cols.source;
        this.template = cols.template;
        this.note = cols.note;
        this.media = cols.media;
        this.card = cols.card;
    }

    public async reset() {
        const userId = this.userId!;

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

    public async insertMany(entries: any[]): Promise<string[]> {
        const userId = this.userId!;

        entries = await Promise.all(entries.map((e) => this.transformCreateOrUpdate(null, e)));
        const now = new Date();

        let sourceMap: Record<string, string> = {};
        let sourceValidKey = entries.filter((e) => e.sourceH).map((e) => e.sourceH);
        for (const e of entries.filter((e, i) => e.sourceH && sourceValidKey.indexOf(e.sourceH) === i)) {
            const s = await this.source.findOne({h: e.sourceH, userId});
            if (s) {
                sourceMap[e.sourceH] = s._id;
            } else {
                const _id = uuid();
                await this.source.insertOne({
                    _id,
                    userId,
                    name: e.source,
                    created: e.sourceCreated || now,
                    h: e.sourceH
                })
                sourceMap[e.sourceH] = _id;
            }
        }

        const tMap: Record<string, string> = {};
        const tValidKey = entries.filter((e) => e.template && e.model).map((e) => `${e.template}\x1f${e.model}`);

        for (const e of entries.filter((e, i) => e.template && e.model &&
        tValidKey.indexOf(`${e.template}\x1f${e.model}`) === i)) {
            const key = `${e.template}\x1f${e.model}`;
            const t = await this.template.findOne({name: e.template, model: e.model, userId});

            if (t) {
                tMap[key] = t._id!;
            } else {
                const _id = uuid();
                await this.template.insertOne({
                    _id,
                    userId,
                    name: e.template,
                    model: e.model,
                    front: e.tFront,
                    back: e.tBack,
                    css: e.css,
                    js: e.js,
                    sourceId: sourceMap[e.sourceH]
                })
                tMap[key] = _id;
            }
        }

        const nMap: Record<string, string> = {};
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

            const _id = uuid();

            nUpsert.push(this.note.findOneAndUpdate({userId, key: e.key}, {$setOnInsert: {
                _id,
                userId,
                _meta: {order},
                key: e.key,
                data,
                sourceId: sourceMap[e.sourceH]
            }}, {upsert: true, returnOriginal: false}));
        }

        (await Promise.all(nUpsert)).map((upsertResult) => {
            nMap[upsertResult.value!.key] = upsertResult.value!._id;
        })

        const dMap: {[key: string]: string} = {};

        for (const d of entries.map((e) => e.deck)) {
            if (!dMap[d]) {
                dMap[d] = await this.getOrCreateDeck(d);
            }
        }

        const _ids: string[] = [];
        const cards: IDbCard[] = [];

        for (const e of entries) {
            const _id = uuid();
            cards.push({
                _id,
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
            });
            _ids.push(_id);
        }

        await this.card.insertMany(cards);
        return _ids;
    }

    public async parseCond(
        cond: Partial<ISearchParserResult>,
        options: ICondOptions = {}
    ): Promise<IPagedOutput<any>> {
        const userId = this.userId!;

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

    public async updateMany(ids: string[], u: any) {
        return await Promise.all(ids.map((id) => this.updateOne(id, u)));
    }

    private async updateOne(cardId: string, u: any) {
        u = await this.transformCreateOrUpdate(cardId, u);
        for (const [k, v] of Object.entries(u)) {
            if (k === "deck") {
                const deckId = await this.getOrCreateDeck(v as string);
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
                        const noteId = uuid();
                        await this.note.insertOne({
                            _id: noteId,
                            userId: this.userId!,
                            _meta: {order: {[k]: 1}},
                            key: uuid(),
                            data: {[k]: v}
                        });
                        await this.card.findOneAndUpdate({_id: cardId}, {$set: {noteId}});
                    }
                }
            }
        }
    }

    public async addTags(ids: string[], tags: string[]) {
        return (await this.card.updateMany({_id: {$in: ids}}, {
            $set: {modified: new Date()},
            $addToSet: {tag: {$each: tags}}
        })).result;
    }

    public async removeTags(ids: string[], tags: string[]) {
        return (await this.card.updateMany({_id: {$in: ids}}, {
            $set: {modified: new Date()},
            $pull: {tag: {$in: tags}}
        })).result;
    }

    public async deleteMany(ids: string[]) {
        return (await this.card.deleteMany({_id: {$in: ids}})).result;
    }

    public async render(cardId: string): Promise<any> {
        const r = await this.parseCond({
            cond: {_id: cardId}
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

    public async markRight(cardId?: string, cardData?: Partial<IDbCard>): Promise<string | null> {
        return await this.createAndUpdateCard(+1, cardId, cardData);
    }

    public async markWrong(cardId?: string, cardData?: Partial<IDbCard>): Promise<string | null> {
        return await this.createAndUpdateCard(-1, cardId, cardData);
    }

    private async createAndUpdateCard(dSrsLevel: number,
            cardId?: string, card?: Partial<IDbCard>): Promise<string | null> {
        const userId = this.userId!;
        
        if (cardId) {
            card = await this.card.findOne({_id: cardId}) || undefined;
        }

        if (!card) {
            return null;
        }

        let srsLevel = card.srsLevel || 0;
        const streak = card.stat && card.stat.streak ? card.stat.streak : {
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

        const stat = card.stat || {} as any;
        stat.streak = streak;

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
        const c = await this.card.findOne({_id: cardId});
        if (c && c.noteId) {
            const n = await this.note.findOne({_id: c.noteId});
            if (n) {
                return n.data;
            }
        }

        return null;
    }

    private async getFront(cardId: string): Promise<string> {
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

    private async getOrCreateDeck(deckName: string): Promise<string> {
        const userId = this.userId!;

        const d = await this.deck.findOne({userId, name: deckName});
        if (!d) {
            const _id = uuid();
            await this.deck.insertOne({_id, userId, name: deckName})
            return _id;
        }

        return d._id!;
    }
}

export default MongoDatabase;