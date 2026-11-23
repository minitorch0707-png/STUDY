// Copies the LectureLab server into the packaged app. (electron-builder's own
// copy step always leaves out node_modules folders, which the server needs.)
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const src = path.join(__dirname, "..", ".next", "standalone");
  if (!fs.existsSync(path.join(src, "server.js"))) throw new Error("Server build missing — run `npm run desktop:prepare` first.");
  const resources =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  const dest = path.join(resources, "server");
  fs.rmSync(dest, { recursive: true, force: true });
  const skip = new Set([".git", ".env", ".env.example", "data", "desktop", "src", ".gitignore"].map((n) => path.join(src, n)));
  fs.cpSync(src, dest, { recursive: true, dereference: true, filter: (p) => !skip.has(p) });
  console.log(`  • copied LectureLab server → ${dest}`);
};
