import { INoteDataSocket } from "./db";
import { escapeRegExp } from "../util";

export function ankiMustache(s: string, d: INoteDataSocket[] | null, front: string = ""): string {
    if (d === null) {
        d = [];
    }

    s = s.replace(/{{FrontSide}}/g, front.replace(/@html\n/g, ""))

    const keys = new Set<string>();
    for (const item of d) {
        keys.add(item.key);
        s = s.replace(
            new RegExp(`{{(\\S+:)?${escapeRegExp(item.key)}}}`, "g"),
            item.value.replace(/^@[^\n]+\n/gs, "")
        );
    }

    s = s.replace(/{{#(\S+)}}([^]*){{\1}}/gs, (m, p1, p2) => {
        return keys.has(p1) ? p2 : "";
    });

    s = s.replace(/{{[^}]+}}/g, "");

    return s;
}