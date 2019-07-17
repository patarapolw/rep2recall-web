import passport from "passport";
import { Strategy } from "passport-local";
import expressJwt from "express-jwt";
import { Request } from "express";
import jwt from "jsonwebtoken";
import { g } from "../config";
import MongoDatabase from "../engine/db/mongo";

passport.use(new Strategy({
    usernameField: "email",
    passwordField: "secret"
}, (email, secret, done) => {
    (async () => {
        let userId = "";
        const db = g.db;
        if (db && db instanceof MongoDatabase) {
            const user = await db.user.findOne({email});
            if (user) {
                if (user.secret !== secret) {
                    return done(null, false, {message: "secret is invalid"});
                }
                userId = user._id!;
            } else {
                return done(null, false, {message: "Please create account via the website first"});
            }
        }

        return done(null, userId);
    })().catch(done);
}));

function getTokenFromHeaders(req: Request) {
    const { headers: { authorization } } = req;
    if (authorization && authorization.split(" ")[0] === "Token") {
        return authorization.split(" ")[1];
    }
    return null;
}

const auth = {
    required: expressJwt({
        secret: "secret",
        userProperty: "payload",
        getToken: getTokenFromHeaders
    }),
    optional: expressJwt({
        secret: "secret",
        userProperty: "payload",
        getToken: getTokenFromHeaders,
        credentialsRequired: false
    })
};

export function generateJwt(id: string) {
    const today = new Date();
    const expirationDate = new Date();
    expirationDate.setDate(today.getDate() + 60);

    return jwt.sign({
        id,
        exp: expirationDate.getTime() / 1000
    }, "secret");
}

export function toAuthJson(id: string) {
    return {
        token: generateJwt(id)
    };
}

export default auth;
