const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// The two apps keep independent packages. Watch the shared pure-data folder so
// editing a token also triggers Fast Refresh in the native app.
config.watchFolders = [...config.watchFolders, path.resolve(__dirname, "../shared"), path.resolve(__dirname, "../src/contracts")];

// Shared contract files live outside this package and may import each other; their Babel
// runtime helpers and any packages resolve from this app's own node_modules.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];

module.exports = config;
