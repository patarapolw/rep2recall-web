import { Vue, Component, Watch } from "vue-property-decorator";
import h from "hyperscript";
import swal from "sweetalert";
import $ from "jquery";
import TreeviewItem, { ITreeViewItem } from "./TreeviewItem";
import EntryEditor from "../editor/EntryEditor";
import { slowClick, fetchJSON, shuffle, quizDataToContent } from "../util";
import io from "socket.io-client";

import "../layout/quiz/quiz.scss";
import template from "../layout/quiz/quiz.pug";

@Component({
    components: { TreeviewItem, EntryEditor },
    template
})
export default class QuizUi extends Vue {
    private isLoading = true;
    private data: ITreeViewItem[] = [];
    private q = "";
    private progress: any = {};

    private quizIds: number[] = [];
    private currentQuizIndex: number = -1;
    private quizContentPrefix = `
    <script>
    window.addEventListener("keydown", (evt) => {
        const {type, key} = evt;
        parent.$("#quiz-modal").trigger(parent.$.Event(type, {key}));
    });
    </script>`;
    private quizContent = "";
    private quizShownAnswer = false;
    private quizData: any = {};
    private selectedDeck = "";

    get counter() {
        if (this.currentQuizIndex >= 0) {
            return `${(this.currentQuizIndex + 1).toLocaleString()} of ${this.quizIds.length.toLocaleString()}`;
        }

        return  "";
    }

    public mounted() {
        this.getTreeviewData();
        $(document.body).on("keydown", "#quiz-modal", this.keyboardHandler);
    }

    public update() {
        this.getTreeviewData();
    }

    public destroyed() {
        $(document.body).off("keydown", "#quiz-modal", this.keyboardHandler);
    }

    private keyboardHandler(evt: JQuery.KeyDownEvent) {
        const keyControl = {
            toggle() {
                const $toggle = $(".quiz-toggle");
                if ($toggle.length > 0) {
                    slowClick($toggle);
                } else {
                    slowClick($(".quiz-next"));
                }
            },
            previous() {
                slowClick($(".quiz-previous"));
            }
        }

        switch(evt.key) {
            case "Enter":
            case " ": keyControl.toggle(); break;
            case "Backspace": 
            case "ArrowLeft":keyControl.previous(); break;
            case "ArrowRight": slowClick($(".quiz-next")); break;
            case "ArrowUp": slowClick($(".quiz-hide")); break;
            case "ArrowDown": slowClick($(".quiz-show")); break;
            case "1": slowClick($(".quiz-right")); break;
            case "2": slowClick($(".quiz-wrong")); break;
            case "3": slowClick($(".quiz-edit")); break;
            default: console.log(evt.key);
        }
    }

    private onInputKeypress(evt: any) {
        if (evt.key === "Enter") {
            this.getTreeviewData();
        }
    }

    private onQuizShown() {
        this.currentQuizIndex = -1;
        this.quizIds = [];
        this.quizShownAnswer = false;
        this.quizContent = "";
    }

    private async onReview(deck: string, type?: string) {
        this.$bvModal.show("quiz-modal");

        const {ids} = await fetchJSON("/api/quiz/", {deck, q: this.q, type})

        this.quizIds = shuffle(ids);
        this.quizContent = h("div", `${ids.length.toLocaleString()} entries to go...`).outerHTML;
        if (ids.length === 0) {
            const [nextHour, nextDay] = await Promise.all([
                fetchJSON("/api/quiz/", {deck, q: this.q, type, due: "1h"}),
                fetchJSON("/api/quiz/", {deck, q: this.q, type, due: "1d"})
            ]);

            this.quizContent += h("div", [
                h("div", `Pending next hour: ${nextHour.ids.length.toLocaleString()}`),
                h("div", `Pending next day: ${nextDay.ids.length.toLocaleString()}`)
            ]).outerHTML;
        }
    }

    private async onDelete(deck: string): Promise<boolean> {
        const r = await swal({
            text: `Are you sure you want to delete ${deck}?`,
            icon: "warning",
            dangerMode: true,
            buttons: [true, true]
        })

        if (r) {
            const {ids} = await fetchJSON("/api/quiz/", {deck, q: this.q, type: "all"})
            await fetchJSON("/api/editor/", {ids}, "DELETE");
            await swal({
                text: `Deleted ${deck}`,
                icon: "success"
            });
            this.$forceUpdate();
            return true;
        }

        return false;
    }

    private async onQuizPreviousButtonClicked() {
        if (this.currentQuizIndex > 0) {
            this.currentQuizIndex--;
            await this.renderQuizContent();
        }
    }

    private async onQuizNextButtonClicked() {
        if (this.currentQuizIndex < this.quizIds.length - 1) {
            this.currentQuizIndex += 1;
            await this.renderQuizContent();
        } else {
            swal({
                text: "Quiz is done!",
                icon: "success",
                buttons: [true, true]
            }).then((r) => {
                if (r) {
                    this.$bvModal.hide("quiz-modal");
                }
            });
        }
    }

    @Watch("quizShownAnswer")
    private onQuizShowButtonClicked() {
        if (this.quizShownAnswer) {
            this.quizContent = quizDataToContent(this.quizData, "backAndNote");
        } else {
            this.quizContent = quizDataToContent(this.quizData, "front");
        }
    }

    private async onQuizRightButtonClicked() {
        if (this.quizShownAnswer) {
            const id = this.quizIds[this.currentQuizIndex];
            await fetchJSON("/api/quiz/right", {id}, "PUT")
            await this.onQuizNextButtonClicked();
        }
    }

    private async onQuizWrongButtonClicked() {
        if (this.quizShownAnswer) {
            const id = this.quizIds[this.currentQuizIndex];
            await fetchJSON("/api/quiz/wrong", {id}, "PUT")
            await this.onQuizNextButtonClicked();
        }
    }

    private async onEntrySaved(u: any) {
        this.quizData.data = Object.assign(this.quizData.data || {}, u.data || {});
        delete u.data;
        Object.assign(this.quizData, u);
        this.onQuizShowButtonClicked();
    }

    private async getTreeviewData() {
        this.isLoading = true;
        this.data = await fetchJSON("/api/quiz/treeview", {q: this.q});
        this.isLoading = false;
    }

    private async renderQuizContent() {
        this.quizContent = "";
        this.quizShownAnswer = false;
        const id = this.quizIds[this.currentQuizIndex];
        if (id) {
            this.quizData = await fetchJSON("/api/quiz/render", {id});
            this.quizContent = quizDataToContent(this.quizData, "front");
        }
    }

    private onExport(deck: string, reset?: boolean) {
        const ws = io(location.origin);
        let started = false;

        ws.on("connect", () => {
            if (!started) {
                ws.emit("export", {
                    deck,
                    reset
                });
                started = true;
            }
        });

        ws.on("message", (msg: any) => {
            try {
                Vue.set(this, "progress", msg);
                if (this.progress.error || !this.progress.text || this.progress.id) {
                    ws.close();
                }
            } catch (e) {
                console.log(msg);
            }

            if (msg.id) {
                location.href = `/api/io/export?deck=${encodeURIComponent(deck)}&id=${msg.id}`;
            }
        });
    }

    private getProgressPercent() {
        return (this.progress.max ? this.progress.current / this.progress.max * 100 : 100).toFixed(0) + "%";
    }

    private preventHide(e: any) {
        if (this.progress.text && !this.progress.id) {
            e.preventDefault();
        }
    }
}
