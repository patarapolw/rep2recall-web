import expressJwt from "express-jwt";
import { Request } from "express";
import jwt from "jsonwebtoken";

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

export function generateJwt(id: string, email: string) {
    const today = new Date();
    const expirationDate = new Date(today);
    expirationDate.setDate(today.getDate() + 60);

    return jwt.sign({
        email, id,
        exp: expirationDate.getTime() / 1000
    }, "secret");
}

export function toAuthJson(id: string, email: string) {
    return {
        email,
        token: generateJwt(id, email)
    };
}

export default auth;
