import Database from ".";
import { ObjectID } from "bson";
import MongoSearchParser from "./search-parser";

export class SearchResource {
    private db: Database;
    private searchParser: MongoSearchParser;

    constructor() {
        this.db = new Database();
        this.searchParser = new MongoSearchParser();
    }

    public parse(q?: string) {
        if (!q) {
            return {};
        }
        return this.searchParser.search(q);
    }

    public getQuery(userId: ObjectID, cond: any) {
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
            {$project: {
                deck: "$d.name"
            }},
            {$project: {
                templateName: {$arrayElemAt: [{$split: ["$template", "/"]}, 0]},
                entry: {$arrayElemAt: [{$split: ["$template", "/"]}, 1]},
                deckId: 1,
                front: 1,
                back: 1,
                note: 1,
                tag: 1,
                srsLevel: 1,
                nextReview: 1
            }},
            {$lookup: {
                from: "template",
                localField: "templateName",
                foreignField: "name",
                as: "t"
            }},
            {$unwind: {
                path: "$t",
                preserveNullAndEmptyArrays: true
            }},
            {$lookup: {
                from: "templateData",
                let: { templateId: "$t._id", entry: "$entry" },
                pipeline: [
                    {$match: {$expr: {$and: [
                        {$eq: ["$templateId", "$$templateId"]},
                        {$eq: ["$entry", "$$entry"]}
                    ]}}},
                    {$project: {_id: 0, newRoot: "$data"}},
                    {$replaceRoot: {newRoot: "$newRoot"}}
                ],
                as: "data"
            }},
            {$project: {t: 0}},
            {$match: cond}
        ]);
    }
}

export default SearchResource;
