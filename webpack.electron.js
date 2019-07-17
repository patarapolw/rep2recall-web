const path = require("path");
const { getWebpackConfig } = require("./webpack.common");

module.exports = [
    {
        mode: "production",
        entry: {
            electron: "./src/node/electron.ts",
            server: "./src/node/server.ts"
        },
        output: {
            path: path.join(__dirname, "build/node"),
            filename: "[name].min.js"
        },
        target: "electron-main",
        node: {
            __dirname: false,
            __filename: false,
        },
        resolve: {
            extensions: ['.js', '.json', '.ts'],
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    exclude: /node_modules/,
                    use: {
                        loader: 'ts-loader',
                    },
                }
            ],
        },
    },
    {
        mode: "production",
        target: "electron-renderer",
        node: {
            __dirname: false,
            __filename: false,
        },
        ...getWebpackConfig("tsconfig.electron.json")
    }
]