import { escapeRegExp } from "../util";
import moment from "moment";
import uuid from "uuid/v4";

export interface ISearchParserResult {
    is: Set<string>;
    sortBy?: string;
    desc: boolean;
    cond: {[key: string]: any};
    fields: Set<string>;
}


export class SearchParser {
    private is: Set<string> = new Set();
    private sortBy?: string;
    private desc = false;
    private fields: Set<string> = new Set();

    private readonly anyOf = new Set(["template", "front", "mnemonic", "entry", "deck", "tag"]);
    private readonly isString = new Set(["template", "front", "back", "mnemonic", "deck", "tag", "entry"]);
    private readonly isDate = new Set(["created", "modified", "nextReview"]);

    public doParse(q: string): ISearchParserResult | null {
        this.is = new Set();
        this.sortBy = undefined;
        this.desc = false;
        this.fields = new Set();

        try {
            return {
                cond: this.parse(q) || {},
                is: this.is,
                sortBy: this.sortBy,
                desc: this.desc,
                fields: this.fields
            };
        } catch (e) {
            return null;
        }
    }

    private parse(q: string): any {
        for (const method of [
            this.removeBrackets,
            this.parseSep(" OR "),
            this.parseSep(" "),
            this.parseNeg,
            this.parseFullExpr,
            this.parsePartialExpr
        ]) {
            try {
                return method.bind(this)(q);
            } catch (e) {}
        }

        throw new Error();
    }

    private removeBrackets(q: string) {
        if (q[0] === "(" && q[q.length - 1] === ")") {
            return this.parse(q.substr(1, q.length - 2));
        }

        throw new Error("Not bracketed");
    }

    private parseSep(sep: string) {
        return (q: string) => {
            const brackets: any = {};

            q = q.replace(/\([^)]+\)/g, (p0) => {
                const id = uuid();
                brackets[id] = p0;
                return id;
            });
            const tokens = q.split(sep);
            tokens.forEach((t, i) => {
                for (const k of Object.keys(brackets)) {
                    tokens[i] = tokens[i].replace(k, brackets[k]);
                }
            });

            if (tokens.length >= 2) {
                const parsedTokens = tokens.map((t) => this.parse(t)).map((t) => t);
                if (parsedTokens.length > 1) {
                    return {[sep === " OR " ? "$or": "$and"]: parsedTokens.map((t) => this.parse(t))};
                } else {
                    return this.parse(parsedTokens[0]);
                }
            }

            throw new Error(`Not separated by '${sep}'`);
        }
    }

    private parseNeg(q: string) {
        if (q[0] === "-") {
            const sb = "-sortBy:";
            if (q.startsWith(sb) && q !== sb) {
                this.sortBy = q.substr(sb.length);
                return {};
            }

            return {$not: this.parse(q.substr(1))};
        }

        throw new Error("Not negative");
    }

    private parseFullExpr(q: string) {
        const m = /^([\w-]+)(:|~|[><]=?|=)([\w-]+|"[^"]+")$/.exec(q);
        if (m) {
            let [_, k, op, v]: any[] = m;

            if (v.length > 2 && v[0] === '"' && v[v.length - 1] === '"') {
                v = v.substr(1, v.length - 2);
            } else {
                const m1 = /^\d+(?:\.\d+)?$/.exec(v);
                if (m1) {
                    v = parseFloat(v);
                }
            }

            if (k === "is") {
                if (v === "due") {
                    k = "nextReview";
                    op = "<=";
                    v = new Date();
                } else if (v === "leech") {
                    k = "srsLevel";
                    op = "=";
                    v = 0;
                } else if (v === "new") {
                    k = "nextReview";
                    op = "=";;
                    v = "NULL";
                } else {
                    this.is.add(v);
                    return {};
                }
            } else if (k === "sortBy") {
                this.sortBy = v;
                return {};
            }

            if (op === ":") {
                if (k === "due" || k === "nextReview") {
                    k = "nextReview";
                    v = "<="
                } else if (k === "created" || k === "modified") {
                    v = "<=";
                }
            }

            if (v === "NULL") {
                v = {$or: [
                    {[k]: {$exists: false}},
                    {[k]: null},
                    {[k]: ""}
                ]};
            }

            if (this.isDate.has(k)) {
                if (v === "NOW") {
                    v = new Date();
                } else if (typeof v === "string") {
                    const m1 = /^([-+]?\\d+)(\\S*)$/.exec(v);
                    if (m1) {
                        try {
                            v = moment().add(parseInt(m1[1]), m1[2] as any).toDate();
                        } catch (e) {}
                    }
                }
            }

            if (op === ":") {
                if (typeof v === "string" || this.isString.has(k)) {
                    v = {$regex: escapeRegExp(v)};
                }
            } else if (op === "~") {
                v = {$regex: v.toString()};
            } else if (op === ">=") {
                v = {$gte: v};
            } else if (op === ">") {
                v = {$gt: v}
            } else if (op === "<=") {
                v = {$lte: v};
            } else if (op === "<") {
                v = {$lt: v};
            }
            
            return this.fitCondToTables(k, v);
        }

        throw new Error("Not full expression");
    }

    private parsePartialExpr(q: string) {
        if (q && q.indexOf(":") === -1) {
            const orCond: any[] = [];

            for (const a of this.anyOf) {
                if (this.isString.has(a)) {
                    orCond.push(this.fitCondToTables(a, {$regex: escapeRegExp(q)}));
                } else {
                    orCond.push(this.fitCondToTables(a, q));
                }
            }

            orCond.push(this.fitCondToTables("data.value", {$regex: escapeRegExp(q)}));
            
            return {$or: orCond};
        }

        throw new Error("Not partial expression");
    }

    private fitCondToTables(k: string, v: any) {
        this.fields.add(k);

        if (k.startsWith("@")) {
            return {data: {$elemMatch: {
                key: k.substr(1),
                value: v
            }}};
        }

        return {[k]: v};
    }
}

export function mongoFilter(cond: any) {
    return (item: any): boolean => {
        for (const k of Object.keys(cond)) {
            if (k[0] === "$") {
                if (k === "$and") {
                    return cond[k].every((x: any) => mongoFilter(x)(item));
                } else if (k === "$or") {
                    return cond[k].some((x: any) => mongoFilter(x)(item));
                } else if (k === "$not") {
                    return !mongoFilter(cond[k])(item);
                }
            } else {
                let itemK;
                if (k[0] === "@") {
                    itemK = dataGetter(item, k.substr(1));
                } else {
                    itemK = dotGetter(item, k);
                }

                if (cond[k] && cond[k].constructor === {}.constructor
                    && Object.keys(cond[k]).some((k0) => k0[0] === "$")) {
                    return (() => {
                        for (const op in Object.keys(cond[k])) {
                            try {
                                if (op === "$regex") {
                                    if (Array.isArray(itemK)) {
                                        return itemK.some(new RegExp(cond[k][op].toString(), "i").test);
                                    } else {
                                        return new RegExp(cond[k][op].toString(), "i").test(itemK);
                                    }
                                } else if (op === "$startswith") {
                                    if (Array.isArray(itemK)) {
                                        return itemK.some((el) => el.startsWith(cond[k][op]));
                                    } else {
                                        return itemK.startsWith(cond[k][op]);
                                    }
                                } else if (op === "$exists") {
                                    return (itemK === null || itemK === undefined || itemK === "") === cond[k][op];
                                } else {
                                    let v = itemK;
                                    let v0 = cond[k][op];
                                    try {
                                        [v, v0] = [parseInt(v), parseInt(v0)];
                                    } catch (e) {}

                                    if (op === "$gte") {
                                        return v >= v0;
                                    } else if (op === "$gt") {
                                        return v > v0;
                                    } else if (op === "$lte") {
                                        return v <= v0;
                                    } else if (op === "$lt") {
                                        return v < v0;
                                    }
                                }
                            } catch (e) {}
                        }
                        return false;
                    })();
                } else if (Array.isArray(itemK)) {
                    if (!itemK.includes(cond[k])) {
                        return false;
                    }
                } else if (itemK !== cond[k]) {
                    return false;
                }
            }
        }

        return true;
    }
}

export function dataGetter(d: any, k: string) {
    k = k.toLocaleLowerCase();

    if (d.data) {
        if (k === "*") {
            return d.data.filter((el: any) => !el.value.startsWith("@nosearch\n")).map((el: any) => el.value);
        } else {
            const v = d.data.filter((el: any) => el.key.toLocaleLowerCase() === k).map((el: any) => el.value);
            return v === undefined ? null : v;
        }
    }

    return null;
}

export function dotGetter(d: any, k: string) {
    let v = d;
    for (const kn of k.split(".")) {
        if (v && v.constructor === {}.constructor) {
            if (kn === "*") {
                v = Object.values(v);
            } else {
                v = v[kn];
                if (v === undefined) {
                    v = {};
                }
            }
        } else if (Array.isArray(v)) {
            try {
                v = v[parseInt(kn)];
                if (v === undefined) {
                    v = null;
                    break;
                }
            } catch (e) {
                v = null;
                break;
            }
        }
    }

    if (v && v.constructor === {}.constructor && Object.keys(v).length === 0) {
        v = null;
    }

    return v;
}