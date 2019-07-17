import dotenv from "dotenv";
import MongoDatabase from "./mongo";
import SqliteDatabase from "./sqlite";
// @ts-ignore
import { AppDirs } from "appdirs";
import fs from "fs";
import path from "path";
dotenv.config();

export interface IDataSocket {
    key: string;
    value: any;
}

export interface ICondOptions {
    offset?: number;
    limit?: number;
    sortBy?: string;
    desc?: boolean;
    fields?: string[];
}

export interface IPagedOutput<T> {
    data: T[];
    count: number;
}

export async function initDatabase() {
    if (process.env.MONGO_URI) {
        return await MongoDatabase.connect(process.env.MONGO_URI);
    } else if (process.env.COLLECTION) {
        return await SqliteDatabase.connect(process.env.COLLECTION);
    } else {
        const userDataDir = new AppDirs("rep2recall").userDataDir();
        if (!process.env.COLLECTION && !fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir);
        }

        return await SqliteDatabase.connect(path.join(userDataDir, "user.db"));
    }
} 