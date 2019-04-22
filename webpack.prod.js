const { web } = require("./webpack.common");

module.exports = {
    ...web,
    mode: "production",
    devtool: "source-map"
};
