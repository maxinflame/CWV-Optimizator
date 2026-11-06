import { SelectField, TextField } from "../components/Fields.tsx";
import type { GuiFormBody } from "../draft.ts";

export function WebsiteSection(props: {
  form: GuiFormBody;
  onChange: (patch: Partial<GuiFormBody>) => void;
}) {
  const external = props.form.serverMode === "external";
  return (
    <section className="card">
      <h2>Сайт</h2>
      <div className="grid">
        <SelectField
          label="Сервер"
          required
          testId="server-mode"
          value={props.form.serverMode}
          onChange={(value) =>
            props.onChange({ serverMode: value as GuiFormBody["serverMode"] })
          }
          options={[
            { value: "external", label: "Уже запущенный URL" },
            { value: "managed", label: "Свой процесс" },
          ]}
        />
        <TextField
          label="Базовый URL"
          required={external}
          testId="base-url"
          value={props.form.baseUrl}
          onChange={(baseUrl) => props.onChange({ baseUrl })}
        />
        <TextField
          label="Команда сборки"
          required={!external}
          value={props.form.buildCommand}
          onChange={(buildCommand) => props.onChange({ buildCommand })}
        />
        <TextField
          label="Команда запуска"
          required={!external}
          testId="start-command"
          value={props.form.startCommand}
          onChange={(startCommand) => props.onChange({ startCommand })}
        />
        <TextField
          label="Путь health-check"
          required
          testId="health-check"
          value={props.form.healthCheckPath}
          onChange={(healthCheckPath) => props.onChange({ healthCheckPath })}
        />
        <TextField
          label="Порт"
          required={!external}
          testId="port"
          value={props.form.port}
          onChange={(port) => props.onChange({ port })}
        />
        <TextField
          label="Таймаут старта, мс"
          value={props.form.startTimeoutMs}
          onChange={(startTimeoutMs) => props.onChange({ startTimeoutMs })}
        />
        <TextField
          label="Команда тестов"
          value={props.form.testCommand}
          onChange={(testCommand) => props.onChange({ testCommand })}
        />
        <TextField
          label="Рабочий каталог"
          hint="Относительно проекта, например frontend"
          value={props.form.cwd}
          onChange={(cwd) => props.onChange({ cwd })}
        />
      </div>
    </section>
  );
}
