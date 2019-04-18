import { Request, Response, NextFunction } from "express";
import Database from "../db";

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
        return db.user.findOne({email: process.env.DEFAULT_USER || req.user.emails[0].value}).then((user) => {
            if (user) {
                res.locals.userId = user._id;
                next();
            } else {
                redirect();
            }
        }).catch(redirect);
    };
}
