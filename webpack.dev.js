const { getWebpackConfig } = require("./webpack.common");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config();

module.exports = {
    mode: "development",
    devtool: "inline-source-map",
    ...getWebpackConfig("tsconfig.web.json"),
    devServer: {
        open: true,
        contentBase: path.resolve(__dirname, "public"),
        proxy: {
            "/api": `http://localhost:${process.env.PORT || 7000}`,
            "/socket.io": {
                target: `http://localhost:${process.env.PORT || 7000}`,
                ws: true
            }
        },
        port: process.env.DEV_SERVER_PORT || 24208
    }
};
