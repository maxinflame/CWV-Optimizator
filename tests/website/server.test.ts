import { createServer as createNetServer } from "node:net";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { loadWebsiteConfig } from "../../src/website/config.js";
import { ProductionServer } from "../../src/website/server.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) {
    const task = cleanups.pop();
    if (task) await task();
  }
});

async function freePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolveListen, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolveClose, reject) => {
    probe.close((error) => (error ? reject(error) : resolveClose()));
  });
  if (!port) throw new Error("Свободный порт не получен");
  return port;
}

function nestedCodes(
  error: unknown,
  found = new Set<string>(),
  depth = 0,
): Set<string> {
  if (!error || typeof error !== "object" || depth > 5) return found;
  const record = error as {
    code?: unknown;
    cause?: unknown;
    errors?: unknown;
  };
  if (typeof record.code === "string") found.add(record.code);
  if (record.cause) nestedCodes(record.cause, found, depth + 1);
  if (Array.isArray(record.errors)) {
    for (const item of record.errors) nestedCodes(item, found, depth + 1);
  }
  return found;
}

async function portIsFree(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(500) });
    return false;
  } catch (error) {
    const codes = nestedCodes(error);
    return codes.has("ECONNREFUSED") || codes.has("ECONNRESET");
  }
}

it("releases the port after stop when the optimizer started the server", async () => {
  const port = await freePort();
  const directory = await mkdtemp(join(tmpdir(), "cwv-server-"));
  const project = join(directory, "site");
  await mkdir(project);
  await writeFile(join(project, "build.mjs"), "process.exit(0);\n");
  await writeFile(
    join(project, "listen.mjs"),
    [
      'import { spawn } from "node:child_process";',
      'import { createServer } from "node:http";',
      "const port = Number(process.env.PORT);",
      'if (process.argv[2] !== "child") {',
      '  const child = spawn(process.execPath, [process.argv[1], "child"], {',
      "    env: process.env,",
      '    stdio: "ignore",',
      "  });",
      '  child.on("exit", (code) => process.exit(code ?? 0));',
      "} else {",
      "  createServer((_req, res) => {",
      '    res.end("ok");',
      '  }).listen(port, "127.0.0.1");',
      "}",
      "",
    ].join("\n"),
  );
  const config = await loadWebsiteConfig(
    join(repo, "website.config.example.ts"),
  );
  config.workspace.path = project;
  config.website.port = port;
  config.website.buildCommand = "node build.mjs";
  config.website.startCommand = "node listen.mjs";
  config.website.startTimeoutMs = 10_000;
  const server = new ProductionServer(config, project, join(directory, "logs"));
  cleanups.push(async () => {
    await server.stop().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  });

  const signal = new AbortController().signal;
  await server.start(signal);
  expect((await fetch(`${server.baseUrl}/`)).status).toBe(200);

  await server.stop();
  expect(await portIsFree(`${server.baseUrl}/`)).toBe(true);

  await server.rebuildAndStart(signal);
  expect((await fetch(`${server.baseUrl}/`)).status).toBe(200);
  await server.stop();
  expect(await portIsFree(`${server.baseUrl}/`)).toBe(true);
}, 20_000);

it("does not stop an external server the optimizer did not start", async () => {
  const port = await freePort();
  const listener = createServer((_req, res) => {
    res.end("external");
  });
  await new Promise<void>((resolveListen, reject) => {
    listener.once("error", reject);
    listener.listen(port, "127.0.0.1", () => resolveListen());
  });
  cleanups.push(
    () =>
      new Promise((resolveClose, reject) => {
        listener.close((error) => (error ? reject(error) : resolveClose()));
      }),
  );

  const directory = await mkdtemp(join(tmpdir(), "cwv-external-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const config = await loadWebsiteConfig(
    join(repo, "website.config.example.ts"),
  );
  config.workspace.path = directory;
  config.website.baseUrl = `http://127.0.0.1:${port}`;
  const server = new ProductionServer(
    config,
    directory,
    join(directory, "logs"),
  );

  await server.stop();
  expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe(
    "external",
  );
});
