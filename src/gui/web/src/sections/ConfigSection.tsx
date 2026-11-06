import { SelectField, TextField } from "../components/Fields.tsx";

export function ConfigSection(props: {
  configs: string[];
  chosen: string;
  name: string;
  busy: boolean;
  onChoose: (name: string) => void;
  onName: (name: string) => void;
  onOpen: () => void;
  onSave: () => void;
}) {
  return (
    <section className="card">
      <h2>Сохранённые конфиги</h2>
      <div className="repo-row">
        <SelectField
          label="Открыть"
          testId="config-select"
          value={props.chosen}
          onChange={props.onChoose}
          options={[
            { value: "", label: "не выбран" },
            ...props.configs.map((name) => ({ value: name, label: name })),
          ]}
        />
        <button
          type="button"
          data-testid="config-open"
          disabled={props.busy || !props.chosen}
          onClick={props.onOpen}
        >
          Открыть
        </button>
      </div>
      <div className="repo-row">
        <TextField
          label="Имя"
          testId="config-name"
          value={props.name}
          onChange={props.onName}
        />
        <button
          type="button"
          data-testid="config-save"
          disabled={props.busy}
          onClick={props.onSave}
        >
          Сохранить
        </button>
      </div>
    </section>
  );
}
