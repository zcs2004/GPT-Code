const fs = require("node:fs");
const path = require("node:path");
const { inspectWindowsAuthenticode } = require("../electron/update.cjs");

function verifyWindowsAuthenticodeFile(filePath, label, inspect = inspectWindowsAuthenticode) {
  if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Windows release ${label} is missing`);
  }
  const signature = inspect(filePath);
  if (signature.status !== "Valid" || !signature.subject || !signature.thumbprint) {
    throw new Error(`Windows release ${label} is not Authenticode-valid: ${signature.status}`);
  }
  return signature;
}

function verifyWindowsPublisherPair({
  installerPath,
  executablePath,
  inspect = inspectWindowsAuthenticode,
  labelPrefix = "Windows release",
}) {
  const executableSignature = verifyWindowsAuthenticodeFile(executablePath, "application executable", inspect);
  const installerSignature = verifyWindowsAuthenticodeFile(installerPath, "installer", inspect);
  if (executableSignature.subject.toLocaleLowerCase("en-US")
    !== installerSignature.subject.toLocaleLowerCase("en-US")) {
    throw new Error(`${labelPrefix} installer publisher does not match the application executable publisher`);
  }
  return {
    installerSignature,
    executableSignature,
    publisherContinuity: true,
  };
}

function verifyWindowsReleaseSignatures({ stagingRoot, productName, inspect = inspectWindowsAuthenticode }) {
  if (typeof stagingRoot !== "string" || !path.isAbsolute(stagingRoot)) {
    throw new Error("Windows release signature verification requires an absolute staging root");
  }
  if (typeof productName !== "string" || !productName.trim()) {
    throw new Error("Windows release signature verification requires a product name");
  }

  const appPath = path.join(stagingRoot, "win-unpacked", `${productName}.exe`);
  const installers = fs.readdirSync(stagingRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /-win-x64\.exe$/i.test(entry.name));
  if (installers.length !== 1) {
    throw new Error(`Expected exactly one Windows x64 installer for signature verification; found ${installers.length}`);
  }
  const installerPath = path.join(stagingRoot, installers[0].name);

  verifyWindowsPublisherPair({ installerPath, executablePath: appPath, inspect });

  return { appPath, installerPath, publisherContinuity: true };
}

module.exports = {
  verifyWindowsAuthenticodeFile,
  verifyWindowsPublisherPair,
  verifyWindowsReleaseSignatures,
};
