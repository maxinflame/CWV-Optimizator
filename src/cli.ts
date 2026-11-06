import {
  parseWebsiteFlags,
  websiteUsage,
  type WebsiteCliCommand,
} from "./website/cli.js";

export const usage = websiteUsage;

export type Command = { type: "help" } | WebsiteCliCommand;

export function parseArgs(args: string[]): Command {
  if (args.length === 0 || (args.length === 1 && ["--help", "-h"].includes(args[0]!)))
    return { type: "help" };

  // Allow both `website --project ...` and bare `--project ...`
  const normalized =
    args[0] === "website" ? args : (["website", ...args] as string[]);
  const website = parseWebsiteFlags(normalized);
  if (website) return website;
  throw new Error(usage);
}
