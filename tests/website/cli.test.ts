import { expect, it } from "vitest";
import { resolve } from "node:path";
import { parseArgs } from "../../src/cli.js";

it("parses measure-only with website prefix", () => {
  expect(
    parseArgs([
      "website",
      "--project",
      resolve("/tmp/site"),
      "--config",
      resolve("/tmp/website.config.ts"),
      "--measure-only",
    ]),
  ).toMatchObject({
    type: "website",
    measureOnly: true,
    validateOnly: false,
  });
});

it("parses bare --project flags", () => {
  expect(
    parseArgs([
      "--project",
      resolve("/tmp/site"),
      "--config",
      resolve("/tmp/website.config.ts"),
      "--agent",
      "cursor",
    ]),
  ).toMatchObject({
    type: "website",
    agent: "cursor",
    measureOnly: false,
  });
});

it("parses --base-url with measure-only", () => {
  expect(
    parseArgs([
      "--project",
      resolve("/tmp/site"),
      "--config",
      resolve("/tmp/website.config.ts"),
      "--measure-only",
      "--base-url",
      "http://localhost:8000",
    ]),
  ).toMatchObject({
    type: "website",
    measureOnly: true,
    baseUrl: "http://localhost:8000",
  });
});

it("shows help", () => {
  expect(parseArgs(["--help"])).toEqual({ type: "help" });
  expect(parseArgs([])).toEqual({ type: "help" });
});
