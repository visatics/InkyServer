import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Device, type Preset } from "../lib/api";

export function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = () => api.listDevices().then(setDevices).catch((e) => setError(e.message));

  useEffect(() => {
    reload();
    api.presets().then(setPresets).catch(() => {});
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Devices</h1>
        <button onClick={() => setAdding((v) => !v)}>{adding ? "Cancel" : "Add device"}</button>
      </div>

      {error && <p className="error">{error}</p>}
      {adding && (
        <AddDevice
          presets={presets}
          onAdded={() => {
            setAdding(false);
            reload();
          }}
        />
      )}

      {devices.length === 0 && !adding && (
        <p className="muted">No devices yet. Add one to get started.</p>
      )}

      <div className="grid">
        {devices.map((d) => (
          <DeviceCard key={d.id} device={d} onChanged={reload} />
        ))}
      </div>
    </div>
  );
}

function DeviceCard({ device, onChanged }: { device: Device; onChanged: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(device.public_uuid);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function regenerate() {
    if (
      !confirm(
        "Regenerate the UUID? The old one stops working immediately and the device must be reconfigured."
      )
    )
      return;
    await api.regenerateUuid(device.id);
    onChanged();
  }

  async function remove() {
    if (!confirm(`Delete "${device.name}" and all its screens and images?`)) return;
    await api.deleteDevice(device.id);
    onChanged();
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>{device.name}</h2>
        <span className="chip">
          {device.width_px}×{device.height_px}
        </span>
      </div>

      <label className="uuid-label">
        Device UUID
        <div className="uuid-row">
          <code>{device.public_uuid}</code>
          <button className="ghost" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </label>
      <p className="hint">Paste this into your Inky Frame's settings, with this server's URL.</p>

      <div className="row gap">
        <Link className="button" to={`/devices/${device.id}`}>
          Configure
        </Link>
        <Link className="button" to={`/devices/${device.id}/preview`}>
          Preview
        </Link>
        <div className="spacer" />
        <button className="ghost" onClick={regenerate}>
          New UUID
        </button>
        <button className="danger" onClick={remove}>
          Delete
        </button>
      </div>
    </div>
  );
}

function AddDevice({ presets, onAdded }: { presets: Preset[]; onAdded: () => void }) {
  const [custom, setCustom] = useState(false);
  const [presetId, setPresetId] = useState("");
  const [name, setName] = useState("");
  const [width, setWidth] = useState(600);
  const [height, setHeight] = useState(448);
  const [buttonCount, setButtonCount] = useState(5);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (presets.length && !presetId) setPresetId(presets[0].id);
  }, [presets, presetId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createDevice(custom ? { name, width, height, buttonCount } : { presetId });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="row gap">
        <label className="radio">
          <input type="radio" checked={!custom} onChange={() => setCustom(false)} /> Predefined
        </label>
        <label className="radio">
          <input type="radio" checked={custom} onChange={() => setCustom(true)} /> Custom
        </label>
      </div>

      {!custom ? (
        <label>
          Model
          <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.width}×{p.height}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label>
            Name
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="row gap">
            <label>
              Width
              <input
                type="number"
                min={1}
                max={4096}
                value={width}
                onChange={(e) => setWidth(+e.target.value)}
              />
            </label>
            <label>
              Height
              <input
                type="number"
                min={1}
                max={4096}
                value={height}
                onChange={(e) => setHeight(+e.target.value)}
              />
            </label>
            <label>
              Buttons
              <input
                type="number"
                min={0}
                max={5}
                value={buttonCount}
                onChange={(e) => setButtonCount(+e.target.value)}
              />
            </label>
          </div>
        </>
      )}

      {error && <p className="error">{error}</p>}
      <button type="submit">Create device</button>
    </form>
  );
}
