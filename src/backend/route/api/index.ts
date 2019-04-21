import { Router } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import session from "express-session";
import auth, { toAuthJson } from "./auth";
import Database, { IDbUser } from "../../db";
import passport from "passport";
import { Strategy } from "passport-local";
import { ObjectID } from "bson";
import cardApiRouter from "./card";
import connectMongo from "connect-mongodb-session";
import dotenv from "dotenv";
dotenv.config();

const MongoStore = connectMongo(session);

export const router = Router();
router.use(cors());
router.use(bodyParser.json({limit: "50mb"}));
router.use(session({
    secret: "romp-porous-likewise-negligent-conical-paralyze-civil-siesta-precook-reword-unwieldy-natural-cuddly-reggae",
    cookie: { maxAge: 60000 },
    resave: false,
    saveUninitialized: false,
    store: new MongoStore({
        uri: process.env.MONGO_URI!,
        collection: "session"
    })
}));

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

router.use("/card", auth.required, cardApiRouter);

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

    return passport.authenticate("local", { session: false }, (err, user: IDbUser, info) => {
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
