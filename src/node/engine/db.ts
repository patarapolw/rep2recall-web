import { MongoClient, Db, Collection, ObjectID } from "mongodb";
import { ISearchParserResult } from "./search";
import { srsMap, getNextReview, repeatReview } from "./quiz";
import dotenv from "dotenv";
import { ankiMustache } from "./util";
import SparkMD5 from "spark-md5";
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

export interface INoteDataSocket {
    key: string;
    value: string;
}

export interface IDbNote {
    _id?: ObjectID;
    userId: ObjectID;
    sourceId?: ObjectID;
    key: string;
    data: INoteDataSocket[];
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
        this.db = mongoClient.db("data");

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
                this.note.createIndex({userId: 1, sourceId: 1, key: 1}, {unique: true}),
                this.media.createIndex({userId: 1, h: 1}, {unique: true}),
                // this.card.createIndex({userId: 1, front: 1}, {unique: true}),
            ]);
        } catch (e) {}

        return;
    }

    public async insertMany(userId: ObjectID, entries: any[]): Promise<ObjectID[]> {
        entries = await Promise.all(entries.map((e) => this.transformCreateOrUpdate(userId, null, e)));

        const eValidSource = entries.filter((e) => e.sourceH);
        const now = new Date();

        const sourceId = (Object.values((await this.source.insertMany(eValidSource.filter((e, i) => {
            return eValidSource.map((e1) => e1.sourceH).indexOf(e.sourceH) === i
        }).map((e) => {
            return {
                userId,
                name: e.source,
                created: e.sourceCreated || now,
                h: e.sourceH
            };
        }))).insertedIds))[0];

        const eValidTemplate = entries.filter((e) => e.tFront);
        const tMap0: {[key: string]: number} = {};

        const tMap1 = (await this.template.insertMany(eValidTemplate.map((e, i) => {
            tMap0[`${e.template}\x1f${e.model}`] = i;

            return {
                userId,
                name: e.template,
                model: e.model,
                front: e.tFront,
                back: e.tBack,
                css: e.css,
                js: e.js,
                sourceId: e.sourceId || sourceId
            }
        }))).insertedIds;

        const eValidNote = entries.filter((e) => e.data);
        const nMap0: {[key: string]: number} = {};

        const nMap1 = (await this.note.insertMany(eValidNote.map((e, i) => {
            nMap0[e.key] = i;

            return {
                userId,
                key: e.key,
                data: e.data,
                sourceId: e.sourceId || sourceId
            }
        }))).insertedIds

        const dMap: {[key: string]: ObjectID} = {};
        const decks = entries.map((e) => e.deck);
        const deckIds = await Promise.all(decks.map((d) => this.getOrCreateDeck(userId, d)));
        decks.forEach((d, i) => {
            dMap[d] = deckIds[i];
        });

        return await Object.values((await this.card.insertMany(entries.map((e) => {
            return {
                userId,
                front: e.front,
                back: e.back,
                mnemonic: e.mnemonic,
                srsLevel: e.srsLevel,
                nextReview: e.nextReview,
                deckId: dMap[e.deck],
                noteId: nMap1[nMap0[e.key]],
                templateId: tMap1[tMap0[`${e.template}\x1f${e.model}`]],
                created: now
            }
        }))).insertedIds);
    }

    public async parseCond(
        userId: ObjectID,
        cond: Partial<ISearchParserResult>,
        options: ICondOptions = {}
    ): Promise<IPagedOutput<any>> {
        if (!options.fields || !cond.cond || !cond.fields) {
            return {
                data: [],
                count: 0
            };
        }

        const proj = {
            _id: 1
        } as {[k: string]: 1 | 0};

        if (["data", "key"].some(cond.fields.has)) {
            proj.noteId = 1;
        } else if (["deck"].some(cond.fields.has)) {
            proj.deckId = 1;
        } else if (["sCreated", "sH", "source"].some(cond.fields.has)) {
            proj.sourceId = 1;
        } else if (["tFront", "tBack", "template", "model", "css", "js"].some(cond.fields.has)) {
            proj.templateId = 1;
        }

        for (const f of cond.fields) {
            proj[f] = 1;
        }

        const outputProj = {} as {[k: string]: 1 | 0};

        for (const f of options.fields) {
            proj[f] = 1;
            outputProj[f] = 1;
        }

        let q = this.card.aggregate<any>([
            {$match: {userId}},
            {$project: proj},
            ...(proj.noteId ? [
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
            ...(proj.deck ? [
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
                    localField: "sourceId",
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
                ...proj,
                deck: "$d.name",
                template: "$t.name",
                model: "$t.model",
                tFront: "$t.front",
                tBack: "$t.back",
                css: "$t.css",
                js: "$t.js",
                key: "$n.key",
                data: "$n.data",
                source: "$s.name",
                sH: "$s.h",
                sCreated: "$.created"
            }},
            {$match: cond.cond},
            {$project: {
                ...proj,
                sortBy: (() => {
                    let sortBy = options.sortBy || "deck";
                    if (sortBy.startsWith("@")) {
                        return {data: {$elemMatch: {key: sortBy.substr(1)}}};
                    }
                    return sortBy;
                })()
            }},
            {$sort: {sortBy: options.desc ? -1 : 1}},
            {$project: outputProj}
        ], {allowDiskUse: true});

        const count = (await q.clone().project({_id: 1}).toArray()).length;
        q = q.skip(options.offset || 0);
        
        if (options.limit) {
            q = q.limit(options.limit)
        }

        return {
            data: await q.toArray(),
            count
        };
    }

    public async updateMany(ids: ObjectID[], u: any) {
        return (await this.card.updateMany({_id: {$in: ids}}, {
            $set: {
                modified: new Date(),
                ...u
            }
        })).result;
    }

    public async addTags(ids: string[], tags: string[]) {
        return (await this.card.updateMany({_id: {$in: ids.map((id) => new ObjectID(id))}}, {
            $set: {modified: new Date()},
            $addToSet: {tag: {$each: tags}}
        })).result;
    }

    public async removeTags(ids: string[], tags: string[]) {
        return (await this.card.updateMany({_id: {$in: ids.map((id) => new ObjectID(id))}}, {
            $set: {modified: new Date()},
            $pull: {tag: {$in: tags}}
        })).result;
    }

    public async deleteMany(ids: string[]) {
        return (await this.card.deleteMany({_id: {$in: ids.map((id) => new ObjectID(id))}})).result;
    }

    public async renderFromId(userId: ObjectID, cardId: string): Promise<any> {
        const c = await this.parseCond(userId, {
            cond: {_id: new ObjectID(cardId)},
            fields: new Set(["_id"])
        }, {
            limit: 1,
            fields: ["front", "back"]
        });

        return c.data[0];
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
            await this.updateMany([cardId], {srsLevel, streak, nextReview});
        }

        return cardId!;
    }

    private async transformCreateOrUpdate(userId: ObjectID, cardId: ObjectID | null, u: {[key: string]: any} = {}):
    Promise<{[key: string]: any}> {
        let data: INoteDataSocket[] | null = null;
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

    private async getData(cardId: ObjectID): Promise<INoteDataSocket[] | null> {
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