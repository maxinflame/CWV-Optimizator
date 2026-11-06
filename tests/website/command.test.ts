import { expect, it } from "vitest";
import {
  buildWslBashScript,
  isUncPath,
  parseWslUncPath,
  wrapCommandForCwd,
  wslDirectSpawn,
} from "../../src/website/command.js";

it("detects UNC and wsl.localhost paths", () => {
  expect(isUncPath("\\\\wsl.localhost\\Ubuntu-22.04\\home\\a")).toBe(true);
  expect(isUncPath("//wsl$/Ubuntu-22.04/home/a")).toBe(true);
  expect(isUncPath("C:/Projects/site")).toBe(false);
  expect(isUncPath("/home/maxinflame/Projects/symbl.cc")).toBe(false);
});

it("parses wsl.localhost and wsl$ UNC paths", () => {
  expect(
    parseWslUncPath(
      "\\\\wsl.localhost\\Ubuntu-22.04\\home\\maxinflame\\Projects\\symbl.cc\\frontend",
    ),
  ).toEqual({
    distro: "Ubuntu-22.04",
    linuxPath: "/home/maxinflame/Projects/symbl.cc/frontend",
  });
  expect(
    parseWslUncPath("//wsl$/Ubuntu-22.04/home/maxinflame/Projects/symbl.cc"),
  ).toEqual({
    distro: "Ubuntu-22.04",
    linuxPath: "/home/maxinflame/Projects/symbl.cc",
  });
  expect(parseWslUncPath("C:\\Projects\\site")).toBeUndefined();
});

it("routes Windows WSL UNC cwd through wsl.exe + base64 script", () => {
  if (process.platform !== "win32") return;
  const unc =
    "\\\\wsl.localhost\\Ubuntu-22.04\\home\\maxinflame\\Projects\\symbl.cc\\frontend";
  const wrapped = wrapCommandForCwd("npm run build", unc);
  expect(wrapped.cwd).toBeUndefined();
  expect(wrapped.direct?.file).toBe("wsl.exe");
  expect(wrapped.direct?.args.slice(0, 5)).toEqual([
    "-d",
    "Ubuntu-22.04",
    "--",
    "bash",
    "-lc",
  ]);
  expect(wrapped.direct?.args[5]).toMatch(/^echo [A-Za-z0-9+/=]+ \| base64 -d \| bash -s$/);

  const script = buildWslBashScript(
    "/home/maxinflame/Projects/symbl.cc/frontend",
    "npm run build",
  );
  expect(script).toContain("cd '/home/maxinflame/Projects/symbl.cc/frontend'");
  expect(script).toContain("npm run build");
  expect(script).toContain("/mnt/[a-zA-Z]");

  const direct = wslDirectSpawn(
    "Ubuntu-22.04",
    "/home/maxinflame/Projects/symbl.cc/frontend",
    "npm run build",
  );
  expect(direct.file).toBe("wsl.exe");
});

it("wraps generic Windows UNC cwd with pushd/popd", () => {
  if (process.platform !== "win32") return;
  const unc = "\\\\server\\share\\project";
  const wrapped = wrapCommandForCwd("npm.cmd run build", unc);
  expect(wrapped.cwd).toBeUndefined();
  expect(wrapped.direct).toBeUndefined();
  expect(wrapped.command).toBe(`pushd "${unc}" && npm.cmd run build && popd`);
});

it("keeps normal cwd on Windows non-UNC paths", () => {
  if (process.platform !== "win32") return;
  const local = "C:\\Projects\\CWV Optimizator\\fixtures\\slow-site";
  expect(wrapCommandForCwd("npm.cmd run build", local)).toEqual({
    command: "npm.cmd run build",
    cwd: local,
  });
});
