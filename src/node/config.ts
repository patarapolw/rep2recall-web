import fs from "fs";
import rimraf from "rimraf";
import SocketIO from "socket.io";
import http from "http";
import SqliteDatabase from "./engine/db/sqlite";
import MongoDatabase from "./engine/db/mongo";
import path from "path";
// @ts-ignore
import { AppDirs } from "appdirs";
import dotenv from "dotenv";
dotenv.config();

interface IGlobalVariable {
    tempFolder: string;
    server?: http.Server;
    io?: SocketIO.Server;
    db?: SqliteDatabase | MongoDatabase;
}

export const g: IGlobalVariable = {
    tempFolder: (() => {
        if (process.env.MONGO_URI) {
            return "tmp";
        } else if (process.env.COLLECTION) {
            return path.join(process.env.COLLECTION, "../tmp");
        } else {
            const userDataDir = new AppDirs("rep2recall").userDataDir();
            if (!fs.existsSync(userDataDir)) {
                fs.mkdirSync(userDataDir);
            }

            return path.join(userDataDir, "tmp");
        }
    })()
};

if (!fs.existsSync(g.tempFolder)) {
    fs.mkdirSync(g.tempFolder);
}

function cleanup() {
    try {
        g.server!.close();
        rimraf.sync(g.tempFolder);
    } catch (e) {}
}

process.on("exit", cleanup);
process.on("SIGINT", cleanup);
