import Database, { mongoClient } from "../server/db";

(async () => {
    await mongoClient.connect();

    const db = new Database();
    db.user.insertOne({
        email: process.env.DEFAULT_USER!,
        secret: "wasp-amusing-absolute-mangle-division-jersey-tabby-wrangle-geologist-universal-racism-regulate-enactment"
    });

    mongoClient.close();
})();
