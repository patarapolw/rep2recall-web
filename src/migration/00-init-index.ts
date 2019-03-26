import Database, { mongoClient } from "../server/db";

(async () => {
    await mongoClient.connect();

    const db = new Database();

    db.user.createIndex({email: 1}, {unique: true});

    db.template.createIndex({userId: 1, name: 1}, {unique: true});
    db.template.createIndex({userId: 2, front: 2}, {unique: true});

    db.templateData.createIndex({templateId: 1, entry: 1}, {unique: true});

    db.deck.createIndex({userId: 1, name: 1}, {unique: true});

    db.card.createIndex({userId: 1, front: 1}, {unique: true});

    mongoClient.close();
})().catch((e) => console.error(e));
