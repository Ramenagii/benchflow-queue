import assert from 'node:assert/strict';
import test from 'node:test';

process.env.VERCEL = '1';

const {
  buildCsvReport,
  claimNextTicket,
  createTicket,
  updateOutcome,
  updateTriage,
} = await import('../server/db.js');

function createState() {
  return {
    events: [{ id: 'event-1', slug: 'fix-day', name: 'Fix Day' }],
    tickets: [
      {
        id: 'BF-001',
        eventId: 'event-1',
        guest: { name: 'Ava', contact: 'ava@example.com' },
        source: 'signup',
        status: 'waiting',
        createdAt: '2026-06-08T09:10:00.000Z',
        checkedInAt: '2026-06-08T09:10:00.000Z',
        category: 'Bikes',
        symptoms: 'Flat tire',
        triage: { priority: 'low', estimateMins: 15, partsNeeded: ['tube'] },
        repairSession: {},
        outcome: {},
      },
      {
        id: 'BF-002',
        eventId: 'event-1',
        guest: { name: 'Kai', contact: 'kai@example.com' },
        source: 'walkin',
        status: 'up-next',
        createdAt: '2026-06-08T09:20:00.000Z',
        checkedInAt: '2026-06-08T09:20:00.000Z',
        category: 'Electronics',
        symptoms: 'Loose jack',
        triage: { priority: 'high', estimateMins: 30, partsNeeded: [] },
        repairSession: {},
        outcome: {},
      },
    ],
  };
}

test('createTicket trims guest input and increments ticket ids', () => {
  const state = createState();
  const event = state.events[0];

  const ticket = createTicket(state, event, {
    name: '  Mira  ',
    contact: '  mira@example.com ',
    category: '',
    brandModel: '',
    symptoms: '  screen flicker ',
    notify: 'email',
  });

  assert.equal(ticket.id, 'BF-003');
  assert.equal(ticket.guest.name, 'Mira');
  assert.equal(ticket.guest.contact, 'mira@example.com');
  assert.equal(ticket.category, 'Other');
  assert.equal(ticket.brandModel, 'Unlisted item');
  assert.equal(ticket.symptoms, 'screen flicker');
  assert.equal(state.tickets.at(-1), ticket);
});

test('claimNextTicket prefers high-priority claimable work and marks it repairing', () => {
  const state = createState();
  const event = state.events[0];

  const ticket = claimNextTicket(state, event, 'all');

  assert.equal(ticket.id, 'BF-002');
  assert.equal(ticket.status, 'repairing');
  assert.equal(ticket.repairSession.assignedVolunteerId, 'vol-you');
});

test('updateTriage normalizes list input and updateOutcome closes the ticket', () => {
  const state = createState();
  const ticket = state.tickets[0];

  updateTriage(ticket, {
    guestName: 'Ava R.',
    contact: ' ava@example.com ',
    category: 'Bikes',
    brandModel: 'Road bike',
    symptoms: 'Flat tire',
    partsNeeded: 'tube, tire lever, ',
    priority: 'high',
    status: 'up-next',
  });
  updateOutcome(ticket, { result: 'fixed', summary: 'Patched tube' });

  assert.deepEqual(ticket.triage.partsNeeded, ['tube', 'tire lever']);
  assert.equal(ticket.status, 'done');
  assert.equal(ticket.outcome.summary, 'Patched tube');
  assert.ok(ticket.repairSession.endedAt);
});

test('buildCsvReport escapes comma and quote characters', () => {
  const state = createState();
  state.tickets[0].guest.name = 'Ava, Jr.';
  state.tickets[0].outcome = { result: 'fixed', summary: 'Replaced "tube"' };

  const csv = buildCsvReport(state, state.events[0]);

  assert.match(csv, /^ticket,guest,contact,source,category,status,priority,estimateMins,outcome,partsNeeded,summary/m);
  assert.match(csv, /"Ava, Jr\."/);
  assert.match(csv, /"Replaced ""tube"""/);
});
