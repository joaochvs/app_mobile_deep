const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// ✅ permite arquivos .db como asset
config.resolver.assetExts.push('db');

module.exports = config;
