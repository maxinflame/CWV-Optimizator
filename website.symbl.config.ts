import { isAbsolute, resolve } from "node:path";
import type { WebsiteConfig } from "./src/website/config.js";

/**
 * Конфиг для локального Docker-окружения symbl.cc.
 *
 * Предпосылки:
 * 1. Стек поднят (`sh etc/local/docker/build.sh` или `docker compose start` в `_docker`).
 * 2. Сайт отвечает на http://localhost:8000/
 * 3. В `frontend/` установлены зависимости (`npm install`).
 * 4. Working tree Git чистый (для --agent).
 *
 * Предпочтительно из WSL (нативный путь, тот же Docker):
 *
 *   cd "/mnt/c/Projects/CWV Optimizator"
 *   npm run pipeline -- --project /home/maxinflame/Projects/symbl.cc \
 *     --config ./website.symbl.config.ts --validate
 *
 * С Windows UNC (`\\wsl.localhost\...`) команды уходят в distro через wsl.exe
 * (linux npm, без Windows npm.cmd / CMD UNC):
 *
 *   npm run pipeline -- --project "\\wsl.localhost\Ubuntu-22.04\home\maxinflame\Projects\symbl.cc" `
 *     --config ./website.symbl.config.ts --validate
 *
 * Либо CWV_PROJECT=/home/maxinflame/Projects/symbl.cc
 */
function symblProjectPath(): string {
  const fromEnv = process.env.CWV_PROJECT?.trim();
  if (fromEnv) return isAbsolute(fromEnv) ? fromEnv : resolve(fromEnv);
  if (process.platform === "linux") return "/home/maxinflame/Projects/symbl.cc";
  return "\\\\wsl.localhost\\Ubuntu-22.04\\home\\maxinflame\\Projects\\symbl.cc";
}

export default {
  workspace: {
    path: symblProjectPath(),
    mode: "direct",
    versionControl: "git",
    requireCleanGit: true,
  },
  agent: {
    provider: "cursor",
    model: "auto",
  },
  website: {
    baseUrl: "http://localhost:8000",
    cwd: "frontend",
    buildCommand: "npm run build",
    healthCheckPath: "/ru/",
    startTimeoutMs: 120_000,
  },
  browser: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    profile: "mobile",
    cpuSlowdownMultiplier: 4,
    networkPreset: "Slow4G",
    observationMs: 2500,
  },
  pages: [
    {
      id: "home-ru",
      path: "/ru/",
      scenarios: ["cold-load", "scroll"],
    },
  ],
  measurements: {
    baselineRepeats: 3,
    quickRepeats: 3,
    confirmationBatches: [
      { role: "candidate", repeats: 3 },
      { role: "reference", repeats: 3 },
    ],
  },
  budgets: {
    maxDurationMinutes: 60,
    maxIterations: 3,
  },
  objectives: {
    thresholds: {
      lcpMs: 2500,
      inpMs: 200,
      cls: 0.1,
      fcpMs: 1800,
    },
    safetyMarginPercent: 10,
    minImprovementPercent: 3,
    maxRegressionPercent: 5,
    protectedMetrics: ["lcpMs", "inpMs", "cls", "fcpMs"],
  },
  verification: {
    visualRegression: true,
    screenshotDiffThreshold: 0.2,
  },
  lighthouse: {
    enabled: true,
    formFactor: "mobile",
  },
} satisfies WebsiteConfig;
