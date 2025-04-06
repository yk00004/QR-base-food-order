module.exports.isAdmin = (req, res, next) => {
    if (!req.user.isAdmin) {
        req.flash("error", "Access Denied! Admins only.");
        return res.redirect("/");
    }
    next();
};
