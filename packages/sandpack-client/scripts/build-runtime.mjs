// Publish the matching preview runtime with the client. Consumers can serve
// these static files from their own CDN instead of blocking boot on another host.
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const client = fileURLToPath(new URL("../", import.meta.url));
const bundler = fileURLToPath(new URL("../../sandpack-bundler/", import.meta.url));
const transpiler = fileURLToPath(new URL("../../transpiler/", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
for (const [cwd, script] of [[transpiler, "build"], [bundler, "clean"], [bundler, "build"]]) {
  const result = spawnSync(npm, ["run", script], { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!existsSync(`${bundler}/dist/index.html`)) throw new Error("Preview runtime index missing");
rmSync(`${client}/sandpack`, { recursive: true, force: true });
cpSync(`${bundler}/dist`, `${client}/sandpack`, {
  recursive: true,
  filter: (source) => !source.endsWith(".map"),
});
