import Vue from "vue";
import VueRouter from "vue-router";
import "./index.scss";
import BootstrapVue from "bootstrap-vue";
import "bootstrap";
import $ from "jquery";
import h from "hyperscript";
import QuizUi from "./quiz/QuizUi";
import "./contextmenu";
import EditorUi from "./editor/EditorUi";
import { slowClick } from "./util/util";
import ImportUi from "./import/ImportUi";
import SettingsUi from "./settings/SettingsUi";
import swal from "sweetalert";

// @ts-ignore
import VueCodemirror from "vue-codemirror";
import "codemirror/addon/display/autorefresh";
import "codemirror/mode/markdown/markdown";
import "codemirror/mode/css/css";
import "codemirror/mode/javascript/javascript";
import "codemirror/addon/edit/closebrackets";

$(() => {
    // @ts-ignore
    $('.tooltip-enabled').tooltip({trigger: "hover"});
    $(document.body).on("mousedown", "button", (evt) => {
        const $this = $(evt.target);
        $this.prop("disabled", true);
        slowClick($this);
    })
});


Vue.use(VueRouter);
Vue.use(BootstrapVue);
Vue.use(VueCodemirror, {
    options: {
        lineNumbers: true,
        lineWrapping: true,
        autoRefresh: true,
        theme: "base16-light",
        autoCloseBrackets: true
    }
});

const router = new VueRouter({
    routes: [
        {path: "/", component: QuizUi},
        {path: "/quiz", component: QuizUi},
        {path: "/editor", component: EditorUi},
        {path: "/import", component: ImportUi},
        {path: "/settings", component: SettingsUi}
    ]
});

const app = new Vue({
    router,
    template: h(".row.stretched", [
        h("b-nav.nav-left", { attrs: { "vertical": "" } }, [
            h("b-nav-item", { attrs: { to: "/quiz" } }, [
                h("i.far.fa-question-circle.nav-icon", {
                    attrs: {
                        "v-b-tooltip.hover": "",
                        title: "Quiz"
                    }
                })
            ]),
            h("b-nav-item", { attrs: { to: "/editor" } }, [
                h("i.far.fa-edit.nav-icon", {
                    attrs: {
                        "v-b-tooltip.hover": "",
                        title: "Editor"
                    }
                }),
            ]),
            h("b-nav-item", { attrs: { to: "/import" } }, [
                h("i.fas.fa-file-import.nav-icon", {
                    attrs: {
                        "v-b-tooltip.hover": "",
                        title: "Import"
                    }
                }),
            ]),
            h("b-nav-item", { attrs: { to: "/editor" } }, [
                h("i.fas.fa-cog.nav-icon", {
                    attrs: {
                        "v-b-tooltip.hover": "",
                        title: "Settings"
                    }
                }),
            ]),
            h("b-nav-item", { attrs: { href: "https://github.com/patarapolw/rep2recall-web", target: "_blank" } }, [
                h("i.fab.fa-github.nav-icon", {
                    attrs: {
                        "v-b-tooltip.hover": "",
                        title: "GitHub"
                    }
                })
            ]),
            h("b-nav-item", { 
                style: {"margin-top": "auto"},
                attrs: {
                    "v-on:click": "profile ? logout() : login()"
                }
            }, [
                h("i.fas.fa-user.nav-icon", {attrs: {
                    "v-if": "!profile",
                    "v-b-tooltip.hover": "",
                    title: "Click here to Login"
                }}),
                h(".nav-icon", {attrs: {
                    "v-if": "profile",
                    "v-b-tooltip.hover": "",
                    "title": "Click here to Logout"
                }}, [
                    h("img", {attrs: {
                        ":src": "profile.picture"
                    }})
                ])
            ]),
        ]),
        h(".separate-vertical"),
        h(".body", { style: { overflow: "scroll" } }, [
            h("router-view")
        ])
    ]).outerHTML,
    data() {
        return {
            profile: null as any
        };
    },
    async created() {
        try {
            this.profile = await (await fetch("/api/auth/profile")).json()
        } catch (e) {
            this.profile = null;
        }

        if (!this.profile) {
            swal({
                text: "Please login",
                icon: "info"
            }).then(() => {
                location.href = "/api/auth/login";
            });
        }
    },
    methods: {
        login() { 
            location.href = "/api/auth/login";
         },
        logout() {
            location.href = "/api/auth/logout";
        }
    }
}).$mount("#App");
