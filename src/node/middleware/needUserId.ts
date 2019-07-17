import { Request, Response, NextFunction } from "express";
import { generateSecret } from "../util";
import { g } from "../config";
import MongoDatabase from "../engine/db/mongo";
import uuid from "uuid/v4";

export default function() {
    return (req: Request, res: Response, next: NextFunction) => {
        function redirect() {
            req.session!.returnTo = req.originalUrl;
            res.sendStatus(403);
        }

        (async () => {
            if ((req as any).payload) {
                const {id} = (req as any).payload;
                if (id) {
                    g.db!.userId = id;
                    return next();
                }
            }

            if (!process.env.DEFAULT_USER && !req.user) {
                return redirect();
            }

            const db = g.db;
            if (db && db instanceof MongoDatabase) {
                const email = process.env.DEFAULT_USER || req.user.emails[0].value;
                const user = await db.user.findOne({email});
                let userId: string;

                if (user) {
                    userId = user._id!;
                } else {
                    const _id = uuid();
                    await db.user.insertOne({
                        _id,
                        email,
                        secret: await generateSecret(),
                        picture: req.user ? req.user.picture : undefined
                    });
                    userId = _id;
                }

                db.userId = userId;
            }
            
            return next();
        })().catch(redirect);
    };
}