const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// The two apps keep independent packages. Watch the shared pure-data folder so
// editing a token also triggers Fast Refresh in the native app.
config.watchFolders = [...config.watchFolders, path.resolve(__dirname, "../shared")];

module.exports = config;
