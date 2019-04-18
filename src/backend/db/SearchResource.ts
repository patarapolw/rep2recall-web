import Database, { IEntry } from "../db";
import { ObjectID } from "bson";
import { AggregationCursor } from "mongodb";

export class SearchResource {
    private db: Database;

    constructor() {
        this.db = new Database();
    }

    public getQuery(userId: ObjectID, cond: any): AggregationCursor<IEntry> {
        const db = new Database();

        return db.card.aggregate([
            {$match: { userId }},
            {$lookup: {
                from: "deck",
                localField: "deckId",
                foreignField: "_id",
                as: "d"
            }},
            {$unwind: "$d"},
            {$lookup: {
                from: "template",
                localField: "templateId",
                foreignField: "_id",
                as: "t"
            }},
            {$unwind: {
                path: "$t",
                preserveNullAndEmptyArrays: true
            }},
            {$lookup: {
                from: "note",
                localField: "noteId",
                foreignField: "_id",
                as: "n"
            }},
            {$unwind: {
                path: "$t",
                preserveNullAndEmptyArrays: true
            }},
            {$project: {
                id: {$toString: "$_id"},
                template: "$t.name",
                model: "$t.model",
                tFront: "$t.front",
                tBack: "$t.back",
                entry: "$n.name",
                deck: "$d.name",
                front: 1,
                back: 1,
                mnemonic: 1,
                tag: 1,
                srsLevel: 1,
                nextReview: 1,
                data: "$n.data"
            }},
            {$match: cond}
        ]);
    }
}

export default SearchResource;
