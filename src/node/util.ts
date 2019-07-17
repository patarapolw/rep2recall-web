import crypto from 'crypto';
import { inspect } from 'util';
import Bluebird from "bluebird";
import moment from "moment";
global.Promise = Bluebird as any;

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

export function escapeSqlLike(s: string) {
    return s.replace(/[[_%]/g, '[$&]');  // $& means the whole matched string
}

export function ankiMustache(s: string, d: Record<string, any> | null, front: string = ""): string {
    if (d === null) {
        d = {};
    }

    s = s.replace(/{{FrontSide}}/g, front.replace(/@html\n/g, ""))

    const keys = new Set<string>();
    for (const [k, v] of Object.entries(d)) {

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

export function shuffle(a: any[]) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export async function asyncP(asyncF: () => Promise<any>): Promise<any> {
    return await new Promise((resolve, reject) => {
        asyncF().then(resolve).catch(reject)
    })
}

export function toString(x: any): string | null {
    if (!x && x !== 0) {
        return null;
    }

    if (x instanceof Date) {
        return x.toISOString();
    } else if (x instanceof Object) {
        return JSON.stringify(x);
    }

    return x.toString();
}

export function fromString(x?: string, isDate: boolean = false): any {
    if (!x) {
        return null;
    }

    if (x[0] === "{" && x[x.length - 1] === "}") {
        return JSON.parse(x);
    }

    if (isDate) {
        try {
            return moment(x).toDate();
        } catch (e) {}
    }

    return x;
}