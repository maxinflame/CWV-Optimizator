import { cp, mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
await mkdir(join(dist, "public"), { recursive: true });
await cp(join(root, "public"), join(dist, "public"), { recursive: true });
await writeFile(
  join(dist, "server.mjs"),
  await readFile(join(root, "server.mjs"), "utf8"),
);
console.log("build ok");
