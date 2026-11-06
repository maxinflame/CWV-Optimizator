import { useEffect, useState } from "react";
import { describeRunActivity } from "../../activity.ts";
import {
  attemptStatusLabel,
  formatMetric,
  limitationLabel,
  outcomeText,
  plainError,
  scenarioTitle,
  stageLabel,
  translateReason,
  validationNotes,
} from "../../reportView.ts";
import { fetchReport, type RunView } from "./api.ts";
import type { WebsiteReport } from "../../../website/report.ts";

const metricColumns = ["lcpMs", "fcpMs", "inpMs", "cls", "ttfbMs"] as const;

function when(value: string | undefined): string {
  if (!value) return "ещё идёт";
  return new Date(value).toLocaleString("ru-RU");
}

function Metrics(props: {
  report: WebsiteReport;
  scenarios: WebsiteReport["baseline"];
}) {
  if (!props.scenarios?.length) return <p>Замеров ещё нет.</p>;
  return (
    <table className="metrics">
      <thead>
        <tr>
          <th>Сценарий</th>
          {metricColumns.map((metric) => (
            <th key={metric}>{metricHeading(metric)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.scenarios.map((item) => (
          <tr key={item.scenario}>
            <td>{scenarioTitle(props.report, item.scenario)}</td>
            {metricColumns.map((metric) => (
              <td key={metric}>{formatMetric(metric, item.medians[metric])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function metricHeading(metric: string): string {
  if (metric === "lcpMs") return "LCP";
  if (metric === "fcpMs") return "FCP";
  if (metric === "inpMs") return "INP";
  if (metric === "cls") return "CLS";
  return "TTFB";
}

export function ReportPage(props: { run: RunView | null }) {
  const [report, setReport] = useState<WebsiteReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const body = await fetchReport();
        if (!stop) {
          setReport(body.report);
          setError("");
        }
      } catch (reason) {
        if (!stop)
          setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
    void load();
    if (props.run?.status !== "running")
      return () => {
        stop = true;
      };
    const timer = window.setInterval(() => void load(), 1000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [props.run?.status, props.run?.directory]);

  const activity = props.run
    ? describeRunActivity({
        status: props.run.status,
        mode: props.run.mode,
        progress: props.run.progress,
      })
    : "";
  const notes = validationNotes(report?.stopReason);
  const outcome = outcomeText(report?.stopReason);
  const failure = plainError(props.run?.error);

  return (
    <div className="report" data-testid="report-page">
      <section className="card">
        <h2>Отчёт</h2>
        {activity ? <p className="activity">{activity}</p> : null}
        {!report ? (
          <p>Отчёта ещё нет. Запустите прогон на странице настроек.</p>
        ) : (
          <dl className="locked">
            <div>
              <dt>Начат</dt>
              <dd>{when(report.startedAt)}</dd>
            </div>
            <div>
              <dt>Закончен</dt>
              <dd>{when(report.finishedAt)}</dd>
            </div>
          </dl>
        )}
        {error ? <p className="error-text">{error}</p> : null}
      </section>
      {notes ? (
        <section className="card">
          <h2>Что проверено</h2>
          <ul>
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {failure ? (
        <section className="card">
          <h2>Ошибка</h2>
          <p className="error-text">{failure}</p>
        </section>
      ) : null}
      {outcome && !failure ? (
        <section className="card">
          <h2>Итог</h2>
          <p>{outcome}</p>
        </section>
      ) : null}
      {report?.git ? (
        <section className="card">
          <h2>Git</h2>
          <dl className="locked">
            <div>
              <dt>Исходная ветка</dt>
              <dd>{report.git.originalBranch}</dd>
            </div>
            <div>
              <dt>Ветка оптимизации</dt>
              <dd>{report.git.optimizationBranch}</dd>
            </div>
            <div>
              <dt>Начальный коммит</dt>
              <dd>{report.git.baselineCommit.slice(0, 12)}</dd>
            </div>
            <div>
              <dt>Принятый коммит</dt>
              <dd>
                {(report.bestCommit ?? report.git.acceptedCommit).slice(0, 12)}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}
      {report?.baseline ? (
        <section className="card">
          <h2>Начальные замеры</h2>
          <Metrics report={report} scenarios={report.baseline} />
        </section>
      ) : null}
      {report?.bottleneck ? (
        <section className="card">
          <h2>Узкое место</h2>
          <p>
            {metricHeading(report.bottleneck.metric)} на{" "}
            {scenarioTitle(report, report.bottleneck.scenario)}. Медиана{" "}
            {formatMetric(report.bottleneck.metric, report.bottleneck.median)},
            порог{" "}
            {formatMetric(
              report.bottleneck.metric,
              report.bottleneck.threshold,
            )}
            .
          </p>
        </section>
      ) : null}
      {report?.attempts.length ? (
        <section className="card">
          <h2>Итерации</h2>
          {report.attempts.map((attempt) => (
            <article className="subcard" key={attempt.id}>
              <h3>
                {attempt.id}: {attemptStatusLabel(attempt.status)}
              </h3>
              <p>
                Шаг: {stageLabel(attempt.stage)}
                {attempt.targetMetric
                  ? `, метрика ${metricHeading(attempt.targetMetric)}`
                  : ""}
                {attempt.targetScenario
                  ? `, ${scenarioTitle(report, attempt.targetScenario)}`
                  : ""}
              </p>
              {attempt.hypothesis ? <p>{attempt.hypothesis}</p> : null}
              {attempt.decision ? (
                <ul>
                  {attempt.decision.reasons.map((reason) => (
                    <li key={reason}>{translateReason(reason)}</li>
                  ))}
                </ul>
              ) : null}
              {attempt.errors.map((item) => (
                <p className="error-text" key={item}>
                  {plainError(item)}
                </p>
              ))}
              {attempt.quick ? (
                <Metrics report={report} scenarios={attempt.quick} />
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
      {report && (report.baseline || report.attempts.length) ? (
        <section className="card">
          <h2>Ограничения</h2>
          <ul>
            {report.limitations.map((item) => (
              <li key={item}>{limitationLabel(item)}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
