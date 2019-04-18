import MongoSearchParser from "../MongoSearchParser";

export const quizState = {
    isQuizShown: false,
    isQuizReady: false,
    isDeckHidden: false,
    q: "",
    currentDeck: "",
    mediaQuery: matchMedia("(max-width: 1000px), (screen and (-webkit-device-pixel-ratio:3)))"),
    parser: new MongoSearchParser({
        anyOf: ["tag"],
        isString: ["template", "model", "entry", "front", "back", "note", "deck", "name", "entry"],
        isDate: ["nextReview"],
        isList: ["tag"]
    }),
    getCond() {
        return this.parser.parse(this.q);
    }
};

export default quizState;
