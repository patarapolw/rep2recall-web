import { Router } from "express";
import passport from "passport";

const router = Router();

// Perform the login, after login Auth0 will redirect to callback
router.get("/login", passport.authenticate("auth0", {
    scope: "openid email profile"
}), (req, res) => {
    res.redirect("/");
});

// Perform the final stage of authentication and redirect to previously requested URL or '/user'
router.get("/callback", (req, res, next) => {
    passport.authenticate("auth0", (err, user, info) => {
        if (err) { return next(err); }
        if (!user) { return res.redirect("/"); }
        req.logIn(user, (_err)  => {
            if (_err) { return next(_err); }
            res.locals.user = req.user;

            // const returnTo = req.session!.returnTo;
            delete req.session!.returnTo;
            res.redirect("/");
        });
    })(req, res, next);
});

// Perform session logout and redirect to homepage
router.get("/logout", (req, res) => {
    req.logout();
    res.redirect("/");
});

export default router;
