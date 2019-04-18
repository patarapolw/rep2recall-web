import { Request, Response, NextFunction } from "express";

export default function() {
    return (req: Request, res: Response, next: NextFunction) => {
        res.locals.user = req.user;
        next();
    };
}
