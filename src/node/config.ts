import fs from "fs";

export const g: any = {
    TMP: "tmp"
};

if (!fs.existsSync(g.TMP)) {
    fs.mkdirSync(g.TMP);
}

function cleanup() {
    try {
        g.server.close();
        fs.unlinkSync(g.TMP);
    } catch (e) {}
}

process.on("exit", cleanup);
process.on("SIGINT", cleanup);
