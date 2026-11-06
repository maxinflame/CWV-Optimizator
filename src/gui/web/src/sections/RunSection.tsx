import { SelectField, TextField } from "../components/Fields.tsx";
import type { GuiFormBody } from "../draft.ts";

export function RunSection(props: {
  form: GuiFormBody;
  picking: boolean;
  onPickRepository: () => void;
  onChange: (patch: Partial<GuiFormBody>) => void;
}) {
  return (
    <section className="card">
      <h2>Репозиторий</h2>
      <div className="repo-row">
        <TextField
          label="Каталог"
          required
          testId="workspace-path"
          hint="Абсолютный путь, в том числе UNC WSL"
          value={props.form.workspacePath}
          onChange={(workspacePath) => props.onChange({ workspacePath })}
        />
        <button
          type="button"
          data-testid="pick-repository"
          disabled={props.picking}
          onClick={props.onPickRepository}
        >
          Выбрать
        </button>
      </div>
      <h2>Запуск</h2>
      <SelectField
        label="Режим"
        required
        value={props.form.mode}
        testId="run-mode"
        onChange={(value) =>
          props.onChange({ mode: value as GuiFormBody["mode"] })
        }
        options={[
          { value: "measure", label: "Только замер" },
          { value: "validate", label: "Проверка окружения" },
          { value: "optimize", label: "Оптимизация" },
        ]}
      />
      <dl className="locked">
        <div>
          <dt>Режим рабочей копии</dt>
          <dd>direct</dd>
        </div>
        <div>
          <dt>Версии</dt>
          <dd>git</dd>
        </div>
        <div>
          <dt>Чистое дерево</dt>
          <dd>да</dd>
        </div>
        <div>
          <dt>Провайдер агента</dt>
          <dd>cursor</dd>
        </div>
      </dl>
    </section>
  );
}
