// The app lives in mobile/ but the roulette logic lives in ../lib, which it
// imports directly rather than through a copy. Metro refuses to read anything
// outside the project root unless that root is named here.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [repoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(repoRoot, "node_modules"),
];
// The repo root has its own node_modules (Next, React 19 for the web app).
// Without this, a shared file could pull React up from there and the app would
// end up with two copies of it.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
