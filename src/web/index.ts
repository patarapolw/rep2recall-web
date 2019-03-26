import { fetchJSON } from "./util";
import { initCardEditor } from "./cardEditor";
import { initDeckViewer } from "./deckViewer";

const el = {
    searchBarArea: document.getElementById("SearchBarArea") as HTMLDivElement,
    userNameArea: document.getElementById("UserNameArea") as HTMLDivElement,
    loginButton: document.getElementById("LoginButton") as HTMLButtonElement,
    editLink: document.getElementById("EditLink") as HTMLButtonElement,
    quizLink: document.getElementById("QuizLink") as HTMLButtonElement,
    app: document.getElementById("App") as HTMLDivElement
};

const displayName: string | undefined = (window as any).displayName;

if (displayName) {
    allowLogout();
} else {
    allowLogin();
}

el.quizLink.onclick = () => initDeckViewer();
el.editLink.onclick = () => initCardEditor();

function allowLogin() {
    el.userNameArea.innerText = displayName || "";
    el.loginButton.classList.add("btn-outline-success");
    el.loginButton.onclick = () => location.replace("/login");
    el.loginButton.innerText = "Login for more";

    el.editLink.disabled = true;
    el.quizLink.disabled = true;

    el.app.innerHTML = `
    <div class="mt-3">
        Please login to use the app.
    </div>`;
}

function allowLogout() {
    el.loginButton.classList.add("btn-outline-danger");
    el.loginButton.onclick = () => location.replace("/logout");
    el.loginButton.innerText = "Logout";

    el.editLink.disabled = false;
    el.quizLink.disabled = false;

    fetchJSON("/editor/card/", {q: "", offset: 0, limit: 1}).then((r) => {
        if (r && r.total) {
            initDeckViewer();
        } else {
            initCardEditor();
        }
    });
}
