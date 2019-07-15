import crypto from 'crypto';
import { INoteDataSocket } from './engine/db';
import { inspect } from 'util';

export function generateSecret(): Promise<string> {
    return new Promise((resolve, reject) => {
        crypto.randomBytes(48, (err, b) => {
            if (err) {
                return reject(err);
            }
            resolve(b.toString("base64"));
        });
    })
}

export function escapeRegExp(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');  // $& means the whole matched string
}

export function ankiMustache(s: string, d: INoteDataSocket[] | null, front: string = ""): string {
    if (d === null) {
        d = [];
    }

    s = s.replace(/{{FrontSide}}/g, front.replace(/@html\n/g, ""))

    const keys = new Set<string>();
    for (const item of d) {
        const k = item.key;
        const v = item.value;

        keys.add(k);

        if (typeof v === "string") {
            s = s.replace(
                new RegExp(`{{(\\S+:)?${escapeRegExp(k)}}}`, "g"),
                v.replace(/^@[^\n]+\n/gs, "")
            );
        }
    }

    s = s.replace(/{{#(\S+)}}([^]*){{\1}}/gs, (m, p1, p2) => {
        return keys.has(p1) ? p2 : "";
    });

    s = s.replace(/{{[^}]+}}/g, "");

    return s;
}

export interface IProgress {
    text: string;
    current?: number;
    max?: number;
}

export function pp(x: any) {
    console.log(inspect(x, {depth: null, colors: true}));
}

export function normalizeArray(x: any) {
    if (Array.isArray(x)) {
        return x[0];
    }

    return x;
}