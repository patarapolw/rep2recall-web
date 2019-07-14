import { Vue, Component, Watch } from "vue-property-decorator";
import h from "hyperscript";
import swal from "sweetalert";
import toastr from "toastr";
import flatpickr from "flatpickr";
import DatetimeNullable from "./DatetimeNullable";
import EntryEditor from "./EntryEditor";
import { Columns, DateFormat } from "../shared";
import { dotGetter, fetchJSON, quizDataToContent, fixData } from "../util";

import "../layout/editor/editor.scss";
import template from "../layout/editor/editor.pug";

@Component({
    components: {DatetimeNullable, EntryEditor},
    template
})
export default class EditorUi extends Vue {
    private q = "";
    private offset = 0;
    private limit = 10;
    private count = 0;
    private sortBy = "deck";
    private desc = false;
    private data: any[] = [];
    private checkedIds: Set<number> = new Set();
    private allCardsSelected = false;
    private isLoading = false;

    private readonly colWidths = {
        checkbox: 50,
        extra: 250
    }

    public mounted() {
        this.fetchData();
    }

    get editorLabel() {
        const from = this.count === 0 ? 0 : this.offset + 1;
        let to = this.offset + this.data.length;
        if (to < from) {
            to = from;
        }

        return `${from.toLocaleString()}-${to.toLocaleString()} of ${this.count.toLocaleString()}`;
    }

    get tableCols() {
        const cols = Columns.slice();
        const extraCols: string[] = [];

        for (const d of this.data) {
            if (d._meta && d._meta.order) {
                for (const it of Object.keys(d._meta.order)) {
                    if (!it.startsWith("_")) {
                        if (!extraCols.includes(it)) {
                            extraCols.push(it);
                        }
                    }
                }
            }
        }

        if (extraCols.length > 0) {
            cols.push(...[
                {
                    name: "source",
                    label: "Source"
                },
                {
                    name: "template",
                    label: "Template"
                }
            ]);
        }

        extraCols.forEach((c) => {
            cols.push({
                name: `data.${c}`,
                label: c[0].toLocaleUpperCase() + c.substr(1)
            });
        });

        return cols;
    }

    get tableWidth(): number {
        return (
            this.colWidths.checkbox +
            this.tableCols.map((c) => (c.width || this.colWidths.extra)).reduce((a, v) => a + v));
    }

    private getOrderedDict(d: any): any[][] {
        const output: any[][] = [];
        this.tableCols.forEach((c) => {
            output.push([c.name, dotGetter(d, c.name), c]);
        });

        return output;
    }

    private stringifyDate(d?: string): string {
        return d ? flatpickr.formatDate(new Date(d), DateFormat) : "";
    }

    private toHtmlAndBreak(s?: string): string {
        const div = document.createElement("div");
        div.innerText = s || "";
        return div.innerHTML.replace(/(\_)/g, "$1<wbr/>");
    }

    private async onEntrySaved(update: any) {
        this.reset();
        this.sortBy = this.checkedIds.size > 0 ? "modified" : "created";
        this.desc = true;
        this.fetchData();
    }

    private async deleteCards() {
        const r = await swal({
            text: "Are you sure you want to delete the following cards",
            buttons: [true, true],
            dangerMode: true
        })

        if (r) {
            this.isLoading = true;
            await fetchJSON("/api/editor/", {ids: Array.from(this.checkedIds)}, "DELETE");
            this.fetchData();
        }
    }

    private async changeDeck() {
        const deck = await swal({
            text: "What do you want to rename the deck to?",
            content: {
                element: "input"
            }
        });

        if (deck) {
            this.isLoading = true;
            await fetchJSON("/api/editor/", {
                ids: Array.from(this.checkedIds),
                update: {deck}
            }, "PUT")

            this.fetchData();
        }
    }

    private async editTags(isAdd: boolean) {
        const tags = await swal({
            text: `Please enter tag names you want to ${isAdd ? "add" : "remove"}.`,
            content: {
                element: "input",
                attributes: {
                    placeholder: "Separated by spaces"
                }
            }
        });

        if (tags) {
            this.isLoading = true;
            await fetchJSON(`/api/editor/editTags`, {
                ids: Array.from(this.checkedIds),
                tags: tags.split(" "),
                isAdd
            }, "PUT")

            this.fetchData();
        }
    }

    private onSearchbarKeypress(evt: any) {
        if (evt.key === "Enter") {
            this.fetchData();
        }
    }

    private onCheckboxClicked(evt: any, id?: number) {
        const checkboxMain = this.$refs["checkbox.main"] as HTMLInputElement;

        if (id) {
            const checkboxCurrent = evt.target as HTMLInputElement;
            if (checkboxCurrent.checked) {
                this.checkedIds.add(id);
            } else {
                this.checkedIds.delete(id);
            }
            this.calculateCheckboxMainStatus();
        } else {
            checkboxMain.indeterminate = false;
            if (checkboxMain.checked) {
                this.data.forEach((d) => {
                    this.checkedIds.add(d.id);
                });

                if (this.count > this.limit) {
                    toastr.warning("Do you want to select all cards?", "", {
                        closeButton: true,
                        positionClass: "toast-top-center",
                        closeHtml: h("button", "Select all").outerHTML,
                        onCloseClick: async () => {
                            this.isLoading = true;
                            const {ids} = await fetchJSON("/api/quiz/", {q: this.q, type: "all"});
                            this.checkedIds = new Set(ids);
                            this.allCardsSelected = true;
                            this.isLoading = false;
                        }
                    }).css({
                        width: "400px",
                        "max-width": "400px"
                    });
                }
            } else {
                this.allCardsSelected = false;
                this.checkedIds.clear();
            }
        }

        this.$forceUpdate();
    }

    private onTableHeaderClicked(name: string) {
        if (this.sortBy === name) {
            this.desc = !this.desc
        } else {
            this.sortBy = name
            this.desc = false
        }
    }

    private onTableRowClicked(id: number) {
        const availableIds = new Set(this.data.map((row) => row.id));

        this.checkedIds.forEach((c) => {
            if (!availableIds.has(c)) {
                this.checkedIds.delete(c);
            }
        });

        if (this.checkedIds.has(id)) {
            this.checkedIds.delete(id);
        } else {
            this.checkedIds.add(id);
        }

        this.calculateCheckboxMainStatus();
        this.$forceUpdate();
    }

    private getHtml(data: any, side: "front" | "back" | "note"): string {
        return quizDataToContent(data, side);
    }

    private calculateCheckboxMainStatus() {
        const checkboxMain = this.$refs["checkbox.main"] as HTMLInputElement;
        this.allCardsSelected = false;
        checkboxMain.indeterminate = this.checkedIds.size > 0 && this.checkedIds.size < this.data.length;
    }

    private reset(clearSearchParams: boolean = true) {
        if (clearSearchParams) {
            this.q = "";
            this.offset = 0;
        }

        this.allCardsSelected = false;
        const checkboxMain = this.$refs["checkbox.main"] as HTMLInputElement;
        checkboxMain.indeterminate = false;
        this.checkedIds.clear();
    }

    @Watch("offset")
    @Watch("sortBy")
    @Watch("desc")
    private async fetchData() {
        if (this.offset === Infinity) {
            this.offset = this.count - this.limit;
        } else if (this.offset < 0) {
            this.offset = 0;
        }

        this.isLoading = true;

        const r = await fetchJSON("/api/editor/", {q: this.q, offset: this.offset, limit: this.limit, 
            sortBy: this.sortBy, desc: this.desc});
        
        console.log(r);

        this.data = r.data.map((d: any) => fixData(d));
        this.count = r.count;

        this.reset(false);
        document.getElementById("editorTable")!.scrollIntoView();

        this.isLoading = false;
    }
}
