import crypto from "crypto";

crypto.randomBytes(48, (err, b) => {
    console.log(b.toString("base64"));
});
