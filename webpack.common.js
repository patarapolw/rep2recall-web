const path = require("path");
const VueLoaderPlugin = require('vue-loader/lib/plugin');

module.exports = {
    getWebpackConfig(tsconfigPath) {
        return {
            entry: {
                index: "./src/web/index.ts"
            },
            output: {
                path: path.resolve(__dirname, "public/js"),
                filename: "[name].min.js",
                publicPath: "js/"
            },
            module: {
                rules: [{
                    test: /\.(css|scss)$/,
                    use: [
                        "style-loader",
                        "css-loader",
                        "sass-loader"
                    ],
                    exclude: /\.module\.css$/
                },
                {
                    test: /\.(ts|tsx)?$/,
                    loader: "ts-loader",
                    exclude: /node_modules/,
                    options: {
                        configFile: tsconfigPath
                    }
                },
                {
                    test: /\.css$/,
                    use: [
                        'vue-style-loader',
                        "style-loader",
                        "css-loader?modules&importLoaders=1&localIdentName=[name]__[local]___[hash:base64:5]"
                    ],
                    include: /\.module\.css$/
                },
                {
                    test: /\.(html|txt)$/,
                    use: "raw-loader"
                },
                {
                    include: /\.pug/,
                    loader: ['raw-loader', 'pug-html-loader']
                },
                {
                    test: /\.(woff(2)?|ttf|eot|svg)(\?v=\d+\.\d+\.\d+)?$/,
                    use: [{
                        loader: "file-loader",
                        options: {
                            name: "[name].[ext]",
                            outputPath: "fonts"
                        }
                    }]
                },
                {
                    test: /\.(png|jpg|gif)$/,
                    use: [{
                        loader: 'file-loader',
                        options: {
                            name: '[name].[ext]',
                            outputPath: "images"
                        },
                    },],
                },
                {
                    test: /\.vue$/,
                    loader: 'vue-loader'
                },
                {
                    test: require.resolve("jquery"),
                    use: [{
                        loader: "expose-loader",
                        options: "jQuery"
                    }, {
                        loader: "expose-loader",
                        options: "$"
                    }]
                }
                ]
            },
            resolve: {
                extensions: [
                    ".tsx",
                    ".ts",
                    ".js",
                    ".vue"
                ],
                alias: {
                    'vue$': 'vue/dist/vue.esm.js'
                }
            },
            node: {
                fs: "empty"
            },
            plugins: [
                // make sure to include the plugin!
                new VueLoaderPlugin()
            ]
        }
    }
};
