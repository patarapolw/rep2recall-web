import { Vue, Component } from "vue-property-decorator";
import { fetchJSON } from "../util";
import swal from "sweetalert";

import template from "../layout/settings/settings.pug";

@Component({template})
export default class SettingsUi extends Vue {
    private apiSecret = "";

    public async created() {
        const r = await fetchJSON("/api/auth/getSecret");
        this.apiSecret = r.secret;
    }

    private async onGenerateNewApiSecretClicked() {
        const c = await swal({
            text: "Are you sure you want to reset the API secret?",
            icon: "warning",
            buttons: [true, true],
            dangerMode: true
        });

        if (c) {
            const r = await fetchJSON("/api/auth/newSecret");
            this.apiSecret = r.secret;
        }
    }

    private async onResetDatabaseClicked() {
        const r = await swal({
            text: "Are you sure you want to reset the database?",
            icon: "warning",
            buttons: [true, true],
            dangerMode: true
        });

        if (r) {
            await fetchJSON("/api/reset", {}, "DELETE");
            await swal({
                text: "Database is reset",
                icon: "info",
                buttons: [true, true],
                dangerMode: true
            });
        }
    }
}
