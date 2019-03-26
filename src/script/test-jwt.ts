import fetch from "node-fetch";

(async () => {
    const r = await fetch("http://localhost:5000/api/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
            email: "email",
            secret: "asdfghjkl;'"
        })
    });

    try {
        console.log(await r.json());
    } catch (e) {
        console.error(r.status);
    }
})().catch((e) => console.error(e));

(async () => {
    const r = await fetch("http://localhost:5000/api/current", {
        headers: {
            Authorization: "Token averylongjwt"
        }
    });

    try {
        console.log(await r.json());
    } catch (e) {
        console.error(r.statusText);
    }
})();
