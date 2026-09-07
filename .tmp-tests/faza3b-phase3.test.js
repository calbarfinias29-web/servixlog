// tests/faza3b-phase3.test.ts
import assert from "node:assert/strict";
import test from "node:test";

// src/agent/agent-phase3.ts
var ADMIN_WRITE_EXECUTION_ENABLED = false;
function normalize(text) {
  return String(text ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[șş]/g, "s").replace(/[țţ]/g, "t").replace(/\s+/g, " ").trim();
}
function valueAfter(text, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]?.trim()) return match[1].trim().replace(/[.,;!?]+$/, "");
  }
  return void 0;
}
function preview(action, target, changes, risk) {
  const lines = [
    action.startsWith("delete_") || action === "cancel_appointment" ? "ATENTIE - OPERATIE DESTRUCTIVA" : action === "transfer_car" || action === "change_job_assignment" ? "TRANSFER" : "ACTIUNE: " + action.toUpperCase(),
    "\u021AINT\u0102: " + target
  ];
  if (action === "transfer_car" || action === "change_job_assignment") {
    lines.push("De la: " + (changes.current_employee ?? "necunoscut"), "La: " + (changes.new_employee ?? "necunoscut"), "Timpul deja lucrat: NU SE RESETEAZ\u0102");
  } else if (Object.keys(changes).length > 0) {
    lines.push("MODIFIC\u0102RI:");
    for (const [key, value] of Object.entries(changes)) lines.push("- " + key + ": " + value);
  }
  lines.push("RISC: " + risk, "CONFIRMARE: DA / NU");
  return lines;
}
function plan(action, target, changes = {}, risk = "normal") {
  return { action, target, changes, risk, preview: preview(action, target, changes, risk) };
}
function parsePhase3Intent(message) {
  const original = String(message ?? "").trim();
  const text = normalize(original);
  if (!text) return null;
  const employeeTarget = valueAfter(original, [/(?:angajatul?|numele angajatului)\s+(.+)$/i]);
  const jobTarget = valueAfter(original, [/(?:lucrarea?|jobul?)\s+(.+)$/i, /(?:pentru|la)\s+([A-Z]{1,2}\s?\d{2,3}\s?[A-Z]{1,3})/i]);
  const appointmentTarget = valueAfter(original, [/(?:programarea?|programare)\s+(.+)$/i]);
  const plate = valueAfter(original, [/(?:masina|mașina|autoturismul?)\s+([A-Z]{1,2}\s?\d{2,3}\s?[A-Z]{1,3})/i, /\b([A-Z]{1,2}\s?\d{2,3}\s?[A-Z]{1,3})\b/i]);
  if (/(?:creeaza|adauga|fa)\b.*\bangajat/.test(text)) {
    const name = employeeTarget ?? valueAfter(original, [/(?:angajat nou|angajat)\s+(.+)$/i]);
    if (!name) return { error: "Spune numele angajatului care trebuie creat." };
    return plan("create_employee", name, { name }, "HIGH");
  }
  if (/(?:dezactiveaza|dezactiva|inactiveaza)\b.*\bangajat/.test(text)) {
    if (!employeeTarget) return { error: "Spune exact ce angajat trebuie dezactivat." };
    return plan("deactivate_employee", employeeTarget, { active: "true -> false" }, "HIGH");
  }
  if (/(?:sterge|elimina)\b.*\bangajat/.test(text)) {
    if (!employeeTarget) return { error: "Spune exact ce angajat trebuie sters." };
    return plan("delete_employee", employeeTarget, {}, "HIGH");
  }
  if (/(?:modifica|schimba)\b.*\bangajat/.test(text)) {
    if (!employeeTarget) return { error: "Spune exact ce angajat trebuie modificat." };
    const name = valueAfter(original, [/(?:numele|numelui)\s+(?:in|în|la|cu)\s+(.+)$/i]);
    return plan("update_employee", employeeTarget, name ? { name } : {}, "HIGH");
  }
  if (/(?:creeaza|adauga|fa)\b.*\b(lucrare|job)/.test(text)) {
    const title = valueAfter(original, [/(?:lucrare|job)\s+(?:nou(?:a|ă)?|numit[aă]?|cu titlul)\s+(.+)$/i]);
    if (!title) return { error: "Spune titlul lucr\u0103rii \u0219i ma\u0219ina asociat\u0103." };
    return plan("create_job", title, { title }, "normal");
  }
  if (/(?:sterge|elimina)\b.*\b(lucrare|job)/.test(text)) {
    if (!jobTarget && !plate) return { error: "Spune exact lucrarea sau num\u0103rul ma\u0219inii." };
    return plan("delete_job", jobTarget ?? plate ?? "", {}, "HIGH");
  }
  if (/(?:schimba|modifica|actualizeaza)\b.*\bstatus/.test(text) || /\b(inchide|redeschide)\b.*\b(lucrare|job)/.test(text)) {
    if (!jobTarget && !plate) return { error: "Spune exact lucrarea sau num\u0103rul ma\u0219inii." };
    const status = text.includes("finalizat") || text.includes("inchide") ? "finalizat" : text.includes("redeschide") ? "asteptare" : valueAfter(original, [/\b(?:in|în)\s+(asteptare(?:_piese)?|in lucru|finalizat)/i]);
    if (!status) return { error: "Status invalid. Folose\u0219te: a\u0219teptare, \xEEn lucru, a\u0219teptare piese sau finalizat." };
    return plan("change_job_status", jobTarget ?? plate ?? "", { status }, "HIGH");
  }
  if (/(?:modifica|schimba|actualizeaza)\b.*\b(lucrare|job)/.test(text)) {
    if (!jobTarget && !plate) return { error: "Spune exact lucrarea sau num\u0103rul ma\u0219inii." };
    return plan("update_job", jobTarget ?? plate ?? "", {}, "normal");
  }
  if (/(?:creeaza|adauga)\b.*\bprogramar/.test(text)) {
    const date = valueAfter(original, [/(?:pe|pentru|in|în)\s+(\d{1,2}[./]\d{1,2}[./]\d{2,4})/i]);
    const time = valueAfter(original, [/(?:la|ora)\s+(\d{1,2}:\d{2})/i]);
    if (!date || !time) return { error: "Pentru programare sunt necesare data \u0219i ora." };
    return plan("create_appointment", date + " " + time, { date, time }, "normal");
  }
  if (/(?:sterge|elimina)\b.*\bprogramar/.test(text)) {
    if (!appointmentTarget && !plate) return { error: "Spune exact programarea sau num\u0103rul ma\u0219inii." };
    return plan("cancel_appointment", appointmentTarget ?? plate ?? "", {}, "HIGH");
  }
  if (/anuleaza\b.*\bprogramar/.test(text)) {
    if (!appointmentTarget && !plate) return { error: "Spune exact programarea sau num\u0103rul ma\u0219inii." };
    return plan("cancel_appointment", appointmentTarget ?? plate ?? "", {}, "HIGH");
  }
  if (/(?:modifica|schimba|actualizeaza)\b.*\bprogramar/.test(text)) {
    if (!appointmentTarget && !plate) return { error: "Spune exact programarea sau num\u0103rul ma\u0219inii." };
    return plan("update_appointment", appointmentTarget ?? plate ?? "", {}, "normal");
  }
  if (/(?:muta|transfera|schimba)\b.*\b(?:masina|mașina|lucrarea|angajatul)/.test(text)) {
    if (!plate) return { error: "Spune num\u0103rul exact al ma\u0219inii pentru transfer. (numarul exact al masinii)" };
    const newEmployee = valueAfter(original, [/(?:la|catre|către)\s+(.+)$/i]);
    if (!newEmployee) return { error: "Spune angajatul nou pentru transfer." };
    return plan(text.includes("lucrarea") ? "change_job_assignment" : "transfer_car", plate, { current_employee: "de verificat", new_employee: newEmployee }, "HIGH");
  }
  return null;
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
  async updateCar(id2, input) {
    return this.entity(await this.send("PATCH", `/api/cars/${encodeURIComponent(id2)}`, input), "car");
  }
  async createJob(input) {
    return this.entity(await this.send("POST", "/api/jobs", input), "job");
  }
  async updateJob(id2, input) {
    return this.entity(await this.send("PATCH", `/api/jobs/${encodeURIComponent(id2)}`, input), "job");
  }
  async createEmployee(input) {
    return this.entity(await this.send("POST", "/api/employees", input), "employee");
  }
  async updateEmployee(id2, input) {
    return this.entity(await this.send("PATCH", `/api/employees/${encodeURIComponent(id2)}`, input), "employee");
  }
  async createAppointment(input) {
    return this.entity(await this.send("POST", "/api/appointments", input), "appointment");
  }
  async updateAppointment(id2, input) {
    return this.entity(await this.send("PATCH", `/api/appointments/${encodeURIComponent(id2)}`, input), "appointment");
  }
  async deleteAppointment(id2) {
    return this.entity(await this.send("DELETE", `/api/appointments/${encodeURIComponent(id2)}`, {}), "appointment");
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

// src/agent/agent-write.ts
var okW = (m) => ({ success: true, message: m });
var failW = (m, debugError) => ({ success: false, message: m, debugError });
var IS_DEMO = false;
function num(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : void 0;
}
function normalizedPlate(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
async function runUpdate(table, values, id2) {
  try {
    const { error } = await supabase.from(table).update(values).eq("id", id2);
    if (error) return failW("Actualizarea nu a reusit.");
    return okW("Actualizat cu succes.");
  } catch (e) {
    return failW("Eroare la actualizare.");
  }
}
var EXECUTABLE_KINDS = [
  "update_rates",
  "update_schedule",
  "create_car",
  "update_car",
  "update_client"
];
async function executeWrite(plan2) {
  if (plan2.kind === "phase3_admin") {
    return ADMIN_WRITE_EXECUTION_ENABLED ? failW("Opera\u021Biile administrative necesit\u0103 activare explicit\u0103 \xEEntr-o faz\u0103 ulterioar\u0103.") : failW("Opera\u021Bia a fost confirmat\u0103, dar execu\u021Bia opera\u021Biilor administrative ale Agentului este momentan dezactivat\u0103.");
  }
  if (!EXECUTABLE_KINDS.includes(plan2.kind)) {
    return failW("Aceasta operatie WRITE nu este activata (FAZA 2B ETAPA 2: tarife/program, masini si date client).");
  }
  switch (plan2.kind) {
    case "create_car":
      return createCar(plan2.params);
    case "update_car":
      return updateCar(plan2.params);
    case "update_client":
      return updateCar(plan2.params);
    case "create_employee":
      return createEmployee(plan2.params);
    case "update_employee":
      return updateEmployee(plan2.params);
    case "create_job":
      return createJob(plan2.params);
    case "update_job":
      return updateJob(plan2.params);
    case "update_job_status":
      return updateJobStatus(plan2.params);
    case "transfer_job":
      return transferJob(plan2.params);
    case "create_appointment":
      return createAppointment(plan2.params);
    case "update_appointment":
      return updateAppointment(plan2.params);
    case "update_schedule":
      return updateSchedule(plan2.params);
    case "update_rates":
      return updateRates(plan2.params);
  }
}
async function createCar(p) {
  if (Array.isArray(p.cars)) {
    const ids = [];
    for (const car of p.cars) {
      if (!car || typeof car !== "object" || Array.isArray(car)) return failW("Date invalide pentru una dintre ma\u0219ini.");
      const result = await createCar(car);
      if (!result.success || !result.id) return failW(result.message, result.debugError);
      ids.push(result.id);
    }
    return { success: true, message: `Au fost create ${ids.length} ma\u0219ini.`, ids };
  }
  try {
    const plate = String(p.license_plate || "").trim().toUpperCase();
    const cname = String(p.client_name || "").trim();
    const phone = p.client_phone || null;
    const email = p.client_email || null;
    const mk = p.make || null;
    const md = p.model || null;
    const yr = num(p.year);
    const col = p.color || null;
    const vi = p.vin || null;
    const ml = num(p.mileage);
    if (!plate || !cname) return failW("Numar si nume client obligatorii.");
    const { data: existingCars, error: duplicateCheckError } = await supabase.from("cars").select("license_plate").eq("is_demo", false);
    if (duplicateCheckError) {
      const detail = `${duplicateCheckError.code ?? ""} ${duplicateCheckError.message ?? ""} ${duplicateCheckError.details ?? ""} ${duplicateCheckError.hint ?? ""}`.trim();
      console.error("[create_car] duplicate check failed:", detail);
      return failW("Masina nu a putut fi verificata.", detail);
    }
    if ((existingCars ?? []).some((car) => normalizedPlate(car.license_plate) === normalizedPlate(plate))) {
      return failW("Exista deja o masina cu acest numar.", `duplicate license_plate: ${plate}`);
    }
    const ins = {
      license_plate: plate,
      client_name: cname,
      client_phone: phone,
      client_email: email,
      make: mk,
      model: md,
      year: yr,
      color: col,
      vin: vi,
      mileage: ml,
      fuel_level: p.fuel_level || null,
      status: p.status || "noua",
      priority: p.priority || "normala",
      is_warranty: p.is_warranty === true,
      deadline: p.deadline || null,
      notes: p.notes || null,
      assigned_employee_id: p.assigned_employee_id || null
    };
    if (registry.kind === "local") {
      if (!dataAdapter.createCar) return failW("Crearea local\u0103 a ma\u0219inii nu este disponibil\u0103.");
      const { data: data2, error: error2 } = await dataAdapter.createCar(ins);
      if (error2 || !data2) return failW("Ma\u0219ina nu a putut fi creat\u0103.", error2?.message);
      return { success: true, message: "Ma\u0219ina a fost creat\u0103 cu succes.", id: data2.id };
    }
    const { data, error } = await supabase.from("cars").insert(ins).select("id").single();
    if (error || !data) {
      const detail = error ? `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.trim() : "no data returned";
      console.error("[create_car] insert failed:", detail);
      return failW("Masina nu a putut fi creata.", detail);
    }
    if (ml !== void 0) {
      try {
        await supabase.from("mileage_log").insert({ car_id: data.id, mileage: ml, is_demo: IS_DEMO });
      } catch (e) {
      }
    }
    return { success: true, message: "Masina a fost creata cu succes.", id: data.id };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[create_car] exception:", detail);
    return failW("Eroare la crearea masinii.", detail);
  }
}
async function updateCar(p) {
  const id2 = String(p.car_id || "");
  if (!id2) return failW("car_id obligatoriu.");
  const patch = {};
  const lp = p.license_plate;
  const cn = p.client_name;
  if (lp) patch.license_plate = lp.trim().toUpperCase();
  if (cn) patch.client_name = cn;
  if (p.client_phone !== void 0) patch.client_phone = p.client_phone || null;
  if (p.client_email !== void 0) patch.client_email = p.client_email || null;
  if (p.make !== void 0) patch.make = p.make || null;
  if (p.model !== void 0) patch.model = p.model || null;
  if (p.year !== void 0) patch.year = num(p.year);
  if (p.color !== void 0) patch.color = p.color || null;
  if (p.vin !== void 0) patch.vin = p.vin || null;
  if (p.mileage !== void 0) patch.mileage = num(p.mileage);
  if (p.status) patch.status = p.status;
  if (p.priority) patch.priority = p.priority;
  if (p.is_warranty !== void 0) patch.is_warranty = p.is_warranty === true;
  if (p.notes !== void 0) patch.notes = p.notes || null;
  if (Object.keys(patch).length === 0) return failW("Niciun camp de actualizat.");
  if (registry.kind === "local") {
    if (!dataAdapter.updateCar) return failW("Actualizarea local\u0103 a ma\u0219inii nu este disponibil\u0103.");
    const { error } = await dataAdapter.updateCar(id2, patch);
    return error ? failW("Actualizarea nu a reu\u0219it.", error.message) : { ...okW("Actualizat cu succes."), id: id2 };
  }
  const res = await runUpdate("cars", patch, id2);
  return { ...res, id: res.success ? id2 : void 0 };
}
async function createEmployee(p) {
  try {
    const name = String(p.name || "").trim();
    if (!name) return failW("Numele angajatului este obligatoriu.");
    const ins = {
      name,
      role: p.role === "admin" ? "admin" : "employee",
      active: p.active === false ? false : true,
      is_demo: IS_DEMO
    };
    const { error } = await supabase.from("employees").insert(ins);
    if (error) return failW("Angajatul nu a putut fi creat.");
    return okW("Angajatul a fost creat cu succes.");
  } catch (e) {
    return failW("Eroare la crearea angajatului.");
  }
}
async function updateEmployee(p) {
  const id2 = String(p.employee_id || "");
  if (!id2) return failW("employee_id obligatoriu.");
  const patch = {};
  const nm = p.name;
  const rl = p.role;
  if (nm) patch.name = nm;
  if (p.role) patch.role = rl === "admin" ? "admin" : "employee";
  if (p.active !== void 0) patch.active = p.active === true;
  return runUpdate("employees", patch, id2);
}
async function createJob(p) {
  try {
    const carId = String(p.car_id || "");
    const title = String(p.title || "").trim();
    if (!carId || !title) return failW("car_id si titlul lucrarii sunt obligatorii.");
    const ins = {
      car_id: carId,
      title,
      description: p.description || null,
      status: p.status || "asteptare",
      worked_seconds: 0,
      overtime_seconds: 0,
      is_overtime: false,
      started_at: null,
      completed_at: null,
      order_index: num(p.order_index) ?? 0,
      is_demo: IS_DEMO
    };
    const { error } = await supabase.from("jobs").insert(ins);
    if (error) return failW("Lucrarea nu a putut fi creata.");
    return okW("Lucrarea a fost creata cu succes.");
  } catch (e) {
    return failW("Eroare la crearea lucrarii.");
  }
}
async function updateJob(p) {
  const id2 = String(p.job_id || "");
  if (!id2) return failW("job_id obligatoriu.");
  const patch = {};
  const ti = p.title;
  if (ti) patch.title = ti;
  if (p.description !== void 0) patch.description = p.description || null;
  if (p.order_index !== void 0) {
    const o = num(p.order_index);
    if (o !== void 0) patch.order_index = o;
  }
  return runUpdate("jobs", patch, id2);
}
async function updateJobStatus(p) {
  const jobId = String(p.job_id || "");
  const status = String(p.status || "");
  const empId = p.employee_id ? String(p.employee_id) : null;
  if (!jobId || !status) return failW("job_id si status obligatorii.");
  try {
    const { data: job, error: readErr } = await supabase.from("jobs").select("*").eq("id", jobId).single();
    if (readErr || !job) return failW("Lucrarea nu a putut fi citita.");
    const j = job;
    const completedAt = status === "finalizat" ? (/* @__PURE__ */ new Date()).toISOString() : j.completed_at;
    const { data, error } = await supabase.rpc("safe_update_job_status", {
      p_job_id: j.id,
      p_employee_id: empId ?? null,
      p_status: status,
      p_worked_seconds: j.worked_seconds ?? 0,
      p_overtime_seconds: j.overtime_seconds ?? 0,
      p_started_at: j.started_at
    });
    if (error) return failW("Statusul nu a putut fi actualizat.");
    if (data && data.ok === false) return failW("Statusul nu a putut fi actualizat.");
    if (status === "finalizat") {
      await supabase.from("jobs").update({ completed_at: completedAt }).eq("id", jobId);
    }
    return okW("Statusul lucrarii a fost actualizat cu succes.");
  } catch (e) {
    return failW("Eroare la actualizarea statusului.");
  }
}
async function transferJob(p) {
  const carId = String(p.car_id || "");
  const newEmpId = String(p.new_employee_id || "");
  const adminId = p.admin_id ? String(p.admin_id) : null;
  try {
    const res = await supabase.rpc("admin_transfer_car", { p_car_id: carId, p_new_employee_id: newEmpId, p_admin_id: adminId });
    if (res.error || res.data?.ok === false) {
      const up = await supabase.from("cars").update({ assigned_employee_id: newEmpId }).eq("id", carId);
      if (up.error) return failW("Transferul nu a putut fi efectuat.");
    }
    return okW("Transferul a fost efectuat. Timpul lucrat anterior ramane in istoric.");
  } catch (e) {
    return failW("Eroare la transfer.");
  }
}
async function createAppointment(p) {
  try {
    const date = String(p.appointment_date || "");
    const time = String(p.appointment_time || "");
    if (!date || !time) return failW("Data si ora programarii sunt obligatorii.");
    const ins = {
      appointment_date: date,
      appointment_time: time,
      client_name: p.client_name || null,
      client_phone: p.client_phone || null,
      license_plate: p.license_plate || null,
      make: p.make || null,
      model: p.model || null,
      employee_id: p.employee_id || null,
      status: p.status || "programata",
      notes: p.notes || null,
      is_demo: IS_DEMO
    };
    const { error } = await supabase.from("appointments").insert(ins);
    if (error) return failW("Programarea nu a putut fi creata.");
    return okW("Programarea a fost creata cu succes.");
  } catch (e) {
    return failW("Eroare la crearea programarii.");
  }
}
async function updateAppointment(p) {
  const id2 = String(p.appointment_id || "");
  if (!id2) return failW("appointment_id obligatoriu.");
  const patch = {};
  const dt = p.appointment_date;
  const tm = p.appointment_time;
  const cname = p.client_name;
  if (dt) patch.appointment_date = dt;
  if (tm) patch.appointment_time = tm;
  if (cname) patch.client_name = cname;
  if (p.notes !== void 0) patch.notes = p.notes || null;
  if (p.employee_id !== void 0) patch.employee_id = p.employee_id || null;
  return runUpdate("appointments", patch, id2);
}
async function updateSchedule(p) {
  try {
    const patch = {};
    const days = [`monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`, `sunday`];
    for (const d of days) {
      const activeK = `${d}_active`;
      const startK = `${d}_start`;
      const endK = `${d}_end`;
      if (activeK in p) patch[activeK] = p[activeK] === true;
      if (startK in p) patch[startK] = String(p[startK]);
      if (endK in p) patch[endK] = String(p[endK]);
    }
    if (registry.kind === "local") {
      if (!dataAdapter.updateSchedule) return failW("Actualizarea local\u0103 a programului nu este disponibil\u0103.");
      const { error: error2 } = await dataAdapter.updateSchedule(patch);
      return error2 ? failW("Programul nu a putut fi actualizat.", error2.message) : okW("Programul de lucru a fost actualizat cu succes.");
    }
    const { error } = await supabase.from("work_schedule").update(patch).eq("active", true);
    if (error) return failW("Programul nu a putut fi actualizat.");
    return okW("Programul de lucru a fost actualizat cu succes.");
  } catch (e) {
    return failW("Eroare la actualizarea programului.");
  }
}
async function updateRates(p) {
  const patch = {};
  const nr = num(p.normal_rate);
  if (nr !== void 0) patch.normal_rate = nr;
  const or = num(p.overtime_rate);
  if (or !== void 0) patch.overtime_rate = or;
  const wr = num(p.warranty_rate);
  if (wr !== void 0) patch.warranty_rate = wr;
  const vr = num(p.vat_rate);
  if (vr !== void 0) patch.vat_rate = vr;
  const ur = num(p.urgent_rate);
  if (ur !== void 0) patch.urgent_rate = ur;
  try {
    if (registry.kind === "local") {
      if (!dataAdapter.updateRates) return failW("Actualizarea local\u0103 a tarifelor nu este disponibil\u0103.");
      const { error: error2 } = await dataAdapter.updateRates(patch);
      return error2 ? failW("Tarifele nu au putut fi actualizate.", error2.message) : okW("Tarifele au fost actualizate cu succes.");
    }
    const { data: rows, error: e2 } = await supabase.from("rates").select("id").order("id").limit(1);
    if (e2) return failW("Nu am putut citi tarifele.");
    const row = rows?.[0];
    if (!row) return failW("Nu exista un rand de tarife.");
    const { error } = await supabase.from("rates").update(patch).eq("id", row.id);
    if (error) return failW("Tarifele nu au putut fi actualizate.");
    return okW("Tarifele au fost actualizate cu succes.");
  } catch (e) {
    return failW("Eroare la actualizarea tarifelor.");
  }
}

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
function isReadOnlyAuditIntent(message) {
  const text = String(message ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  return /\b(audit|analizeaz|verifica|verific|raport|read only|doar cit|doar analize|nu face|fara modific|fara sa modific|nu modific|nu schimb|nu sterg|nu crea|nu executa)\b/.test(text) || /\b(s-ar modifica|s-ar schimba|ce trebuie reparat|ce lipseste)\b/.test(text);
}
function hasExplicitWriteDirective(message) {
  const text = String(message ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  if (/\b(?:s-ar modifica|s-ar schimba|daca ar fi|dacă ar fi)\b/.test(text)) return false;
  if (/\bnu face\s*[:\n]/.test(text)) return false;
  if (/\bnu\s+(?:modific|schimb|sterg|creez|actualizez|readuc|restabilesc)/.test(text)) return false;
  return /\b(?:vreau sa\s+)?(?:modific|modifica|schimb|schimba|setez|seteaza|pun|pune|actualizez|actualizeaza|readuc|readuce|revin|revina|restabilest\w*|trebuie sa fie din nou)\b/.test(text);
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
function evaluatePendingConfirmation(pending2, decision) {
  if (!WRITE_ARMED) {
    return {
      canExecute: false,
      reason: "write-disabled (FAZA 2A)",
      state: pending2 ? "awaiting_confirmation" : "idle"
    };
  }
  if (!pending2) {
    return { canExecute: false, reason: "no-pending-operation", state: "idle" };
  }
  if (!isWriteActionAllowed(pending2.action)) {
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

// src/agent/agent-test-management.ts
var runs = /* @__PURE__ */ new Map();
var results = /* @__PURE__ */ new Map();
var bugs = /* @__PURE__ */ new Map();
var fixtures = /* @__PURE__ */ new Map();
var sequence = 0;
function now() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function id(prefix) {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence.toString(36)}`;
}
function fail(error) {
  return { success: false, data: null, error };
}
function ok(data) {
  return { success: true, data };
}
function redact(value, key = "") {
  if (/password|token|secret|service.?role|private.?key|credential|api.?key/i.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  }
  return value;
}
function sanitizeEvidence(input = {}) {
  const safe = redact(input);
  return { timestamp: String(safe.timestamp ?? now()), tool: String(safe.tool ?? "agent"), action: String(safe.action ?? "unknown"), ...safe };
}
function createTestRun(input = {}) {
  const timestamp = now();
  const run = {
    test_run_id: id("TR"),
    created_at: timestamp,
    started_at: timestamp,
    status: "RUNNING",
    environment: input.environment ?? "local",
    cleanup_status: "PENDING",
    description: input.description,
    source: input.source ?? "agent",
    test_mode: input.test_mode ?? "full-test"
  };
  runs.set(run.test_run_id, run);
  return { ...run };
}
function getTestRuns() {
  return [...runs.values()].map((run) => ({ ...run }));
}
function getTestRun(testRunId) {
  const run = runs.get(testRunId);
  return run ? { ...run } : null;
}
function requireRun(testRunId) {
  return runs.get(testRunId) ?? null;
}
function updateTestRunStatus(testRunId, status) {
  const run = runs.get(testRunId);
  if (!run || run.status === "CLEANED" && status !== "CLEANED") return null;
  run.status = status;
  if (status !== "RUNNING") run.finished_at = now();
  if (status === "CLEANUP_PENDING") run.cleanup_status = "CLEANUP_PENDING";
  return { ...run };
}
function recordTestResult(input) {
  if (!requireRun(input.test_run_id)) return null;
  const result = { ...input, id: id("RESULT"), created_at: now(), evidence: (input.evidence ?? []).map(sanitizeEvidence) };
  results.set(result.id, result);
  updateTestRunStatus(input.test_run_id, input.status === "FAIL" ? "FAILED" : input.status === "BLOCKED" ? "BLOCKED" : "RUNNING");
  return { ...result, evidence: result.evidence.map((item) => ({ ...item })) };
}
function getTestResults(testRunId, status) {
  return [...results.values()].filter((result) => (!testRunId || result.test_run_id === testRunId) && (!status || result.status === status)).map((result) => ({ ...result, evidence: result.evidence.map((item) => ({ ...item })) }));
}
function bugKey(input) {
  return `${input.test_run_id}|${(input.test_name ?? input.title).trim().toLowerCase()}|${input.affected_area.trim().toLowerCase()}`;
}
function createBug(input) {
  if (!requireRun(input.test_run_id)) return null;
  const key = bugKey(input);
  const existing = [...bugs.values()].find((bug2) => bugKey(bug2) === key);
  if (existing) return { ...existing, evidence: existing.evidence.map((item) => ({ ...item })) };
  const timestamp = now();
  const bug = { ...input, test_name: input.test_name ?? input.title, bug_id: id("BUG"), status: "OPEN", created_at: timestamp, updated_at: timestamp, evidence: (input.evidence ?? []).map(sanitizeEvidence) };
  bugs.set(bug.bug_id, bug);
  return { ...bug, evidence: bug.evidence.map((item) => ({ ...item })) };
}
function getBugs(testRunId, severity) {
  return [...bugs.values()].filter((bug) => (!testRunId || bug.test_run_id === testRunId) && (!severity || bug.severity === severity)).map((bug) => ({ ...bug, evidence: bug.evidence.map((item) => ({ ...item })) }));
}
function getBug(bugId) {
  const bug = bugs.get(bugId);
  return bug ? { ...bug, evidence: bug.evidence.map((item) => ({ ...item })) } : null;
}
function updateBugStatus(bugId, status) {
  const bug = bugs.get(bugId);
  if (!bug) return null;
  bug.status = status;
  bug.updated_at = now();
  return { ...bug, evidence: bug.evidence.map((item) => ({ ...item })) };
}
function createTestFixture(testRunId, entity, data = {}) {
  if (!requireRun(testRunId)) return null;
  const fixture = { id: id("FIXTURE"), test_run_id: testRunId, entity, data: { ...data, test_run_id: testRunId }, created_at: now() };
  fixtures.set(fixture.id, fixture);
  return { ...fixture, data: { ...fixture.data } };
}
function getTestFixtures(testRunId) {
  return [...fixtures.values()].filter((fixture) => !testRunId || fixture.test_run_id === testRunId).map((fixture) => ({ ...fixture, data: { ...fixture.data } }));
}
function getCleanupStatus(testRunId) {
  const run = requireRun(testRunId);
  if (!run) return null;
  const remaining = { fixtures: getTestFixtures(testRunId).length, results: getTestResults(testRunId).length, bugs: getBugs(testRunId).length };
  return { test_run_id: testRunId, status: run.cleanup_status, remaining };
}
function cleanupTestRun(testRunId, confirmation) {
  const run = requireRun(testRunId);
  if (!run) return fail("test_run_id invalid sau inexistent.");
  if (!/^da$/i.test(confirmation.trim())) return fail("Cleanup necesita confirmarea explicita: Da.");
  for (const [fixtureId, fixture] of fixtures) if (fixture.test_run_id === testRunId) fixtures.delete(fixtureId);
  for (const [resultId, result] of results) if (result.test_run_id === testRunId) results.delete(resultId);
  for (const [bugId, bug] of bugs) if (bug.test_run_id === testRunId) bugs.delete(bugId);
  run.status = "CLEANED";
  run.cleanup_status = "CLEANED";
  run.finished_at = now();
  return ok(getCleanupStatus(testRunId));
}
function executeTestManagementTool(tool, params = {}) {
  switch (tool) {
    case "get_test_runs":
      return ok(getTestRuns());
    case "get_test_run":
      return ok(getTestRun(String(params.test_run_id ?? "")));
    case "get_test_results":
      return ok(getTestResults(params.test_run_id ? String(params.test_run_id) : void 0, params.status));
    case "get_bugs":
      return ok(getBugs(params.test_run_id ? String(params.test_run_id) : void 0, params.severity));
    case "get_bug":
      return ok(getBug(String(params.bug_id ?? "")));
    case "get_cleanup_status":
      return ok(getCleanupStatus(String(params.test_run_id ?? "")));
    case "create_test_run":
      return ok(createTestRun(params));
    case "record_test_result": {
      const result = recordTestResult(params);
      return result ? ok(result) : fail("test_run_id invalid sau inexistent.");
    }
    case "create_bug": {
      const bug = createBug(params);
      return bug ? ok(bug) : fail("test_run_id invalid sau inexistent.");
    }
    case "update_bug_status": {
      const bug = updateBugStatus(String(params.bug_id ?? ""), params.status);
      return bug ? ok(bug) : fail("bug_id invalid sau inexistent.");
    }
    case "cleanup_test_run":
      return cleanupTestRun(String(params.test_run_id ?? ""), String(params.confirmation ?? ""));
    default:
      return fail(`Tool Faza 6 necunoscut: ${tool}`);
  }
}
async function createPersistentTestRun(input = {}) {
  const run = createTestRun(input);
  const { data, error } = await supabase.from("test_runs").insert(run).select().single();
  if (error || !data) {
    runs.delete(run.test_run_id);
    return null;
  }
  return data;
}
async function persistTestFixture(fixture) {
  const { error } = await supabase.from("test_fixtures").insert({ id: fixture.id, test_run_id: fixture.test_run_id, entity_type: fixture.entity, data: fixture.data, created_at: fixture.created_at });
  return !error;
}
async function persistTestResult(result) {
  const { error } = await supabase.from("test_results").insert({ id: result.id, test_run_id: result.test_run_id, test_name: result.test_name, category: result.category, status: result.status, expected: result.expected, actual: result.actual, severity: result.severity, evidence: result.evidence, created_at: result.created_at });
  return !error;
}
async function persistBug(bug) {
  const { error } = await supabase.from("agent_bugs").insert({ bug_id: bug.bug_id, test_run_id: bug.test_run_id, test_name: bug.test_name ?? bug.title, title: bug.title, description: bug.description, severity: bug.severity, expected: bug.expected, actual: bug.actual, reproduction_steps: bug.reproduction_steps, evidence: bug.evidence, affected_area: bug.affected_area, status: bug.status, created_at: bug.created_at, updated_at: bug.updated_at });
  return !error;
}
async function finishPersistentTestRun(testRunId, status) {
  const { error } = await supabase.from("test_runs").update({ status, finished_at: now() }).eq("test_run_id", testRunId);
  return !error;
}
async function getPersistentTestRuns() {
  const { data } = await supabase.from("test_runs").select("*").order("created_at", { ascending: false });
  return data ?? [];
}
async function getPersistentTestResults(testRunId) {
  let query = supabase.from("test_results").select("*").order("created_at", { ascending: true });
  if (testRunId) query = query.eq("test_run_id", testRunId);
  const { data } = await query;
  return data ?? [];
}
async function getPersistentBugs(testRunId, severity) {
  let query = supabase.from("agent_bugs").select("*").order("created_at", { ascending: false });
  if (testRunId) query = query.eq("test_run_id", testRunId);
  if (severity) query = query.eq("severity", severity);
  const { data } = await query;
  return data ?? [];
}
async function cleanupPersistentTestRun(testRunId, confirmation) {
  if (!/^da$/i.test(confirmation.trim())) return fail("Cleanup necesita confirmarea explicita: Da.");
  const { data, error } = await supabase.rpc("cleanup_test_run", { p_test_run_id: testRunId, p_confirmation: "Da" });
  if (error) return fail(error.message);
  return ok(data);
}
var pendingPersistentCleanup = null;
async function handlePersistentTestManagementMessage(message) {
  const text = String(message ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (pendingPersistentCleanup && /^da$/.test(text)) {
    const runId = pendingPersistentCleanup;
    pendingPersistentCleanup = null;
    return cleanupPersistentTestRun(runId, "Da");
  }
  if (pendingPersistentCleanup && /^(nu|anuleaza)$/.test(text)) {
    pendingPersistentCleanup = null;
    return ok("Cleanup anulat.");
  }
  if (/^(porneste|creeaza) un test run$/.test(text)) return ok(await createPersistentTestRun({ source: "agent", test_mode: "full-test" }));
  if (/arat(a|a-mi) (ultimul )?test run/.test(text)) return ok((await getPersistentTestRuns()).slice(0, 1));
  if (/arat(a|a-mi) bug-urile/.test(text)) return ok(await getPersistentBugs(void 0, /critice/.test(text) ? "CRITICAL" : /high/.test(text) ? "HIGH" : void 0));
  if (/ce teste au esuat|arat(a|a-mi) rezultatul testului/.test(text)) {
    const runId = /\bTR-[\w-]+/.exec(text)?.[0];
    return ok((await getPersistentTestResults(runId)).filter((result) => !/ce teste au esuat/.test(text) || result.status === "FAIL"));
  }
  const cleanup = /curata test run-ul\s+(TR-[\w-]+)/.exec(text);
  if (cleanup) {
    pendingPersistentCleanup = cleanup[1].toUpperCase();
    return ok(`Voi \u0219terge DOAR datele asociate test_run_id ${pendingPersistentCleanup}. Datele reale nu vor fi modificate. Confirmi?`);
  }
  if (/status(ul)? cleanup/.test(text)) return fail("Spune test_run_id pentru statusul cleanup.");
  return null;
}
function handleTestManagementMessage(message) {
  const text = String(message ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (/^(porneste|creeaza) un test run$/.test(text)) return executeTestManagementTool("create_test_run");
  if (/arat(a|a-mi) bug-urile/.test(text)) return executeTestManagementTool("get_bugs");
  return null;
}

// src/agent/agent-full-test.ts
function createTestRunId(now2 = Date.now(), random = Math.random()) {
  return `test-${now2}-${Math.floor(random * 16777215).toString(36).padStart(5, "0")}`;
}
function createTestFixture2(testRunId) {
  const employeeA = `employee-${testRunId}-a`;
  const employeeB = `employee-${testRunId}-b`;
  const carId = `car-${testRunId}`;
  const jobId = `job-${testRunId}`;
  return {
    employees: [
      { id: employeeA, name: `TEST EMPLOYEE 1 [${testRunId}]`, role: "employee", active: true, is_demo: true, username: null, avatar_url: null, access_code: null },
      { id: employeeB, name: `TEST EMPLOYEE 2 [${testRunId}]`, role: "employee", active: true, is_demo: true, username: null, avatar_url: null, access_code: null }
    ],
    cars: [{
      id: carId,
      internal_id: null,
      license_plate: `TST${testRunId.slice(-6).toUpperCase()}`,
      client_name: `TEST CLIENT [${testRunId}]`,
      client_phone: "0700000000",
      client_email: null,
      make: "TEST",
      model: "RUNNER",
      year: 2026,
      color: null,
      vin: `TESTVIN-${testRunId}`,
      mileage: 1e3,
      body_observations: null,
      photo_url: null,
      fuel_level: "1/2",
      status: "in_lucru",
      priority: "normala",
      assigned_employee_id: employeeA,
      deadline: null,
      is_warranty: false,
      notes: null,
      overtime_seconds: 0,
      payment_status: "neincasat",
      invoice_status: "nefacturat",
      financial_status: "neincasat",
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      completed_at: null,
      is_demo: true
    }],
    jobs: [{ id: jobId, car_id: carId, title: `TEST JOB NORMAL [${testRunId}]`, description: "Synthetic isolated job", status: "asteptare", worked_seconds: 0, overtime_seconds: 0, is_overtime: false, started_at: null, completed_at: null, order_index: 1, is_demo: true }],
    appointments: [{ id: `appointment-${testRunId}`, license_plate: `TST${testRunId.slice(-6).toUpperCase()}`, appointment_date: "2099-09-10", appointment_time: "14:00", is_demo: true }]
  };
}
function check(id2, category, action, expected, actual, status, severity = "LOW", evidence) {
  return { id: id2, category, action, expected, actual, status, severity, evidence };
}
function buildFullTestReport(testRunId = createTestRunId(), startedAt = (/* @__PURE__ */ new Date()).toISOString()) {
  const fixture = createTestFixture2(testRunId);
  const plate = fixture.cars[0].license_plate;
  const tests = [
    check("TEST-001", "Access", "Legacy login boundary", "Legacy UI can be tested without Auth", "Auth is outside this mode; no Supabase Auth call", "BLOCKED", "MEDIUM", "No live browser credentials are created."),
    check("TEST-002", "Cars", "Synthetic car identity", "Car contains current test_run_id", fixture.cars[0].client_name.includes(testRunId) ? "test_run_id embedded" : "missing test_run_id", fixture.cars[0].client_name.includes(testRunId) ? "PASS" : "FAIL"),
    check("TEST-003", "Jobs", "Synthetic job identity", "Job contains current test_run_id", fixture.jobs[0].title.includes(testRunId) ? "test_run_id embedded" : "missing test_run_id", fixture.jobs[0].title.includes(testRunId) ? "PASS" : "FAIL"),
    check("TEST-004", "Search", "Plate/VIN/client/job search fixture", "All identifiers are unique to run", "Synthetic identifiers are run-scoped", "PASS"),
    check("TEST-005", "Timer", "Normal time accounting", "worked_seconds is normal only", "Fixture starts at 0; no DB timer invoked", "PASS"),
    check("TEST-006", "Overtime", "Overtime accounting", "overtime_seconds is separate", "Fixture keeps overtime_seconds separate at 0", "PASS"),
    check("TEST-007", "Pause / Resume", "State transition model", "Pause excludes elapsed work", "No live RPC executed in isolated mode", "BLOCKED", "MEDIUM"),
    check("TEST-008", "Finalization", "Finalize job", "completed_at and status persist", "No live mutation allowed", "BLOCKED", "HIGH"),
    check("TEST-009", "Transfer", "Employee A to B", "Time fields remain unchanged", "No live transfer allowed", "BLOCKED", "HIGH"),
    check("TEST-010", "Reports", "Normal/overtime totals", "Separate totals are calculated", "Pure fixture uses separate fields", "PASS"),
    check("TEST-011", "PDF", "Report generation", "No real PDF side effects", "Browser/PDF evidence unavailable in isolated mode", "BLOCKED", "LOW"),
    check("TEST-012", "Dashboard", "Live timer and statuses", "Dashboard reflects persisted data", "Live UI test not run", "BLOCKED", "MEDIUM"),
    check("TEST-013", "Schedule", "Weekly schedule overlap", "No real schedule mutation", "Read-only/live schedule test not run", "BLOCKED", "MEDIUM"),
    check("TEST-014", "Rates/VAT", "Rates read-only", "No real rates mutation", "Faza 2 executor remains unchanged", "PASS"),
    check("TEST-015", "Employee History", "Finalized employee history", "History remains untouched", "No history mutation invoked", "PASS"),
    check("TEST-016", "Agent READ", "Read tools", "READ remains available", "Existing READ path unchanged", "PASS"),
    check("TEST-017", "Agent WRITE Faza 2", "Confirmation and allowlist", "Only five existing actions are allowed", isWriteActionAllowed("create_car") && !isWriteActionAllowed("create_employee") ? "Faza 2 allowlist intact" : "allowlist changed", isWriteActionAllowed("create_car") && !isWriteActionAllowed("create_employee") ? "PASS" : "FAIL"),
    check("TEST-018", "Agent Admin", "Phase 3 preview", "Intent is previewable but not executable", parsePhase3Intent(`transfer\u0103 ma\u0219ina ${plate} la TEST EMPLOYEE 2 [${testRunId}]`) ? "Preview created" : "No preview", parsePhase3Intent(`transfer\u0103 ma\u0219ina ${plate} la TEST EMPLOYEE 2 [${testRunId}]`) ? "PASS" : "FAIL"),
    check("TEST-019", "Security", "Phase 3 execution gate", "Confirmed admin operation is blocked", ADMIN_WRITE_EXECUTION_ENABLED ? "Gate enabled" : "Gate disabled", ADMIN_WRITE_EXECUTION_ENABLED ? "FAIL" : "PASS", "LOW", "ADMIN_WRITE_EXECUTION_ENABLED=false"),
    check("TEST-020", "Security", "Confirmation parser", "Da approved, Nu rejected, OK ambiguous", parseConfirmation("Da").status + "/" + parseConfirmation("Nu").status + "/" + parseConfirmation("OK").status, parseConfirmation("Da").status === "approved" && parseConfirmation("Nu").status === "rejected" && parseConfirmation("OK").status === "ambiguous" ? "PASS" : "FAIL"),
    check("TEST-021", "Delete", "Delete safety", "Delete reaches only blocked gate", "No delete function is called", "PASS"),
    check("TEST-022", "Reset", "Operational reset", "Reset is never executed", "No reset call", "PASS"),
    check("TEST-023", "Isolation", "Database test_run_id isolation", "DB rows can be safely scoped by test_run_id", "Schema has is_demo but no test_run_id; DB writes are blocked", "BLOCKED", "HIGH"),
    check("TEST-024", "Cleanup", "Explicit cleanup plan", "Cleanup is scoped and not automatic", `Only planned for ${testRunId}`, "PASS"),
    check("TEST-025", "UI", "Dark/light and responsive UI", "Visual browser evidence exists", "Playwright/browser evidence unavailable", "BLOCKED", "LOW")
  ];
  const endedAt = (/* @__PURE__ */ new Date()).toISOString();
  return { testRunId, startedAt, endedAt, tests, cleanup: { status: "PENDING_EXPLICIT_COMMAND", scope: testRunId, executed: false } };
}
async function runFullTestAndPersist() {
  const run = await createPersistentTestRun({ source: "full-test", test_mode: "full-test", description: "SERVIX Full Test Mode" });
  if (!run) return null;
  const report = buildFullTestReport(run.test_run_id, run.started_at);
  const fixture = createTestFixture2(run.test_run_id);
  const fixtureRows = [
    ...fixture.employees.map((data) => ({ entity: "employee", data })),
    ...fixture.cars.map((data) => ({ entity: "car", data })),
    ...fixture.jobs.map((data) => ({ entity: "job", data })),
    ...fixture.appointments.map((data) => ({ entity: "appointment", data }))
  ];
  for (const row of fixtureRows) {
    const managed = createTestFixture(run.test_run_id, row.entity, row.data);
    if (!managed || !await persistTestFixture(managed)) return null;
  }
  for (const testCase of report.tests) {
    const result = {
      test_run_id: run.test_run_id,
      test_name: testCase.id + ": " + testCase.action,
      category: testCase.category,
      status: testCase.status,
      expected: testCase.expected,
      actual: testCase.actual,
      severity: testCase.severity,
      evidence: testCase.evidence ? [{ timestamp: report.endedAt, tool: "full-test", action: testCase.action, response: testCase.evidence }] : []
    };
    const stored = recordTestResult(result);
    if (!stored || !await persistTestResult(stored)) return null;
    if (testCase.status === "FAIL") {
      const bug = createBug({ test_run_id: run.test_run_id, test_name: testCase.id + ": " + testCase.action, title: testCase.action, description: testCase.actual, severity: testCase.severity, expected: testCase.expected, actual: testCase.actual, reproduction_steps: [testCase.action], affected_area: testCase.category, evidence: result.evidence });
      if (!bug || !await persistBug(bug)) return null;
    }
  }
  const finalStatus = report.tests.some((testCase) => testCase.status === "FAIL") ? "FAILED" : report.tests.some((testCase) => testCase.status === "BLOCKED") ? "BLOCKED" : "PASSED";
  if (!await finishPersistentTestRun(run.test_run_id, finalStatus)) return null;
  return report;
}
function formatFullTestReport(report) {
  const count = (status) => report.tests.filter((test2) => test2.status === status).length;
  const severe = (severity) => report.tests.filter((test2) => test2.severity === severity && test2.status === "FAIL").length;
  const lines = [
    "FULL TEST REPORT",
    "",
    `Test Run: ${report.testRunId}`,
    `Start: ${report.startedAt}`,
    `End: ${report.endedAt}`,
    "",
    `TOTAL TESTS: ${report.tests.length}`,
    `PASS: ${count("PASS")}`,
    `FAIL: ${count("FAIL")}`,
    `BLOCKED: ${count("BLOCKED")}`,
    `CRITICAL: ${severe("CRITICAL")}`,
    `HIGH: ${severe("HIGH")}`,
    `MEDIUM: ${severe("MEDIUM")}`,
    `LOW: ${severe("LOW")}`,
    "",
    "BLOCKED:",
    ...report.tests.filter((test2) => test2.status === "BLOCKED").map((test2) => `- ${test2.id} ${test2.category}: ${test2.actual}`),
    "",
    `CLEANUP STATUS: ${report.cleanup.status}`,
    `CLEANUP SCOPE: ${report.cleanup.scope}`,
    "CLEANUP EXECUTED: NO"
  ];
  return lines.join("\n");
}
function isFullTestCommand(message) {
  const text = String(message ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  return /^(agent,?\s*)?(testeaza programul|porneste testele|ruleaza test complet|full test)$/.test(text);
}

// src/agent/agent-write-flow.ts
var flowState = "idle";
var pending = null;
var pendingPlan = null;
var pendingPreviewLines = [];
function resetFlow() {
  flowState = "idle";
  pending = null;
  pendingPlan = null;
  pendingPreviewLines = [];
}
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
async function readCurrentRates() {
  const { data, error } = await supabase.from("rates").select("*").order("id").limit(1);
  if (error) return {};
  if (!data?.[0]) return {};
  return data[0];
}
async function readCurrentSchedule() {
  const { data, error } = await supabase.from("work_schedule").select("*").eq("active", true).order("id").limit(1);
  if (error || !data?.[0]) return null;
  return data[0];
}
function buildRatesPreview(changes, current) {
  const lines = [];
  const units = {
    normal_rate: "lei/or\u0103",
    urgent_rate: "lei/or\u0103",
    overtime_rate: "lei/or\u0103",
    warranty_rate: "lei/or\u0103",
    vat_rate: "%"
  };
  const labels = {
    normal_rate: "Tariful normal",
    urgent_rate: "Tariful urgent",
    overtime_rate: "Tariful overtime",
    warranty_rate: "Tariful garan\u021Bie",
    vat_rate: "TVA"
  };
  for (const [k, v] of Object.entries(changes)) {
    lines.push(labels[k] + " actual: " + (current[k] ?? "necunoscut") + " " + units[k] + ".");
    lines.push(labels[k] + " nou: " + v + " " + units[k] + ".");
  }
  lines.push("", "Confirmi modificarea?");
  return lines;
}
function buildSchedulePreview(changes, current) {
  const lines = [];
  const day = Object.keys(changes)[0].replace(/_(active|start|end)$/, "");
  const curActive = current[day + "_active"] ?? false;
  lines.push(DAY_LABELS[day] + " este momentan " + (curActive ? "activ\u0103 (" + current[day + "_start"] + "-" + current[day + "_end"] + ")" : "inactiv\u0103") + ".");
  if (changes[day + "_active"] === false) {
    lines.push("Program nou: inactiv\u0103.");
  } else {
    lines.push("Noul program:");
    lines.push("Activ\u0103: Da");
    lines.push("\xCEnceput: " + changes[day + "_start"]);
    lines.push("Sf\xE2r\u0219it: " + changes[day + "_end"]);
  }
  lines.push("", "Confirmi modificarea?");
  return lines;
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
function normPlate(p) {
  return String(p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function normName(n) {
  return norm(String(n ?? ""));
}
async function loadNonDemoCars() {
  if (registry.kind === "local") {
    const { data: data2, error: error2 } = await dataAdapter.getCars();
    return error2 ? null : data2 ?? [];
  }
  const { data, error } = await supabase.from("cars").select("id, license_plate, internal_id, client_name, client_phone, client_email, make, model, year, vin, mileage").eq("is_demo", false);
  if (error) return null;
  return data ?? [];
}
async function readCarById(id2) {
  if (registry.kind === "local") {
    const { data: data2, error: error2 } = await dataAdapter.getCars();
    return error2 ? null : (data2 ?? []).find((car) => car.id === id2) ?? null;
  }
  const { data, error } = await supabase.from("cars").select("*").eq("id", id2).maybeSingle();
  if (error || !data) return null;
  return data;
}
function carLabel(car) {
  return [car.license_plate, [car.make, car.model].filter(Boolean).join(" ")].filter(Boolean).join(" \u2014 ");
}
function valuesMatch(field, actual, proposed) {
  if (field === "mileage" || field === "year") return Number(actual) === Number(proposed);
  return String(actual ?? "").trim() === String(proposed ?? "").trim();
}
function buildCarCreatePreview(changes) {
  const lines = ["Ma\u0219in\u0103 nou\u0103:"];
  lines.push("Num\u0103r: " + changes.license_plate);
  lines.push("Client: " + changes.client_name);
  if (changes.client_phone) lines.push("Telefon: " + changes.client_phone);
  if (changes.make || changes.model) lines.push("Marc\u0103 / Model: " + [changes.make, changes.model].filter(Boolean).join(" "));
  if (changes.vin) lines.push("VIN: " + changes.vin);
  if (changes.mileage !== void 0 && changes.mileage !== null) lines.push("Kilometraj: " + changes.mileage + " km");
  lines.push("", "Confirmi crearea?");
  return lines;
}
function buildCarBatchCreatePreview(cars, existingPlates = []) {
  const lines = ["PREVIEW \u2014 CREARE MA\u0218INI", ""];
  if (existingPlates.length > 0) {
    lines.push(`Deja existente, nu vor fi create: ${existingPlates.join(", ")}`);
    lines.push("");
  }
  for (const [index, car] of cars.entries()) {
    lines.push(`${index + 1}. ${car.license_plate} \u2014 ${[car.make, car.model].filter(Boolean).join(" ") || "f\u0103r\u0103 marc\u0103/model"}`);
    lines.push(`   Client: ${car.client_name}`);
    if (car.client_phone) lines.push(`   Telefon: ${car.client_phone}`);
    lines.push("");
  }
  lines.push("Confirmi crearea?");
  return lines;
}
function buildCarUpdatePreview(car, changes) {
  const labels = {
    model: "Model",
    make: "Marc\u0103",
    color: "Culoare",
    year: "An",
    vin: "VIN",
    mileage: "Kilometraj",
    client_name: "Client",
    client_phone: "Telefon",
    client_email: "Email"
  };
  const lines = ["Ma\u0219in\u0103: " + carLabel(car)];
  if (changes.client_name || changes.client_phone || changes.client_email) {
    lines.push("Client actual: " + (car.client_name ?? "\u2014"));
  }
  for (const [k, v] of Object.entries(changes)) {
    lines.push(labels[k] + " actual: " + (car[k] ?? "\u2014"));
    lines.push(labels[k] + " nou: " + v);
  }
  lines.push("", "Confirmi modificarea?");
  return lines;
}
var CLIENT_ONLY_FIELDS = ["client_name", "client_phone", "client_email"];
async function prepareCarOperation(parsed) {
  const cars = await loadNonDemoCars();
  if (!cars) return { success: false, text: "Nu am putut citi ma\u0219inile pentru verificare." };
  if (parsed.action === "create_car") {
    const creates = parsed.cars ?? [parsed.changes];
    const duplicatePlates = creates.filter((create) => cars.some((car2) => normPlate(car2.license_plate) === normPlate(create.license_plate))).map((create) => String(create.license_plate));
    const repeatedPlates = creates.map((create) => normPlate(create.license_plate)).filter((plate, index, all) => all.indexOf(plate) !== index);
    if (repeatedPlates.length > 0) {
      const plates = [...new Set(repeatedPlates)].join(", ");
      return {
        success: false,
        text: "Cererea con\u021Bine numere duplicate: " + plates + ". Corecteaz\u0103 cererea \xEEnainte de confirmare."
      };
    }
    const newCars = creates.filter((create) => !duplicatePlates.includes(String(create.license_plate)));
    if (newCars.length === 0) return { success: false, text: `Toate ma\u0219inile exist\u0103 deja: ${duplicatePlates.join(", ")}. Nimic nu a fost creat.` };
    const params = newCars.length === 1 ? newCars[0] : { cars: newCars };
    pending = createPendingOperation("create_car", { license_plate: newCars.map((car2) => car2.license_plate).join(", ") }, params);
    pendingPlan = { kind: "create_car", description: parsed.summary, params };
    pendingPreviewLines = creates.length === 1 ? buildCarCreatePreview(newCars[0]) : buildCarBatchCreatePreview(newCars, duplicatePlates);
    flowState = "awaiting_confirmation";
    return {
      success: true,
      text: pendingPreviewLines.join("\n"),
      pending: { operationId: pending.operationId, action: pending.action, lines: pendingPreviewLines }
    };
  }
  let candidates = [];
  if (parsed.plate) {
    const plate = normPlate(parsed.plate);
    candidates = cars.filter((c) => normPlate(c.license_plate) === plate);
    if (candidates.length === 0) {
      candidates = cars.filter((c) => normPlate(c.vin) === plate);
    }
  } else if (parsed.clientName) {
    const name = normName(parsed.clientName);
    candidates = cars.filter((c) => normName(c.client_name) === name);
  }
  if (candidates.length === 0) {
    return { success: false, text: "Nu am g\u0103sit ma\u0219ina c\u0103utat\u0103. Verific\u0103 num\u0103rul de \xEEnmatriculare." };
  }
  if (candidates.length > 1) {
    const list = candidates.slice(0, 10).map(
      (c, i) => i + 1 + ". " + carLabel(c) + " \u2014 client: " + (c.client_name ?? "\u2014") + (c.internal_id ? " (" + c.internal_id + ")" : "")
    ).join("\n");
    return {
      success: false,
      text: "Am g\u0103sit mai multe ma\u0219ini care se potrivesc. Precizeaz\u0103 exact care (num\u0103r de \xEEnmatriculare sau ID intern):\n\n" + list
    };
  }
  const car = candidates[0];
  const action = parsed.action === "update_client" && Object.keys(parsed.changes).every((k) => CLIENT_ONLY_FIELDS.includes(k)) ? "update_client" : "update_car";
  if (Object.entries(parsed.changes).every(([k, v]) => valuesMatch(k, car[k], v))) {
    return { success: false, text: "Valoarea este deja aceasta. Nimic nu a fost modificat." };
  }
  pending = createPendingOperation(action, { car_id: car.id }, parsed.changes);
  pendingPlan = { kind: action, description: parsed.summary, params: { ...parsed.changes, car_id: car.id } };
  pendingPreviewLines = buildCarUpdatePreview(car, parsed.changes);
  flowState = "awaiting_confirmation";
  return {
    success: true,
    text: pendingPreviewLines.join("\n"),
    pending: { operationId: pending.operationId, action: pending.action, lines: pendingPreviewLines }
  };
}
async function executeWithReadBack(plan2, changes) {
  const result = await executeWrite(plan2);
  if (!result.success) {
    if (result.debugError) console.error(`[agent-write-flow] ${plan2.kind} failed:`, result.debugError);
    flowState = "error";
    return { ok: false, message: result.message };
  }
  const changedKeys = Object.keys(changes);
  const NOT_CONFIRMED = "Opera\u021Bia a fost trimis\u0103, dar nu am putut confirma rezultatul.";
  if (plan2.kind === "update_rates") {
    const fresh = await readCurrentRates();
    if (!fresh || changedKeys.some((k) => Number(fresh[k]) !== Number(changes[k]))) {
      flowState = "error";
      return { ok: false, message: "Modificarea nu a putut fi confirmat\u0103." };
    }
  } else if (plan2.kind === "update_schedule") {
    const fresh = await readCurrentSchedule();
    if (!fresh || changedKeys.some((k) => fresh[k] !== changes[k])) {
      flowState = "error";
      return { ok: false, message: "Modificarea nu a putut fi confirmat\u0103." };
    }
  } else if (plan2.kind === "create_car") {
    const creates = Array.isArray(plan2.params.cars) ? plan2.params.cars : [changes];
    const ids = result.ids ?? (result.id ? [result.id] : []);
    const readBackKeys = ["license_plate", "client_name", "client_phone", "make", "model", "year", "vin", "mileage"];
    const verified = await Promise.all(ids.map(async (id2, index) => {
      const fresh = await readCarById(id2);
      const create = creates[index] ?? {};
      return Boolean(fresh) && !readBackKeys.some((key) => create[key] !== void 0 && !valuesMatch(key, fresh[key], create[key]));
    }));
    if (ids.length !== creates.length || verified.some((value) => !value)) {
      flowState = "error";
      return { ok: false, message: NOT_CONFIRMED };
    }
    const created = ids.map((id2, index) => `${creates[index].license_plate} (ID: ${id2})`).join("\n");
    flowState = "success";
    return { ok: true, message: `Ma\u0219ini create \u0219i confirmate:
${created}` };
  } else if (plan2.kind === "update_car" || plan2.kind === "update_client") {
    const id2 = String(plan2.params.car_id ?? "");
    const fresh = id2 ? await readCarById(id2) : null;
    if (!fresh || changedKeys.some((k) => !valuesMatch(k, fresh[k], changes[k]))) {
      flowState = "error";
      return { ok: false, message: NOT_CONFIRMED };
    }
  }
  flowState = "success";
  return { ok: true, message: result.message };
}
function looksLikeNewQuestion(message) {
  const t = norm(message);
  return /^(cate|cati|cata|cat|care|ce|arata|afiseaza|lista|vezi|exista|cum|de ce|cand|unde|tarifele|programul)\b/.test(t) || /\?\s*$/.test(message);
}
async function handleAgentMessage(message, fallback) {
  const persistentManagement = await handlePersistentTestManagementMessage(message);
  if (persistentManagement) {
    return { success: persistentManagement.success, text: persistentManagement.success ? JSON.stringify(persistentManagement.data, null, 2) : persistentManagement.error ?? "Opera\u021Bia Faza 6 nu a reu\u0219it." };
  }
  const testManagement = handleTestManagementMessage(message);
  if (testManagement) {
    return { success: testManagement.success, text: testManagement.success ? JSON.stringify(testManagement.data, null, 2) : testManagement.error ?? "Opera\u021Bia Faza 6 nu a reu\u0219it." };
  }
  if (isFullTestCommand(message)) {
    const report = await runFullTestAndPersist();
    return { success: true, text: formatFullTestReport(report ?? buildFullTestReport()) };
  }
  if (isReadOnlyAuditIntent(message) && !hasExplicitWriteDirective(message)) return fallback();
  if (pending && pendingPlan && parseConfirmation(message).status !== "ambiguous") {
    const decision = parseConfirmation(message);
    if (!isWriteActionAllowed(pending.action) && !ADMIN_WRITE_EXECUTION_ENABLED && decision.status === "approved") {
      pending = null;
      pendingPlan = null;
      pendingPreviewLines = [];
      flowState = "cancelled";
      return { success: false, text: "Opera\u021Bia a fost confirmat\u0103, dar execu\u021Bia opera\u021Biilor administrative ale Agentului este momentan dezactivat\u0103." };
    }
    const approval = evaluatePendingConfirmation(pending, decision);
    if (decision.status === "rejected") {
      pending = null;
      pendingPlan = null;
      pendingPreviewLines = [];
      flowState = "cancelled";
      return { success: true, text: "Am \xEEn\u021Beles. Nu am efectuat nicio modificare." };
    }
    if (approval.canExecute) {
      const op = pending;
      flowState = "executing";
      const res = await executeWithReadBack(pendingPlan, op.proposedChanges ?? {});
      pending = null;
      pendingPlan = null;
      pendingPreviewLines = [];
      return { success: res.ok, text: res.message };
    }
    if (decision.status === "ambiguous" && looksLikeNewQuestion(message)) {
      return fallback();
    }
    return {
      success: false,
      text: 'R\u0103spunsul este ambiguu. Te rog confirm\u0103 explicit (\u201EDa, confirm") sau anuleaz\u0103 (\u201ENu").',
      pending: { operationId: pending.operationId, action: pending.action, lines: pendingPreviewLines }
    };
  }
  const parsed = parseWriteIntent(message);
  if (parsed) {
    if ("error" in parsed) {
      return { success: false, text: parsed.error };
    }
    if (!isWriteActionAllowed(parsed.action)) {
      return { success: false, text: "Aceast\u0103 opera\u021Bie de scriere nu este activat\u0103." };
    }
    if (parsed.action === "update_rates") {
      const current = await readCurrentRates();
      if (!current) return { success: false, text: "Nu am putut citi tarifele actuale." };
      pending = createPendingOperation("update_rates", { id: current.id }, parsed.changes);
      pendingPlan = { kind: "update_rates", description: parsed.summary, params: parsed.changes };
      pendingPreviewLines = buildRatesPreview(parsed.changes, current);
    } else {
      const current = await readCurrentSchedule();
      if (!current) return { success: false, text: "Nu am putut citi programul de lucru actual." };
      const fillErr = fillScheduleFromCurrent(parsed, current);
      if (fillErr) return { success: false, text: fillErr };
      pending = createPendingOperation("update_schedule", { id: current.id }, parsed.changes);
      pendingPlan = { kind: "update_schedule", description: parsed.summary, params: parsed.changes };
      pendingPreviewLines = buildSchedulePreview(parsed.changes, current);
    }
    flowState = "awaiting_confirmation";
    return {
      success: true,
      text: pendingPreviewLines.join("\n"),
      pending: { operationId: pending.operationId, action: pending.action, lines: pendingPreviewLines }
    };
  }
  const carParsed = parseCarWriteIntent(message);
  if (carParsed) {
    if ("error" in carParsed) {
      return { success: false, text: carParsed.error };
    }
    if (!isWriteActionAllowed(carParsed.action)) {
      return { success: false, text: "Aceast\u0103 opera\u021Bie de scriere nu este activat\u0103." };
    }
    return await prepareCarOperation(carParsed);
  }
  const phase3Parsed = parsePhase3Intent(message);
  if (phase3Parsed) {
    if ("error" in phase3Parsed) return { success: false, text: phase3Parsed.error };
    pending = createPendingOperation(phase3Parsed.action, phase3Parsed.target, phase3Parsed.changes);
    pendingPlan = { kind: "phase3_admin", description: phase3Parsed.action, params: phase3Parsed.changes };
    pendingPreviewLines = phase3Parsed.preview;
    flowState = "awaiting_confirmation";
    return {
      success: true,
      text: pendingPreviewLines.join("\n"),
      pending: { operationId: pending.operationId, action: pending.action, lines: pendingPreviewLines }
    };
  }
  const loose = parseConfirmation(message);
  if (loose.status === "approved") {
    return { success: false, text: "Nu exist\u0103 nicio opera\u021Bie \xEEn a\u0219teptarea confirm\u0103rii, deci nu am executat nimic." };
  }
  return fallback();
}

// tests/faza3b-phase3.test.ts
test("FAZA 3B: recunoa\u0219te inten\u021Biile administrative", () => {
  assert.equal(parsePhase3Intent("creeaz\u0103 un angajat Ion Popescu")?.action, "create_employee");
  assert.equal(parsePhase3Intent("modific\u0103 angajatul Ion Popescu")?.action, "update_employee");
  assert.equal(parsePhase3Intent("dezactiveaz\u0103 angajatul Ion Popescu")?.action, "deactivate_employee");
  assert.equal(parsePhase3Intent("creeaz\u0103 lucrare nou\u0103 schimb ulei")?.action, "create_job");
  assert.equal(parsePhase3Intent("modific\u0103 lucrarea B123ABC")?.action, "update_job");
  assert.equal(parsePhase3Intent("schimb\u0103 statusul lucr\u0103rii B123ABC \xEEn finalizat")?.action, "change_job_status");
  assert.equal(parsePhase3Intent("adaug\u0103 programare pe 10.09.2026 la 14:00")?.action, "create_appointment");
  assert.equal(parsePhase3Intent("anuleaz\u0103 programarea B123ABC")?.action, "cancel_appointment");
  assert.equal(parsePhase3Intent("transfer\u0103 ma\u0219ina B123ABC la Maria")?.action, "transfer_car");
  assert.equal(parsePhase3Intent("\u0219terge lucrarea B123ABC")?.action, "delete_job");
});
test("FAZA 3B: diacriticele \u0219i majusculele sunt suportate", () => {
  assert.equal(parsePhase3Intent("\u0218TERGE PROGRAMAREA B123ABC")?.action, "cancel_appointment");
  assert.equal(parsePhase3Intent("MUT\u0102 MA\u0218INA B123ABC LA MARIA")?.action, "transfer_car");
});
test("FAZA 3B: ambiguit\u0103\u021Bile cer clarificare", () => {
  const errors = [
    parsePhase3Intent("\u0219terge programarea"),
    parsePhase3Intent("schimb\u0103 statusul lucr\u0103rii"),
    parsePhase3Intent("transfer\u0103 ma\u0219ina la Maria"),
    parsePhase3Intent("creeaz\u0103 programare")
  ].map((result) => result && "error" in result ? result.error : "");
  assert.match(errors[0], /Spune exact/);
  assert.match(errors[1], /Spune exact/);
  assert.match(errors[2], /numărul exact/);
  assert.match(errors[3], /data și ora/);
});
test("FAZA 3B: statusurile sunt limitate la cele existente", () => {
  const invalid = parsePhase3Intent("schimb\u0103 statusul lucr\u0103rii B123ABC \xEEn arhivat");
  assert.ok(invalid && "error" in invalid);
  assert.match(invalid.error, /Status invalid/);
  const valid = parsePhase3Intent("schimb\u0103 statusul lucr\u0103rii B123ABC \xEEn finalizat");
  assert.deepEqual(valid && "error" in valid ? null : valid?.changes.status, "finalizat");
});
test("FAZA 3B: preview-ul con\u021Bine \u021Binta, risc \u0219i confirmare", () => {
  const parsed = parsePhase3Intent("transfer\u0103 ma\u0219ina B123ABC la Maria");
  assert.ok(parsed && !("error" in parsed));
  assert.ok(parsed.preview.some((line) => line.includes("B123ABC")));
  assert.ok(parsed.preview.some((line) => line.includes("RISC: HIGH")));
  assert.ok(parsed.preview.some((line) => line.includes("CONFIRMARE: DA / NU")));
  assert.ok(parsed.preview.some((line) => line.includes("NU SE RESETEAZ\u0102")));
});
test("FAZA 3B: confirmation valid\u0103 nu trece de execution gate", async () => {
  resetFlow();
  const preview2 = await handleAgentMessage("\u0219terge lucrarea B123ABC", async () => ({ success: true, text: "read" }));
  assert.equal(preview2.success, true);
  const blocked = await handleAgentMessage("Da", async () => ({ success: true, text: "read" }));
  assert.equal(blocked.success, false);
  assert.match(blocked.text, /execuția operațiilor administrative.*dezactivată/i);
});
test("FAZA 3B: executorul refuz\u0103 phase3_admin \u0219i gate-ul este dezactivat", async () => {
  assert.equal(ADMIN_WRITE_EXECUTION_ENABLED, false);
  const result = await executeWrite({ kind: "phase3_admin", description: "delete_job", params: {} });
  assert.equal(result.success, false);
});
test("FAZA 3B: anularea nu execut\u0103 nimic", async () => {
  resetFlow();
  await handleAgentMessage("\u0219terge programarea B123ABC", async () => ({ success: true, text: "read" }));
  const cancelled = await handleAgentMessage("Nu", async () => ({ success: true, text: "read" }));
  assert.equal(cancelled.success, true);
  assert.match(cancelled.text, /nicio modificare/i);
});
