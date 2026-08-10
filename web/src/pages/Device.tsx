import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Asset, type ButtonAction, type Device, type Screen } from "../lib/api";
import { ButtonMatrix } from "../components/ButtonMatrix";

export function DevicePage() {
  const { id = "" } = useParams();
  const [device, setDevice] = useState<Device | null>(null);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [mappings, setMappings] = useState<Record<string, ButtonAction>>({});
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [d, s, m] = await Promise.all([
        api.getDevice(id),
        api.listScreens(id),
        api.getMappings(id),
      ]);
      setDevice(d);
      setScreens(s);
      setMappings(m);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (error) return <p className="error page">{error}</p>;
  if (!device) return <div className="loading">Loading…</div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to="/" className="link">
            ← Devices
          </Link>
          <h1>{device.name}</h1>
          <p className="muted">
            {device.width_px}×{device.height_px} · {device.button_count} buttons · default screen{" "}
            {device.default_screen}
          </p>
        </div>
        <Link className="button" to={`/devices/${device.id}/preview`}>
          Open Preview
        </Link>
      </div>

      <ScreenList device={device} screens={screens} onChanged={reload} />
      <ButtonMatrix device={device} screens={screens} mappings={mappings} onChanged={reload} />
    </div>
  );
}

function ScreenList({
  device,
  screens,
  onChanged,
}: {
  device: Device;
  screens: Screen[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<"slideshow" | "debug">("slideshow");
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createScreen(device.id, { name: name || "Untitled", provider, refreshMinutes: 5 });
      setName("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function move(index: number, delta: number) {
    const next = [...screens];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await api.reorderScreens(
      device.id,
      next.map((s) => s.id)
    );
    onChanged();
  }

  return (
    <section className="card">
      <h2>Screens</h2>
      {screens.length === 0 && <p className="muted">No screens yet.</p>}

      {screens.map((s, i) => (
        <ScreenRow
          key={s.id}
          screen={s}
          device={device}
          isFirst={i === 0}
          isLast={i === screens.length - 1}
          onMove={(d) => move(i, d)}
          onChanged={onChanged}
        />
      ))}

      <form className="row gap add-screen" onSubmit={add}>
        <input
          placeholder="New screen name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
          <option value="slideshow">Slideshow</option>
          <option value="debug">Debug</option>
        </select>
        <button type="submit">Add screen</button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function ScreenRow({
  screen,
  device,
  isFirst,
  isLast,
  onMove,
  onChanged,
}: {
  screen: Screen;
  device: Device;
  isFirst: boolean;
  isLast: boolean;
  onMove: (delta: number) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isDefault = device.default_screen === screen.ordinal;

  async function patch(p: Parameters<typeof api.updateScreen>[1]) {
    await api.updateScreen(screen.id, p);
    onChanged();
  }

  return (
    <div className="screen-row">
      <div className="row gap">
        <span className="chip">{screen.ordinal}</span>
        <strong>{screen.name}</strong>
        <span className="muted">{screen.provider}</span>
        {isDefault && <span className="chip accent">default</span>}
        <div className="spacer" />
        <button className="ghost" disabled={isFirst} onClick={() => onMove(-1)} title="Move up">
          ↑
        </button>
        <button className="ghost" disabled={isLast} onClick={() => onMove(1)} title="Move down">
          ↓
        </button>
        <button className="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Edit"}
        </button>
      </div>

      {open && (
        <div className="screen-detail">
          <div className="row gap wrap">
            <label>
              Name
              <input
                defaultValue={screen.name}
                onBlur={(e) => e.target.value !== screen.name && patch({ name: e.target.value })}
              />
            </label>
            <label>
              Refresh (minutes, 0 = never)
              <input
                type="number"
                min={0}
                defaultValue={screen.refresh_minutes ?? 0}
                onBlur={(e) => patch({ refreshMinutes: +e.target.value })}
              />
            </label>
            {screen.provider === "slideshow" && (
              <>
                <label>
                  Order
                  <select
                    defaultValue={screen.provider_config.order ?? "sequential"}
                    onChange={(e) =>
                      patch({
                        providerConfig: {
                          ...screen.provider_config,
                          order: e.target.value as "sequential" | "random",
                        },
                      })
                    }
                  >
                    <option value="sequential">Sequential</option>
                    <option value="random">Random</option>
                  </select>
                </label>
                <label>
                  Fit
                  <select
                    defaultValue={screen.provider_config.fit ?? "cover"}
                    onChange={(e) =>
                      patch({
                        providerConfig: {
                          ...screen.provider_config,
                          fit: e.target.value as "cover" | "contain",
                        },
                      })
                    }
                  >
                    <option value="cover">Cover (crop)</option>
                    <option value="contain">Contain (letterbox)</option>
                  </select>
                </label>
              </>
            )}
          </div>

          <div className="row gap">
            {!isDefault && (
              <button
                className="ghost"
                onClick={async () => {
                  await api.updateDevice(device.id, { defaultScreen: screen.ordinal });
                  onChanged();
                }}
              >
                Make device default
              </button>
            )}
            <div className="spacer" />
            <button
              className="danger"
              onClick={async () => {
                if (!confirm(`Delete screen "${screen.name}"?`)) return;
                await api.deleteScreen(screen.id);
                onChanged();
              }}
            >
              Delete screen
            </button>
          </div>

          {screen.provider === "slideshow" && <AssetManager screenId={screen.id} />}
        </div>
      )}
    </div>
  );
}

function AssetManager({ screenId }: { screenId: string }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(
    () => api.listAssets(screenId).then(setAssets).catch(() => {}),
    [screenId]
  );

  useEffect(() => {
    reload();
  }, [reload]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) await api.uploadAsset(screenId, file);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function move(index: number, delta: number) {
    const next = [...assets];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setAssets(next);
    await api.reorderAssets(
      screenId,
      next.map((a) => a.id)
    );
    reload();
  }

  return (
    <div className="assets">
      <h4>Images</h4>
      {assets.length === 0 && <p className="muted">No images yet — the screen will show an error card.</p>}
      <ol className="asset-list">
        {assets.map((a, i) => (
          <li key={a.id}>
            <span className="chip">{i + 1}</span>
            <span className="filename">{a.original_filename ?? a.id}</span>
            <div className="spacer" />
            <button className="ghost" disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button className="ghost" disabled={i === assets.length - 1} onClick={() => move(i, 1)}>
              ↓
            </button>
            <button
              className="danger"
              onClick={async () => {
                await api.deleteAsset(a.id);
                reload();
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ol>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        disabled={busy}
        onChange={(e) => upload(e.target.files)}
      />
      {busy && <p className="muted">Uploading…</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
