import Loki, { Collection } from "@lokidb/loki";
import { FSStorage } from "@lokidb/fs-storage";
import fs from "fs";
import SearchResource from "../db/SearchResource";
import Database, { IDbSource, IDbMedia, IDbDeck, IDbCard } from "../db";
import { ObjectID } from "bson";
import moment from "moment";
import shortid from "shortid";

FSStorage.register();

export interface IDbLokiCard {
    deckId: number;
    template?: ILokiTemplate;
    note?: ILokiNote;
    sourceId?: number;
    front: string;
    back?: string;
    mnemonic?: string;
    srsLevel?: number;
    nextReview?: Date;
    tag?: string[];
    created?: Date;
    modified?: Date;
}

export interface IDbLokiSource {
    created: Date;
    name: string;
    h: string;
}

export interface IDbLokiMedia {
    guid: string;
    sourceId: number;
    name: string;
    data: Buffer;
    h: string;
}

export interface IDbLokiDeck {
    name: string;
    isOpen?: boolean;
}

export interface ILokiTemplate {
    name: string;
    model?: string;
    front: string;
    back?: string;
    css?: string;
}

export interface ILokiNote {
    name: string;
    data: Map<string, string>;
}

export class LokiDb {
    public static async connect(filename: string): Promise<LokiDb> {
        const loki = new Loki(filename);
        await loki.initializePersistence({
            autoload: fs.existsSync(filename),
            autosave: true,
            autosaveInterval: 4000
        });

        return new LokiDb(loki);
    }

    public loki: Loki;
    public deck: Collection<IDbLokiDeck>;
    public card: Collection<IDbLokiCard>;
    public source: Collection<IDbLokiSource>;
    public media: Collection<IDbLokiMedia>;

    private constructor(loki: Loki) {
        this.loki = loki;

        this.deck = this.loki.getCollection("deck");
        if (this.deck === null) {
            this.deck = this.loki.addCollection("deck", {
                unique: ["name"]
            });
        }

        this.card = this.loki.getCollection("card");
        if (this.card === null) {
            this.card = this.loki.addCollection("card", {
                unique: ["front"]
            });
        }

        this.source = this.loki.getCollection("source");
        if (this.source === null) {
            this.source = this.loki.addCollection("source");
        }

        this.media = this.loki.getCollection("media");
        if (this.media === null) {
            this.media = this.loki.addCollection("media", {
                unique: ["h"]
            });
        }
    }

    /**
     * Done in minimum of four steps: Sources, Media, Decks and Cards.
     * @param userId User Id
     * @param cond filtering of MongoDB
     * @param cb Progress tracker.
     */
    public async fromMongo(userId: ObjectID, cond: any, cb: (s: any) => any) {
        const search = new SearchResource();
        const db = new Database();

        cb({
            text: "Querying MongoDB data"
        });

        const content = await search.getQuery(userId, cond, []).toArray();
        const cardIds = content.map((c) => c._id);

        // Inserting sources

        const dbSources = await db.source.aggregate([
            {$match: {userId}},
            {$lookup: {
                from: "card",
                localField: "$_id",
                foreignField: "$sourceId",
                as: "c"
            }},
            {$unwind: "$c"},
            {$match: {
                "c._id": {$in: cardIds}
            }},
            {$project: {
                _id: 1,
                created: 1,
                name: 1,
                h: 1
            }}
        ]).toArray();

        cb({
            text: "Inserting sources",
            max: dbSources.length
        });

        const sources = this.source.insert(dbSources.map((s) => {
            const {created, name, h} = s;
            return {
                created,
                name,
                h};
        }));

        const sourceIdToLoki = {} as any;
        if (!Array.isArray(sources)) {
            sourceIdToLoki[dbSources[0]._id!.toHexString()] = (sources as any).$loki;
        } else {
            sources.forEach((s, i) => {
                sourceIdToLoki[dbSources[i]._id!.toHexString()] = s.$loki;
            });
        }

        // Inserting media

        const medias = await db.media.find({sourceId: {$in: dbSources.map((s) => s._id)}}).toArray();

        cb({
            text: "Inserting medias",
            max: medias.length
        });

        this.media.insert(medias.map((m) => {
            const {_id, name, data, h, sourceId} = m;
            return {
                guid: _id,
                name,
                data,
                h,
                sourceId: sourceIdToLoki[sourceId.toHexString()]
            };
        }));

        // Inserting Decks

        let deckNames = content.map((c) => c.deck);
        deckNames = deckNames.filter((d, i) => deckNames.indexOf(d) === i);

        cb({
            text: "Inserting Decks",
            max: deckNames.length
        });

        const decks = this.deck.insert(deckNames.map((d) => {
            return {name: d};
        }));

        const deckNameToId = {} as any;
        if (!Array.isArray(decks)) {
            deckNameToId[(decks as any).name] = (decks as any).$loki;
        } else {
            decks.forEach((d) => {
                deckNameToId[d.name] = d.$loki;
            });
        }

        // Inserting cards

        cb({
            text: "Inserting Cards",
            max: content.length
        });

        const lkCards: IDbLokiCard[] = [];
        content.forEach((c) => {
            const {template, model, tFront, tBack, css, entry, deck,
            front, back, mnemonic, tag, srsLevel, nextReview, data, sourceId, created, modified} = c;

            const lkCard: IDbLokiCard = {
                front,
                back,
                mnemonic,
                tag,
                srsLevel,
                nextReview,
                note: {
                    name: entry,
                    data
                },
                template: {
                    name: template,
                    model,
                    front: tFront,
                    back: tBack,
                    css
                },
                deckId: deckNameToId[deck],
                sourceId: sourceIdToLoki[sourceId],
                created,
                modified
            };
            lkCards.push(lkCard);
        });

        this.card.insert(lkCards);
    }

    /**
     * Done in minimum of four steps: Sources, Media, Decks and Cards.
     * @param userId User ID
     * @param cb Progress tracker
     */
    public async toMongo(userId: ObjectID, cb: (s: any) => any) {
        const db = new Database();

        // Importing sources

        const dbSourceIds: number[] = [];
        const dbSources: IDbSource[] = this.source.find().map((s) => {
            const {$loki, name, created, h} = s;
            dbSourceIds.push($loki);
            return {
                userId,
                name,
                created: moment(created).toDate(),
                h
            };
        });

        cb({
            text: "Inserting sources.",
            max: dbSources.length
        });

        const sourceResult = (await db.source.insertMany(dbSources)).insertedIds;

        // Importing media

        const dbMedia: IDbMedia[] = this.media.find().map((m) => {
            const {name, data, h} = m;
            return {
                _id: shortid.generate(),
                sourceId: sourceResult[dbSourceIds.indexOf(m.sourceId)],
                name, data, h
            };
        });

        cb({
            text: "Inserting media.",
            max: dbMedia.length
        });

        await db.media.insertMany(dbMedia);

        // Importing decks

        const dbDeckIds: number[] = [];
        const dbDeck: IDbDeck[] = this.deck.find().map((d) => {
            const {$loki, name, isOpen} = d;
            dbDeckIds.push($loki);
            return {name, isOpen};
        });

        cb({
            text: "Inserting decks.",
            max: dbDeck.length
        });

        const deckResult = (await db.deck.insertMany(dbDeck)).insertedIds;

        // Importing cards

        const dbCard: IDbCard[] = this.card.find().map((c) => {
            const {deckId, template, note, sourceId,
            front, back, mnemonic, tag, nextReview, srsLevel, created, modified} = c;

            return {
                userId,
                sourceId: sourceResult[dbSourceIds.indexOf(sourceId!)],
                deckId: deckResult[dbDeckIds.indexOf(deckId!)],
                template, note, front, back, mnemonic, tag, srsLevel,
                nextReview: moment(nextReview).toDate(),
                created: moment(created).toDate(),
                modified: moment(modified).toDate()
            };
        });

        cb({
            text: "Inserting cards.",
            max: dbCard.length
        });

        await db.card.insertMany(dbCard);
    }
}
