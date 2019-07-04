import { Vue, Component, Watch } from "vue-property-decorator";
import swal from "sweetalert";
import io from "socket.io-client";

import template from "../layout/import/import.pug";

@Component({template})
export default class ImportUi extends Vue {
    private importFile: File | null = null;
    private progress: any = {};

    private getProgressPercent() {
        return (this.progress.max ? this.progress.current / this.progress.max * 100 : 100).toFixed(0) + "%";
    }

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
        formData.append("file", this.importFile!);
        (this.$refs.uploadModal as any).show();

        this.progress = {
            text: "Uploading..."
        };

        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (evt) => {
            Object.assign(this.progress, {
                text: `Uploading ${this.importFile!.name}`,
                current: evt.loaded / evt.total,
                max: 1
            });
        };
        xhr.onload = () => {
            Object.assign(this.progress, {
                text: `Parsing ${this.importFile!.name}`,
                max: 0
            });
            const { id } = JSON.parse(xhr.responseText);
            const ws = io(location.origin);
            let started = false;

            ws.on("connect", () => {
                if (!started) {
                    ws.send({
                        id,
                        type: /\.[^.]+$/.exec(this.importFile!.name)![0]
                    });
                    started = true;
                }
            });

            ws.on("message", (msg: any) => {
                try {
                    Vue.set(this, "progress", msg);
                    if (this.progress.error || !this.progress.text) {
                        ws.close();
                    }
                } catch (e) {
                    console.log(msg);
                }
            });
        };

        xhr.open("POST", "/api/io/import");
        xhr.send(formData);
    }

    @Watch("progress")
    private watchProgress() {
        if (!this.progress.text) {
            (this.$refs.uploadModal as any).hide();

            if (this.progress.error) {
                swal({
                    text: this.progress.error,
                    icon: "error"
                })
            } else {
                swal({
                    title: "Success",
                    icon: "success"
                })
            }
        }
    }
}
