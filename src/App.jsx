import { useEffect, useMemo, useRef, useState } from "react";
import heroServiceBench from "../assets/illustrations/hero-service-bench.svg";
import howItWorks from "../assets/illustrations/section-how-it-works.svg";
import whatToBring from "../assets/illustrations/section-what-to-bring.svg";

const EMPTY_STATE = { events: [], tickets: [], volunteers: [], meta: null };
const CATEGORIES = ["Electronics", "Small appliances", "Textiles", "Bikes", "Other"];
const STATUSES = ["waiting", "up-next", "repairing", "done"];
const OUTCOMES = ["fixed", "needs-parts", "specialist", "not-repairable"];
const PRIORITIES = ["high", "medium", "low"];
const SAFETY_FLAGS = ["mains", "battery", "brakes", "pressure", "water", "load-bearing", "steering"];

const statusMeta = {
  waiting: { label: "Waiting", icon: "W" },
  "up-next": { label: "Up next", icon: "U" },
  repairing: { label: "Now repairing", icon: "R" },
  done: { label: "Done", icon: "D" }
};

const outcomeMeta = {
  fixed: { label: "Fixed", icon: "OK" },
  "needs-parts": { label: "Needs parts", icon: "P" },
  specialist: { label: "Needs specialist", icon: "S" },
  "not-repairable": { label: "Not repairable", icon: "N" }
};

const categoryMeta = {
  Electronics: { icon: "EL" },
  "Small appliances": { icon: "AP" },
  Textiles: { icon: "TX" },
  Bikes: { icon: "BK" },
  Other: { icon: "OT" }
};

const templates = {
  fixed: "Cleaned contacts, resoldered joint, tested OK.",
  "needs-parts": "Needs 2x 608 bearings; bring parts and return next session.",
  specialist: "Likely controller board issue; refer to repair shop list.",
  "not-repairable": "Cracked frame near load-bearing joint; unsafe to continue."
};

export default function App() {
  const [data, setData] = useState(EMPTY_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [path, setPath] = useState(normalizePath);
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [ui, setUi] = useState({
    volunteerCategory: "all",
    volunteerStatus: "active",
    boardLarge: false
  });
  const toastTimer = useRef(null);
  const appRef = useRef(null);

  const repairEvent = data.events[0];
  const tickets = useMemo(
    () => (repairEvent ? data.tickets.filter((ticket) => ticket.eventId === repairEvent.id) : []),
    [data.tickets, repairEvent]
  );

  useEffect(() => {
    if (!location.hash) {
      location.hash = "#/events";
    }

    const syncRoute = () => setPath(normalizePath());
    window.addEventListener("hashchange", syncRoute);
    syncRoute();
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadBackendState() {
      try {
        const nextData = await apiRequest("/state");
        if (cancelled) return;
        setData(nextData);
        setLoadError("");
      } catch (error) {
        if (cancelled) return;
        setLoadError(error.message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadBackendState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    appRef.current?.focus({ preventScroll: true });
  }, [path]);

  useEffect(() => {
    if (!path.endsWith("/board")) return undefined;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, [path]);

  const showToast = (message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2800);
  };

  const navigate = (route) => {
    location.hash = route.startsWith("#") ? route : `#${route}`;
  };

  const runApiAction = async (request, successMessage) => {
    try {
      const result = await request();
      if (result?.state) setData(result.state);
      if (successMessage) showToast(typeof successMessage === "function" ? successMessage(result) : successMessage);
      return result;
    } catch (error) {
      showToast(error.message);
      return null;
    }
  };

  const resetDemo = async () => {
    if (!window.confirm("Reset the prototype to the original seeded demo data?")) return;
    const nextData = await apiRequest("/reset", { method: "POST" });
    setData(nextData);
    showToast("Demo data reset.");
  };

  const addTicket = async (formData, source) => {
    const result = await runApiAction(
      () =>
        apiRequest(`/events/${repairEvent.slug}/tickets`, {
          method: "POST",
          body: ticketPayloadFromForm(formData, source)
        }),
      ({ ticket }) => (source === "walkin" ? `${ticket.id} assigned to walk-in customer.` : `${ticket.id} intake created. Notification stub queued.`)
    );
    if (!result?.ticket) return;
    navigate(source === "walkin" ? `/admin/events/${repairEvent.slug}/triage/${result.ticket.id}` : `/events/${repairEvent.slug}/board`);
  };

  const checkInTicket = async (ticketId) => {
    await runApiAction(
      () => apiRequest(`/tickets/${ticketId}/check-in`, { method: "POST" }),
      `${ticketId} checked in and ready for triage.`
    );
  };

  const printTicket = (ticketId) => {
    showToast(`Print stub ready for ${ticketId}.`);
    window.print();
  };

  const copyTicket = async (ticket) => {
    await navigator.clipboard?.writeText(`${ticket.id} - ${ticket.guest.name} - ${ticket.status}`);
    showToast(`${ticket.id} copied to clipboard.`);
  };

  const saveTriage = async (ticketId, formData) => {
    await runApiAction(
      () =>
        apiRequest(`/tickets/${ticketId}/triage`, {
          method: "PATCH",
          body: triagePayloadFromForm(formData)
        }),
      `${ticketId} triage saved.`
    );
  };

  const setTicketStatus = async (ticketId, status) => {
    await runApiAction(
      () => apiRequest(`/tickets/${ticketId}/status`, { method: "PATCH", body: { status } }),
      `${ticketId} moved to ${statusMeta[status].label}.`
    );
  };

  const claimNext = async () => {
    const result = await runApiAction(
      () =>
        apiRequest(`/events/${repairEvent.slug}/claim-next`, {
          method: "POST",
          body: { category: ui.volunteerCategory }
        }),
      ({ ticket }) => (ticket ? `${ticket.id} claimed. It is now on the board.` : "No ticket is available.")
    );
  };

  const saveOutcome = async (ticketId, formData) => {
    await runApiAction(
      () =>
        apiRequest(`/tickets/${ticketId}/outcome`, {
          method: "PATCH",
          body: outcomePayloadFromForm(formData)
        }),
      `${ticketId} outcome saved and ticket closed.`
    );
  };

  const exportCsv = async () => {
    try {
      await downloadCsvFromApi(`/events/${repairEvent.slug}/report.csv`, "benchflow-report.csv");
      showToast("CSV report exported.");
    } catch (error) {
      showToast(error.message);
    }
  };

  const actions = {
    addTicket,
    checkInTicket,
    claimNext,
    copyTicket,
    exportCsv,
    navigate,
    printTicket,
    saveOutcome,
    saveTriage,
    setTicketStatus,
    setUi,
    showToast,
    toggleBoardLarge: () => setUi((current) => ({ ...current, boardLarge: !current.boardLarge }))
  };

  if (isLoading || !repairEvent) {
    return <BootScreen message={isLoading ? "Loading backend data..." : loadError || "No event data returned from backend."} />;
  }

  if (loadError) {
    return <BootScreen message={loadError} />;
  }

  return (
    <>
      <a className="skip-link" href="#app">
        Skip to app
      </a>
      <Topbar eventSlug={repairEvent.slug} path={path} onNavigate={navigate} onReset={resetDemo} />
      <main
        id="app"
        ref={appRef}
        className={ui.boardLarge && path.endsWith("/board") ? "app-shell board-large-shell" : "app-shell"}
        tabIndex={-1}
        aria-live="polite"
      >
        <RouteView repairEvent={repairEvent} path={path} tickets={tickets} actions={actions} ui={ui} now={now} />
      </main>
      <div id="toast" className="toast" role="status" aria-live="polite" hidden={!toast}>
        {toast}
      </div>
    </>
  );
}

function BootScreen({ message }) {
  return (
    <>
      <a className="skip-link" href="#app">
        Skip to app
      </a>
      <main id="app" className="app-shell" tabIndex={-1} aria-live="polite">
        <section className="work-surface">
          <div className="surface-intro">
            <p className="eyebrow">BenchFlow Queue</p>
            <h1>{message}</h1>
            <p>Start the backend with the project dev script, then refresh this page.</p>
          </div>
        </section>
      </main>
    </>
  );
}

function Topbar({ eventSlug, path, onNavigate, onReset }) {
  const routes = [
    ["Events", "/events"],
    ["Intake", `/events/${eventSlug}/signup`],
    ["Board", `/events/${eventSlug}/board`],
    ["Check-in", `/admin/events/${eventSlug}/check-in`],
    ["Team", `/admin/events/${eventSlug}/volunteer`],
    ["Report", `/admin/events/${eventSlug}/report`]
  ];

  return (
    <header className="topbar">
      <div className="brand" aria-label="BenchFlow Queue">
        <span className="brand-mark" aria-hidden="true">
          BF
        </span>
        <span>
          <strong>BenchFlow Queue</strong>
          <small>Intake, triage, bench work, report</small>
        </span>
      </div>
      <nav className="main-nav" aria-label="Primary">
        {routes.map(([label, route]) => (
          <button
            key={route}
            className={`nav-button ${isActiveRoute(path, route) ? "is-active" : ""}`}
            type="button"
            data-route={`#${route}`}
            onClick={() => onNavigate(route)}
          >
            {label}
          </button>
        ))}
      </nav>
      <button className="ghost-button compact" type="button" data-reset-demo onClick={onReset}>
        Reset demo
      </button>
    </header>
  );
}

function RouteView({ repairEvent, path, tickets, actions, ui, now }) {
  if (path === "/events") {
    return <HomePage repairEvent={repairEvent} tickets={tickets} onNavigate={actions.navigate} />;
  }
  if (path === `/events/${repairEvent.slug}`) {
    return <EventDetails repairEvent={repairEvent} tickets={tickets} onNavigate={actions.navigate} />;
  }
  if (path === `/events/${repairEvent.slug}/signup`) {
    return <SignupPage repairEvent={repairEvent} onAddTicket={actions.addTicket} onNavigate={actions.navigate} />;
  }
  if (path === `/events/${repairEvent.slug}/board`) {
    return <BoardPage repairEvent={repairEvent} tickets={tickets} ui={ui} now={now} onToggleLarge={actions.toggleBoardLarge} />;
  }
  if (path === `/admin/events/${repairEvent.slug}/check-in`) {
    return <CheckInPage repairEvent={repairEvent} tickets={tickets} actions={actions} />;
  }
  if (path.startsWith(`/admin/events/${repairEvent.slug}/triage`)) {
    const ticketId = path.split("/").pop();
    if (ticketId && ticketId !== "triage") {
      return <TriagePage repairEvent={repairEvent} ticket={tickets.find((ticket) => ticket.id.toLowerCase() === ticketId.toLowerCase())} actions={actions} />;
    }
    return <TriageList repairEvent={repairEvent} tickets={tickets} onNavigate={actions.navigate} />;
  }
  if (path === `/admin/events/${repairEvent.slug}/volunteer`) {
    return <VolunteerPage repairEvent={repairEvent} tickets={tickets} actions={actions} ui={ui} />;
  }
  if (path === `/admin/events/${repairEvent.slug}/report`) {
    return <ReportPage tickets={tickets} onExport={actions.exportCsv} />;
  }
  return <NotFound repairEvent={repairEvent} onNavigate={actions.navigate} />;
}

function HomePage({ repairEvent, tickets, onNavigate }) {
  const counts = getDashboardCounts(tickets);
  return (
    <>
      <section className="hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">For local repair shops, makerspaces, tailors, and bike counters</p>
          <h1>Run every service bench from one calm queue.</h1>
          <p className="lede">Customers sign up, staff check items in, specialists triage the work, and the whole crew can see what is waiting, up next, and on the bench.</p>
          <div className="button-row">
            <button className="primary-button" type="button" onClick={() => onNavigate(`/events/${repairEvent.slug}`)}>
              Open event
            </button>
            <button className="secondary-button" type="button" onClick={() => onNavigate(`/admin/events/${repairEvent.slug}/volunteer`)}>
              Team console
            </button>
          </div>
        </div>
        <img className="hero-image" src={heroServiceBench} alt="Illustrated service counter with bike, textile, and electronics repair tickets" />
      </section>

      <section className="metric-strip" aria-label="Event snapshot">
        <Metric label="Queue now" value={counts.active} detail="active tickets" />
        <Metric label="Now repairing" value={counts.repairing} detail="in progress" />
        <Metric label="Done" value={counts.done} detail="closed" />
        <Metric label="Capacity" value={`${tickets.length}/${repairEvent.capacity}`} detail="demo intakes" />
      </section>

      <section className="section-band">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Upcoming event</p>
            <h2>{repairEvent.name}</h2>
          </div>
          <button className="ghost-button" type="button" onClick={() => onNavigate(`/events/${repairEvent.slug}/signup`)}>
            Add intake
          </button>
        </div>
        <article className="event-card">
          <div>
            <p className="event-date">{formatEventWindow(repairEvent)}</p>
            <h3>{repairEvent.location}</h3>
            <p>{repairEvent.notes}</p>
          </div>
          <div className="event-actions">
            <button className="secondary-button" type="button" onClick={() => onNavigate(`/events/${repairEvent.slug}/board`)}>
              Queue board
            </button>
            <button className="secondary-button" type="button" onClick={() => onNavigate(`/admin/events/${repairEvent.slug}/check-in`)}>
              Front desk
            </button>
          </div>
        </article>
      </section>
    </>
  );
}

function EventDetails({ repairEvent, tickets, onNavigate }) {
  const remaining = Math.max(repairEvent.capacity - tickets.length, 0);
  return (
    <>
      <section className="event-hero">
        <div className="event-hero-copy">
          <p className="eyebrow">Public intake page</p>
          <h1>{repairEvent.name}</h1>
          <p className="lede">Bring a repair item. The team helps diagnose the issue, estimate the work, and record a clear next step.</p>
          <div className="button-row">
            <button className="primary-button" type="button" onClick={() => onNavigate(`/events/${repairEvent.slug}/signup`)}>
              Start intake
            </button>
            <button className="secondary-button" type="button" onClick={() => onNavigate(`/events/${repairEvent.slug}/board`)}>
              View queue
            </button>
          </div>
        </div>
        <div className="event-poster" aria-label="Event details">
          <span className="poster-kicker">Riverside Hub</span>
          <strong>{formatDate(repairEvent.start)}</strong>
          <span>
            {formatTime(repairEvent.start)}-{formatTime(repairEvent.end)}
          </span>
          <span>{remaining} capacity spots left</span>
        </div>
      </section>

      <section className="two-column">
        <div>
          <p className="eyebrow">What to bring</p>
          <h2>Help the bench team diagnose faster.</h2>
          <ul className="check-list">
            <li>The item and any power cables, chargers, or matching parts</li>
            <li>Manuals, photos, or model number</li>
            <li>Any replacement parts you already have</li>
          </ul>
        </div>
        <img className="section-image" src={whatToBring} alt="Tote bag with cable, manual, and parts" />
      </section>

      <section className="two-column">
        <img className="section-image" src={howItWorks} alt="Three illustrated steps for check-in, triage, and repair" />
        <div>
          <p className="eyebrow">How it works</p>
          <h2>Check in, triage, bench work, record.</h2>
          <ol className="number-list">
            <li>Front desk assigns a queue ticket from intake or walk-in.</li>
            <li>A specialist records symptoms, estimate, priority, and parts.</li>
            <li>The board keeps the crew aligned until the outcome is saved.</li>
          </ol>
        </div>
      </section>

      <section className="section-band">
        <div className="section-heading">
          <div>
            <p className="eyebrow">FAQ</p>
            <h2>Before you arrive</h2>
          </div>
        </div>
        <div className="faq-stack">
          {repairEvent.faq.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}

function SignupPage({ repairEvent, onAddTicket, onNavigate }) {
  return (
    <section className="work-surface">
      <div className="surface-intro">
        <p className="eyebrow">Public intake</p>
        <h1>Tell us what is broken.</h1>
        <p>Staff can find this intake at check-in and assign a queue ticket. Optional photo upload is represented as an intake field in this demo.</p>
      </div>
      <form
        className="form-grid"
        data-signup-form
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          onAddTicket(new FormData(submitEvent.currentTarget), "signup");
        }}
      >
        <label>
          Name
          <input name="name" autoComplete="name" required />
        </label>
        <label>
          Contact
          <input name="contact" autoComplete="email" placeholder="email or phone" required />
        </label>
        <label>
          Item category
          <select name="category" required defaultValue="Electronics">
            <CategoryOptions />
          </select>
        </label>
        <label>
          Brand or model
          <input name="brandModel" placeholder="Example: Philips blender HR2056" />
        </label>
        <label className="span-2">
          Quick description
          <textarea name="symptoms" rows="4" required placeholder="What happens, when it started, and whether it feels unsafe" />
        </label>
        <label>
          Photo note
          <input name="photoNote" placeholder="Optional: photo filename or note" />
        </label>
        <label>
          Preferred notification
          <select name="notify" defaultValue="Email/SMS stub">
            <option>Email/SMS stub</option>
            <option>Screen display only</option>
          </select>
        </label>
        <label className="checkbox-label span-2">
          <input type="checkbox" name="consent" required />I consent to event staff using my contact for queue status updates.
        </label>
        <div className="form-actions span-2">
          <button className="primary-button" type="submit">
            Create intake
          </button>
          <button className="secondary-button" type="button" onClick={() => onNavigate(`/events/${repairEvent.slug}`)}>
            Back to event
          </button>
        </div>
      </form>
    </section>
  );
}

function CheckInPage({ repairEvent, tickets, actions }) {
  const [query, setQuery] = useState("");
  const visibleTickets = queueSorted(tickets).filter((ticket) => !query || searchText(ticket).includes(query.trim().toLowerCase()));

  return (
    <section className="work-surface">
      <div className="surface-intro">
        <p className="eyebrow">Front desk check-in</p>
        <h1>Lookup intake or create a walk-in.</h1>
          <p>Assign queue tickets, print the ticket stub, and send customers to triage.</p>
      </div>
      <div className="split-workspace">
        <div>
          <label className="search-box">
            Search tickets
            <input type="search" data-checkin-search placeholder="Name, ticket, category, or contact" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="ticket-list compact-list" data-checkin-list>
            {visibleTickets.map((ticket) => (
              <CheckInRow key={ticket.id} ticket={ticket} repairEvent={repairEvent} actions={actions} />
            ))}
          </div>
        </div>
        <form
          className="walkin-panel"
          data-walkin-form
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            actions.addTicket(new FormData(submitEvent.currentTarget), "walkin");
          }}
        >
          <h2>Walk-in intake</h2>
          <label>
            Guest name
            <input name="name" required />
          </label>
          <label>
            Contact
            <input name="contact" placeholder="email or phone" required />
          </label>
          <label>
            Category
            <select name="category" required defaultValue="Electronics">
              <CategoryOptions />
            </select>
          </label>
          <label>
            Item
            <input name="brandModel" required />
          </label>
          <label>
            Symptoms
            <textarea name="symptoms" rows="4" required />
          </label>
          <label className="checkbox-label">
            <input name="consent" type="checkbox" required />
            Consent captured
          </label>
          <button className="primary-button" type="submit">
            Assign walk-in ticket
          </button>
        </form>
      </div>
    </section>
  );
}

function CheckInRow({ ticket, repairEvent, actions }) {
  return (
    <article className="ticket-card mini-ticket" data-search-text={searchText(ticket)}>
      <div className="ticket-topline">
        <span className="ticket-id">{ticket.id}</span>
        <StatusChip status={ticket.status} />
      </div>
      <h3>{ticket.guest.name}</h3>
      <p>{ticket.brandModel}</p>
      <div className="chip-row">
        <CategoryChip category={ticket.category} />
        <PriorityChip priority={ticket.triage.priority} />
      </div>
      <div className="button-row tight">
        <button className="secondary-button compact" type="button" data-checkin-ticket={ticket.id} onClick={() => actions.checkInTicket(ticket.id)}>
          Check in
        </button>
        <button className="ghost-button compact" type="button" onClick={() => actions.navigate(`/admin/events/${repairEvent.slug}/triage/${ticket.id}`)}>
          Triage
        </button>
        <button className="ghost-button compact" type="button" data-print-ticket={ticket.id} onClick={() => actions.printTicket(ticket.id)}>
          Print
        </button>
        <button className="ghost-button compact" type="button" data-copy-ticket={ticket.id} onClick={() => actions.copyTicket(ticket)}>
          Copy
        </button>
      </div>
    </article>
  );
}

function TriageList({ repairEvent, tickets, onNavigate }) {
  const activeTickets = queueSorted(tickets.filter((ticket) => ticket.status !== "done"));
  return (
    <section className="work-surface">
      <div className="surface-intro">
        <p className="eyebrow">Triage queue</p>
        <h1>Choose an item to triage.</h1>
        <p>Structured triage records category, symptoms, safety flags, time estimate, priority, and parts notes.</p>
      </div>
      <div className="ticket-grid">
        {activeTickets.map((ticket) => (
          <TicketCard key={ticket.id} ticket={ticket} actionLabel="Open triage" onAction={() => onNavigate(`/admin/events/${repairEvent.slug}/triage/${ticket.id}`)} />
        ))}
      </div>
    </section>
  );
}

function TriagePage({ repairEvent, ticket, actions }) {
  if (!ticket) return <NotFound repairEvent={repairEvent} onNavigate={actions.navigate} />;

  return (
    <section className="work-surface">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Triage</p>
          <h1>
            {ticket.id}: {ticket.brandModel}
          </h1>
        </div>
        <button className="secondary-button" type="button" onClick={() => actions.navigate(`/admin/events/${repairEvent.slug}/triage`)}>
          All triage
        </button>
      </div>
      <form
        className="triage-layout"
        data-triage-form
        data-ticket-id={ticket.id}
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          actions.saveTriage(ticket.id, new FormData(submitEvent.currentTarget));
        }}
      >
        <div className="triage-panel">
          <h2>Intake</h2>
          <label>
            Guest
            <input name="guestName" defaultValue={ticket.guest.name} required />
          </label>
          <label>
            Contact
            <input name="contact" defaultValue={ticket.guest.contact} required />
          </label>
          <label>
            Category
            <select name="category" defaultValue={ticket.category}>
              <CategoryOptions />
            </select>
          </label>
          <label>
            Brand/model
            <input name="brandModel" defaultValue={ticket.brandModel} />
          </label>
          <label>
            Symptoms
            <textarea name="symptoms" rows="6" defaultValue={ticket.symptoms} />
          </label>
          <fieldset>
            <legend>Safety flags</legend>
            <div className="checkbox-grid">
              {SAFETY_FLAGS.map((flag) => (
                <label className="checkbox-label" key={flag}>
                  <input type="checkbox" name="safetyFlags" value={flag} defaultChecked={ticket.safetyFlags.includes(flag)} />
                  {flag}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="triage-panel">
          <h2>Notes + estimate</h2>
          <label>
            Diagnosis guess
            <textarea name="diagnosisGuess" rows="4" defaultValue={ticket.triage.diagnosisGuess} />
          </label>
          <div className="inline-fields">
            <label>
              Estimate (mins)
              <input name="estimateMins" type="number" min="5" step="5" defaultValue={Number(ticket.triage.estimateMins || 20)} />
            </label>
            <label>
              Priority
              <select name="priority" defaultValue={ticket.triage.priority}>
                {PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Parts needed
            <input name="partsNeeded" defaultValue={(ticket.triage.partsNeeded || []).join(", ")} placeholder="comma-separated" />
          </label>
          <label>
            Specialist notes
            <textarea name="notes" rows="5" defaultValue={ticket.triage.notes || ""} />
          </label>
          <label>
            Queue status
            <select name="status" defaultValue={ticket.status}>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusMeta[status].label}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button className="primary-button" type="submit">
              Save triage
            </button>
            <button className="secondary-button" type="button" onClick={() => actions.navigate(`/events/${repairEvent.slug}/board`)}>
              Open board
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

function BoardPage({ repairEvent, tickets, ui, now, onToggleLarge }) {
  const columns = ["repairing", "up-next", "waiting", "done"];
  return (
    <section className="board-view">
      <div className="board-header">
        <div>
          <p className="eyebrow">Queue board</p>
          <h1>{repairEvent.name}</h1>
          <p>
            {repairEvent.location} - {formatTime(repairEvent.start)}-{formatTime(repairEvent.end)}
          </p>
        </div>
        <div className="board-tools">
          <time dateTime={now.toISOString()}>{formatClock(now)}</time>
          <button className="secondary-button compact" type="button" data-board-size onClick={onToggleLarge}>
            {ui.boardLarge ? "Exit large screen" : "Large screen"}
          </button>
        </div>
      </div>
      <div className="lane-strip" aria-label="Queue lanes">
        {CATEGORIES.map((category) => {
          const count = tickets.filter((ticket) => ticket.category === category && ticket.status !== "done").length;
          return (
            <span key={category}>
              <CategoryChip category={category} /> <strong>{count}</strong>
            </span>
          );
        })}
      </div>
      <div className="queue-columns">
        {columns.map((status) => {
          const columnTickets = queueSorted(tickets.filter((ticket) => ticket.status === status));
          return (
            <section className="queue-column" aria-labelledby={`column-${status}`} key={status}>
              <div className="queue-column-heading">
                <h2 id={`column-${status}`}>{statusMeta[status].label}</h2>
                <span>{columnTickets.length}</span>
              </div>
              <div className="queue-stack">
                {columnTickets.length ? columnTickets.map((ticket) => <BoardTicket key={ticket.id} ticket={ticket} now={now} />) : <p className="empty-state">No tickets here.</p>}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function BoardTicket({ ticket, now }) {
  const stuck = ticket.status === "waiting" && waitingMins(ticket, now) > 30;
  return (
    <article className={`board-ticket ${stuck ? "is-stuck" : ""}`}>
      <div className="ticket-topline">
        <span className="ticket-id">{ticket.id}</span>
        <PriorityChip priority={ticket.triage.priority} />
      </div>
      <h3>{ticket.brandModel}</h3>
      <p>
        {ticket.guest.name} - {ticket.triage.estimateMins} min estimate
      </p>
      <div className="chip-row">
        <CategoryChip category={ticket.category} />
        <OutcomeChip result={ticket.outcome?.result} />
      </div>
      {stuck ? <p className="stuck-note">Waiting {waitingMins(ticket, now)} min - organizer override available.</p> : null}
    </article>
  );
}

function VolunteerPage({ repairEvent, tickets, actions, ui }) {
  const [claimDialogOpen, setClaimDialogOpen] = useState(false);
  const nextTicket = nextClaimableTicket(tickets, ui.volunteerCategory);
  const filtered = filterVolunteerTickets(tickets, ui);

  const confirmClaim = () => {
    actions.claimNext();
    setClaimDialogOpen(false);
  };

  return (
    <>
      <section className="work-surface">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Team console</p>
            <h1>Claim, repair, and close outcomes.</h1>
          </div>
          <button className="primary-button" type="button" data-claim-next disabled={!nextTicket} onClick={() => setClaimDialogOpen(true)}>
            Claim next{nextTicket ? `: ${nextTicket.id}` : ""}
          </button>
        </div>
        <div className="toolbar" aria-label="Team filters">
          <label>
            Category
            <select data-volunteer-category value={ui.volunteerCategory} onChange={(event) => actions.setUi((current) => ({ ...current, volunteerCategory: event.target.value }))}>
              <option value="all">All lanes</option>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select data-volunteer-status value={ui.volunteerStatus} onChange={(event) => actions.setUi((current) => ({ ...current, volunteerStatus: event.target.value }))}>
              <option value="active">Active</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusMeta[status].label}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button compact" type="button" onClick={() => actions.navigate(`/admin/events/${repairEvent.slug}/check-in`)}>
            Front desk
          </button>
          <button className="secondary-button compact" type="button" onClick={() => actions.navigate(`/admin/events/${repairEvent.slug}/triage`)}>
            Triage list
          </button>
        </div>
        <div className="ticket-grid">
          {filtered.length ? filtered.map((ticket) => <VolunteerTicket key={ticket.id} ticket={ticket} repairEvent={repairEvent} actions={actions} />) : <p className="empty-state">No tickets match these filters.</p>}
        </div>
      </section>
      {claimDialogOpen ? (
        <dialog className="confirm-dialog" data-claim-dialog open>
          <form method="dialog">
            <h2>Claim next ticket?</h2>
            <p>{nextTicket ? `${nextTicket.id} - ${nextTicket.brandModel} will move to Now repairing.` : "No ticket is available."}</p>
            <div className="form-actions">
              <button className="secondary-button" value="cancel" onClick={() => setClaimDialogOpen(false)}>
                Cancel
              </button>
              <button className="primary-button" value="confirm" type="button" data-confirm-claim disabled={!nextTicket} onClick={confirmClaim}>
                Claim ticket
              </button>
            </div>
          </form>
        </dialog>
      ) : null}
    </>
  );
}

function VolunteerTicket({ ticket, repairEvent, actions }) {
  return (
    <article className="ticket-card">
      <div className="ticket-topline">
        <span className="ticket-id">{ticket.id}</span>
        <StatusChip status={ticket.status} />
      </div>
      <h3>{ticket.brandModel}</h3>
      <p>{ticket.symptoms}</p>
      <div className="chip-row">
        <CategoryChip category={ticket.category} />
        <PriorityChip priority={ticket.triage.priority} />
        <OutcomeChip result={ticket.outcome?.result} />
      </div>
      <dl className="detail-list">
        <div>
          <dt>Guest</dt>
          <dd>{ticket.guest.name}</dd>
        </div>
        <div>
          <dt>Estimate</dt>
          <dd>{ticket.triage.estimateMins} min</dd>
        </div>
        <div>
          <dt>Waiting</dt>
          <dd>{waitingMins(ticket)} min</dd>
        </div>
      </dl>
      <div className="button-row tight">
        {STATUSES.map((status) => (
          <button
            className="ghost-button compact"
            type="button"
            data-set-status={status}
            data-ticket-id={ticket.id}
            disabled={ticket.status === status}
            key={status}
            onClick={() => actions.setTicketStatus(ticket.id, status)}
          >
            {statusMeta[status].label}
          </button>
        ))}
      </div>
      <form
        className="outcome-form"
        data-outcome-form
        data-ticket-id={ticket.id}
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          actions.saveOutcome(ticket.id, new FormData(submitEvent.currentTarget));
        }}
      >
        <label>
          Outcome
          <select name="result" defaultValue={ticket.outcome?.result || "fixed"}>
            {OUTCOMES.map((result) => (
              <option key={result} value={result}>
                {outcomeMeta[result].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Summary
          <textarea name="summary" rows="3" defaultValue={ticket.outcome?.summary || ""} />
        </label>
        <div className="button-row tight">
          {OUTCOMES.map((result) => (
            <button
              className="ghost-button compact"
              type="button"
              data-template={result}
              key={result}
              onClick={(clickEvent) => {
                const form = clickEvent.currentTarget.closest("form");
                form.elements.result.value = result;
                form.elements.summary.value = templates[result];
              }}
            >
              {outcomeMeta[result].label}
            </button>
          ))}
          <button className="secondary-button compact" type="submit">
            Save outcome
          </button>
        </div>
      </form>
      <button className="link-button" type="button" onClick={() => actions.navigate(`/admin/events/${repairEvent.slug}/triage/${ticket.id}`)}>
        Open full triage record
      </button>
    </article>
  );
}

function ReportPage({ tickets, onExport }) {
  const outcomes = countBy(tickets, (ticket) => ticket.outcome?.result || "pending");
  const categories = countBy(tickets, (ticket) => ticket.category);
  const totalEstimate = tickets.reduce((sum, ticket) => sum + Number(ticket.triage.estimateMins || 0), 0);
  const completed = tickets.filter((ticket) => ticket.status === "done");

  return (
    <section className="work-surface">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Organizer report</p>
          <h1>Post-event throughput and outcomes.</h1>
        </div>
        <button className="primary-button" type="button" data-export-csv onClick={onExport}>
          Export CSV
        </button>
      </div>
      <section className="metric-strip report-metrics">
        <Metric label="Tickets" value={tickets.length} detail="total intake" />
        <Metric label="Completed" value={completed.length} detail="marked done" />
        <Metric label="Avg estimate" value={`${Math.round(totalEstimate / tickets.length)}m`} detail="triage time" />
        <Metric label="Needs follow-up" value={followUpCount(tickets)} detail="parts or specialist" />
      </section>
      <div className="report-grid">
        <section>
          <h2>Outcome mix</h2>
          <BarChart
            counts={outcomes}
            labels={{
              fixed: "Fixed",
              "needs-parts": "Needs parts",
              specialist: "Needs specialist",
              "not-repairable": "Not repairable",
              pending: "Pending"
            }}
          />
        </section>
        <section>
          <h2>Common categories</h2>
          <BarChart counts={categories} labels={Object.fromEntries(CATEGORIES.map((category) => [category, category]))} />
        </section>
      </div>
      <section>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Ticket ledger</p>
            <h2>All seeded and added tickets</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Guest</th>
                <th>Category</th>
                <th>Status</th>
                <th>Outcome</th>
                <th>Estimate</th>
                <th>Parts</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id}>
                  <td>{ticket.id}</td>
                  <td>{ticket.guest.name}</td>
                  <td>{ticket.category}</td>
                  <td>{statusMeta[ticket.status]?.label || ticket.status}</td>
                  <td>{outcomeMeta[ticket.outcome?.result]?.label || "Pending"}</td>
                  <td>{ticket.triage.estimateMins} min</td>
                  <td>{(ticket.triage.partsNeeded || []).join(", ") || "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function TicketCard({ ticket, actionLabel, onAction }) {
  return (
    <article className="ticket-card">
      <div className="ticket-topline">
        <span className="ticket-id">{ticket.id}</span>
        <StatusChip status={ticket.status} />
      </div>
      <h3>{ticket.brandModel}</h3>
      <p>{ticket.symptoms}</p>
      <div className="chip-row">
        <CategoryChip category={ticket.category} />
        <PriorityChip priority={ticket.triage.priority} />
      </div>
      <dl className="detail-list">
        <div>
          <dt>Guest</dt>
          <dd>{ticket.guest.name}</dd>
        </div>
        <div>
          <dt>Estimate</dt>
          <dd>{ticket.triage.estimateMins} min</dd>
        </div>
        <div>
          <dt>Parts</dt>
          <dd>{(ticket.triage.partsNeeded || []).join(", ") || "None"}</dd>
        </div>
      </dl>
      <button className="secondary-button" type="button" onClick={onAction}>
        {actionLabel}
      </button>
    </article>
  );
}

function NotFound({ repairEvent, onNavigate }) {
  return (
    <section className="work-surface">
      <div className="surface-intro">
        <p className="eyebrow">Missing route</p>
        <h1>This prototype view does not exist.</h1>
        <p>Return to the event list or open the Riverside service hub demo.</p>
      </div>
      <div className="button-row">
        <button className="primary-button" type="button" onClick={() => onNavigate("/events")}>
          Events
        </button>
        <button className="secondary-button" type="button" onClick={() => onNavigate(`/events/${repairEvent.slug}`)}>
          Event details
        </button>
      </div>
    </section>
  );
}

function Metric({ label, value, detail }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function StatusChip({ status }) {
  const meta = statusMeta[status] || { label: status, icon: "?" };
  return (
    <span className={`chip status-${status}`}>
      <b>{meta.icon}</b>
      {meta.label}
    </span>
  );
}

function OutcomeChip({ result }) {
  if (!result) {
    return (
      <span className="chip">
        <b>--</b>Pending
      </span>
    );
  }
  const meta = outcomeMeta[result] || { label: result, icon: "?" };
  return (
    <span className={`chip outcome-${result}`}>
      <b>{meta.icon}</b>
      {meta.label}
    </span>
  );
}

function CategoryChip({ category }) {
  const meta = categoryMeta[category] || categoryMeta.Other;
  return (
    <span className="chip category-chip">
      <b>{meta.icon}</b>
      {category}
    </span>
  );
}

function PriorityChip({ priority = "medium" }) {
  return (
    <span className={`chip priority-${priority}`}>
      <b>{String(priority).slice(0, 1).toUpperCase()}</b>
      {priority}
    </span>
  );
}

function CategoryOptions() {
  return CATEGORIES.map((category) => (
    <option key={category} value={category}>
      {category}
    </option>
  ));
}

function BarChart({ counts, labels }) {
  const max = Math.max(1, ...Object.values(counts));
  return (
    <div className="bar-chart">
      {Object.keys(labels).map((key) => {
        const value = counts[key] || 0;
        const width = Math.max(4, Math.round((value / max) * 100));
        return (
          <div className="bar-row" key={key}>
            <span>{labels[key]}</span>
            <div className="bar-track">
              <span style={{ width: `${width}%` }} />
            </div>
            <strong>{value}</strong>
          </div>
        );
      })}
    </div>
  );
}

async function apiRequest(path, options = {}) {
  const init = {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" }
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);

  const response = await fetch(`/api${path}`, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(payload?.error || "Backend request failed");
  return payload;
}

function ticketPayloadFromForm(form, source) {
  return {
    source,
    name: String(form.get("name") || "").trim(),
    contact: String(form.get("contact") || "").trim(),
    consent: form.get("consent") === "on",
    category: String(form.get("category") || "Other"),
    brandModel: String(form.get("brandModel") || "Unlisted item").trim(),
    symptoms: String(form.get("symptoms") || "").trim(),
    photoNote: String(form.get("photoNote") || "").trim(),
    notify: String(form.get("notify") || "Email/SMS stub")
  };
}

function triagePayloadFromForm(form) {
  return {
    guestName: String(form.get("guestName") || "").trim(),
    contact: String(form.get("contact") || "").trim(),
    category: String(form.get("category") || "Other"),
    brandModel: String(form.get("brandModel") || "").trim(),
    symptoms: String(form.get("symptoms") || "").trim(),
    safetyFlags: form.getAll("safetyFlags").map(String),
    diagnosisGuess: String(form.get("diagnosisGuess") || "").trim(),
    estimateMins: Number(form.get("estimateMins") || 20),
    partsNeeded: String(form.get("partsNeeded") || ""),
    priority: String(form.get("priority") || "medium"),
    notes: String(form.get("notes") || "").trim(),
    status: String(form.get("status") || "waiting")
  };
}

function outcomePayloadFromForm(form) {
  return {
    result: String(form.get("result") || "fixed"),
    summary: String(form.get("summary") || "").trim()
  };
}

async function downloadCsvFromApi(path, filename) {
  const response = await fetch(`/api${path}`);
  if (!response.ok) throw new Error("CSV export failed");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function nextClaimableTicket(tickets, category = "all") {
  return queueSorted(tickets).find((ticket) => {
    const statusOk = ticket.status === "up-next" || ticket.status === "waiting";
    const categoryOk = category === "all" || ticket.category === category;
    return statusOk && categoryOk;
  });
}

function filterVolunteerTickets(tickets, ui) {
  return queueSorted(tickets).filter((ticket) => {
    const categoryOk = ui.volunteerCategory === "all" || ticket.category === ui.volunteerCategory;
    const statusOk = ui.volunteerStatus === "active" ? ticket.status !== "done" : ticket.status === ui.volunteerStatus;
    return categoryOk && statusOk;
  });
}

function queueSorted(tickets) {
  const weights = { high: 0, medium: 1, low: 2 };
  return [...tickets].sort((a, b) => {
    const byPriority = (weights[a.triage?.priority] ?? 1) - (weights[b.triage?.priority] ?? 1);
    if (byPriority !== 0) return byPriority;
    return new Date(a.createdAt || a.checkedInAt) - new Date(b.createdAt || b.checkedInAt);
  });
}

function waitingMins(ticket, now = new Date()) {
  const base = new Date(ticket.checkedInAt || ticket.createdAt || Date.now()).getTime();
  return Math.max(0, Math.floor((now.getTime() - base) / 60000));
}

function getDashboardCounts(tickets) {
  return {
    active: tickets.filter((ticket) => ticket.status !== "done").length,
    repairing: tickets.filter((ticket) => ticket.status === "repairing").length,
    done: tickets.filter((ticket) => ticket.status === "done").length
  };
}

function followUpCount(tickets) {
  return tickets.filter((ticket) => ticket.outcome?.result === "needs-parts" || ticket.outcome?.result === "specialist").length;
}

function countBy(items, getter) {
  return items.reduce((acc, item) => {
    const key = getter(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function searchText(ticket) {
  return [ticket.id, ticket.guest.name, ticket.guest.contact, ticket.category, ticket.brandModel, ticket.status].join(" ").toLowerCase();
}

function normalizePath() {
  return (location.hash || "#/events").replace(/^#/, "").replace(/\/$/, "") || "/events";
}

function isActiveRoute(path, route) {
  return path === route || (route !== "/events" && path.startsWith(route));
}

function formatEventWindow(repairEvent) {
  return `${formatDate(repairEvent.start)} - ${formatTime(repairEvent.start)} to ${formatTime(repairEvent.end)}`;
}

function formatDate(dateValue) {
  return new Intl.DateTimeFormat("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(dateValue));
}

function formatTime(dateValue) {
  return new Intl.DateTimeFormat("en-SG", {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(dateValue));
}

function formatClock(date) {
  return new Intl.DateTimeFormat("en-SG", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}
