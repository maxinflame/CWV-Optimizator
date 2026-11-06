import { TextField } from "../components/Fields.tsx";
import type { GuiFormBody } from "../draft.ts";

export function AgentSection(props: {
  form: GuiFormBody;
  onChange: (patch: Partial<GuiFormBody>) => void;
}) {
  return (
    <section className="card">
      <h2>Агент</h2>
      <div className="grid">
        <TextField
          label="Модель"
          required
          value={props.form.agentModel}
          onChange={(agentModel) => props.onChange({ agentModel })}
        />
        <TextField
          label="Усилие рассуждения"
          value={props.form.agentReasoningEffort}
          onChange={(agentReasoningEffort) =>
            props.onChange({ agentReasoningEffort })
          }
        />
      </div>
    </section>
  );
}
