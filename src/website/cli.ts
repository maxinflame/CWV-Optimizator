import { resolve } from "node:path";
import type { WebsiteConfig } from "./config.js";
import { loadWebsiteConfig } from "./config.js";

export const websiteUsage = `Usage:
  npm run pipeline -- --project <abs-path> --config <configs/website.config.ts> [--measure-only | --validate | --agent cursor] [--base-url <url>]
  npm run pipeline -- website --project <abs-path> --config <configs/website.config.ts> [--measure-only | --validate | --agent cursor] [--base-url <url>]`;

export type WebsiteCliCommand = {
  type: "website";
  project: string;
  configPath: string;
  measureOnly: boolean;
  validateOnly: boolean;
  agent?: string;
  baseUrl?: string;
};

export function parseWebsiteFlags(
  args: string[],
): WebsiteCliCommand | undefined {
  if (args[0] !== "website") return undefined;
  const flags = new Map<string, string | boolean>();
  for (let index = 1; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--measure-only" || arg === "--validate") {
      flags.set(arg, true);
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(websiteUsage);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(websiteUsage);
    flags.set(arg, value);
    index++;
  }
  const project = flags.get("--project");
  const configPath = flags.get("--config");
  if (typeof project !== "string" || typeof configPath !== "string")
    throw new Error(websiteUsage);
  const agent = flags.get("--agent");
  const baseUrl = flags.get("--base-url");
  return {
    type: "website",
    project: resolve(project),
    configPath: resolve(configPath),
    measureOnly: flags.get("--measure-only") === true,
    validateOnly: flags.get("--validate") === true,
    agent: typeof agent === "string" ? agent : undefined,
    baseUrl: typeof baseUrl === "string" ? baseUrl : undefined,
  };
}

export async function loadWebsiteCommandConfig(
  command: WebsiteCliCommand,
): Promise<WebsiteConfig> {
  const config = await loadWebsiteConfig(command.configPath);
  config.workspace.path = command.project;
  if (command.agent) config.agent.provider = command.agent;
  if (command.baseUrl) config.website.baseUrl = command.baseUrl;
  return config;
}
