import { MongoClient, Db, Collection, ObjectID } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

export const mongoClient = new MongoClient(process.env.MONGO_URI!, { useNewUrlParser: true });

export interface IUser {
    _id?: ObjectID;
    email: string;
    secret: string;
}

export interface ITemplate {
    _id?: ObjectID;
    userId: ObjectID;
    name: string;
    front?: string;
    back?: string;
    note?: string;
}

export interface ITemplateData {
    _id?: ObjectID;
    templateId: ObjectID;
    entry: string;
    data: any;
}

export interface ICard {
    _id?: ObjectID;
    userId: ObjectID;
    deckId: ObjectID;
    template?: string;
    front: string;
    back?: string;
    note?: string;
    tag?: string[];
    srsLevel: number;
    nextReview: Date;
}

export interface IDeck {
    _id?: ObjectID;
    userId: ObjectID;
    name: string;
}

export class Database {
    public user: Collection<IUser>;
    public template: Collection<ITemplate>;
    public templateData: Collection<ITemplateData>;
    public card: Collection<ICard>;
    public deck: Collection<IDeck>;

    private db: Db;

    constructor() {
        this.db = mongoClient.db("rep2recall");

        this.user = this.db.collection("user");
        this.template = this.db.collection("template");
        this.templateData = this.db.collection("templateData");
        this.card = this.db.collection("card");
        this.deck = this.db.collection("deck");
    }
}

export default Database;
