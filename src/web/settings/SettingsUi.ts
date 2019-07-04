import { Vue, Component } from "vue-property-decorator";
import { fetchJSON } from "../util";
import swal from "sweetalert";

import template from "../layout/settings/settings.pug";

@Component({template})
export default class SettingsUi extends Vue {
    private async onResetDatabaseClicked() {
        const r = await swal({
            text: "Please ensure you want to reset the database. The app will restart afterwards.",
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
