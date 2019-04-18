import { Vue, Component } from "vue-property-decorator";
import m from "hyperscript";
// @ts-ignore
import ndjsonStream from "can-ndjson-stream";

@Component({
    template: m(".container.mt-3", [
        m(".row", [
            m("h3", "Choose Anki file (*.apkg) to import:")
        ]),
        m(".input-group", [
            m(".custom-file", [
                m("input.custom-file-input#importFileInput", {
                    type: "file",
                    accept: ".apkg",
                    attrs: { "v-on:change": "onImportFileChanged" }
                }),
                m("label.custom-file-label", {
                    "for": "importFileInput",
                    "aria-describedby": "importFileButton"
                }, "{{importFile ? importFile.name : 'Choose file'}}")
            ]),
            m(".input-group-append", [
                m("button.btn.btn-outline-success.input-group-text#importFileButton", {
                    attrs: {
                        ":disabled": "!importFile",
                        "v-on:click": "onImportButtonClicked"
                    }
                }, "Upload")
            ])
        ]),
        m("b-modal", {
            attrs: {
                "ref": "uploadModal",
                "hide-footer": true,
                "hide-header-close": true,
                "title": "Uploading",
                "v-on:hide": "preventHide"
            }
        }, [
                m("div", "{{progress.text}}"),
                m(".progress.mt-3", {attrs: {
                    ":style": "{display: progress.max ? 'block': 'none'}"
                }}, [
                    m(".progress-bar.progress-bar-striped.progress-bar-animated", {attrs: {
                        "role": "progressbar",
                        ":aria-valuenow": "progress.value",
                        "aria-valuemin": "0",
                        ":aria-valuemax": "progress.max",
                        ":style": "{width: (progress.value / progress.max * 100) + '%'}"
                    }}, "{{progress.value}} of {{progress.max}}")
                ])
            ])
    ]).outerHTML
})
export default class ImportExport extends Vue {
    private importFile: File | null = null;
    private progress = {
        text: "",
        value: 0,
        max: 0
    };

    private preventHide(e: any) {
        if (this.progress.text) {
            e.preventDefault();
        }
    }

    private onImportFileChanged(e: any) {
        this.importFile = e.target.files[0];
    }

    private onImportButtonClicked() {
        const formData = new FormData();
        formData.append("apkg", this.importFile!);

        (async () => {
            const r = await fetch("/io/import/anki", { method: "POST", body: formData });
            (this.$refs.uploadModal as any).show();
            const reader = ndjsonStream(r.body).getReader();
            let result: any;
            while (!result || !result.done) {
                result = await reader.read();
                const data = result.value;
                this.progress.text = data.status;
                if (data.progress) {
                    this.progress.value = data.progress.from;
                    this.progress.max = data.progress.total;
                } else {
                    this.progress.value = 0;
                    this.progress.max = 0;
                }
            }
            (this.$refs.uploadModal as any).hide();
        })();
    }
}
