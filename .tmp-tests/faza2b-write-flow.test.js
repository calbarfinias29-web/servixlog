// tests/faza2b-write-flow.test.ts
import assert from "node:assert/strict";

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

// tests/faza2b-write-flow.test.ts
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
console.log("FAZA 2B \u2014 write flow");
test("Allowlist ETAPA 2: tarife/program + masini/clienti permise", () => {
  for (const a of ["update_rates", "update_schedule", "create_car", "update_car", "update_client"]) {
    assert.equal(isWriteActionAllowed(a), true, a);
  }
  for (const a of ["create_client", "create_employee", "update_employee", "create_job", "update_job", "update_job_status", "transfer_job", "create_appointment", "update_appointment", "delete_car", "delete_client", "update_password"]) {
    assert.equal(isWriteActionAllowed(a), false, a);
  }
});
test("WRITE este ARMED dar restrictionat", () => {
  assert.equal(WRITE_ARMED, true);
});
test("Parse: tariful normal 120 lei -> update_rates", () => {
  const r = parseWriteIntent("Schimb\u0103 tariful normal la 120 lei.");
  assert.equal(r.action, "update_rates");
  assert.deepEqual(r.changes, { normal_rate: 120 });
});
test("Parse: TVA 19% -> vat_rate", () => {
  const r = parseWriteIntent("Schimb\u0103 TVA la 19%.");
  assert.deepEqual(r.changes, { vat_rate: 19 });
});
test("Parse: sambata 08:00-14:00 -> update_schedule", () => {
  const r = parseWriteIntent("S\xE2mb\u0103t\u0103 s\u0103 fie activ\u0103 de la 08:00 la 14:00.");
  assert.equal(r.action, "update_schedule");
  assert.deepEqual(r.changes, { saturday_active: true, saturday_start: "08:00", saturday_end: "14:00" });
});
test("Parse: garantie si overtime", () => {
  const g = parseWriteIntent("Modific\u0103 tariful garan\u021Bie la 50 lei.");
  assert.deepEqual(g.changes, { warranty_rate: 50 });
  const o = parseWriteIntent("Schimb\u0103 tariful overtime la 200 lei/ora.");
  assert.deepEqual(o.changes, { overtime_rate: 200 });
});
test("Parse: mesaje fara verbe de scriere -> null", () => {
  assert.equal(parseWriteIntent("Care este tariful normal?"), null);
  assert.equal(parseWriteIntent("Ce program avem azi?"), null);
});
test("Validare: rate negative/NaN/invalide respinse", () => {
  assert.equal(validateRateValue(-5).ok, false);
  assert.equal(validateRateValue("abc").ok, false);
  assert.equal(validateRateValue(NaN).ok, false);
  assert.equal(validateRateValue("120,5").ok, true);
});
test("Validare: TVA 0..100", () => {
  assert.equal(validateVatValue(-1).ok, false);
  assert.equal(validateVatValue(150).ok, false);
  assert.equal(validateVatValue(19.5).ok, true);
});
test("Validare: HH:MM si start < end", () => {
  assert.equal(validateTimeHHMM("25:00").ok, false);
  assert.equal(validateTimeHHMM("abc").ok, false);
  assert.equal(validateTimeHHMM("08:00").ok, true);
  const bad = parseWriteIntent("Schimb\u0103 sambata de la 14:00 la 08:00");
  assert.ok(bad.error);
});
test('SECURITY: "Da" / "Confirm" fara pending -> NU executa', () => {
  const a = evaluatePendingConfirmation(null, parseConfirmation("Da"));
  assert.equal(a.canExecute, false);
  const b = evaluatePendingConfirmation(null, parseConfirmation("Confirm"));
  assert.equal(b.canExecute, false);
});
test('SECURITY: "Nu confirm" / "Nu modifica" / "ok" -> NU executa', () => {
  const pending = createPendingOperation("update_rates", { id: "r1" }, { normal_rate: 120 });
  assert.equal(evaluatePendingConfirmation(pending, parseConfirmation("Nu confirm")).canExecute, false);
  assert.equal(evaluatePendingConfirmation(pending, parseConfirmation("Nu modifica")).canExecute, false);
  assert.equal(evaluatePendingConfirmation(pending, parseConfirmation("ok")).canExecute, false);
});
test('SECURITY: actiune ne-permisa (create_employee) nu poate fi executata nici cu "Da"', () => {
  const pending = createPendingOperation("create_employee", { name: "Test" }, { name: "Test" });
  const approval = evaluatePendingConfirmation(pending, parseConfirmation("Da"));
  assert.equal(approval.canExecute, false);
});
test("SECURITY: DELETE si PROTECTED raman blocate", () => {
  const d = createPendingOperation("delete_car", { car_id: "x" }, {});
  assert.equal(evaluatePendingConfirmation(d, parseConfirmation("Da")).canExecute, false);
  const p = createPendingOperation("reset_operational_data", {}, {});
  assert.equal(evaluatePendingConfirmation(p, parseConfirmation("Da")).canExecute, false);
});
console.log("FAZA 2B: " + passed + " pass, " + failed + " fail");
if (failed > 0) process.exit(1);
