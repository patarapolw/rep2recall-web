import { Router } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import session from "express-session";
import auth, { toAuthJson } from "./auth";
import Database, { IUser } from "../../db";
import passport from "passport";
import { Strategy } from "passport-local";
import { ObjectID } from "bson";

passport.use(new Strategy({
    usernameField: "email",
    passwordField: "secret"
}, (email, secret, done) => {
    const db = new Database();
    db.user.findOne({email, secret}).then((user) => {
        if (!user) {
            return done(null, false, {message: "email or secret is invalid"});
        }

        return done(null, user);
    }).catch(done);
}));

export const router = Router();
router.use(cors());
router.use(bodyParser.json());
router.use(session({
    secret: "romp-porous-likewise-negligent-conical-paralyze-civil-siesta-precook-reword-unwieldy-natural-cuddly-reggae",
    cookie: { maxAge: 60000 },
    resave: false,
    saveUninitialized: false
}));

router.post("/login", auth.optional, (req, res, next) => {
    const { body: { email, secret } } = req;

    if (!email) {
        return res.status(422).json({
            errors: {
                email: "is required"
            }
        });
    }

    if (!secret) {
        return res.status(422).json({
            errors: {
                secret: "is required"
            }
        });
    }

    return passport.authenticate("local", { session: false }, (err, user: IUser, info) => {
        if (err) {
            return next(err);
        }

        if (user) {
            return res.json(toAuthJson(user._id!.toHexString(), user.email));
        }

        return res.status(400).json(info);
    })(req, res, next);
});

router.get("/current", auth.required, async (req, res) => {
    const { id } = (req as any).payload;

    const db = new Database();
    const u = await db.user.findOne({_id: new ObjectID(id)});
    if (!u) {
        return res.sendStatus(400);
    }

    return res.json({email: u.email});
});

export default router;
