import Vue from "vue";
import VueRouter from "vue-router";
import BootstrapVue from "bootstrap-vue";
import "bootstrap";
import $ from "jquery";
import QuizUi from "./quiz/QuizUi";
import "./contextmenu";
import EditorUi from "./editor/EditorUi";
import { slowClick, mobileQuery } from "./util";
import ImportUi from "./import/ImportUi";
import SettingsUi from "./settings/SettingsUi";
import swal from "sweetalert";

import template from "./layout/index.pug";
import "./layout/index.scss";

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
    template,
    data() {
        return {
            profile: null as any,
            isExpanded: false,
            isMobile: mobileQuery.matches
        };
    },
    computed: {
        currentMobile() {
            return mobileQuery.matches;
        }
    },
    async created() {
        window.addEventListener("resize", this.onResize);

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
    beforeDestroy() {
        window.removeEventListener("resize", this.onResize);
    },
    methods: {
        login() { 
            location.href = "/api/auth/login";
         },
        logout() {
            location.href = "/api/auth/logout";
        },
        onResize() {
            this.isMobile = mobileQuery.matches;
        }
    }
}).$mount("#App");
