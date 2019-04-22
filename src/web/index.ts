import Vue from "vue";
import VueRouter from "vue-router";
import Counter from "./DbEditor/component/Counter";
import SearchBar from "./DbEditor/component/SearchBar";
import "./index.scss";
import Quiz from "./Quiz/Quiz";
import BootstrapVue from "bootstrap-vue";
import "bootstrap";
import CardEditor from "./DbEditor/CardEditor";
import ImportExport from "./ImportExport";
import "./contextmenu";
import Front from "./Front";
import { fetchJSON } from "./util";

Vue.use(VueRouter);
Vue.use(BootstrapVue);

const router = new VueRouter({
    routes: [
        {name: "default", path: "/", component: Front},
        {name: "quiz", path: "/quiz", component: Quiz},
        {name: "cardEditor", path: "/editor", component: CardEditor},
        {name: "importExport", path: "/importExport", component: ImportExport}
    ]
});

const app = new Vue({
    router,
    components: {Counter, SearchBar},
    render(m) {
        return m("div", {class: ["h-100"]}, [
            m("nav", {
                class: ["navbar", "navbar-expand-lg", "navbar-light", "bg-light"]
            }, [
                m("a", {
                    class: ["navbar-brand"],
                    domProps: {href: "#"}
                }, "Rep2Recall"),
                m("button", {
                    class: ["navbar-toggler"],
                    attrs: {
                        "data-target": "#navbarSupportedContent",
                        "data-toggle": "collapse",
                        "type": "button"
                    }
                }, [
                    m("span", {class: "navbar-toggler-icon"})
                ]),
                m("div", {
                    class: ["collapse", "navbar-collapse"],
                    attrs: {id: "navbarSupportedContent"}
                }, [
                    m("ul", {
                        class: ["navbar-nav", "mr-auto"]
                    }, [
                        m("li", {
                            attrs: {
                                disabled: !this.displayName
                            },
                            class: ["nav-item", this.$route.path === "/quiz" ? "active" : ""]
                        }, [
                            m("router-link", {
                                class: ["nav-link"],
                                props: {to: "/quiz", event: !this.displayName ? "" : "click"}
                            }, "Quiz")
                        ]),
                        m("li", {
                            attrs: {
                                disabled: !this.displayName
                            },
                            class: ["nav-item", this.$route.path === "/editor" ? "active" : ""]
                        }, [
                            m("router-link", {
                                class: ["nav-link"],
                                props: {to: "/editor", event: !this.displayName ? "" : "click"}
                            }, "Editor")
                        ]),
                        m("li", {
                            attrs: {
                                disabled: !this.displayName
                            },
                            class: ["nav-item", this.$route.path === "/importExport" ? "active" : ""]
                        }, [
                            m("router-link", {
                                class: ["nav-link"],
                                props: {to: "/importExport", event: !this.displayName ? "" : "click"}
                            }, "Import")
                        ]),
                        m("li", {
                            class: ["nav-item"]
                        }, [
                            m("a", {
                                class: ["nav-link"],
                                domProps: {href: "https://github.com/patarapolw/rep2recall-web"},
                                attrs: {target: "_blank"}
                            }, "About")
                        ]),
                        m(Counter)
                    ]),
                    m("ul", {
                        class: ["navbar-nav"]
                    }, [
                        m(SearchBar),
                        m("button", {
                            class: ["btn", "form-control", "nav-item", "mt-1", "mr-2",
                            this.displayName ? "btn-outline-danger" : "btn-outline-success"],
                            style: {display: typeof this.displayName === "string" ? "none" : "block"},
                            on: {click: () => location.replace(this.displayName ? "/logout" : "/login")}
                        }, this.displayName ? "Logout" : "Login")
                    ])
                ])
            ]),
            m("router-view")
        ]);
    },
    data: {
        displayName: null as any
    },
    methods: {
        async getLoginStatus() {
            const r = (await fetchJSON("/loginStatus"));
            if (typeof r === "object" || typeof r === "string") {
                this.displayName = r.displayName || r;
                if (this.$route.path === "/") {
                    router.push("/quiz");
                }
            } else {
                this.displayName = null;
                if (this.$route.path !== "/") {
                    router.push("/");
                }
            }
        },
        handleRouteChange(route: any) {
            if (this.displayName) {
                this.$router.push(route);
            }
        }
    },
    created() {
        // @ts-ignore
        this.getLoginStatus();
    },
    beforeUpdate() {
        // @ts-ignore
        this.getLoginStatus();
    }
}).$mount("#App");
