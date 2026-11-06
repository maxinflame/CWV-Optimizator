import { describeRunActivity } from "../../../activity.ts";
import type { RunView } from "../api.ts";

const statusLabels: Record<RunView["status"], string> = {
  running: "выполняется",
  completed: "завершён",
  failed: "ошибка",
  interrupted: "остановлен",
};

export function StatusSection(props: {
  run: RunView | null;
  busy: boolean;
  onStart: () => void;
  onAbort: () => void;
  onOpenReport: () => void;
}) {
  const running = props.run?.status === "running";
  const activity = props.run
    ? describeRunActivity({
        status: props.run.status,
        mode: props.run.mode,
        progress: props.run.progress,
      })
    : "";
  return (
    <aside className="card status">
      <h2>Прогон</h2>
      <p data-testid="run-status">
        {props.run ? statusLabels[props.run.status] : "не запущен"}
      </p>
      {activity ? (
        <p className="activity" data-testid="run-activity">
          {activity}
        </p>
      ) : null}
      {props.run?.directory ? (
        <p className="path">
          <span>Каталог</span>
          {props.run.directory}
        </p>
      ) : null}
      <div className="actions">
        <button
          type="button"
          className="primary"
          data-testid="start"
          disabled={running || props.busy}
          onClick={props.onStart}
        >
          Запустить
        </button>
        <button
          type="button"
          className="danger"
          disabled={!running}
          onClick={props.onAbort}
        >
          Остановить
        </button>
      </div>
      <button
        type="button"
        className="ghost"
        data-testid="open-report"
        onClick={props.onOpenReport}
      >
        Отчёт
      </button>
    </aside>
  );
}
