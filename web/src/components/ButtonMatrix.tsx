import { useState } from "react";
import { api, type ButtonAction, type Device, type Screen } from "../lib/api";

const LABELS = ["A", "B", "C", "D", "E"] as const;

export function describeAction(a: ButtonAction | undefined): string {
  if (!a) return "—";
  switch (a.type) {
    case "goto":
      return `→ Screen ${a.screen}`;
    case "set":
      return `set ${a.key}=${a.value}`;
    case "cycle":
      return `cycle ${a.key}`;
    case "slideshow":
      return a.dir === "next" ? "next photo" : "prev photo";
    case "none":
      return "no-op";
  }
}

/**
 * Rows are buttons, columns are "Device default" plus each screen — the matrix
 * from PRD §6.4. Cells store the exact ButtonAction JSON the engine consumes,
 * so what is saved here is literally what the state engine reads.
 */
export function ButtonMatrix({
  device,
  screens,
  mappings,
  onChanged,
}: {
  device: Device;
  screens: Screen[];
  mappings: Record<string, ButtonAction>;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<{ button: string; screen: Screen | null } | null>(null);
  const buttons = LABELS.slice(0, device.button_count);

  /** Screen override wins, then device default, then no-op (engine order). */
  const resolved = (button: string, screen: Screen): ButtonAction =>
    screen.button_overrides[button] ?? mappings[button] ?? { type: "none" };

  return (
    <section className="card">
      <h2>Buttons</h2>
      <p className="hint">
        A screen's override wins over the device default. Blank cells fall through.
      </p>

      <div className="matrix-scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th />
              <th>Device default</th>
              {screens.map((s) => (
                <th key={s.id}>
                  {s.ordinal}. {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {buttons.map((b) => (
              <tr key={b}>
                <th className="rowhead">{b}</th>
                <td>
                  <button className="cell" onClick={() => setEditing({ button: b, screen: null })}>
                    {describeAction(mappings[b])}
                  </button>
                </td>
                {screens.map((s) => (
                  <td key={s.id}>
                    <button className="cell" onClick={() => setEditing({ button: b, screen: s })}>
                      {s.button_overrides[b] ? (
                        <strong>{describeAction(s.button_overrides[b])}</strong>
                      ) : (
                        <span className="inherited">{describeAction(resolved(b, s))}</span>
                      )}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ResolvedPreview device={device} screens={screens} resolved={resolved} />

      {editing && (
        <ActionEditor
          button={editing.button}
          screen={editing.screen}
          device={device}
          screens={screens}
          current={
            editing.screen ? editing.screen.button_overrides[editing.button] : mappings[editing.button]
          }
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}

/**
 * Flags screens no button can reach — the dead-end check from PRD §6.4. A screen
 * you cannot navigate to is invisible on a real panel, which is easy to create
 * by accident and hard to notice.
 */
function ResolvedPreview({
  device,
  screens,
  resolved,
}: {
  device: Device;
  screens: Screen[];
  resolved: (button: string, screen: Screen) => ButtonAction;
}) {
  const buttons = LABELS.slice(0, device.button_count);
  const reachable = new Set<number>([device.default_screen]);
  for (const from of screens) {
    for (const b of buttons) {
      const a = resolved(b, from);
      if (a.type === "goto") reachable.add(a.screen);
    }
  }
  const unreachable = screens.filter((s) => !reachable.has(s.ordinal));

  if (unreachable.length === 0) {
    return <p className="notice">Every screen is reachable by button or as the device default.</p>;
  }
  return (
    <p className="warn">
      Unreachable: {unreachable.map((s) => `${s.ordinal}. ${s.name}`).join(", ")}. No button maps
      to {unreachable.length > 1 ? "these screens" : "this screen"}, so the device can never show{" "}
      {unreachable.length > 1 ? "them" : "it"}.
    </p>
  );
}

function ActionEditor({
  button,
  screen,
  device,
  screens,
  current,
  onClose,
  onSaved,
}: {
  button: string;
  screen: Screen | null;
  device: Device;
  screens: Screen[];
  current: ButtonAction | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<ButtonAction["type"] | "inherit">(
    current?.type ?? (screen ? "inherit" : "none")
  );
  const [gotoScreen, setGotoScreen] = useState(
    current?.type === "goto" ? current.screen : (screens[0]?.ordinal ?? 1)
  );
  const [key, setKey] = useState(
    current && (current.type === "set" || current.type === "cycle") ? current.key : "mode"
  );
  const [value, setValue] = useState(current?.type === "set" ? String(current.value) : "light");
  const [values, setValues] = useState(
    current?.type === "cycle" ? current.values.join(", ") : "light, dark"
  );
  const [dir, setDir] = useState<"next" | "prev">(
    current?.type === "slideshow" ? current.dir : "next"
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function build(): ButtonAction | null {
    switch (type) {
      case "goto":
        return { type: "goto", screen: gotoScreen };
      case "set":
        return { type: "set", key, value };
      case "cycle":
        return {
          type: "cycle",
          key,
          values: values
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        };
      case "slideshow":
        return { type: "slideshow", dir };
      case "none":
        return { type: "none" };
      default:
        return null; // inherit
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const action = build();
      if (screen) {
        const next = { ...screen.button_overrides };
        if (action) next[button] = action;
        else delete next[button];
        await api.updateScreen(screen.id, { buttonOverrides: next });
      } else if (action) {
        await api.setMapping(device.id, button, action);
      } else {
        await api.clearMapping(device.id, button);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <h3>
          Button {button} — {screen ? `screen ${screen.ordinal} (${screen.name})` : "device default"}
        </h3>

        <label>
          Action
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {screen && <option value="inherit">Inherit device default</option>}
            <option value="goto">Switch screen</option>
            <option value="set">Set state key</option>
            <option value="cycle">Cycle state key</option>
            <option value="slideshow">Slideshow next/prev</option>
            <option value="none">No-op</option>
          </select>
        </label>

        {type === "goto" && (
          <label>
            Target screen
            <select value={gotoScreen} onChange={(e) => setGotoScreen(+e.target.value)}>
              {screens.map((s) => (
                <option key={s.id} value={s.ordinal}>
                  {s.ordinal}. {s.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {(type === "set" || type === "cycle") && (
          <label>
            State key
            <input value={key} onChange={(e) => setKey(e.target.value)} />
          </label>
        )}
        {type === "set" && (
          <label>
            Value
            <input value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
        )}
        {type === "cycle" && (
          <label>
            Values (comma-separated)
            <input value={values} onChange={(e) => setValues(e.target.value)} />
          </label>
        )}
        {type === "slideshow" && (
          <label>
            Direction
            <select value={dir} onChange={(e) => setDir(e.target.value as "next" | "prev")}>
              <option value="next">Next photo</option>
              <option value="prev">Previous photo</option>
            </select>
          </label>
        )}

        <pre className="json-peek">{JSON.stringify(build() ?? "(inherit)", null, 2)}</pre>

        {error && <p className="error">{error}</p>}
        <div className="row gap">
          <button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
