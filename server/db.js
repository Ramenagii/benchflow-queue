import { readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rootDir = join(__dirname, "..");
const seedPath = join(rootDir, "data", "seed.json");
const statePath = join(rootDir, "data", "runtime-state.json");
const seedData = require("../data/seed.json");
const memoryMode = process.env.VERCEL === "1";

const priorityWeights = { high: 0, medium: 1, low: 2 };

export async function readState() {
  if (memoryMode) {
    globalThis.__benchflowState ??= materializeSeed(seedData);
    return globalThis.__benchflowState;
  }

  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return resetState();
  }
}

export async function writeState(state) {
  if (memoryMode) {
    globalThis.__benchflowState = state;
    return state;
  }

  const tempPath = `${statePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, statePath);
  return state;
}

export async function resetState() {
  const seed = memoryMode ? seedData : JSON.parse(await readFile(seedPath, "utf8"));
  const state = materializeSeed(seed);
  await writeState(state);
  return state;
}

export async function mutateState(mutator) {
  const state = await readState();
  const result = mutator(state);
  await writeState(state);
  return { state, result };
}

export function findEventBySlug(state, slug) {
  return state.events.find((event) => event.slug === slug);
}

export function findTicket(state, ticketId) {
  return state.tickets.find((ticket) => ticket.id.toLowerCase() === String(ticketId).toLowerCase());
}

export function eventTickets(state, eventId) {
  return state.tickets.filter((ticket) => ticket.eventId === eventId);
}

export function createTicket(state, event, payload) {
  const ticket = {
    id: nextTicketId(state.tickets),
    eventId: event.id,
    guest: {
      name: cleanText(payload.name),
      contact: cleanText(payload.contact),
      consent: Boolean(payload.consent)
    },
    source: payload.source === "walkin" ? "walkin" : "signup",
    status: "waiting",
    createdAt: new Date().toISOString(),
    checkedInAt: new Date().toISOString(),
    category: cleanText(payload.category) || "Other",
    brandModel: cleanText(payload.brandModel) || "Unlisted item",
    symptoms: cleanText(payload.symptoms),
    safetyFlags: [],
    triage: {
      diagnosisGuess: "Awaiting triage",
      estimateMins: 20,
      partsNeeded: [],
      priority: "medium",
      notes: cleanText(payload.photoNote)
    },
    repairSession: { assignedVolunteerId: null, durationMins: null },
    outcome: { result: null, summary: "", partsAdvice: "", followUpLinks: [] },
    notifications: [`${cleanText(payload.notify) || "Email/SMS stub"} ready`]
  };
  state.tickets.push(ticket);
  return ticket;
}

export function checkInTicket(ticket) {
  ticket.checkedInAt = new Date().toISOString();
  if (ticket.status === "done") ticket.status = "waiting";
  ticket.notifications = [`Status stub ready for ${ticket.guest.contact}`];
  return ticket;
}

export function updateTriage(ticket, payload) {
  ticket.guest.name = cleanText(payload.guestName);
  ticket.guest.contact = cleanText(payload.contact);
  ticket.category = cleanText(payload.category) || "Other";
  ticket.brandModel = cleanText(payload.brandModel);
  ticket.symptoms = cleanText(payload.symptoms);
  ticket.safetyFlags = Array.isArray(payload.safetyFlags) ? payload.safetyFlags.map(cleanText).filter(Boolean) : [];
  ticket.triage = {
    diagnosisGuess: cleanText(payload.diagnosisGuess),
    estimateMins: Number(payload.estimateMins || 20),
    partsNeeded: splitList(payload.partsNeeded),
    priority: cleanText(payload.priority) || "medium",
    notes: cleanText(payload.notes)
  };
  ticket.status = cleanText(payload.status) || "waiting";
  return ticket;
}

export function updateTicketStatus(ticket, status) {
  ticket.status = status;
  if (!ticket.repairSession) ticket.repairSession = {};
  if (status === "repairing" && !ticket.repairSession.startedAt) {
    ticket.repairSession.startedAt = new Date().toISOString();
  }
  if (status === "done") {
    ticket.repairSession.endedAt = new Date().toISOString();
  }
  return ticket;
}

export function updateOutcome(ticket, payload) {
  ticket.outcome = {
    ...(ticket.outcome || {}),
    result: cleanText(payload.result) || "fixed",
    summary: cleanText(payload.summary),
    followUpLinks: ticket.outcome?.followUpLinks || [],
    partsAdvice: ticket.outcome?.partsAdvice || ""
  };
  updateTicketStatus(ticket, "done");
  return ticket;
}

export function claimNextTicket(state, event, category = "all") {
  const ticket = nextClaimableTicket(eventTickets(state, event.id), category);
  if (!ticket) return null;
  updateTicketStatus(ticket, "repairing");
  ticket.repairSession.assignedVolunteerId = "vol-you";
  return ticket;
}

export function buildCsvReport(state, event) {
  const rows = eventTickets(state, event.id).map((ticket) => ({
    ticket: ticket.id,
    guest: ticket.guest.name,
    contact: ticket.guest.contact,
    source: ticket.source,
    category: ticket.category,
    status: ticket.status,
    priority: ticket.triage.priority,
    estimateMins: ticket.triage.estimateMins,
    outcome: ticket.outcome?.result || "pending",
    partsNeeded: (ticket.triage.partsNeeded || []).join("; "),
    summary: ticket.outcome?.summary || ""
  }));
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n");
}

function materializeSeed(seed) {
  const currentTime = Date.now();
  const state = deepClone(seed);
  state.tickets = state.tickets.map((ticket, index) => {
    const waitMins = Number(ticket.waitMins || 0);
    const createdAt = new Date(currentTime - (waitMins + 8) * 60 * 1000).toISOString();
    const checkedInAt = new Date(currentTime - waitMins * 60 * 1000).toISOString();
    const repairSession = ticket.repairSession || {};
    if (ticket.status === "repairing" && !repairSession.startedAt) {
      repairSession.startedAt = new Date(currentTime - 18 * 60 * 1000).toISOString();
    }
    if (ticket.status === "done" && !repairSession.endedAt) {
      const duration = repairSession.durationMins || ticket.triage?.estimateMins || 20;
      repairSession.endedAt = new Date(currentTime - Math.max(2, index + 1) * 5 * 60 * 1000).toISOString();
      repairSession.startedAt = new Date(new Date(repairSession.endedAt).getTime() - duration * 60 * 1000).toISOString();
    }
    return {
      ...ticket,
      createdAt,
      checkedInAt,
      repairSession,
      notifications: [ticket.guest?.contact ? `Status stub ready for ${ticket.guest.contact}` : "Screen display only"]
    };
  });
  state.meta = { seededAt: new Date(currentTime).toISOString(), version: 3 };
  return state;
}

function nextClaimableTicket(tickets, category = "all") {
  return queueSorted(tickets).find((ticket) => {
    const statusOk = ticket.status === "up-next" || ticket.status === "waiting";
    const categoryOk = category === "all" || ticket.category === category;
    return statusOk && categoryOk;
  });
}

function queueSorted(tickets) {
  return [...tickets].sort((a, b) => {
    const byPriority = (priorityWeights[a.triage?.priority] ?? 1) - (priorityWeights[b.triage?.priority] ?? 1);
    if (byPriority !== 0) return byPriority;
    return new Date(a.createdAt || a.checkedInAt) - new Date(b.createdAt || b.checkedInAt);
  });
}

function nextTicketId(tickets) {
  const next = tickets.reduce((max, ticket) => {
    const number = Number(String(ticket.id).replace(/\D/g, ""));
    return Math.max(max, number || 0);
  }, 0) + 1;
  return `BF-${String(next).padStart(3, "0")}`;
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
