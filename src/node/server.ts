import express, { Router } from "express";
import Database, { mongoClient } from "./engine/db";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import session from "express-session";
import passport from "passport";
import cors from "cors";
import connectMongo from "connect-mongodb-session";
import authRouter from "./api/auth";
import editorRouter from "./api/editor";
import ioRouter from "./api/io";
import quizRouter from "./api/quiz";
import "./auth/auth0";
import "./auth/token";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const MongoStore = connectMongo(session);

app.use(session({
    secret: process.env.SECRET_KEY!,
    cookie: { maxAge: 60000 },
    resave: false,
    saveUninitialized: true,
    store: new MongoStore({
        uri: process.env.MONGO_URI!,
        collection: "session"
    })
}));

app.use(passport.initialize());
app.use(passport.session());

app.use(express.static("public"));

const apiRouter = Router();
app.use("/api", apiRouter);

apiRouter.use(bodyParser.json());
apiRouter.use(cors());
apiRouter.use("/auth", authRouter);
apiRouter.use("/editor", editorRouter);
apiRouter.use("/io", ioRouter);
apiRouter.use("/quiz", quizRouter);

(async () => {
    await mongoClient.connect();
    await new Database().build();

    app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
})();
