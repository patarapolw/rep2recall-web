import Database from "../db";
import { ObjectID } from "bson";
import { AggregationCursor } from "mongodb";
import SearchParser from "./MongoQParser";

export class SearchResource {
    private db: Database;
    private parser: SearchParser;

    constructor(anyOf: string[] = ["template", "front", "back", "note", "deck"]) {
        this.db = new Database();
        this.parser = new SearchParser({
            anyOf,
            isString: ["template", "front", "back", "note", "deck", "name", "entry"],
            isDate: ["nextReview"],
            isList: ["tag"]
        });
    }

    public parse(q?: string) {
        return this.parser.parse(q);
    }

    public getQuery(userId: ObjectID, cond: any, options: any[]): AggregationCursor<any> {
        return this.db.card.aggregate([
            {$match: { userId }},
            {$lookup: {
                from: "deck",
                localField: "deckId",
                foreignField: "_id",
                as: "d"
            }},
            {$unwind: "$d"},
            {$lookup: {
                from: "source",
                localField: "sourceId",
                foreignField: "_id",
                as: "s"
            }},
            {$project: {
                id: {$toString: "$_id"},
                template: "$template.name",
                model: "$template.model",
                tFront: "$template.front",
                tBack: "$template.back",
                css: "$template.css",
                entry: "$note.name",
                deck: "$d.name",
                front: 1,
                back: 1,
                mnemonic: 1,
                tag: 1,
                srsLevel: 1,
                nextReview: 1,
                created: 1,
                modified: 1,
                data: "$note.data",
                source: "s.name"
            }},
            {$match: cond},
            ...options
        ], {allowDiskUse: true});
    }
}

export default SearchResource;
