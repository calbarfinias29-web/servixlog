var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/agent/agent-phase3.ts
var agent_phase3_exports = {};
__export(agent_phase3_exports, {
  ADMIN_WRITE_EXECUTION_ENABLED: () => ADMIN_WRITE_EXECUTION_ENABLED,
  parsePhase3Intent: () => parsePhase3Intent,
  pendingPhase3: () => pendingPhase3
});
module.exports = __toCommonJS(agent_phase3_exports);
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
    action.startsWith("delete_") || action === "cancel_appointment" ? "ATEN\u021AIE \u2014 OPERA\u021AIE DESTRUCTIV\u0102" : action === "transfer_car" || action === "change_job_assignment" ? "TRANSFER" : "AC\u021AIUNE: " + action.toUpperCase(),
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
    if (!employeeTarget) return { error: "Spune exact ce angajat trebuie \u0219ters." };
    return plan("delete_employee", employeeTarget, {}, "HIGH");
  }
  if (/(?:modifica|schimba)\b.*\bangajat/.test(text)) {
    if (!employeeTarget) return { error: "Spune exact ce angajat trebuie modificat." };
    const name = valueAfter(original, [/(?:numele|numelui)\s+(?:in|în|la|cu)\s+(.+)$/i]);
    return plan("update_employee", employeeTarget, name ? { name } : {}, "HIGH");
  }
  if (/(?:creeaza|adauga|fa)\b.*\b(lucrare|job)/.test(text)) {
    const title = valueAfter(original, [/(?:lucrare|job)\s+(?:noua?|numit[aă]?|cu titlul)\s+(.+)$/i]);
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
  if (/(?:sterge|anuleaza|elimina)\b.*\bprogramar/.test(text)) {
    if (!appointmentTarget && !plate) return { error: "Spune exact programarea sau num\u0103rul ma\u0219inii." };
    return plan("cancel_appointment", appointmentTarget ?? plate ?? "", {}, "HIGH");
  }
  if (/(?:modifica|schimba|actualizeaza)\b.*\bprogramar/.test(text)) {
    if (!appointmentTarget && !plate) return { error: "Spune exact programarea sau num\u0103rul ma\u0219inii." };
    return plan("update_appointment", appointmentTarget ?? plate ?? "", {}, "normal");
  }
  if (/(?:muta|transfera|schimba)\b.*\b(?:masina|mașina|lucrarea|angajatul)/.test(text)) {
    if (!plate) return { error: "Spune num\u0103rul exact al ma\u0219inii pentru transfer." };
    const newEmployee = valueAfter(original, [/(?:la|catre|către)\s+(.+)$/i]);
    if (!newEmployee) return { error: "Spune angajatul nou pentru transfer." };
    return plan(text.includes("lucrarea") ? "change_job_assignment" : "transfer_car", plate, { current_employee: "de verificat", new_employee: newEmployee }, "HIGH");
  }
  return null;
}
function pendingPhase3(planData, operationId) {
  return { operationId, action: planData.action, target: planData.target, proposedChanges: planData.changes, createdAt: Date.now() };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ADMIN_WRITE_EXECUTION_ENABLED,
  parsePhase3Intent,
  pendingPhase3
});
