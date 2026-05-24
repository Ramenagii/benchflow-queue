import { createServer } from "node:http";
import {
  buildCsvReport,
  checkInTicket,
  claimNextTicket,
  createTicket,
  findEventBySlug,
  findTicket,
  mutateState,
  readState,
  resetState,
  updateOutcome,
  updateTicketStatus,
  updateTriage
} from "./db.js";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const allowedStatuses = new Set(["waiting", "up-next", "repairing", "done"]);

export async function handleApiRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (!url.pathname.startsWith("/api")) {
      return sendJson(res, 404, { error: "Not found" });
    }

    if (req.method === "OPTIONS") {
      return sendEmpty(res, 204);
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, { ok: true, service: "benchflow-api" });
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      return sendJson(res, 200, await readState());
    }

    if (req.method === "POST" && url.pathname === "/api/reset") {
      return sendJson(res, 200, await resetState());
    }

    const eventTicketMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/tickets$/);
    if (req.method === "POST" && eventTicketMatch) {
      const slug = decodeURIComponent(eventTicketMatch[1]);
      const body = await readJson(req);
      const { state, result } = await mutateState((draft) => {
        const event = findEventBySlug(draft, slug);
        if (!event) throw httpError(404, "Event not found");
        return createTicket(draft, event, body);
      });
      return sendJson(res, 201, { state, ticket: result });
    }

    const checkInMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/check-in$/);
    if (req.method === "POST" && checkInMatch) {
      const ticketId = decodeURIComponent(checkInMatch[1]);
      const { state, result } = await mutateState((draft) => {
        const ticket = findTicket(draft, ticketId);
        if (!ticket) throw httpError(404, "Ticket not found");
        return checkInTicket(ticket);
      });
      return sendJson(res, 200, { state, ticket: result });
    }

    const triageMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/triage$/);
    if (req.method === "PATCH" && triageMatch) {
      const ticketId = decodeURIComponent(triageMatch[1]);
      const body = await readJson(req);
      const { state, result } = await mutateState((draft) => {
        const ticket = findTicket(draft, ticketId);
        if (!ticket) throw httpError(404, "Ticket not found");
        return updateTriage(ticket, body);
      });
      return sendJson(res, 200, { state, ticket: result });
    }

    const statusMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/status$/);
    if (req.method === "PATCH" && statusMatch) {
      const ticketId = decodeURIComponent(statusMatch[1]);
      const body = await readJson(req);
      if (!allowedStatuses.has(body.status)) throw httpError(400, "Invalid status");
      const { state, result } = await mutateState((draft) => {
        const ticket = findTicket(draft, ticketId);
        if (!ticket) throw httpError(404, "Ticket not found");
        return updateTicketStatus(ticket, body.status);
      });
      return sendJson(res, 200, { state, ticket: result });
    }

    const outcomeMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/outcome$/);
    if (req.method === "PATCH" && outcomeMatch) {
      const ticketId = decodeURIComponent(outcomeMatch[1]);
      const body = await readJson(req);
      const { state, result } = await mutateState((draft) => {
        const ticket = findTicket(draft, ticketId);
        if (!ticket) throw httpError(404, "Ticket not found");
        return updateOutcome(ticket, body);
      });
      return sendJson(res, 200, { state, ticket: result });
    }

    const claimMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/claim-next$/);
    if (req.method === "POST" && claimMatch) {
      const slug = decodeURIComponent(claimMatch[1]);
      const body = await readJson(req);
      const { state, result } = await mutateState((draft) => {
        const event = findEventBySlug(draft, slug);
        if (!event) throw httpError(404, "Event not found");
        return claimNextTicket(draft, event, body.category || "all");
      });
      return sendJson(res, 200, { state, ticket: result });
    }

    const reportMatch = url.pathname.match(/^\/api\/events\/([^/]+)\/report\.csv$/);
    if (req.method === "GET" && reportMatch) {
      const slug = decodeURIComponent(reportMatch[1]);
      const state = await readState();
      const event = findEventBySlug(state, slug);
      if (!event) throw httpError(404, "Event not found");
      return sendText(res, 200, buildCsvReport(state, event), "text/csv; charset=utf-8", {
        "Content-Disposition": 'attachment; filename="benchflow-report.csv"'
      });
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const status = error.status || 500;
    const message = status === 500 ? "Internal server error" : error.message;
    if (status === 500) console.error(error);
    return sendJson(res, status, { error: message });
  }
}

const server = createServer(handleApiRequest);

if (process.env.VERCEL !== "1") {
  server.listen(PORT, HOST, () => {
    console.log(`BenchFlow API listening at http://${HOST}:${PORT}`);
  });
}

export default handleApiRequest;

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, "Invalid JSON");
  }
}

function sendJson(res, status, payload) {
  return sendText(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function sendText(res, status, body, contentType, extraHeaders = {}) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    ...extraHeaders
  });
  res.end(body);
}

function sendEmpty(res, status) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end();
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
