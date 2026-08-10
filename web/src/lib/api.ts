import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export interface Device {
  id: string;
  name: string;
  public_uuid: string;
  width_px: number;
  height_px: number;
  button_count: number;
  default_screen: number;
}

export type ButtonAction =
  | { type: "goto"; screen: number }
  | { type: "set"; key: string; value: string | number }
  | { type: "cycle"; key: string; values: (string | number)[] }
  | { type: "slideshow"; dir: "next" | "prev" }
  | { type: "none" };

export interface Screen {
  id: string;
  device_id: string;
  ordinal: number;
  name: string;
  provider: "slideshow" | "debug";
  provider_config: { order?: "sequential" | "random"; fit?: "cover" | "contain" };
  refresh_minutes: number | null;
  button_overrides: Partial<Record<string, ButtonAction>>;
}

export interface Asset {
  id: string;
  screen_id: string;
  storage_key: string;
  original_filename: string | null;
  position: number;
}

export interface Preset {
  id: string;
  name: string;
  width: number;
  height: number;
  buttonCount: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, "not signed in");
  return { authorization: `Bearer ${token}` };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await authHeader();
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const issues = parsed?.issues?.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`);
    throw new ApiError(res.status, issues?.join("; ") || parsed?.error || res.statusText);
  }
  return parsed as T;
}

export const api = {
  presets: () => request<Preset[]>("GET", "/presets"),

  listDevices: () => request<Device[]>("GET", "/devices"),
  getDevice: (id: string) => request<Device>("GET", `/devices/${id}`),
  createDevice: (body: { presetId: string } | { name: string; width: number; height: number; buttonCount: number }) =>
    request<Device>("POST", "/devices", body),
  updateDevice: (id: string, patch: Partial<{ name: string; defaultScreen: number }>) =>
    request<Device>("PATCH", `/devices/${id}`, patch),
  regenerateUuid: (id: string) => request<Device>("POST", `/devices/${id}/regenerate-uuid`),
  deleteDevice: (id: string) => request<void>("DELETE", `/devices/${id}`),

  listScreens: (deviceId: string) => request<Screen[]>("GET", `/devices/${deviceId}/screens`),
  createScreen: (
    deviceId: string,
    body: { name: string; provider: "slideshow" | "debug"; refreshMinutes?: number | null }
  ) => request<Screen>("POST", `/devices/${deviceId}/screens`, body),
  updateScreen: (
    id: string,
    patch: Partial<{
      name: string;
      providerConfig: Screen["provider_config"];
      refreshMinutes: number | null;
      buttonOverrides: Partial<Record<string, ButtonAction>>;
    }>
  ) => request<Screen>("PATCH", `/screens/${id}`, patch),
  reorderScreens: (deviceId: string, orderedIds: string[]) =>
    request<void>("POST", `/devices/${deviceId}/screens/reorder`, { orderedIds }),
  deleteScreen: (id: string) => request<void>("DELETE", `/screens/${id}`),

  getMappings: (deviceId: string) =>
    request<Record<string, ButtonAction>>("GET", `/devices/${deviceId}/mappings`),
  setMapping: (deviceId: string, button: string, action: ButtonAction) =>
    request<{ button: string; action: ButtonAction }>(
      "PUT",
      `/devices/${deviceId}/mappings/${button}`,
      action
    ),
  clearMapping: (deviceId: string, button: string) =>
    request<void>("DELETE", `/devices/${deviceId}/mappings/${button}`),

  listAssets: (screenId: string) => request<Asset[]>("GET", `/screens/${screenId}/assets`),
  reorderAssets: (screenId: string, orderedIds: string[]) =>
    request<void>("POST", `/screens/${screenId}/assets/reorder`, { orderedIds }),
  deleteAsset: (id: string) => request<void>("DELETE", `/assets/${id}`),

  /** Multipart, so it bypasses the JSON helper. */
  uploadAsset: async (screenId: string, file: File): Promise<Asset> => {
    const headers = await authHeader();
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/screens/${screenId}/assets`, {
      method: "POST",
      headers,
      body: form,
    });
    const parsed = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, parsed?.error ?? res.statusText);
    return parsed as Asset;
  },
};
