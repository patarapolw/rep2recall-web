import { Request, Response, NextFunction } from "express";
import Database from "../db";

export default function() {
    return (req: Request, res: Response, next: NextFunction) => {
        function redirect() {
            req.session!.returnTo = req.originalUrl;
            res.redirect("/login");
        }

        const db = new Database();
        db.user.findOne({email: req.user.emails[0].value}).then((user) => {
            if (user) {
                res.locals.userId = user._id;
                next();
            } else {
                redirect();
            }
        }).catch(redirect);
    };
}
