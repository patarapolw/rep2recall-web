const { getWebpackConfig } = require("./webpack.common");

module.exports = {
    ...getWebpackConfig("tsconfig.web.json"),
    mode: "production",
    devtool: "source-map"
};
