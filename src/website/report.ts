import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { WebsiteConfig } from "./config.js";
import type { ScenarioAggregate } from "./measure/types.js";
import type { AcceptanceDecision, Bottleneck } from "./acceptance.js";
import type { GitState } from "./git.js";

export interface WebsiteAttemptRecord {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "accepted" | "rejected" | "failed" | "inconclusive" | "interrupted";
  stage: string;
  gitRevision?: string;
  targetPage?: string;
  targetScenario?: string;
  targetMetric?: string;
  hypothesis?: string;
  filesModified?: string[];
  buildOk?: boolean;
  testsOk?: boolean;
  smokeOk?: boolean;
  quick?: ScenarioAggregate[];
  confirmation?: {
    order: Array<{ role: "candidate" | "reference"; repeats: number; commit: string }>;
    candidate: ScenarioAggregate[];
    reference: ScenarioAggregate[];
  };
  decision?: AcceptanceDecision;
  agentSummary?: string;
  errors: string[];
}

export interface WebsiteReport {
  kind: "website-cwv";
  startedAt: string;
  finishedAt?: string;
  status: "running" | "completed" | "failed" | "interrupted";
  stopReason?: string;
  config: WebsiteConfig;
  git?: GitState;
  baseline?: ScenarioAggregate[];
  bottleneck?: Bottleneck | null;
  attempts: WebsiteAttemptRecord[];
  bestCommit?: string;
  lighthouse?: {
    baseline?: Record<string, unknown> | null;
    final?: Record<string, unknown> | null;
  };
  limitations: string[];
}

export function createWebsiteReport(
  config: WebsiteConfig,
  startedAt: Date,
): WebsiteReport {
  return {
    kind: "website-cwv",
    startedAt: startedAt.toISOString(),
    status: "running",
    config,
    attempts: [],
    limitations: [
      "Laboratory improvements are not guaranteed field Core Web Vitals improvements.",
      "INP requires a configured interaction scenario; unavailable values are reported explicitly.",
      "Confirmation uses sequential batched measurements, not simultaneous paired A/B runs.",
    ],
  };
}

export async function saveWebsiteReport(
  directory: string,
  report: WebsiteReport,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(join(directory, "REPORT.md"), renderMarkdown(report));
}

function formatMedians(aggregates: ScenarioAggregate[] | undefined): string {
  if (!aggregates?.length) return "_нет данных_";
  return aggregates
    .map((item) => {
      const parts = Object.entries(item.medians)
        .map(([key, value]) => `${key}=${value === null ? "n/a" : value}`)
        .join(", ");
      return `- \`${item.scenario}\`: ${parts}`;
    })
    .join("\n");
}

const HYPOTHESIS_MD_MAX = 200;

export function formatHypothesisOneLine(hypothesis: string | undefined): string {
  if (!hypothesis) return "без гипотезы";
  const flat = hypothesis.replace(/\s+/g, " ").trim();
  if (!flat) return "без гипотезы";
  return flat.length <= HYPOTHESIS_MD_MAX
    ? flat
    : `${flat.slice(0, HYPOTHESIS_MD_MAX - 1)}…`;
}

function formatAttemptLine(attempt: WebsiteAttemptRecord): string {
  const reasons = (attempt.decision?.reasons ?? attempt.errors).join("; ");
  const hypothesis = formatHypothesisOneLine(attempt.hypothesis);
  return reasons
    ? `- ${attempt.id}: ${hypothesis} — ${reasons}`
    : `- ${attempt.id}: ${hypothesis}`;
}

export function renderMarkdown(report: WebsiteReport): string {
  const accepted = report.attempts.filter((attempt) => attempt.status === "accepted");
  const rejected = report.attempts.filter((attempt) => attempt.status === "rejected");
  const inconclusive = report.attempts.filter(
    (attempt) => attempt.status === "inconclusive",
  );
  const failed = report.attempts.filter(
    (attempt) =>
      attempt.status === "failed" || attempt.status === "interrupted",
  );
  return [
    "# Отчёт Core Web Vitals",
    "",
    `Статус: **${report.status}**`,
    report.stopReason ? `Причина остановки: ${report.stopReason}` : "",
    "",
    "## Git",
    report.git
      ? [
          `- Исходная ветка: \`${report.git.originalBranch}\` @ \`${report.git.originalCommit}\``,
          `- Ветка оптимизации: \`${report.git.optimizationBranch}\``,
          `- Baseline: \`${report.git.baselineCommit}\``,
          `- Лучший принятый коммит: \`${report.bestCommit ?? report.git.acceptedCommit}\``,
        ].join("\n")
      : "_нет_",
    "",
    "## Начальная производительность",
    formatMedians(report.baseline),
    "",
    "## Узкое место",
    report.bottleneck
      ? `\`${report.bottleneck.metric}\` на \`${report.bottleneck.scenario}\` (медиана ${report.bottleneck.median}, порог ${report.bottleneck.threshold})`
      : "Не выявлено (метрики в пределах внутренних порогов) или не измерялось.",
    "",
    "## Принятые оптимизации",
    accepted.length
      ? accepted
          .map(
            (attempt) =>
              `- ${attempt.id}: ${formatHypothesisOneLine(attempt.hypothesis)} → \`${attempt.gitRevision}\``,
          )
          .join("\n")
      : "_нет_",
    "",
    "## Отклонённые гипотезы",
    rejected.length ? rejected.map(formatAttemptLine).join("\n") : "_нет_",
    "",
    "## Неубедительные гипотезы",
    inconclusive.length
      ? inconclusive.map(formatAttemptLine).join("\n")
      : "_нет_",
    "",
    "## Сбои итераций",
    failed.length
      ? failed
          .map(
            (attempt) =>
              `- ${attempt.id} @ ${attempt.stage}: ${attempt.errors.join("; ") || attempt.status}`,
          )
          .join("\n")
      : "_нет_",
    "",
    "## Ограничения измерений",
    report.limitations.map((item) => `- ${item}`).join("\n"),
    "",
    "## Lighthouse",
    report.lighthouse
      ? "См. артефакты `lighthouse/` (лабораторная валидация, не полевые CWV)."
      : "_не запускался_",
    "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}
