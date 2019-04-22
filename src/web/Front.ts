import { Vue, Component } from "vue-property-decorator";
import { CreateElement } from "vue";
import dbEditorState from "./DbEditor/shared";

@Component
export default class Front extends Vue {
    public render(m: CreateElement) {
        return m("div", {
            class: ["mt-3", "container", "ml-3", "mr-3", "nav-fixed-content"]
        }, [
            m("div", {class: ["row"]}, "Login to create your interactive quiz."),
            m("img", {
                class: ["mt-3", "row", "mx-auto"],
                domProps: {src: "/screenshots/quiz1.png"}
            }),
            m("img", {
                class: ["mt-3", "row", "mx-auto"],
                domProps: {src: "/screenshots/editor1.png"}
            }),
            m("img", {
                class: ["mt-3", "row", "mx-auto"],
                domProps: {src: "/screenshots/editor2.png"}
            }),
            m("img", {
                class: ["mt-3", "row", "mx-auto"],
                domProps: {src: "/screenshots/import1.png"}
            })
        ]);
    }

    public beforeCreate() {
        dbEditorState.counter.isActive = false;
        dbEditorState.searchBar.isActive = false;
    }
}
