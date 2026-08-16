// The app lives in mobile/ but the roulette logic lives in ../lib, which it
// imports directly rather than through a copy. Metro refuses to read anything
// outside the project root unless that root is named here.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

config.watchFolders = [path.resolve(__dirname, "..")];

// Resolution is left at Metro's default on purpose. This is not a hoisted
// monorepo — mobile/node_modules is self-contained, and several of expo's own
// dependencies (expo-asset, expo-constants, …) sit nested inside
// node_modules/expo, where only the standard walk-up finds them. Pinning
// nodeModulesPaths and disabling hierarchical lookup hides exactly those.
//
// Nothing leaks in from the repo root's node_modules either: the shared files
// in ../lib import only their own siblings, never a package.

module.exports = config;
