const expoConfig = require('eslint-config-expo/flat');
const { defineConfig } = require('eslint/config');

module.exports = defineConfig([
  expoConfig,
  {
    rules: {
      // Expo's platform-specific entry points are checked by TypeScript and Metro.
      // eslint-plugin-import cannot always analyze their native exports.
      'import/no-unresolved': ['error', { ignore: ['^expo-(audio|notifications)$'] }],
    },
  },
]);
