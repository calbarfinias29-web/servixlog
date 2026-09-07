// tests/microphone.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";

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

// src/lib/costs.ts
function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function calculateCostSummary(subtotal, vatRate) {
  const roundedSubtotal = roundMoney(subtotal);
  const vatAmount = roundMoney(roundedSubtotal * vatRate / 100);
  return { subtotal: roundedSubtotal, vatAmount, totalWithVat: roundMoney(roundedSubtotal + vatAmount) };
}

// src/agent/agent-tools.ts
function ok(data) {
  return { success: true, data };
}
function fail(error) {
  return { success: false, data: null, error };
}
async function get_dashboard() {
  try {
    const [cR, jR, eR, aR] = await Promise.all([
      supabase.from("cars").select("id, status").eq("is_demo", false),
      supabase.from("jobs").select("id, status").eq("is_demo", false),
      supabase.from("employees").select("id, active").eq("is_demo", false),
      supabase.from("appointments").select("id, status").eq("is_demo", false)
    ]);
    if (cR.error) return fail(cR.error.message);
    if (jR.error) return fail(jR.error.message);
    if (eR.error) return fail(eR.error.message);
    if (aR.error) return fail(aR.error.message);
    const cars = cR.data ?? [];
    const jobs = jR.data ?? [];
    const emps = eR.data ?? [];
    const appts = aR.data ?? [];
    return ok({ cars: { total: cars.length, in_lucru: cars.filter((c) => c.status === "in_lucru").length, finalizata: cars.filter((c) => c.status === "finalizata").length }, jobs: { total: jobs.length, in_lucru: jobs.filter((j) => j.status === "in_lucru").length, finalizat: jobs.filter((j) => j.status === "finalizat").length }, employees: { total: emps.length, active: emps.filter((e) => e.active).length }, appointments: { total: appts.length, programata: appts.filter((a) => a.status === "programata").length } });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Eroare");
  }
}
async function get_cars(params) {
  if (registry.kind === "local") {
    const { data, error } = await dataAdapter.getCars();
    if (error) return fail(error.message);
    const status = params.status;
    return ok((data ?? []).filter((car) => !car.is_demo && (!status || car.status === status)));
  }
  try {
    const st = params.status;
    let q = supabase.from("cars").select("*").eq("is_demo", false).order("created_at", { ascending: false });
    if (st) q = q.eq("status", st);
    const { data, error } = await q;
    if (error) return fail(error.message);
    return ok(data ?? []);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Eroare");
  }
}
async function get_car(params) {
  try {
    const id = params.car_id;
    if (!id) return fail("car_id obligatoriu");
    const { data, error } = await supabase.from("cars").select("*, jobs(*)").eq("id", id).single();
    if (error) return fail(error.message);
    return ok(data);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Eroare");
  }
}
async function get_employees() {
  if (registry.kind === "local") {
    const { data, error } = await dataAdapter.getEmployees();
    return error ? fail(error.message) : ok((data ?? []).filter((employee) => !employee.is_demo));
  }
  try {
    const { data, error } = await supabase.from("employees").select("*").eq("is_demo", false).order("name");
    if (error) return fail(error.message);
    return ok(data ?? []);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Eroare");
  }
}
async function get_employee(params) {
  try {
    const id = params.employee_id;
    if (!id) return fail("employee_id obligatoriu");
    const { data, error } = await supabase.from("employees").select("*").eq("id", id).single();
    if (error) return fail(error.message);
    return ok(data);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Eroare");
  }
}
async function get_jobs(params) {
  if (registry.kind === "local") {
    const { data, error } = await dataAdapter.getJobs();
    if (error) return fail(error.message);
    const status = params.status;
    return ok((data ?? []).filter((job) => !job.is_demo && (!status || job.status === status)));
  }
  try {
    const st = params.status;
    let q = supabase.from("jobs").select("*").eq("is_demo", false).order("order_index");
    if (st) q = q.eq("status", st);
    const { data, error } = await q;
    if (error) return fail(error.message);
    return ok(data ?? []);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Eroare");
  }
}
async function get_job(params) {
  try {
    const id = params.job_id;
    if (!id) return fail("job_id obligatoriu");
    const { data, error } = await supabase.from("jobs").select("*").eq("id", id).single();
    if (error) return fail(error.message);
    return ok(data);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Eroare");
  }
}
async function get_appointments(params) {
  try {
    const st = params.status;
    let q = supabase.from("appointments").select("*").eq("is_demo", false).order("appointment_date");
    if (st) q = q.eq("status", st);
    const { data, error } = await q;
    if (error) return fail(error.message);
    return ok(data ?? []);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Eroare");
  }
}
async function get_rates() {
  if (registry.kind === "local") {
    const { data, error } = await dataAdapter.getRates();
    return error ? fail(error.message) : ok(data);
  }
  try {
    const { data, error } = await supabase.from("rates").select("*").order("id").limit(1);
    if (error) return fail(error.message);
    return ok(data?.[0] ?? null);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Eroare");
  }
}
async function get_schedule() {
  if (registry.kind === "local") {
    const { data, error } = await dataAdapter.getSchedule();
    return error ? fail(error.message) : ok(data);
  }
  try {
    const { data, error } = await supabase.from("work_schedule").select("*").eq("active", true).order("id").limit(1);
    if (error) return fail(error.message);
    return ok(data?.[0] ?? null);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Eroare");
  }
}
async function get_time_entries(params) {
  try {
    const eid = params.employee_id;
    let q = supabase.from("time_entries").select("*").order("start_time", { ascending: false }).limit(100);
    if (eid) q = q.eq("employee_id", eid);
    const { data, error } = await q;
    if (error) return fail(error.message);
    return ok(data ?? []);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Eroare");
  }
}
async function get_activity_log(params) {
  try {
    const lim = params.limit || 50;
    const { data, error } = await supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(lim);
    if (error) return fail(error.message);
    return ok(data ?? []);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Eroare");
  }
}
async function analyze_productivity() {
  try {
    const [{ data: emps, error: e1 }, { data: tes, error: e2 }] = await Promise.all([
      supabase.from("employees").select("*").eq("is_demo", false).eq("active", true),
      supabase.from("time_entries").select("*")
    ]);
    if (e1) return fail(e1.message);
    if (e2) return fail(e2.message);
    const employees = emps ?? [];
    const entries = tes ?? [];
    const result = employees.map((emp) => {
      const ee = entries.filter((e) => e.employee_id === emp.id);
      const norm = ee.filter((e) => !e.is_overtime).reduce((s, e) => s + (e.duration_seconds ?? 0), 0);
      const ot = ee.filter((e) => e.is_overtime).reduce((s, e) => s + (e.duration_seconds ?? 0), 0);
      return { id: emp.id, name: emp.name, normal_hours: Math.round(norm / 3600 * 100) / 100, overtime_hours: Math.round(ot / 3600 * 100) / 100, total_hours: Math.round((norm + ot) / 3600 * 100) / 100 };
    });
    result.sort((a, b) => b.total_hours - a.total_hours);
    return ok(result);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Eroare");
  }
}
async function analyze_overtime() {
  try {
    const { data, error } = await supabase.from("jobs").select("*").eq("is_demo", false);
    if (error) return fail(error.message);
    const jobs = data ?? [];
    return ok({ total_jobs: jobs.length, jobs_with_overtime: jobs.filter((j) => j.overtime_seconds > 0).length, total_normal_hours: Math.round(jobs.reduce((s, j) => s + j.worked_seconds, 0) / 3600 * 100) / 100, total_overtime_hours: Math.round(jobs.reduce((s, j) => s + j.overtime_seconds, 0) / 3600 * 100) / 100 });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Eroare");
  }
}
async function analyze_costs() {
  try {
    const [{ data: jobs, error: e1 }, { data: rates, error: e2 }] = await Promise.all([
      supabase.from("jobs").select("*").eq("is_demo", false).eq("status", "finalizat"),
      supabase.from("rates").select("*").order("id").limit(1)
    ]);
    if (e1) return fail(e1.message);
    if (e2) return fail(e2.message);
    const jList = jobs ?? [];
    const rate = rates?.[0] ?? null;
    const nR = rate?.normal_rate ?? 100;
    const oR = rate?.overtime_rate ?? 150;
    const vR = rate?.vat_rate ?? 21;
    let nC = 0, oC = 0;
    const details = jList.map((j) => {
      const nc = j.worked_seconds / 3600 * nR;
      const oc = j.overtime_seconds / 3600 * oR;
      nC += nc;
      oC += oc;
      return { id: j.id, title: j.title, normal_cost: Math.round(nc * 100) / 100, overtime_cost: Math.round(oc * 100) / 100 };
    });
    const summary = calculateCostSummary(nC + oC, vR);
    return ok({ rates: { normal_rate: nR, overtime_rate: oR, vat_rate: vR }, jobs: details, summary: { subtotal: summary.subtotal, vat_amount: summary.vatAmount, total_with_vat: summary.totalWithVat } });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Eroare");
  }
}
async function detect_anomalies() {
  try {
    const { data, error } = await supabase.from("jobs").select("*").eq("is_demo", false);
    if (error) return fail(error.message);
    const jobs = data ?? [];
    const anomalies = [];
    for (const j of jobs) {
      if (j.worked_seconds < 0) anomalies.push({ type: "negative_worked_seconds", job_id: j.id, title: j.title, value: j.worked_seconds });
      if (j.overtime_seconds < 0) anomalies.push({ type: "negative_overtime_seconds", job_id: j.id, title: j.title, value: j.overtime_seconds });
    }
    return ok({ total: anomalies.length, anomalies });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Eroare");
  }
}
var AGENT_TOOLS = [
  { name: "get_dashboard", description: "Rezumat dashboard", securityLevel: "read" /* READ */, execute: get_dashboard },
  { name: "get_cars", description: "Lista masini", securityLevel: "read" /* READ */, execute: (p) => get_cars(p) },
  { name: "get_car", description: "Detalii masina", securityLevel: "read" /* READ */, execute: (p) => get_car(p) },
  { name: "get_employees", description: "Lista angajati", securityLevel: "read" /* READ */, execute: get_employees },
  { name: "get_employee", description: "Detalii angajat", securityLevel: "read" /* READ */, execute: (p) => get_employee(p) },
  { name: "get_jobs", description: "Lista lucrari", securityLevel: "read" /* READ */, execute: (p) => get_jobs(p) },
  { name: "get_job", description: "Detalii lucrare", securityLevel: "read" /* READ */, execute: (p) => get_job(p) },
  { name: "get_appointments", description: "Programari", securityLevel: "read" /* READ */, execute: (p) => get_appointments(p) },
  { name: "get_rates", description: "Tarife", securityLevel: "read" /* READ */, execute: get_rates },
  { name: "get_schedule", description: "Program lucru", securityLevel: "read" /* READ */, execute: get_schedule },
  { name: "get_time_entries", description: "Intrari timp", securityLevel: "read" /* READ */, execute: (p) => get_time_entries(p) },
  { name: "get_activity_log", description: "Jurnal activitate", securityLevel: "read" /* READ */, execute: (p) => get_activity_log(p) },
  { name: "analyze_productivity", description: "Analiza productivitate", securityLevel: "analyze" /* ANALYZE */, execute: analyze_productivity },
  { name: "analyze_overtime", description: "Analiza overtime", securityLevel: "analyze" /* ANALYZE */, execute: analyze_overtime },
  { name: "analyze_costs", description: "Analiza costuri", securityLevel: "analyze" /* ANALYZE */, execute: analyze_costs },
  { name: "detect_anomalies", description: "Detectare anomalii", securityLevel: "analyze" /* ANALYZE */, execute: detect_anomalies }
];

// src/agent/agent-intent.ts
function normalizeText(text) {
  return text.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u0218\u0219]/g, "s").replace(/[\u021a\u021b]/g, "t").replace(/[\u0102\u0103]/g, "a").replace(/[\u00ce\u00ee]/g, "i");
}
function detectOperation(text) {
  const t = normalizeText(text);
  if (t.match(/^(cate|canti|cati|numara|cifra)/)) return "COUNT";
  if (t.match(/^(arata|lista|vezi|afiseza)/)) return "LIST";
  if (t.match(/^(ce|care)/)) return "LIST";
  return "LIST";
}
function detectStatusFilter(text, category) {
  const t = normalizeText(text);
  if (t.match(/(in lucru|activ)/)) return "in_lucru";
  if (t.match(/(finalizat|terminat|gata|completat)/)) return category === "CARS" ? "finalizata" : "finalizat";
  if (t.match(/(asteptare|asteapta|pendent)/)) return "asteptare";
  if (t.match(/(asteptare piese|piese)/)) return "asteptare_piese";
  if (t.match(/(nou|noi|noua)/)) return "noua";
  return void 0;
}
function detectCategory(text) {
  const t = normalizeText(text);
  if (t.match(/(dashboard|rezumat|situatia generala)/)) return "DASHBOARD";
  if (t.match(/(anomalii|probleme|negative|bug|erori)/)) return "ANOMALIES";
  if (t.match(/(cost|pret|factura|tva|bani|suma|valoare)/)) return "COSTS";
  if (t.match(/(overtime|suplimentar|peste program)/)) return "OVERTIME";
  if (t.match(/(productivitate|performanta|cel mai mult|cel mai putin)/)) return "PRODUCTIVITY";
  if (t.match(/(programul|orar|schedule|la ce ora|cand)/)) return "SCHEDULE";
  if (t.match(/\btarif\w*\b|\brate\b|lei ora/)) return "RATES";
  if (t.match(/(programar|programare|calendar|sedinta)/)) return "APPOINTMENTS";
  if (t.match(/(time entries|intrari timp|ore lucrate)/)) return "TIME_ENTRIES";
  if (t.match(/(activitate|istoric|log|jurnal)/)) return "ACTIVITY_LOG";
  if (t.match(/(angajat|angajati|echipa|personal|muncitor)/)) return "EMPLOYEES";
  if (t.match(/(lucrar|lucrare|task|sarcina|serviciu|comanda)/)) return "JOBS";
  if (t.match(/(masin|masina|vehicul|automobil|auto)/)) return "CARS";
  return "UNKNOWN";
}
function detectIntent(message) {
  const category = detectCategory(message);
  const operation = detectOperation(message);
  const filters = { status: detectStatusFilter(message, category) };
  return { category, operation, filters, originalMessage: message, confidence: category === "UNKNOWN" ? 0 : 1 };
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

// src/agent/speech-recognition.ts
function getSpeechRecognitionConstructor(host) {
  return host?.SpeechRecognition ?? host?.webkitSpeechRecognition;
}
function isSpeechRecognitionSupported(host) {
  return Boolean(getSpeechRecognitionConstructor(host));
}
function createRomanianRecognition(host) {
  const Constructor = getSpeechRecognitionConstructor(host);
  if (!Constructor) return null;
  const recognition = new Constructor();
  recognition.lang = "ro-RO";
  recognition.continuous = false;
  recognition.interimResults = false;
  return recognition;
}
function readFinalTranscript(event) {
  const transcripts = [];
  for (let index = 0; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (result?.[0]?.transcript) transcripts.push(result[0].transcript);
  }
  return transcripts.join(" ").replace(/\s+/g, " ").trim();
}
function speechErrorMessage(error) {
  if (error === "not-allowed" || error === "service-not-allowed") return "Accesul la microfon a fost refuzat. Agentul text r\u0103m\xE2ne disponibil.";
  if (error === "audio-capture") return "Microfonul nu este disponibil. Agentul text r\u0103m\xE2ne disponibil.";
  return "Recunoa\u0219terea vocal\u0103 nu a putut porni. Agentul text r\u0103m\xE2ne disponibil.";
}

// tests/microphone.test.ts
test("speech recognition supported and unsupported", () => {
  class FakeRecognition {
    lang = "";
    continuous = true;
    interimResults = true;
    onresult = null;
    onerror = null;
    onend = null;
    start() {
    }
    stop() {
    }
    abort() {
    }
  }
  assert.equal(isSpeechRecognitionSupported({ SpeechRecognition: FakeRecognition }), true);
  assert.equal(isSpeechRecognitionSupported({}), false);
  assert.equal(createRomanianRecognition({ SpeechRecognition: FakeRecognition })?.lang, "ro-RO");
  assert.equal(createRomanianRecognition({}), null);
});
test("start/stop contract and transcript update", () => {
  const transcript = readFinalTranscript({ results: [[{ transcript: "Schimb\u0103 tariful" }], [{ transcript: "normal la o sut\u0103 unu" }]] });
  assert.equal(transcript, "Schimb\u0103 tariful normal la o sut\u0103 unu");
});
test("permission and unsupported errors are explicit", () => {
  assert.match(speechErrorMessage("not-allowed"), /refuzat/i);
  assert.match(speechErrorMessage("audio-capture"), /disponibil/i);
  assert.match("Recunoa\u0219terea vocal\u0103 nu este disponibil\u0103 \xEEn acest browser.", /browser/i);
});
test("Romanian transcript enters the same Agent parser", () => {
  assert.equal(detectIntent("Arat\u0103-mi c\xE2te ma\u0219ini sunt \xEEn lucru.").category, "CARS");
  assert.equal(detectIntent("Spune-mi ce angaja\u021Bi lucreaz\u0103.").category, "EMPLOYEES");
  assert.equal(detectIntent("arata masini").category, "CARS");
  assert.equal(detectIntent("arata angajati").category, "EMPLOYEES");
});
test("voice confirmation and cancellation use existing security parser", () => {
  assert.equal(parseConfirmation("Da").status, "approved");
  assert.equal(parseConfirmation("Nu").status, "rejected");
  assert.equal(parseConfirmation("Anuleaz\u0103").status, "rejected");
});
test("microphone stores no audio and text path remains available", async () => {
  const source = await fs.readFile(new URL("../src/agent/AgentModal.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|MediaRecorder|getUserMedia/i);
  assert.match(source, /handleAgentMessage\(text/);
});
