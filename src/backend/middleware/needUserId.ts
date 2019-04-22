import { Request, Response, NextFunction } from "express";
import Database from "../db";
import crypto from "crypto";

export default function() {
    return (req: Request, res: Response, next: NextFunction) => {
        function redirect() {
            req.session!.returnTo = req.originalUrl;
            res.sendStatus(403);
        }

        if (!req.user && !process.env.DEFAULT_USER) {
            return redirect();
        }

        const db = new Database();
        const email = process.env.DEFAULT_USER || req.user.emails[0].value;
        if (!email) {
            return redirect();
        }

        crypto.randomBytes(48, (err, b) => {
            if (err) {
                redirect();
            }

            const secret = b.toString("base64");

            db.user.findOneAndUpdate(
                {email},
                {
                    $set: {email},
                    $setOnInsert: {secret}
                },
                {returnOriginal: false, upsert: true}
            ).then((r) => {
                if (r.value) {
                    res.locals.userId = r.value._id;
                    return next();
                }
                redirect();
            }).catch(redirect);
        });
    };
}
