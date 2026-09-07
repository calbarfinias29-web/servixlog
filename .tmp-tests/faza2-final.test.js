// tests/faza2-final.test.ts
import assert from "node:assert/strict";

// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";
var supabaseUrl = "https://placeholder.supabase.co";
var supabaseAnonKey = "placeholder-anon-key";
var supabase = createClient(supabaseUrl, supabaseAnonKey);

// src/data/SupabaseDataAdapter.ts
var SupabaseDataAdapter = class {
  async getEmployees() {
    const { data, error } = await supabase.from("employees").select("*").order("name");
    return { data, error };
  }
  async getCars() {
    const { data, error } = await supabase.from("cars").select("*, jobs(*), plate_history(*), mileage_log(*), car_photos(*)").order("created_at", { ascending: false });
    return { data, error };
  }
  async getJobs() {
    const { data, error } = await supabase.from("jobs").select("*").order("order_index");
    return { data, error };
  }
  async getSchedule() {
    const { data, error } = await supabase.from("work_schedule").select("*").eq("active", true).limit(1).maybeSingle();
    return { data, error };
  }
  async getRates() {
    const { data, error } = await supabase.from("rates").select("*").eq("active", true).limit(1).maybeSingle();
    return { data, error };
  }
  async getThemes() {
    const { data, error } = await supabase.from("themes").select("*").order("name");
    return { data, error };
  }
  async getAppointments() {
    const { data, error } = await supabase.from("appointments").select("*").order("appointment_date", { ascending: true }).order("appointment_time", { ascending: true });
    return { data, error };
  }
  async getVehicleMakes() {
    const { data, error } = await supabase.from("vehicle_makes").select("id, name, normalized_name").order("name");
    return { data, error };
  }
  async getVehicleModels() {
    const { data, error } = await supabase.from("vehicle_models").select("id, make_id, name, normalized_name").order("name");
    return { data, error };
  }
  async getWorkCatalog() {
    const { data, error } = await supabase.from("work_catalog").select("id, name, normalized_name").order("name");
    return { data, error };
  }
  async getCarActivityLog(carId) {
    const { data, error } = await supabase.from("activity_log").select("id, action, detail, created_at").eq("car_id", carId).order("created_at", { ascending: true });
    return { data, error };
  }
  async getTimeEntries(params) {
    let query = supabase.from("time_entries").select("employee_id, job_id, start_time, end_time, duration_seconds, is_overtime, jobs!inner(car_id)").gte("start_time", params.fromIso).lte("start_time", params.toIso);
    if (params.employeeId) query = query.eq("employee_id", params.employeeId);
    const { data, error } = await query;
    return { data, error };
  }
};

// src/data/LocalDataAdapter.ts
var DEFAULT_LOCAL_SERVER_URL = "http://127.0.0.1:8787";
function localError(message, code = "LOCAL_HTTP") {
  return { message, details: "", hint: "", code };
}
var LocalDataAdapter = class {
  baseUrl;
  constructor(baseUrl = DEFAULT_LOCAL_SERVER_URL) {
    this.baseUrl = baseUrl;
  }
  /** GET generic + mapare erori (rețea / HTTP / JSON) în QueryResult. */
  async request(path) {
    const url = `${this.baseUrl.replace(/\/+$/, "")}${path}`;
    let res;
    try {
      res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    } catch (err) {
      return {
        data: null,
        error: localError(
          `Local Server indisponibil la ${this.baseUrl} (${err instanceof Error ? err.message : String(err)}).`,
          "LOCAL_UNAVAILABLE"
        )
      };
    }
    if (!res.ok) {
      return {
        data: null,
        error: localError(`Local Server error: HTTP ${res.status} la ${path}.`, `LOCAL_HTTP_${res.status}`)
      };
    }
    try {
      const json = await res.json();
      return { data: json, error: null };
    } catch (err) {
      return {
        data: null,
        error: localError(
          `R\u0103spuns invalid din Local Server (${err instanceof Error ? err.message : String(err)}).`,
          "LOCAL_INVALID_JSON"
        )
      };
    }
  }
  async field(path, field) {
    const { data, error } = await this.request(path);
    if (error) return { data: null, error };
    const record = data;
    return { data: record?.[field] ?? null, error: null };
  }
  async getEmployees() {
    return this.field("/api/employees", "employees");
  }
  async getCars() {
    return this.field("/api/cars", "cars");
  }
  async getJobs() {
    return this.field("/api/jobs", "jobs");
  }
  async getSchedule() {
    return this.field("/api/schedule", "schedule");
  }
  async getRates() {
    return this.field("/api/rates", "rates");
  }
  async getThemes() {
    return this.field("/api/themes", "themes");
  }
  async getAppointments() {
    return this.field("/api/appointments", "appointments");
  }
  async getVehicleMakes() {
    return this.field("/api/vehicle-makes", "makes");
  }
  async getVehicleModels() {
    return this.field("/api/vehicle-models", "models");
  }
  async getWorkCatalog() {
    return this.field("/api/work-catalog", "catalog");
  }
  async getCarActivityLog(carId) {
    return this.field(`/api/activity-log?carId=${encodeURIComponent(carId)}`, "entries");
  }
  async getTimeEntries(params) {
    const qs = new URLSearchParams({ fromIso: params.fromIso, toIso: params.toIso });
    if (params.employeeId) qs.set("employeeId", params.employeeId);
    return this.field(`/api/time-entries?${qs.toString()}`, "entries");
  }
  // ============================ FAZA 7A — WRITE LOCAL ============================
  /**
   * POST/PATCH generic spre Local Server. Erorile sunt mapate identic cu
   * request() (LOCAL_UNAVAILABLE / LOCAL_HTTP_<status>), fără fallback la
   * Supabase. Body-ul este JSON validat server-side — niciodată SQL.
   */
  async send(method, path, body) {
    const url = `${this.baseUrl.replace(/\/+$/, "")}${path}`;
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {})
      });
    } catch (err) {
      return {
        data: null,
        error: localError(
          `Local Server indisponibil la ${this.baseUrl} (${err instanceof Error ? err.message : String(err)}).`,
          "LOCAL_UNAVAILABLE"
        )
      };
    }
    if (!res.ok) {
      let message = `Local Server error: HTTP ${res.status} la ${path}.`;
      try {
        const detail = await res.json();
        if (detail?.error) message += ` (${detail.error}${detail.issues ? `: ${detail.issues.map((i) => i.field).join(", ")}` : ""})`;
      } catch {
      }
      return { data: null, error: localError(message, `LOCAL_HTTP_${res.status}`) };
    }
    try {
      const json = await res.json();
      return { data: json, error: null };
    } catch (err) {
      return {
        data: null,
        error: localError(
          `R\u0103spuns invalid din Local Server (${err instanceof Error ? err.message : String(err)}).`,
          "LOCAL_INVALID_JSON"
        )
      };
    }
  }
  /** Extrage entitatea din payload-ul { ok, <singular> }. */
  entity(result, key) {
    if (result.error) return { data: null, error: result.error };
    return { data: result.data?.[key] ?? null, error: null };
  }
  timerResult(result) {
    if (result.error) return { data: null, error: result.error };
    return { data: result.data, error: null };
  }
  async createCar(input) {
    return this.entity(await this.send("POST", "/api/cars", input), "car");
  }
  async updateCar(id, input) {
    return this.entity(await this.send("PATCH", `/api/cars/${encodeURIComponent(id)}`, input), "car");
  }
  async createJob(input) {
    return this.entity(await this.send("POST", "/api/jobs", input), "job");
  }
  async updateJob(id, input) {
    return this.entity(await this.send("PATCH", `/api/jobs/${encodeURIComponent(id)}`, input), "job");
  }
  async createEmployee(input) {
    return this.entity(await this.send("POST", "/api/employees", input), "employee");
  }
  async updateEmployee(id, input) {
    return this.entity(await this.send("PATCH", `/api/employees/${encodeURIComponent(id)}`, input), "employee");
  }
  async createAppointment(input) {
    return this.entity(await this.send("POST", "/api/appointments", input), "appointment");
  }
  async updateAppointment(id, input) {
    return this.entity(await this.send("PATCH", `/api/appointments/${encodeURIComponent(id)}`, input), "appointment");
  }
  async deleteAppointment(id) {
    return this.entity(await this.send("DELETE", `/api/appointments/${encodeURIComponent(id)}`, {}), "appointment");
  }
  async updateRates(input) {
    return this.entity(await this.send("PATCH", "/api/rates", input), "rates");
  }
  async updateSchedule(input) {
    return this.entity(await this.send("PATCH", "/api/schedule", input), "schedule");
  }
  async startJobTimer(input) {
    return this.timerResult(await this.send("POST", "/api/timer/start", input));
  }
  async updateJobTimerStatus(input) {
    return this.timerResult(await this.send("POST", "/api/timer/status", input));
  }
  async startOvertimeTimer(input) {
    return this.timerResult(await this.send("POST", "/api/timer/overtime/start", input));
  }
  async stopOvertimeTimer(input) {
    return this.timerResult(await this.send("POST", "/api/timer/overtime/stop", input));
  }
  async takeoverJob(input) {
    return this.timerResult(await this.send("POST", "/api/timer/takeover", input));
  }
  async transferJob(input) {
    return this.timerResult(await this.send("POST", "/api/timer/transfer", input));
  }
  async getTimerState(jobId) {
    const result = await this.request(`/api/timer/${encodeURIComponent(jobId)}`);
    return this.timerResult({ data: result.data, error: result.error });
  }
  async getDevices() {
    return this.field("/api/devices", "devices").then((result) => ({ data: result.data ? { devices: result.data } : null, error: result.error }));
  }
  async createDevicePairing(input) {
    return this.send("POST", "/api/devices/pair", input).then((result) => ({ data: result.data, error: result.error }));
  }
  async revokeDevice(deviceId) {
    return this.send("POST", "/api/devices/revoke", { deviceId }).then((result) => ({ data: result.data, error: result.error }));
  }
  async reactivateDevice(deviceId) {
    return this.send("POST", "/api/devices/reactivate", { deviceId }).then((result) => ({ data: result.data, error: result.error }));
  }
  subscribeToEvents(onEvent, options = {}) {
    let stopped = false;
    let retryTimer = null;
    let controller = null;
    let retryDelay = 1e3;
    const connect = async () => {
      if (stopped) return;
      options.onStatus?.("connecting");
      controller = new AbortController();
      const headers = { Accept: "text/event-stream" };
      if (options.deviceId) headers["x-servix-device-id"] = options.deviceId;
      if (options.credential) headers["x-servix-device-credential"] = options.credential;
      try {
        const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/api/events`, { headers, signal: controller.signal });
        if (response.status === 401 || response.status === 403) {
          options.onStatus?.("revoked");
          return;
        }
        if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);
        options.onStatus?.("online");
        retryDelay = 1e3;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!stopped) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
            if (data) {
              try {
                onEvent(JSON.parse(data));
              } catch {
              }
            }
          }
        }
        if (!stopped) throw new Error("SSE disconnected");
      } catch (error) {
        if (!stopped && error.name !== "AbortError") {
          options.onStatus?.("offline");
          retryTimer = setTimeout(() => void connect(), retryDelay);
          retryDelay = Math.min(retryDelay * 2, 3e4);
        }
      }
    };
    void connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      controller?.abort();
      options.onStatus?.("offline");
    };
  }
};

// src/data/registry.ts
var DefaultAdapterRegistry = class {
  _kind = "supabase";
  current;
  factories;
  defaultBaseUrl;
  constructor(factories, defaultBaseUrl) {
    this.factories = factories;
    this.defaultBaseUrl = defaultBaseUrl;
    this.current = factories.supabase();
  }
  get kind() {
    return this._kind;
  }
  adapter() {
    return this.current;
  }
  enableLocal(baseUrl) {
    this._kind = "local";
    this.current = this.factories.local(baseUrl || this.defaultBaseUrl);
  }
  enableSupabase() {
    this._kind = "supabase";
    this.current = this.factories.supabase();
  }
};

// src/data/index.ts
function localServerUrl() {
  const envUrl = import.meta.env?.VITE_SERVIX_LOCAL_URL;
  return envUrl && envUrl.trim() ? envUrl.trim() : DEFAULT_LOCAL_SERVER_URL;
}
var registry = new DefaultAdapterRegistry(
  {
    supabase: () => new SupabaseDataAdapter(),
    local: (baseUrl) => new LocalDataAdapter(baseUrl)
  },
  localServerUrl()
);
var dataAdapter = new Proxy(registry, {
  get(target, prop) {
    const active = target.adapter();
    const value = active[prop];
    return typeof value === "function" ? value.bind(active) : value;
  }
});

// src/agent/agent-security.ts
function normalizeConfirmationText(text) {
  return String(text ?? "").toLowerCase().normalize("NFC").replace(/[şș]/g, "s").replace(/[ţț]/g, "t").replace(/ă/g, "a").replace(/â/g, "a").replace(/î/g, "i").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
var APPROVED_PHRASES = [
  "da",
  "da confirm",
  "da confirm modificarea",
  "confirm",
  "confirm modificarea",
  "confirmarea",
  "confirmare",
  "executa",
  "sigur",
  "da da"
];
var NEGATION_WORDS = [
  "nu",
  "anuleaza",
  "renunta",
  "refuza",
  "lasa",
  "opreste"
];
function hasWord(text, word) {
  return new RegExp("(^| )" + word + "( |$)").test(text);
}
function parseConfirmation(response) {
  const t = normalizeConfirmationText(response);
  if (!t) {
    return { status: "ambiguous", reason: "empty-or-whitespace" };
  }
  if (NEGATION_WORDS.some((w) => hasWord(t, w))) {
    return { status: "rejected", reason: "explicit-refusal" };
  }
  if (APPROVED_PHRASES.includes(t)) {
    return { status: "approved", reason: "explicit-approval" };
  }
  if (/^da(\s|$)/.test(t)) {
    const tail = t.replace(/^da/, "").trim();
    if (tail === "" || /^(da|confirm|confirma|executa|sigur)/.test(tail)) {
      return { status: "approved", reason: "explicit-approval" };
    }
    return { status: "ambiguous", reason: "hedged-approval" };
  }
  if (/^(confirm|confirma|executa)/.test(t)) {
    return { status: "approved", reason: "explicit-approval" };
  }
  return { status: "ambiguous", reason: "no-explicit-confirmation" };
}
var WRITE_ARMED = true;
var ALLOWED_WRITE_ACTIONS = [
  "update_rates",
  "update_schedule",
  "create_car",
  "update_car",
  "update_client"
];
function isWriteActionAllowed(action) {
  return ALLOWED_WRITE_ACTIONS.includes(action);
}
var pendingOperationSequence = 0;
function createPendingOperation(action, target, proposedChanges) {
  pendingOperationSequence += 1;
  const createdAt = Date.now();
  return {
    operationId: `${action}-${createdAt}-${pendingOperationSequence}`,
    action,
    target,
    proposedChanges,
    createdAt
  };
}
function evaluatePendingConfirmation(pending, decision) {
  if (!WRITE_ARMED) {
    return {
      canExecute: false,
      reason: "write-disabled (FAZA 2A)",
      state: pending ? "awaiting_confirmation" : "idle"
    };
  }
  if (!pending) {
    return { canExecute: false, reason: "no-pending-operation", state: "idle" };
  }
  if (!isWriteActionAllowed(pending.action)) {
    return {
      canExecute: false,
      reason: "action-not-enabled (FAZA 2B ETAPA 2: update_rates/update_schedule/create_car/update_car/update_client)",
      state: "cancelled"
    };
  }
  if (decision.status === "rejected") {
    return { canExecute: false, reason: "refused-by-user", state: "cancelled" };
  }
  if (decision.status !== "approved") {
    return { canExecute: false, reason: "ambiguous-requires-explicit-confirmation", state: "awaiting_confirmation" };
  }
  return { canExecute: true, reason: "approved-for-pending-operation", state: "executing" };
}

// src/agent/agent-write-flow.ts
function norm(text) {
  return String(text ?? "").toLowerCase().normalize("NFC").replace(/ş/g, "s").replace(/ţ/g, "t").replace(/ș/g, "s").replace(/ț/g, "t").replace(/ă/g, "a").replace(/â/g, "a").replace(/î/g, "i").replace(/\s+/g, " ").trim();
}
var RO_UNITS = {
  zero: 0,
  unu: 1,
  una: 1,
  o: 1,
  doi: 2,
  doua: 2,
  trei: 3,
  patru: 4,
  cinci: 5,
  sase: 6,
  sapte: 7,
  opt: 8,
  noua: 9,
  zece: 10,
  unsprezece: 11,
  doisprezece: 12,
  treisprezece: 13,
  paisprezece: 14,
  cincisprezece: 15,
  saisprezece: 16,
  saptesprezece: 17,
  optsprezece: 18,
  nouasprezece: 19
};
var RO_TENS = {
  douazeci: 20,
  treizeci: 30,
  patruzeci: 40,
  cincizeci: 50,
  saizeci: 60,
  saptezeci: 70,
  optzeci: 80,
  nouazeci: 90
};
function parseRomanianNumberPhrase(tokens) {
  let total = 0, current = 0, any = false;
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk === "si") {
      const prev = tokens[i - 1], next = tokens[i + 1];
      if (!(prev && prev in RO_TENS && next && (next in RO_UNITS || next in RO_TENS))) return null;
      continue;
    }
    if (tk in RO_UNITS) {
      current += RO_UNITS[tk];
      any = true;
    } else if (tk in RO_TENS) {
      current += RO_TENS[tk];
      any = true;
    } else if (tk === "suta" || tk === "sute") {
      current = (current || 1) * 100;
      total += current;
      current = 0;
    } else if (tk === "mie" || tk === "mii") {
      current = (current || 1) * 1e3;
      total += current;
      current = 0;
    } else return null;
  }
  if (!any) return null;
  const value = total + current;
  return Number.isFinite(value) ? value : null;
}
var RO_NUMBER_WORD = new RegExp(
  "^(" + Object.keys(RO_UNITS).join("|") + "|" + Object.keys(RO_TENS).join("|") + "|suta|sute|mie|mii|si)$"
);
function convertRomanianNumberWords(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      const v = parseRomanianNumberPhrase(run);
      if (v !== null) {
        out.push(String(v));
        run = [];
        return;
      }
    }
    out.push(...run);
    run = [];
  };
  for (const w of words) {
    if (RO_NUMBER_WORD.test(w)) {
      run.push(w);
    } else {
      flush();
      out.push(w);
    }
  }
  flush();
  return out.join(" ");
}
var RATE_FIELDS = {
  normal: { key: "normal_rate", label: "Tariful normal", unit: "lei/or\u0103" },
  normal_rate: { key: "normal_rate", label: "Tariful normal", unit: "lei/or\u0103" },
  urgent: { key: "urgent_rate", label: "Tariful urgent", unit: "lei/or\u0103" },
  urgenta: { key: "urgent_rate", label: "Tariful urgent", unit: "lei/or\u0103" },
  overtime: { key: "overtime_rate", label: "Tariful overtime", unit: "lei/or\u0103" },
  suplimentar: { key: "overtime_rate", label: "Tariful overtime", unit: "lei/or\u0103" },
  garantie: { key: "warranty_rate", label: "Tariful garan\u021Bie", unit: "lei/or\u0103" }
};
var DAYS = {
  luni: "monday",
  marti: "tuesday",
  miercuri: "wednesday",
  joi: "thursday",
  vineri: "friday",
  sambata: "saturday",
  duminica: "sunday"
};
var DAY_LABELS = {
  monday: "Luni",
  tuesday: "Mar\u021Bi",
  wednesday: "Miercuri",
  thursday: "Joi",
  friday: "Vineri",
  saturday: "S\xE2mb\u0103t\u0103",
  sunday: "Duminic\u0103"
};
function validateRateValue(raw) {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return { ok: false, error: "Valoarea nu este un numar valid." };
  if (n < 0) return { ok: false, error: "Valoarea nu poate fi negativa." };
  if (n > 1e5) return { ok: false, error: "Valoarea este implausibil de mare." };
  return { ok: true, value: Math.round(n * 100) / 100 };
}
function validateVatValue(raw) {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return { ok: false, error: "Valoarea TVA nu este un numar valid." };
  if (n < 0) return { ok: false, error: "TVA nu poate fi negativ." };
  if (n > 100) return { ok: false, error: "TVA nu poate depasi 100%." };
  return { ok: true, value: Math.round(n * 10) / 10 };
}
function validateTimeHHMM(raw) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw ?? "").trim());
  if (!m) return { ok: false, error: "Formatul orei trebuie sa fie HH:MM." };
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return { ok: false, error: "Ora este invalida (HH:MM, 00:00-23:59)." };
  return { ok: true, value: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` };
}
var WRITE_VERB = /(^| )(schimb|schimba|schimbam|modific|modifica|setez|seteaz|pune|pun|actualizez|actualizeaza|readuc|readuce|revin|revina|restabil|inapoi|vreau sa pun|as vrea sa pun|trebuie sa fie din nou)/;
var NUMBER = /(\d+(?:[.,]\d+)?)/;
function parseWriteIntent(message) {
  const t = norm(convertRomanianNumberWords(norm(message)));
  const isSchedulePhrase = Object.keys(DAYS).some((d) => new RegExp("(^| )" + d + "( |$)").test(t)) && /sa fie|sa incepem|sa terminam|sa pornim|de la \d|la \d|schimb|modific|setez|actualizez|pune|pun/.test(t);
  if (!WRITE_VERB.test(t) && !isSchedulePhrase) return null;
  const dayMatch = Object.keys(DAYS).find((d) => new RegExp("(^| )" + d + "( |$)").test(t));
  if (dayMatch) {
    const day = DAYS[dayMatch];
    const timeMatch = /de la (\d{1,2}[:.]\d{2}) la (\d{1,2}[:.]\d{2})|de la (\d{1,2}[:.]\d{2})|(?:\b|^)(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})/.exec(t);
    const singleHour = /(?:la|ora|de la)\s+(\d{1,2})(?:[:.](\d{2}))?( |$)/.exec(t);
    const activeOff = /(inactiva|inactive|neactiva|inchis)/.test(t);
    const activeOn = /(activa|active|activ)( |$)/.test(t) && !activeOff;
    const changes = {};
    let startOnly = false;
    if (timeMatch) {
      const s = validateTimeHHMM(timeMatch[1] ?? timeMatch[3] ?? timeMatch[4]);
      const e = timeMatch[2] !== void 0 || timeMatch[5] !== void 0 ? validateTimeHHMM(timeMatch[2] ?? timeMatch[5]) : null;
      if (!s.ok) return { error: s.error };
      if (e && !e.ok) return { error: e.error };
      if (e && s.value >= e.value) return { error: "Ora de inceput trebuie sa fie inainte de ora de sfarsit." };
      changes[day + "_active"] = true;
      changes[day + "_start"] = s.value;
      if (e) changes[day + "_end"] = e.value;
      else startOnly = true;
    } else if (activeOff) {
      changes[day + "_active"] = false;
    } else if (activeOn) {
      changes[day + "_active"] = true;
      startOnly = true;
    } else if (singleHour) {
      const s = validateTimeHHMM(singleHour[1] + ":" + (singleHour[2] ?? "00"));
      if (!s.ok) return { error: s.error };
      changes[day + "_active"] = true;
      changes[day + "_start"] = s.value;
      startOnly = true;
    } else {
      return { error: 'Nu am inteles noul program. Exemplu: "Sambata sa fie activa de la 08:00 la 14:00" sau "schimba programul de luni la 8".' };
    }
    return {
      action: "update_schedule",
      changes,
      summary: DAY_LABELS[day] + ": " + (changes[day + "_active"] === false ? "inactiva" : "activa " + (changes[day + "_start"] ?? "(ore neschimbate)") + (changes[day + "_end"] ? "-" + changes[day + "_end"] : "")),
      ...startOnly ? { fillFromCurrent: day } : {}
    };
  }
  if (/(^| )tva( |$)|cota tva/.test(t)) {
    const m = NUMBER.exec(t);
    if (!m) return { error: 'Nu am inteles noua cota TVA. Exemplu: "Schimba TVA la 19%".' };
    const v = validateVatValue(m[1]);
    if (!v.ok) return { error: v.error };
    return { action: "update_rates", changes: { vat_rate: v.value }, summary: "TVA: " + v.value + "%" };
  }
  const rateEntry = Object.entries(RATE_FIELDS).find(([k]) => new RegExp("(^| )" + k + "( |$)").test(t));
  if (rateEntry) {
    const rangeM = /de la (\d+(?:[.,]\d+)?)\s*(?:lei\s*(?:\/\s*)?ora)?\s+la\s+(\d+(?:[.,]\d+)?)/.exec(t);
    const m = rangeM ? rangeM[2] : NUMBER.exec(t)?.[1];
    if (!m) return { error: 'Nu am inteles noua valoare. Exemplu: "Schimba tariful normal la 120 lei".' };
    const v = validateRateValue(m);
    if (!v.ok) return { error: v.error };
    const f = rateEntry[1];
    return { action: "update_rates", changes: { [f.key]: v.value }, summary: f.label + ": " + v.value + " " + f.unit };
  }
  return null;
}
function fillScheduleFromCurrent(parsed, current) {
  const day = parsed.fillFromCurrent;
  if (!day) return null;
  const curStart = current[day + "_start"];
  const curEnd = current[day + "_end"];
  if (parsed.changes[day + "_active"] === true && !parsed.changes[day + "_start"]) {
    if (!curStart || !curEnd) {
      return "Nu am ore salvate pentru " + DAY_LABELS[day] + '. Spune-mi intervalul complet, de exemplu: "08:00 - 17:00".';
    }
    parsed.changes[day + "_start"] = curStart;
    parsed.changes[day + "_end"] = curEnd;
    parsed.summary = DAY_LABELS[day] + ": activa " + curStart + "-" + curEnd + " (ore neschimbate)";
  } else if (parsed.changes[day + "_start"] && !parsed.changes[day + "_end"]) {
    if (!curEnd) {
      return "Nu am ora de sfarsit pentru " + DAY_LABELS[day] + '. Spune-mi intervalul complet, de exemplu: "de la 08:00 la 17:00".';
    }
    parsed.changes[day + "_end"] = curEnd;
    parsed.summary = DAY_LABELS[day] + ": activa " + parsed.changes[day + "_start"] + "-" + curEnd;
  }
  return null;
}
var CAR_UPDATE_FIELDS = [
  { field: "model", keys: ["modelul", "model"], label: "Model", kind: "car" },
  { field: "make", keys: ["marca", "marka", "make"], label: "Marc\u0103", kind: "car" },
  { field: "color", keys: ["culoarea", "culoare"], label: "Culoare", kind: "car" },
  { field: "year", keys: ["anul"], label: "An", kind: "car", numeric: true, min: 1950, max: 2100 },
  { field: "vin", keys: ["vin", "sasiu", "serie sasiu"], label: "VIN", kind: "car" },
  { field: "mileage", keys: ["kilometrajul", "kilometraj", "kilometru"], label: "Kilometraj", kind: "car", numeric: true, min: 0, max: 3e6 },
  { field: "client_phone", keys: ["telefonul", "telefon"], label: "Telefon", kind: "client" },
  { field: "client_email", keys: ["email", "mail"], label: "Email", kind: "client" },
  { field: "client_name", keys: ["numele clientului", "proprietarul", "clientul"], label: "Client", kind: "client" }
];
var PLATE_STOPWORDS = /* @__PURE__ */ new Set(["km", "lei", "ani", "vin", "la", "in", "cu", "si"]);
function wordAt(t, word) {
  return new RegExp("(^| )" + word + "( |$)").test(t);
}
function scanPlate(message) {
  const tokens = message.toUpperCase().replace(/[,.;:!?]/g, " ").split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (/^[A-Z]{1,2}\d{2,3}[A-Z]{1,4}$/.test(tok)) return tok;
    if (/^[A-Z]{1,2}\d{2,3}$/.test(tok) && tokens[i + 1] && /^[A-Z]{1,4}$/.test(tokens[i + 1]) && !PLATE_STOPWORDS.has(tokens[i + 1].toLowerCase()) && !PLATE_STOPWORDS.has(tok.toLowerCase())) return tok + tokens[i + 1];
    if (/^[A-Z]{1,2}$/.test(tok) && !PLATE_STOPWORDS.has(tok.toLowerCase()) && tokens[i + 1] && /^\d{2,3}$/.test(tokens[i + 1]) && tokens[i + 2] && /^[A-Z]{1,4}$/.test(tokens[i + 2]) && !PLATE_STOPWORDS.has(tokens[i + 2].toLowerCase())) return tok + tokens[i + 1] + tokens[i + 2];
  }
  return void 0;
}
function extractNewValue(message) {
  const re = /\s(?:în|in|la|cu)\s/gi;
  let last = null;
  let m2;
  while ((m2 = re.exec(message)) !== null) last = m2;
  if (!last) return void 0;
  return message.slice(last.index + last[0].length).trim().replace(/[.,;!?]+$/, "").trim() || void 0;
}
function extractOwnerName(message) {
  const m = /(?:\blui\b|\bclientului\b|\bproprietarului\b)\s+([A-Za-zĂÂÎȘȚăâîșț.\- ]+?)(?=\s+(?:la|in|în)\b|[.,;!?]|$)/i.exec(message);
  const name = m?.[1]?.trim();
  return name || void 0;
}
function extractPhone(message) {
  const explicit = /(?:telefon(?:ul)?|tel\.?)\s*(?:este|e|:)?\s*([0-9][0-9 .()\-\u00a0]{5,})/i.exec(message);
  if (explicit) return explicit[1].replace(/\D/g, "") || void 0;
  const bare = /(^|[\s,])(0\d{9}|\+?4\s?0\s?7\d{8})(?=$|[\s,.])/i.exec(message);
  if (bare) return bare[2].replace(/\D/g, "");
  return void 0;
}
function extractNameAfter(message, keywords) {
  const re = new RegExp("(?:" + keywords.join("|") + ")\\s*:?\\s*([A-Za-z\u0102\xC2\xCE\u0218\u021A\u0103\xE2\xEE\u0219\u021B0-9.\\- ]+?)(?=\\s+(?:cu|pentru|client(?:ul)?|telefon|marca|marc\u0103|model|vin|serie|kilometraj|km|la|in|\xEEn|an)\\b|[.,;!?]|$)", "i");
  const m = re.exec(message);
  const v = m?.[1]?.trim().replace(/\s+/g, " ");
  return v || void 0;
}
function parseCarWriteIntent(message, allowMissingMileage = false) {
  const t = norm(message);
  const hasCarWord = wordAt(t, "masina") || wordAt(t, "masini") || wordAt(t, "masinile") || wordAt(t, "masinii") || wordAt(t, "auto") || wordAt(t, "vehicul") || wordAt(t, "client") || wordAt(t, "clientul");
  const isCreate = /(adaug|creeaz|inregistreaz|masina noua|noua masina|client nou)/.test(t);
  if (isCreate && hasCarWord) {
    const numberedBlocks = message.split(/(?:^|\s)\d+\.\s*(?=(?:număr|numar)\s*:)/i).filter((block) => /(?:număr|numar|client|marc[ăa]|model|telefon)\s*:/i.test(block));
    if (numberedBlocks.length > 1) {
      const cars = numberedBlocks.map((block) => parseCarWriteIntent(`Creeaz\u0103 o ma\u0219in\u0103 ${block}`, true)).filter((parsed) => Boolean(parsed && !("error" in parsed) && parsed.action === "create_car")).map((parsed) => parsed.changes);
      if (cars.length !== numberedBlocks.length) return { error: "Nu am putut extrage toate ma\u0219inile. Verific\u0103 num\u0103rul, clientul, marca \u0219i modelul pentru fiecare." };
      return { action: "create_car", changes: cars[0], cars, summary: `Creare ${cars.length} ma\u0219ini noi` };
    }
    const plate = scanPlate(message);
    const phone = extractPhone(message);
    const clientName = extractNameAfter(message, ["clientul", "client", "pentru clientul"]);
    const make = extractNameAfter(message, ["marca", "marc\u0103"]);
    const model = extractNameAfter(message, ["modelul", "model"]);
    let mileage;
    const mM = /(?:kilometraj(?:ul)?\s*(?:este|e|:)?\s*(\d{2,7})|(\d{2,7})\s*(?:km|kilometri))/i.exec(message);
    if (mM) mileage = Number(mM[1] ?? mM[2]) || void 0;
    const vinM = /(?:vin|serie\s+sasiu|sasiu)\s*[: ]\s*([A-HJ-NPR-Z0-9]{6,17})/i.exec(message);
    const vin = vinM?.[1]?.toUpperCase();
    const missing = [];
    if (!plate) missing.push("num\u0103rul de \xEEnmatriculare al ma\u0219inii");
    if (!clientName) missing.push("numele clientului");
    if (mileage === void 0 && !allowMissingMileage) missing.push("kilometrajul");
    if (missing.length > 0) {
      return {
        error: "Pentru a exista un client \xEEn sistem, acesta este asociat unei ma\u0219ini. Mai am nevoie de: " + missing.join(", ") + '. Exemplu: "Adaug\u0103 ma\u0219ina B123ABC pentru clientul Ion Popescu, marca BMW, model X5, kilometraj 150000, telefon 0712345678".'
      };
    }
    if (phone && (phone.length < 6 || phone.length > 15)) {
      return { error: "Num\u0103rul de telefon nu pare valid." };
    }
    const changes = {
      license_plate: plate,
      client_name: clientName,
      mileage,
      client_phone: phone ?? null,
      client_email: null,
      make: make ?? null,
      model: model ?? null,
      vin: vin ?? null
    };
    return { action: "create_car", changes, summary: "Ma\u0219in\u0103 nou\u0103 " + plate + " pentru " + clientName };
  }
  if (wordAt(t, "muta") && (wordAt(t, "masina") || wordAt(t, "masinii") || wordAt(t, "auto"))) {
    const plate = scanPlate(message);
    const val = extractNewValue(message);
    if (!plate || !val) {
      return { error: 'Nu am \xEEn\u021Beles mutarea. Exemplu: "Mut\u0103 ma\u0219ina B123ABC la Ion Popescu".' };
    }
    return { action: "update_client", changes: { client_name: val }, plate, summary: "Mutare ma\u0219ina " + plate + " la " + val };
  }
  if (/(schimba|modific|setez|actualizez|pune)/.test(t)) {
    const def = CAR_UPDATE_FIELDS.find((d) => d.keys.some((k) => k.includes(" ") ? t.includes(" " + k) : wordAt(t, k)));
    if (def) {
      const val = extractNewValue(message);
      if (!val) {
        return { error: 'Nu am \xEEn\u021Beles noua valoare. Exemplu: "Schimb\u0103 modelul ma\u0219inii B123ABC \xEEn X3".' };
      }
      let value = val;
      if (def.field === "client_phone") {
        const digits = val.replace(/\D/g, "");
        if (digits.length < 6 || digits.length > 15) return { error: "Num\u0103rul de telefon nu pare valid." };
        value = digits;
      }
      if (def.numeric) {
        if (/^\s*-\d/.test(val)) return { error: def.label + " nu poate fi negativ." };
        const n = Number(val.replace(/[^\d.]/g, ""));
        if (!Number.isFinite(n) || def.min !== void 0 && n < def.min || def.max !== void 0 && n > def.max) {
          return { error: def.label + " nu este o valoare valid\u0103." };
        }
        value = Math.round(n);
      }
      const plate = scanPlate(message);
      const clientName = extractOwnerName(message);
      if (!plate && !clientName) {
        return { error: 'Spune-mi ce ma\u0219in\u0103 modific\u0103m (num\u0103r de \xEEnmatriculare) sau al cui client schimb\u0103m datele. Exemplu: "Schimb\u0103 telefonul lui Ion Popescu la 0712345678".' };
      }
      const action = def.kind === "client" ? "update_client" : "update_car";
      return { action, changes: { [def.field]: value }, plate, clientName, summary: def.label + ": " + value };
    }
  }
  return null;
}

// tests/faza2-final.test.ts
var passed = 0;
var failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  PASS - " + name);
  } catch (e) {
    failed++;
    console.error("  FAIL - " + name);
    console.error(e);
  }
}
console.log("FAZA 2 FINAL \u2014 natural language tarife");
var rateExamples = [
  "schimb\u0103 tariful normal la 101",
  "Schimb\u0103m tariful normal la 101 lei",
  "SCHIMBA TARIFUL NORMAL LA 101",
  "schimb\u0103 tariful normal de la 100 la 101",
  "a\u0219 vrea s\u0103 pun tariful normal 101"
];
for (const ex of rateExamples) {
  test('NL rates: "' + ex + '" -> update_rates normal_rate=101', () => {
    const r = parseWriteIntent(ex);
    assert.ok(r && !("error" in r), JSON.stringify(r));
    assert.equal(r.action, "update_rates");
    assert.deepEqual(r.changes, { normal_rate: 101 });
  });
}
test('Numere romanesti: "de la o suta la o suta unu" -> 101', () => {
  const r = parseWriteIntent("Schimb\u0103m tariful normal de la o sut\u0103 la o sut\u0103 unu");
  assert.ok(r && !("error" in r), JSON.stringify(r));
  assert.deepEqual(r.changes, { normal_rate: 101 });
});
test("Numere romanesti: convertRomanianNumberWords", () => {
  assert.equal(convertRomanianNumberWords("la o suta unu"), "la 101");
  assert.equal(convertRomanianNumberWords("doua sute cincizeci"), "250");
  assert.equal(convertRomanianNumberWords("douazeci si cinci"), "25");
  assert.equal(parseRomanianNumberPhrase(["o", "suta", "unu"]), 101);
  assert.equal(parseRomanianNumberPhrase(["unu"]), 1);
});
test("Valoare incerta in cuvinte NU este ghicita", () => {
  const r = parseWriteIntent("schimb\u0103 tariful normal la o");
  assert.ok(!r || "error" in r || r.action !== "update_rates");
});
test('Schedule: "schimb\u0103 programul de luni la 8" -> start 08:00 + fillFromCurrent', () => {
  const r = parseWriteIntent("schimb\u0103 programul de luni la 8");
  assert.ok(r && !("error" in r), JSON.stringify(r));
  assert.equal(r.action, "update_schedule");
  assert.equal(r.changes.monday_start, "08:00");
  assert.equal(r.fillFromCurrent, "monday");
  const err = fillScheduleFromCurrent(r, { monday_start: "09:00", monday_end: "18:00" });
  assert.equal(err, null);
  assert.deepEqual(r.changes, { monday_active: true, monday_start: "08:00", monday_end: "18:00" });
});
test('Schedule: "luni s\u0103 \xEEncepem la 8" -> aceeasi intentie', () => {
  const r = parseWriteIntent("luni s\u0103 \xEEncepem la 8");
  assert.ok(r && !("error" in r), JSON.stringify(r));
  assert.equal(r.changes.monday_start, "08:00");
});
test('Schedule: "schimb\u0103 s\xE2mb\u0103ta s\u0103 fie activ\u0103" -> active, ore din curent', () => {
  const r = parseWriteIntent("schimb\u0103 s\xE2mb\u0103ta s\u0103 fie activ\u0103");
  assert.ok(r && !("error" in r), JSON.stringify(r));
  assert.equal(r.changes.saturday_active, true);
  const err = fillScheduleFromCurrent(r, { saturday_start: "09:00", saturday_end: "13:00" });
  assert.equal(err, null);
  assert.deepEqual(r.changes, { saturday_active: true, saturday_start: "09:00", saturday_end: "13:00" });
});
test("Schedule: activare fara ore salvate -> cere interval (nu ghiceste)", () => {
  const r = parseWriteIntent("schimb\u0103 s\xE2mb\u0103ta s\u0103 fie activ\u0103");
  const err = fillScheduleFromCurrent(r, {});
  assert.ok(err && err.length > 0);
});
test("Schedule: interval complet inca functioneaza", () => {
  const r = parseWriteIntent("programul de luni s\u0103 fie 08:00 - 17:00");
  assert.ok(r && !("error" in r), JSON.stringify(r));
  assert.deepEqual(r.changes, { monday_active: true, monday_start: "08:00", monday_end: "17:00" });
});
test('Car: "adaug\u0103 o ma\u0219in\u0103" -> cere informatiile lipsa (nu inventeaza)', () => {
  const r = parseCarWriteIntent("adaug\u0103 o ma\u0219in\u0103");
  assert.ok(r && "error" in r && /numărul|numarul/i.test(r.error));
});
test('Car: "Adaug\u0103 ma\u0219ina B123ABC" -> cere client + kilometraj', () => {
  const r = parseCarWriteIntent("Adaug\u0103 ma\u0219ina B123ABC");
  assert.ok(r && "error" in r);
  assert.match(r.error, /clientului/);
  assert.match(r.error, /kilometrajul/);
});
test('Car: "AD\u0102UG\u0102 MA\u0218INA B123ABC" (uppercase/diacritice) -> acelasi comportament', () => {
  const r = parseCarWriteIntent("AD\u0102UG\u0102 MA\u0218INA B123ABC");
  assert.ok(r && "error" in r);
});
test('Car: "schimb\u0103 kilometrajul la B123ABC la 125000" -> update_car mileage', () => {
  const r = parseCarWriteIntent("schimb\u0103 kilometrajul la B123ABC la 125000");
  assert.ok(r && !("error" in r), JSON.stringify(r));
  assert.equal(r.action, "update_car");
  assert.deepEqual(r.changes, { mileage: 125e3 });
  assert.equal(r.plate, "B123ABC");
});
test('Car: "Schimba kilometrajul masinii B123ABC la 125000" -> acelasi intent', () => {
  const r = parseCarWriteIntent("Schimba kilometrajul masinii B123ABC la 125000");
  assert.ok(r && !("error" in r), JSON.stringify(r));
  assert.deepEqual(r.changes, { mileage: 125e3 });
});
test('Client: "schimb\u0103 telefonul clientului de la B123ABC la 0712345678"', () => {
  const r = parseCarWriteIntent("schimb\u0103 telefonul clientului de la B123ABC la 0712345678");
  assert.ok(r && !("error" in r), JSON.stringify(r));
  assert.equal(r.action, "update_client");
  assert.deepEqual(r.changes, { client_phone: "0712345678" });
});
test('Client: "Schimba telefonul clientului B123ABC cu 0712345678" (cu)', () => {
  const r = parseCarWriteIntent("Schimba telefonul clientului B123ABC cu 0712345678");
  assert.ok(r && !("error" in r), JSON.stringify(r));
  assert.deepEqual(r.changes, { client_phone: "0712345678" });
});
test('Ambiguu: "schimb\u0103 ma\u0219ina" -> nu produce WRITE', () => {
  const r = parseCarWriteIntent("schimb\u0103 ma\u0219ina");
  assert.ok(r === null || "error" in r);
});
test('Ambiguu: "modific\u0103" -> nu produce WRITE', () => {
  assert.equal(parseWriteIntent("modific\u0103"), null);
  const c = parseCarWriteIntent("modific\u0103");
  assert.ok(c === null || "error" in c);
});
test('Ambiguu: "schimb\u0103 tariful" (f\u0103r\u0103 valoare) -> cere clarificare', () => {
  const r = parseWriteIntent("schimb\u0103 tariful");
  assert.ok(r === null || "error" in r && r.action !== "update_rates");
});
test('Ambiguu: "actualizeaz\u0103 clientul" -> cere clarificare, nu WRITE', () => {
  const r = parseCarWriteIntent("actualizeaz\u0103 clientul");
  assert.ok(r === null || "error" in r && r.action !== "update_client");
});
test('Ambiguu: "pune 101" -> nu produce WRITE', () => {
  assert.equal(parseWriteIntent("pune 101"), null);
  const c = parseCarWriteIntent("pune 101");
  assert.ok(c === null || "error" in c);
});
test("Valori invalide: kilometraj negativ / telefon scurt respinse", () => {
  const r1 = parseCarWriteIntent("schimb\u0103 kilometrajul la B123ABC la -5");
  assert.ok(r1 && "error" in r1);
  const r2 = parseCarWriteIntent("schimb\u0103 telefonul clientului B123ABC la 123");
  assert.ok(r2 && "error" in r2);
});
console.log("FAZA 2 FINAL \u2014 confirmation security");
test("Confirmarea aproba DOAR pending-ul exact (operationId unic)", () => {
  const p = createPendingOperation("update_rates", { id: 1 }, { normal_rate: 101 });
  const a = evaluatePendingConfirmation(p, parseConfirmation("da"));
  assert.equal(a.canExecute, true);
  const other = createPendingOperation("update_rates", { id: 1 }, { normal_rate: 101 });
  assert.notEqual(p.operationId, other.operationId);
});
test('Cancel: "Anuleaz\u0103" -> pending inchis, nimic executat', () => {
  const p = createPendingOperation("update_rates", { id: 1 }, { normal_rate: 101 });
  const a = evaluatePendingConfirmation(p, parseConfirmation("Anuleaz\u0103"));
  assert.equal(a.canExecute, false);
  assert.equal(a.state, "cancelled");
});
test('Refuz: "Nu confirm" nu este aprobare', () => {
  const p = createPendingOperation("update_rates", { id: 1 }, { normal_rate: 101 });
  const a = evaluatePendingConfirmation(p, parseConfirmation("Nu confirm"));
  assert.equal(a.canExecute, false);
  assert.equal(a.state, "cancelled");
});
test('Ambiguu: "ok" -> pending ramane in asteptare, NU executa', () => {
  const p = createPendingOperation("update_rates", { id: 1 }, { normal_rate: 101 });
  const a = evaluatePendingConfirmation(p, parseConfirmation("ok"));
  assert.equal(a.canExecute, false);
  assert.equal(a.state, "awaiting_confirmation");
});
test('F\u0103r\u0103 pending: "Da" nu execut\u0103 nimic', () => {
  const a = evaluatePendingConfirmation(null, parseConfirmation("da"));
  assert.equal(a.canExecute, false);
  assert.equal(a.reason, "no-pending-operation");
});
test("Allowlist strict: exact cele 5 operatii WRITE", () => {
  assert.deepEqual([...ALLOWED_WRITE_ACTIONS].sort(), ["create_car", "update_car", "update_client", "update_rates", "update_schedule"]);
  assert.equal(WRITE_ARMED, true);
  for (const blocked of ["delete_car", "delete_job", "create_client", "create_employee", "update_employee", "delete_employee", "create_job", "update_job", "delete_job", "create_appointment", "update_appointment", "delete_appointment", "transfer_employee", "change_assignment", "change_job_status", "reset_operational_data"]) {
    assert.equal(isWriteActionAllowed(blocked), false, blocked);
  }
});
test('Pending ne-permis nu poate fi executat nici cu "Da"', () => {
  const p = createPendingOperation("delete_car", { id: "x" }, {});
  const a = evaluatePendingConfirmation(p, parseConfirmation("da"));
  assert.equal(a.canExecute, false);
});
test("Validare: valori incorecte nu produc WRITE plan", () => {
  assert.equal(validateRateValue(-1).ok, false);
  assert.equal(validateRateValue("abc").ok, false);
  assert.equal(validateTimeHHMM("25:00").ok, false);
});
console.log("FAZA 2 FINAL: " + passed + " pass, " + failed + " fail");
if (failed > 0) process.exit(1);
