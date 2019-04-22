// import fetch from "node-fetch";
// import UserDb from "../server/userDb";
// import fs from "fs";

// const secret = JSON.parse(fs.readFileSync("user/secret.json", "utf8"));

// (async () => {
//     const userDb = await UserDb.connect();
//     const cards = userDb.card!.eqJoin(userDb.deck!, "deckId", "$loki", (l, r) => {
//         delete l.$loki;
//         delete l.deckId;
//         return {
//             ...l,
//             deck: r.name
//         };
//     }).data().map((c) => {
//         delete c.$loki;
//         delete c.meta;
//         return c;
//     });

//     console.log(cards);

//     while (cards.length > 0) {
//         console.log(await fetchJSON("http://localhost:5000/api/user/card", {
//             data: cards.splice(0, 50),
//             fromMarkdown: true
//         }));
//     }

//     // console.log(await fetchJSON("http://localhost:5000/api/login", {
//     //     email: secret.email,
//     //     secret: secret.secret
//     // }));
//     userDb.close();
// })();

// async function fetchJSON(url: string, data: any = {}, method?: string): Promise<any> {
//     const res = await fetch(url, {
//         method: method || "POST",
//         headers: {
//             "Authorization": `Token ${secret.token}`,
//             "Content-Type": "application/json; charset=utf-8"
//         },
//         body: JSON.stringify(data)
//     });

//     try {
//         return await res.json();
//     } catch (e) {
//         if (res.status < 300) {
//             return res.status;
//         } else {
//             throw new Error(res.statusText);
//         }
//     }
// }
