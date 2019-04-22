import { MongoClient, Db, Collection, ObjectID } from "mongodb";
import dotenv from "dotenv";
import moment from "moment";
import crypto from "crypto";
dotenv.config();

declare function interfaceKey<T extends object>(): Array<keyof T>;

export const mongoClient = new MongoClient(process.env.MONGO_URI!, { useNewUrlParser: true });

export interface IDbUser {
    _id?: ObjectID;
    email: string;
    secret: string;
    permission?: any;
}

export interface IDbCard {
    _id?: ObjectID;
    userId: ObjectID;
    deckId: ObjectID;
    template?: ITemplate;
    note?: INote;
    sourceId?: ObjectID;
    front: string;
    back?: string;
    mnemonic?: string;
    srsLevel?: number;
    nextReview?: Date;
    tag?: string[];
    created?: Date;
    modified?: Date;
}

export interface IDbSource {
    _id?: ObjectID;
    userId: ObjectID;
    created: Date;
    name: string;
    h: string;
}

export interface IDbMedia {
    _id?: ObjectID;
    sourceId?: ObjectID;
    name: string;
    data: Buffer;
    h: string;
}

export interface IDbDeck {
    _id?: ObjectID;
    name: string;
    isOpen?: boolean;
}

export interface ITemplate {
    sourceId?: ObjectID;
    name: string;
    model?: string;
    front: string;
    back?: string;
    css?: string;
}

export interface INote {
    sourceId?: ObjectID;
    name: string;
    data: Map<string, string>;
}

export interface IEntry {
    _id?: ObjectID;
    template?: string;
    model?: string;
    entry?: string;
    tFront?: string;
    tBack?: string;
    css?: string;
    deck: string;
    front: string;
    back?: string;
    mnemonic?: string;
    srsLevel?: number;
    nextReview?: string | Date;
    tag?: string[];
    data?: Map<string, string>;
    sourceId?: ObjectID;
}

export class Database {
    public user: Collection<IDbUser>;
    public card: Collection<IDbCard>;
    public media: Collection<IDbMedia>;
    public source: Collection<IDbSource>;
    public deck: Collection<IDbDeck>;

    private db: Db;

    constructor() {
        this.db = mongoClient.db("rep2recall");

        this.user = this.db.collection("user");
        this.card = this.db.collection("card");
        this.media = this.db.collection("media");
        this.source = this.db.collection("source");
        this.deck = this.db.collection("deck");
    }

    public async build() {
        try {
            const secret = await new Promise((resolve, reject) => {
                crypto.randomBytes(48, (err, b) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(b.toString("base64"));
                });
            }) as string;

            if (process.env.DEFAULT_USER) {
                await this.user.insertOne({email: process.env.DEFAULT_USER!, secret});
            }

            return await Promise.all([
                this.user.createIndex({email: 1}, {unique: true}),
                this.deck.createIndex({userId: 1, name: 1}, {unique: true}),
                this.card.createIndex({userId: 1, front: 1}, {unique: true}),
                this.card.createIndex({deckId: 2}),
                this.card.createIndex({templateId: 3}),
                this.card.createIndex({noteId: 4}),
                this.media.createIndex({h: 1}, {unique: true})
            ]);
        } catch (e) {}

        return;
    }

    public async insertMany(userId: ObjectID, entries: IEntry[]): Promise<ObjectID[]> {
        let decks = entries.map((e) => e.deck);
        decks = decks.filter((d, i) => decks.indexOf(d) === i);
        const deckIds = (await Promise.all(decks.map((d, i) => {
            return this.deck.findOneAndUpdate(
                {userId, name: d},
                {
                    $set: {userId, name: d}
                },
                {returnOriginal: false, upsert: true}
            );
        }))).map((r) => r.value!._id);

        const now = new Date();
        const cards: IDbCard[] = entries.map((e, i) => {
            const {deck, nextReview, front, back, mnemonic, srsLevel, tag,
                model, template, tFront, tBack, css, sourceId, entry, data} = e;
            const c: IDbCard = {
                userId,
                front, back, mnemonic, srsLevel, tag,
                nextReview: nextReview ? moment(nextReview).toDate() : undefined,
                deckId: deckIds[decks.indexOf(deck)]!,
                sourceId,
                template: template ? {name: template, model: model!, front: tFront!, back: tBack, css} : undefined,
                note: entry ? {name: entry, data: data!} : undefined,
                created: now
            };

            return c;
        });

        const result = await this.card.insertMany(cards);
        const ids = Object.values(result.insertedIds);

        return ids;
    }

    public async update(userId: ObjectID, u: Partial<IEntry>) {
        const c = await this.transformUpdate(userId, u);
        c.modified = new Date();
        return await this.card.updateOne({_id: u._id}, {$set: c});
    }

    private async transformUpdate(userId: ObjectID, u: Partial<IEntry>): Promise<Partial<IDbCard>> {
        const output: Partial<IDbCard> = {};

        for (const k of Object.keys(u)) {
            const v = (u as any)[k];

            if (k === "deck") {
                const r = await this.deck.findOneAndUpdate(
                    {userId, name: v},
                    {
                        $set: {userId, name: v}
                    },
                    {returnOriginal: false, upsert: true}
                );
                delete (u as any)[k];
                output.deckId = r.value!._id;
            } else if (k === "nextReview") {
                output.nextReview = moment(v).toDate();
            } else if (interfaceKey<IDbCard>().indexOf(k as any) !== -1) {
                (output as any)[k] = v;
            }
        }

        return output;
    }
}

export default Database;
