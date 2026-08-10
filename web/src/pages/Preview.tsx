import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Device } from "../lib/api";

const LABELS = ["A", "B", "C", "D", "E"] as const;

interface DeviceResponse {
  image: string;
  refresh: number;
  sha: string;
  state: Record<string, string | number>;
}

interface Entry {
  at: string;
  trigger: string;
  sha: string;
  unchanged: boolean;
  state: Record<string, string | number>;
  refresh: number;
}

/**
 * An in-browser software device (PRD §6.6).
 *
 * It is deliberately NOT a separate code path: it calls the same
 * `GET /:uuid?state&button=X` the firmware calls, holds the returned `state`
 * client-side exactly as §7.3 describes, and re-requests on each interaction.
 * That is what stops it drifting from real device behaviour and makes it a live
 * integration test of the protocol.
 */
export function PreviewPage() {
  const { id = "" } = useParams();
  const [device, setDevice] = useState<Device | null>(null);
  const [state, setState] = useState<Record<string, string | number> | null>(null);
  const [last, setLast] = useState<DeviceResponse | null>(null);
  const [log, setLog] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);

  // Held in a ref as well so the auto-advance timer always sends current state
  // rather than the state captured when the interval was created.
  const stateRef = useRef<Record<string, string | number> | null>(null);
  const shaRef = useRef<string | null>(null);

  useEffect(() => {
    api.getDevice(id).then(setDevice).catch((e) => setError(e.message));
  }, [id]);

  const poll = useCallback(
    async (button?: string, trigger = button ? `button ${button}` : "refresh tick") => {
      if (!device) return;
      setBusy(true);
      setError(null);
      try {
        // Exactly the firmware's request: held state as query params, plus an
        // optional transient `button`. Never a mock, never an /api shortcut.
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(stateRef.current ?? {})) params.set(k, String(v));
        if (button) params.set("button", button);
        const qs = params.toString();

        const res = await fetch(`/${device.public_uuid}${qs ? `?${qs}` : ""}`);
        if (!res.ok) throw new Error(`device endpoint returned ${res.status}`);
        const data = (await res.json()) as DeviceResponse;

        const unchanged = shaRef.current === data.sha;
        // Persist the returned state wholesale, always — §7.3 step 3.
        stateRef.current = data.state;
        shaRef.current = data.sha;
        setState(data.state);
        setLast(data);
        setLog((l) =>
          [
            {
              at: new Date().toLocaleTimeString(),
              trigger,
              sha: data.sha,
              unchanged,
              state: data.state,
              refresh: data.refresh,
            },
            ...l,
          ].slice(0, 12)
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [device]
  );

  // First boot: no state params at all, so the server applies the default screen.
  useEffect(() => {
    if (device && !last) poll(undefined, "first boot");
  }, [device, last, poll]);

  // Accelerated auto-advance — replays timer wakes without waiting real minutes.
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => poll(undefined, "auto tick"), 3000);
    return () => clearInterval(t);
  }, [auto, poll]);

  if (error && !device) return <p className="error page">{error}</p>;
  if (!device) return <div className="loading">Loading…</div>;

  const buttons = LABELS.slice(0, device.button_count);

  return (
    <div className="page preview-page">
      <div className="page-head">
        <div>
          <Link to={`/devices/${device.id}`} className="link">
            ← {device.name}
          </Link>
          <h1>Preview</h1>
          <p className="muted">
            A software device driving the real endpoint — the same request your Inky Frame makes.
          </p>
        </div>
      </div>

      <div className="preview-layout">
        <div>
          <div
            className="panel"
            style={{ aspectRatio: `${device.width_px} / ${device.height_px}` }}
          >
            {last ? (
              <img src={last.image} alt="Current screen" />
            ) : (
              <div className="panel-empty">Waiting for first render…</div>
            )}
            {busy && <div className="panel-busy">…</div>}
          </div>

          <div className="buttons">
            {buttons.map((b) => (
              <button key={b} disabled={busy} onClick={() => poll(b)}>
                {b}
              </button>
            ))}
          </div>

          <div className="row gap tick-row">
            <button className="ghost" disabled={busy} onClick={() => poll(undefined)}>
              Tick refresh
            </button>
            <label className="radio">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              Auto-advance (3s)
            </label>
            <div className="spacer" />
            <button
              className="ghost"
              onClick={() => {
                stateRef.current = null;
                shaRef.current = null;
                setLast(null);
                setLog([]);
                poll(undefined, "first boot (reset)");
              }}
            >
              Reset to first boot
            </button>
          </div>

          <p className="hint">
            Shown in full colour, as the server sends it. A real panel dithers to its own palette,
            so the on-device appearance is approximate.
          </p>
          {error && <p className="error">{error}</p>}
        </div>

        <aside className="inspector card">
          <h2>Inspector</h2>

          <h4>State the device holds</h4>
          <pre>{JSON.stringify(state ?? {}, null, 2)}</pre>

          <div className="row gap">
            <div>
              <h4>Refresh</h4>
              <p className="big">
                {last ? (last.refresh === 0 ? "never" : `${last.refresh} min`) : "—"}
              </p>
            </div>
            <div>
              <h4>SHA</h4>
              <p className="mono small">{last ? `${last.sha.slice(0, 16)}…` : "—"}</p>
            </div>
          </div>

          {log[0]?.unchanged && (
            <p className="notice">
              Unchanged — the device would skip the download and the panel refresh.
            </p>
          )}

          <h4>Request log</h4>
          <ol className="log">
            {log.map((e, i) => (
              <li key={i} className={e.unchanged ? "muted" : ""}>
                <span className="mono small">{e.at}</span> {e.trigger}
                <br />
                <span className="mono small">{e.sha.slice(0, 12)}…</span>{" "}
                {e.unchanged && <span className="chip">skip</span>}
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
