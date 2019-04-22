import express from "express";
import Database, { mongoClient } from "./db";
import session from "express-session";
import dotenv from "dotenv";
import { Strategy } from "passport-auth0";
import passport from "passport";
import userInViews from "./middleware/userInViews";
import bodyParser from "body-parser";
import authRouter from "./route/auth";
import apiRouter from "./route/api";
import cardRouter from "./route/card";
import deckRouter from "./route/deck";
import quizRouter from "./route/quiz";
import mediaRouter from "./route/media";
import ioRouter from "./route/io";
import rimraf from "rimraf";
dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
app.set("view engine", "ejs");

app.use(session({
    secret: "7wub186Ly2kl3OahEV8eZ0gNxJvQNSTpZXvBJgjdPaI1lgJi3+99CRvNQjdPxx3q",
    cookie: {},
    resave: false,
    saveUninitialized: true
}));

const auth0Strategy = new Strategy(
    {
        domain: process.env.AUTH0_DOMAIN!,
        clientID: process.env.AUTH0_CLIENT_ID!,
        clientSecret: process.env.AUTH0_CLIENT_SECRET!,
        callbackURL:
            process.env.AUTH0_CALLBACK_URL || `http://localhost:${port}/callback`
    },
    (accessToken, refreshToken, extraParams, profile, done) => {
        // accessToken is the token to call Auth0 API (not needed in the most cases)
        // extraParams.id_token has the JSON Web Token
        // profile has all the information from the user
        return done(null, profile);
    }
);
passport.use(auth0Strategy);

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((user, done) => {
    done(null, user);
});

app.use(express.static("public"));
app.use(express.static("dist"));

app.use(userInViews());
app.use(authRouter);
app.use(bodyParser.json());
app.use("/api", apiRouter);
app.use("/card", cardRouter);
app.use("/deck", deckRouter);
app.use("/quiz", quizRouter);
app.use("/media", mediaRouter);
app.use("/io", ioRouter);

app.get("/", (req, res) => {
    res.render("layout/min", {
        js: "/index.min.js"
    });
});

app.post("/loginStatus", (req, res) => res.json(req.user));

process.on("SIGINT", () => {
    rimraf.sync("tmp");
});

(async () => {
    await mongoClient.connect();
    await new Database().build();
    app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
})();
