// Prepares everything the desktop app bundles:
//   1. builds LectureLab as a self-contained server (.next/standalone)
//   2. copies its static files in
//   3. downloads a private copy of Node.js for this computer's platform
// Run from the project root: npm run desktop:prepare
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const NODE_VERSION = "v22.23.5"; // must match the Node major used to install dependencies (native modules)
const root = path.resolve(import.meta.dirname, "..");
const standalone = path.join(root, ".next", "standalone");
const sh = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", cwd: root, ...opts });

console.log("› Building LectureLab server…");
fs.rmSync(path.join(root, ".next"), { recursive: true, force: true });
sh("npx next build", { env: { ...process.env, LECTURELAB_STANDALONE: "1", NEXT_TELEMETRY_DISABLED: "1" } });

console.log("› Copying static files…");
fs.cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
fs.cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
// Never ship a developer's local data folder.
fs.rmSync(path.join(standalone, "data"), { recursive: true, force: true });

const plat = process.platform === "win32" ? "win" : process.platform;
const arch = process.arch;
const nodeDir = path.join(root, "desktop", "resources", "node");
const exe = process.platform === "win32" ? "node.exe" : "node";
if (fs.existsSync(path.join(nodeDir, exe)) && fs.readFileSync(path.join(nodeDir, ".version"), "utf8").trim() === `${NODE_VERSION}-${plat}-${arch}`) {
  console.log("› Node.js already downloaded");
} else {
  console.log(`› Downloading Node.js ${NODE_VERSION} for ${plat}-${arch}…`);
  fs.rmSync(nodeDir, { recursive: true, force: true });
  fs.mkdirSync(nodeDir, { recursive: true });
  const name = `node-${NODE_VERSION}-${plat}-${arch}`;
  const tmp = path.join(root, "desktop", "resources", "tmp");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const ext = plat === "win" ? "zip" : "tar.gz";
  const archive = path.join(tmp, `node.${ext}`);
  const res = await fetch(`https://nodejs.org/dist/${NODE_VERSION}/${name}.${ext}`);
  if (!res.ok) throw new Error(`Node.js download failed: ${res.status}`);
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  sh(`tar -xf "${archive}" -C "${tmp}"`);
  const src = plat === "win" ? path.join(tmp, name, "node.exe") : path.join(tmp, name, "bin", "node");
  fs.copyFileSync(src, path.join(nodeDir, exe));
  fs.chmodSync(path.join(nodeDir, exe), 0o755);
  fs.copyFileSync(path.join(tmp, name, "LICENSE"), path.join(nodeDir, "LICENSE"));
  fs.writeFileSync(path.join(nodeDir, ".version"), `${NODE_VERSION}-${plat}-${arch}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log("✓ Desktop resources ready");
