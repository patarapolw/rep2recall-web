import { MongoClient, Db, Collection, ObjectID } from "mongodb";
import dotenv from "dotenv";
import moment from "moment";
dotenv.config();

declare function interfaceKey<T extends object>(): Array<keyof T>;

export const mongoClient = new MongoClient(process.env.MONGO_URI!, { useNewUrlParser: true });

export interface IUser {
    _id?: ObjectID;
    email: string;
    secret: string;
    permission?: any;
}

export interface IDeck {
    _id?: ObjectID;
    userId: ObjectID;
    name: string;
    isOpen?: boolean;
}

export interface ICard {
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
}

export interface ISource {
    _id?: ObjectID;
    userId: ObjectID;
    created: Date;
    name: string;
    h: string;
}

export interface ITemplate {
    _id?: ObjectID;
    sourceId: ObjectID;
    name: string;
    model?: string;
    front: string;
    back?: string;
    css?: string;
}

export interface INote {
    _id?: ObjectID;
    sourceId: ObjectID;
    name: string;
    data: Map<string, string>;
}

export interface IMedia {
    _id?: ObjectID;
    sourceId: ObjectID;
    name: string;
    data: Buffer;
    h: string;
}

export interface IEntry {
    _id?: ObjectID;
    template?: string;
    model?: string;
    entry?: string;
    tFront?: string;
    tBack?: string;
    deck: string;
    front: string;
    back?: string;
    mnemonic?: string;
    srsLevel?: number;
    nextReview?: string | Date;
    tag: string[];
    data?: Map<string, string>;
    sourceId?: ObjectID;
}

export class Database {
    public user: Collection<IUser>;
    public template: Collection<ITemplate>;
    public note: Collection<INote>;
    public card: Collection<ICard>;
    public deck: Collection<IDeck>;
    public media: Collection<IMedia>;
    public source: Collection<ISource>;

    private db: Db;

    constructor() {
        this.db = mongoClient.db("rep2recall");

        this.user = this.db.collection("user");
        this.template = this.db.collection("template");
        this.note = this.db.collection("note");
        this.card = this.db.collection("card");
        this.deck = this.db.collection("deck");
        this.media = this.db.collection("media");
        this.source = this.db.collection("source");
    }

    public async insertMany(userId: ObjectID, entries: IEntry[]): Promise<ObjectID[]> {
        let decks = entries.map((e) => e.deck);
        decks = decks.filter((d, i) => decks.indexOf(d) === i);
        const deckIds = (await Promise.all(decks.map((d) => {
            return this.deck.findOneAndUpdate(
                {userId, name: d},
                {$set: {userId, name: d}},
                {returnOriginal: false, upsert: true}
            );
        }))).map((r) => r.value!._id);

        let sourceId: ObjectID | undefined;
        let templates = entries.filter((e) => e.model && e.template).map((e) => {
            sourceId = e.sourceId!;
            return `${e.template}\x1f${e.model}`;
        });
        templates = templates.filter((t, i) => templates.indexOf(t) === i);
        const templateIds = (await Promise.all((templates.map((t) => {
            const [name, model] = t.split("\x1f");
            return this.template.findOne({sourceId, name, model});
        })))).map((t) => t!._id);

        const noteIds = (await Promise.all(entries.map((e) => {
            const {entry, data} = e;
            if (entry) {
                return this.note.insertOne({
                    sourceId: sourceId!,
                    name: entry!,
                    data: data!
                }) as Promise<any>;
            } else {
                return undefined;
            }
        }))).map((n) => n ? n.insertedId : undefined);

        const cards: ICard[] = entries.map((e, i) => {
            const {deck, nextReview, front, back, mnemonic, srsLevel, tag} = e;
            return {
                userId,
                front, back, mnemonic, srsLevel, tag,
                nextReview: nextReview ? moment(nextReview).toDate() : undefined,
                deckId: deckIds[decks.indexOf(deck)],
                noteId: noteIds[i],
                templateId: e.template && e.model ? templateIds[templates.indexOf(`${e.template}\x1f${e.model}`)] : undefined
            } as ICard;
        });

        const result = await this.card.insertMany(cards);
        const ids = Object.values(result.insertedIds);

        return ids;
    }

    public async update(userId: ObjectID, u: Partial<IEntry>) {
        const c = await this.transformUpdate(userId, u);
        return await this.card.updateOne({_id: u._id}, {$set: c});
    }

    private async transformUpdate(userId: ObjectID, u: Partial<IEntry>): Promise<Partial<ICard>> {
        const output: Partial<ICard> = {};

        for (const k of Object.keys(u)) {
            const v = (u as any)[k];

            if (k === "deck") {
                const r = await this.deck.findOneAndUpdate(
                    {userId, name: v},
                    {$set: {userId, name: v}},
                    {returnOriginal: false, upsert: true}
                );
                delete (u as any)[k];
                output.deckId = r.value!._id;
            } else if (k === "nextReview") {
                output.nextReview = moment(v).toDate();
            } else if (interfaceKey<ICard>().indexOf(k as any) !== -1) {
                (output as any)[k] = v;
            }
        }

        return output;
    }
}

export default Database;
