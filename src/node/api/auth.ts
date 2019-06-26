import { Router } from "express";
import passport from "passport";
import tokenAuth, { toAuthJson } from "../auth/token";
import needUserId from "../middleware/needUserId";
import asyncHandler from "express-async-handler";
import Database from "../engine/db";
import { generateSecret } from "../util";

const router = Router();

router.get("/login", passport.authenticate("auth0", {
    scope: "openid email profile"
}), (req, res) => {
    res.redirect("/");
});

router.post("/token", tokenAuth.optional, (req, res, next) => {
    const {email, secret} = req.body;
    if (!email || !secret) {
        return res.sendStatus(422);
    }

    return passport.authenticate("local", { session: false }, (err, userId, info) => {
        if (err) {
            return next(err);
        }

        if (userId) {
            return res.json(toAuthJson(userId));
        }

        return res.status(400).json(info);
    })(req, res, next);
});

router.post("/getSecret", needUserId(), asyncHandler(async (req, res) => {
    const userId = res.locals.userId;
    const db = new Database();
    const user = await db.user.findOne({_id: userId});

    return res.json({secret: user!.secret});
}));

router.post("/newSecret", needUserId(), asyncHandler(async (req, res) => {
    const userId = res.locals.userId;
    const db = new Database();
    const secret = await generateSecret();

    await db.user.updateOne({_id: userId}, {$set: {secret}});

    return res.json({secret});
}));

router.get("/callback", (req, res, next) => {
    passport.authenticate("auth0", (err, user, info) => {
        if (err) { return next(err); }
        if (!user) { return res.redirect("/"); }
        req.logIn(user, (_err)  => {
            if (_err) { return next(_err); }
            res.locals.user = req.user;
            delete req.session!.returnTo;
            
            const {NODE_ENV, DEV_SERVER_PORT} = process.env;
            if (NODE_ENV === "development" && DEV_SERVER_PORT) {
                res.redirect(`http://localhost:${DEV_SERVER_PORT}`)
            } else {
                res.redirect("/");
            }
        });
    })(req, res, next);
});

router.get("/profile", tokenAuth.optional, (req, res) => {
    if (req.user) {
        const {displayName, picture} = req.user;
        return res.json({
            name: displayName,
            picture
        });
    } else {
        return res.json(null);
    }
});

router.get("/logout", (req, res) => {
    req.logout();
    res.redirect("/");
});

export default router;