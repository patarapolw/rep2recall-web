import MongoSearchParser from "../MongoSearchParser";

export const dbEditorState = {
    cardEditor: {
        data: [] as any[],
        sortBy: "deck",
        desc: false
    },
    editor: {
        text: {} as any,
        html: {
            quill: {} as any
        } as any,
        list: {
            valueDict: {} as any
        } as any
    },
    counter: {
        page: {
            offset: 0,
            limit: 10,
            count: 0
        },
        instance: null as any,
        isActive: false,
        addEntry: false,
        canAddEntry: true
    },
    searchBar: {
        q: "",
        instance: null as any,
        isActive: false,
        parser: new MongoSearchParser({
            isString: ["template", "model", "entry", "front", "back", "note", "deck", "name", "entry"],
            isDate: ["nextReview"],
            isList: ["tag"]
        }),
        getCond() {
            return this.parser.parse(this.q);
        }
    }
};

export default dbEditorState;
