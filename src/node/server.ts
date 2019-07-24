import express, { Router } from "express";
import { initDatabase } from "./engine/db";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import session from "express-session";
import passport from "passport";
import cors from "cors";
import connectMongo from "connect-mongodb-session";
import authRouter from "./api/auth";
import editorRouter from "./api/editor";
import quizRouter from "./api/quiz";
import indexRouter from "./api";
import "./auth/auth0";
import "./auth/token";
import http from "http";
import SocketIO from "socket.io";
import { g } from "./config";
import path from "path";

dotenv.config();

const app = express();
const port = process.env.PORT || 7000;
g.server = new http.Server(app);
g.io = SocketIO(g.server, {serveClient: false});

if (process.env.MONGO_URI) {
    const MongoStore = connectMongo(session);
    const sessionMiddleware = session({
        secret: process.env.SECRET_KEY!,
        cookie: { maxAge: 24 * 3600 * 1000 },
        resave: false,
        saveUninitialized: true,
        store: new MongoStore({
            uri: process.env.MONGO_URI!,
            collection: "session"
        })
    });

    app.use(sessionMiddleware);

    app.use(passport.initialize());
    app.use(passport.session());

    g.io.use((socket, next) => {
        sessionMiddleware(socket.request, {} as any, next);
    });
}

app.use(express.static(path.join(__dirname, "../../public")));

const apiRouter = Router();
app.use("/api", apiRouter);

apiRouter.use(bodyParser.json());
apiRouter.use(cors());
apiRouter.use("/auth", authRouter);
apiRouter.use("/editor", editorRouter);
apiRouter.use("/io", require("./api/io").default);
apiRouter.use("/quiz", quizRouter);
apiRouter.use("/", indexRouter);

(async () => {
    g.db = await initDatabase();
    g.server!.listen(port, () => console.log(`Server running on http://localhost:${port}`));
})().catch(console.error);
