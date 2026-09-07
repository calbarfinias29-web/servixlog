// tests/faza2b-etapa2-cars.test.ts
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
var RO_NUMBER_WORD = new RegExp(
  "^(" + Object.keys(RO_UNITS).join("|") + "|" + Object.keys(RO_TENS).join("|") + "|suta|sute|mie|mii|si)$"
);
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

// tests/faza2b-etapa2-cars.test.ts
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
console.log("FAZA 2B ETAPA 2 \u2014 masini + clienti");
test("Parse: create_car cu date complete", () => {
  const r = parseCarWriteIntent("Adaug\u0103 ma\u0219ina B123ABC pentru clientul Ion Popescu, marca BMW, model X5, kilometraj 150000, telefon 0712345678");
  assert.equal(r.action, "create_car");
  assert.equal(r.changes.license_plate, "B123ABC");
  assert.equal(r.changes.client_name, "Ion Popescu");
  assert.equal(r.changes.make, "BMW");
  assert.equal(r.changes.model, "X5");
  assert.equal(r.changes.mileage, 15e4);
  assert.equal(r.changes.client_phone, "0712345678");
});
test("Parse: create_car cu numar cu spatii (TM 27 FXC)", () => {
  const r = parseCarWriteIntent("Adaug\u0103 ma\u0219ina TM 27 FXC pentru clientul Andrei Pop, kilometraj 80000");
  assert.equal(r.action, "create_car");
  assert.equal(r.changes.license_plate, "TM27FXC");
});
test("Parse: create_car accepta TM 10 TEST si pastreaza toate campurile", () => {
  const r = parseCarWriteIntent("Adaug\u0103 ma\u0219ina TM 10 TEST pentru clientul Client Test, marca Dacia, model Logan, kilometraj 100000, telefon 0712345678");
  assert.equal(r.action, "create_car");
  assert.equal(r.changes.license_plate, "TM10TEST");
  assert.equal(r.changes.client_name, "Client Test");
  assert.equal(r.changes.make, "Dacia");
  assert.equal(r.changes.model, "Logan");
  assert.equal(r.changes.mileage, 1e5);
  assert.equal(r.changes.client_phone, "0712345678");
});
test("Parse: create_car accepta placi compacte si standard", () => {
  for (const plate of ["TM10TEST", "B123ABC", "IS05RTG"]) {
    const r = parseCarWriteIntent(`Adaug\u0103 ma\u0219ina ${plate} pentru clientul Client Test, marca Dacia, model Logan, kilometraj 100000, telefon 0712345678`);
    assert.equal(r.action, "create_car");
    assert.equal(r.changes.license_plate, plate);
  }
});
test("Parse: cererea explicit\u0103 pentru 3 ma\u0219ini este CREATE \u0219i extrage toate ma\u0219inile", () => {
  const r = parseCarWriteIntent(`Creeaz\u0103 3 ma\u0219ini noi \xEEn baza Local\u0103.
1.
Num\u0103r: TM 10 TEST
Marc\u0103: BMW
Model: Seria 3
Client: Client Test 1
Telefon: 0722000001
2.
Num\u0103r: TM 20 TEST
Marc\u0103: Audi
Model: A4
Client: Client Test 2
Telefon: 0722000002
3.
Num\u0103r: TM 30 TEST
Marc\u0103: Dacia
Model: Duster
Client: Client Test 3
Telefon: 0722000003`);
  assert.equal(r.action, "create_car");
  assert.equal(r.cars.length, 3);
  assert.deepEqual(r.cars.map((car) => car.license_plate), ["TM10TEST", "TM20TEST", "TM30TEST"]);
  assert.equal(r.cars[1].client_name, "Client Test 2");
  assert.equal(r.cars[1].make, "Audi");
  assert.equal(r.cars[1].model, "A4");
});
test("CREATE: campuri obligatorii lipsa -> intreaba, nu inventeaza", () => {
  const r = parseCarWriteIntent("Adaug\u0103 clientul Ion Popescu.");
  assert.ok(r.error);
  assert.ok(String(r.error).includes("\xEEnmatriculare"));
  assert.ok(String(r.error).includes("kilometraj"));
});
test("CREATE: kilometraj lipsa -> intreaba", () => {
  const r = parseCarWriteIntent("Adaug\u0103 ma\u0219ina B123ABC pentru clientul Ion Popescu, marca BMW");
  assert.ok(r.error);
  assert.ok(String(r.error).includes("kilometraj"));
});
test("Parse: update_car \u2014 schimba modelul", () => {
  const r = parseCarWriteIntent("Schimb\u0103 modelul ma\u0219inii B123ABC \xEEn X3.");
  assert.equal(r.action, "update_car");
  assert.equal(r.plate, "B123ABC");
  assert.deepEqual(r.changes, { model: "X3" });
});
test("Parse: update_client \u2014 telefonul lui Ion Popescu", () => {
  const r = parseCarWriteIntent("Schimb\u0103 telefonul lui Ion Popescu la 0712345678.");
  assert.equal(r.action, "update_client");
  assert.equal(r.clientName, "Ion Popescu");
  assert.deepEqual(r.changes, { client_phone: "0712345678" });
});
test("Parse: muta masina la client", () => {
  const r = parseCarWriteIntent("Mut\u0103 ma\u0219ina B123ABC la Ion Popescu.");
  assert.equal(r.action, "update_client");
  assert.equal(r.plate, "B123ABC");
  assert.deepEqual(r.changes, { client_name: "Ion Popescu" });
});
test("UPDATE: telefon invalid respins", () => {
  const r = parseCarWriteIntent("Schimb\u0103 telefonul lui Ion Popescu la abc.");
  assert.ok(r.error);
});
test("UPDATE: an invalid respins", () => {
  const r = parseCarWriteIntent("Schimb\u0103 anul ma\u0219inii B123ABC la 1800.");
  assert.ok(r.error);
});
test("UPDATE: fara identificator -> cere clarificare", () => {
  const r = parseCarWriteIntent("Schimb\u0103 modelul \xEEn X3.");
  assert.ok(r.error);
});
test("READ: intrebarile nu sunt intentii WRITE masina", () => {
  assert.equal(parseCarWriteIntent("C\xE2te ma\u0219ini avem?"), null);
  assert.equal(parseCarWriteIntent("Care sunt tarifele?"), null);
  assert.equal(parseCarWriteIntent("Ce program avem azi?"), null);
});
test("Allowlist: create_client independent BLOCAT (limitare arhitectura)", () => {
  assert.equal(isWriteActionAllowed("create_client"), false);
  assert.equal(isWriteActionAllowed("update_client"), true);
});
console.log("FAZA 2B ETAPA 2: " + passed + " pass, " + failed + " fail");
if (failed > 0) process.exit(1);
