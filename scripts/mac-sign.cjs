const path = require("node:path");

function loadElectronOsxSign() {
  const electronBuilderPath = require.resolve("electron-builder");
  const appBuilderPath = require.resolve("app-builder-lib", {
    paths: [path.dirname(electronBuilderPath)],
  });
  const osxSignPath = require.resolve("@electron/osx-sign", {
    paths: [path.dirname(appBuilderPath)],
  });

  return require(osxSignPath);
}

async function signWithElectronOsxSign(options, _packager, loadOsxSign = loadElectronOsxSign) {
  await loadOsxSign().signAsync(options);
}

module.exports = signWithElectronOsxSign;
module.exports.signWithElectronOsxSign = signWithElectronOsxSign;
