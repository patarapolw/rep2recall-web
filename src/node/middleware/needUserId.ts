import { Request, Response, NextFunction } from "express";
import Database from "../engine/db";
import { generateSecret } from "../util";
import { ObjectID } from "bson";

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
                    res.locals.userId = new ObjectID(id);
                    return next();
                }
            }

            if (!req.user) {
                return redirect();
            }

            const db = new Database();
            const email = req.user.emails[0].value;
            const user = await db.user.findOne({email});
            let userId: ObjectID;

            if (user) {
                userId = user._id!;
            } else {
                userId = (await db.user.insertOne({
                    email,
                    secret: await generateSecret(),
                    picture: req.user.picture
                })).insertedId
            }

            res.locals.userId = userId;
            return next();
        })().catch(redirect);
    };
}