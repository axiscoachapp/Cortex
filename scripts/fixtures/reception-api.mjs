// Synthetic loopback transport for UI tests. Authorization itself is verified in PostgreSQL.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
export const ids = {
  admin: '11111111-1111-4111-8111-111111111111',
  doctor: '22222222-2222-4222-8222-222222222222',
  a: '33333333-3333-4333-8333-333333333333',
  b: '66666666-6666-4666-8666-666666666666',
  patient: '44444444-4444-4444-8444-444444444444',
  clinic: '55555555-5555-4555-8555-555555555555',
  contact: '77777777-7777-4777-8777-777777777777',
  case: '88888888-8888-4888-8888-888888888888',
};
export async function startReceptionFixture() {
  let teamDirectoryFailure = false;
  const now = () => new Date().toISOString();
  const users = new Map(
    [
      [ids.admin, 'admin'],
      [ids.a, 'recepcao-a'],
      [ids.b, 'recepcao-b'],
    ].map(([id, name]) => [
      id,
      {
        id,
        email: name + '@example.invalid',
        aud: 'authenticated',
        role: 'authenticated',
        created_at: now(),
        email_confirmed_at: now(),
        app_metadata: { provider: 'email', ...(id === ids.admin ? {} : { account_type: 'reception' }) },
        user_metadata: {},
        factors: [],
      },
    ]),
  );
  const doctors = [
    { id: ids.admin, name: 'Dra. Ana Exemplo', specialty: 'geral' },
    { id: ids.doctor, name: 'Dr. Bruno Exemplo', specialty: 'psiquiatria' },
  ];
  const staff = [
    { id: ids.a, name: 'Secretária A', active: true, doctorIds: [ids.admin] },
    { id: ids.b, name: 'Secretária B', active: true, doctorIds: [ids.admin] },
  ];
  const beneficiaries = [
    {
      id: ids.patient,
      name: 'Paciente Sintético',
      dateOfBirth: '2000-01-01',
      doctorId: ids.admin,
      relationship: 'guardian',
    },
  ];
  const contacts = [
    { id: ids.contact, name: 'Família Exemplo', phone: '(41) 99999-0000', createdAt: now(), beneficiaries },
  ];
  const cases = [
    {
      id: ids.case,
      clinicId: ids.clinic,
      contactId: ids.contact,
      doctorId: ids.admin,
      subject: 'Solicitação de retorno',
      kind: 'return',
      status: 'new',
      assignedTo: null,
      revision: 1,
      createdAt: now(),
      notes: [],
      drafts: {},
    },
  ];
  const appointments = [];
  const blocks = [];
  const requests = new Map();
  const metrics = { clinicalReads: [], externalCalls: [], unknown: [], bookings: 0, contacts: 0, caseWrites: 0 };
  let failCaseOnce = false;
  const token = (user) =>
    [
      { alg: 'HS256', typ: 'JWT' },
      {
        sub: user.id,
        role: 'authenticated',
        aud: 'authenticated',
        aal: 'aal1',
        exp: Math.floor(Date.now() / 1000) + 86400,
        iat: Math.floor(Date.now() / 1000),
      },
    ]
      .map((value) => Buffer.from(JSON.stringify(value)).toString('base64url'))
      .join('.') + '.synthetic-signature';
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let raw = '';
      for await (const part of req) raw += part;
      const input = raw ? JSON.parse(raw) : {};
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,HEAD,OPTIONS',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      };
      const send = (data, status = 200) => {
        res.writeHead(status, headers);
        res.end(JSON.stringify(data));
      };
      const error = (code, message) => send({ code, message }, code === '42501' ? 403 : 409);
      if (req.method === 'OPTIONS') return send({});
      let actor;
      try {
        actor = JSON.parse(Buffer.from(req.headers.authorization?.split('.')[1] ?? '', 'base64url').toString()).sub;
      } catch {}
      const user = users.get(actor);
      if (url.pathname === '/auth/v1/token') {
        const found = [...users.values()].find((u) => u.email === input.email);
        if (!found) return error('42501', 'Synthetic user missing');
        return send({
          access_token: token(found),
          refresh_token: 'synthetic-refresh',
          expires_in: 86400,
          expires_at: Math.floor(Date.now() / 1000) + 86400,
          token_type: 'bearer',
          user: found,
        });
      }
      if (url.pathname === '/auth/v1/user') return send(user);
      if (url.pathname === '/auth/v1/logout') return send({});
      if (!user) return error('42501', 'Synthetic session missing');
      const member = staff.find((s) => s.id === actor);
      const permitted = (doctor) =>
        (actor === ids.admin && (!doctor || doctor === ids.admin)) || (member?.active && (!doctor || member.doctorIds.includes(doctor)));
      if (url.pathname === '/functions/v1/create-clinic-receptionist' && actor === ids.admin) {
        const id = randomUUID();
        staff.push({ id, name: input.name, active: true, doctorIds: input.doctorIds });
        return send({ success: true, email: input.email, temporaryPassword: 'synthetic-password-only-for-browser' });
      }
      if (url.pathname.startsWith('/functions/')) {
        metrics.externalCalls.push(url.pathname);
        return send({ error: 'External operation blocked' }, 503);
      }
      if (!url.pathname.startsWith('/rest/v1/rpc/')) {
        metrics.clinicalReads.push({ actor, path: url.pathname });
        return send([]);
      }
      const rpc = url.pathname.split('/').pop();
      if (rpc === 'reception_team_doctors')
        return actor !== ids.admin || input.p_clinic !== ids.clinic ? error('42501', 'Management scope required')
          : teamDirectoryFailure ? error('XX000', 'Synthetic team directory failure') : send(doctors);
      if (rpc === 'clinic_access')
        return send({
          kind: member ? 'reception' : 'clinical',
          active: member ? member.active : true,
          admin: actor === ids.admin,
          actorId: actor,
          clinic: { id: ids.clinic, name: 'Haddad Nicola' },
          doctors: doctors.filter((d) => permitted(d.id)),
          staff: actor === ids.admin ? staff : [],
        });
      if (!permitted(input.p_doctor)) return error('42501', 'Scope revoked');
      const contact = contacts.find((c) => c.id === input.p_contact);
      const receptionCase = cases.find((c) => c.id === input.p_case);
      const detail = (c) => ({
        id: c.id,
        clinicId: c.clinicId,
        contactId: c.contactId,
        contactName: contacts.find((x) => x.id === c.contactId).name,
        phone: contacts.find((x) => x.id === c.contactId).phone,
        doctorId: c.doctorId,
        subject: c.subject,
        kind: c.kind,
        status: c.status,
        assignedTo: c.assignedTo,
        revision: c.revision,
        createdAt: c.createdAt,
        beneficiaries: contacts.find((x) => x.id === c.contactId).beneficiaries.filter((p) => permitted(p.doctorId)),
        eligibleAssignees: [
          ...staff
            .filter((s) => s.active && (!c.doctorId || s.doctorIds.includes(c.doctorId)))
            .map((s) => ({ id: s.id, name: s.name })),
          { id: ids.admin, name: doctors[0].name },
        ],
        notes: c.notes,
        noteCount: c.notes.length,
        draft: c.drafts[actor] ?? { body: '', revision: 0 },
      });
      if (rpc === 'reception_contacts')
        return send({
          items: contacts
            .filter((c) => !input.p_search || (c.name + c.phone).toLowerCase().includes(input.p_search.toLowerCase()))
            .map(({ id, name, phone, createdAt }) => ({ id, name, phone, createdAt })),
          nextCursor: null,
        });
      if (rpc === 'reception_contact')
        return contact
          ? send({
              id: contact.id,
              clinicId: ids.clinic,
              name: contact.name,
              phone: contact.phone,
              beneficiaries: contact.beneficiaries.filter((p) => permitted(p.doctorId)),
            })
          : error('42501', 'Contact missing');
      if (rpc === 'reception_contact_edit')
        return actor === ids.admin && contact
          ? send({ id: contact.id, name: contact.name, phone: contact.phone, revision: contact.revision ?? 1 })
          : error('42501', 'Administrator required');
      if (rpc === 'reception_update_contact') {
        if (actor !== ids.admin || !contact) return error('42501', 'Administrator required');
        if (input.p_revision !== (contact.revision ?? 1)) return error('40001', 'Contact changed');
        Object.assign(contact, { name: input.p_name, phone: input.p_phone, revision: (contact.revision ?? 1) + 1 });
        return send(contact.revision);
      }
      if (rpc === 'reception_create_contact') {
        if (requests.has(input.p_request)) return send(requests.get(input.p_request));
        const id = randomUUID();
        contacts.push({ id, name: input.p_name, phone: input.p_phone, createdAt: now(), beneficiaries: [] });
        requests.set(input.p_request, id);
        metrics.contacts++;
        return send(id);
      }
      if (rpc === 'reception_create_case') {
        if (failCaseOnce) {
          failCaseOnce = false;
          return send({ message: 'Synthetic lost connection' }, 503);
        }
        if (requests.has(input.p_request)) return send(requests.get(input.p_request));
        const id = randomUUID();
        cases.push({
          id,
          clinicId: ids.clinic,
          contactId: input.p_contact,
          doctorId: input.p_doctor,
          subject: input.p_subject,
          kind: input.p_kind,
          status: 'new',
          assignedTo: null,
          revision: 1,
          createdAt: now(),
          notes: [],
          drafts: {},
        });
        requests.set(input.p_request, id);
        return send(id);
      }
      if (rpc === 'reception_queue')
        return send({
          items: cases
            .filter(
              (c) =>
                permitted(c.doctorId) &&
                (!input.p_mine || c.assignedTo === actor) &&
                (!input.p_doctor || c.doctorId === input.p_doctor) &&
                (input.p_status === 'all' ||
                  (input.p_status === 'open' && !['resolved', 'cancelled'].includes(c.status)) ||
                  c.status === input.p_status),
            )
            .map((c) => {
              const d = detail(c);
              return {
                id: d.id,
                subject: d.subject,
                kind: d.kind,
                status: d.status,
                revision: d.revision,
                contactId: d.contactId,
                contactName: d.contactName,
                phone: d.phone,
                doctorId: d.doctorId,
                assignedTo: d.assignedTo,
                assigneeName: staff.find((s) => s.id === d.assignedTo)?.name ?? null,
                createdAt: d.createdAt,
              };
            }),
          nextCursor: null,
        });
      if (rpc === 'reception_case')
        return receptionCase && permitted(receptionCase.doctorId)
          ? send(detail(receptionCase))
          : error('42501', 'Case unavailable');
      if (['reception_update_case', 'reception_save_draft', 'reception_add_note'].includes(rpc)) {
        if (!receptionCase || !permitted(receptionCase.doctorId)) return error('42501', 'Case unavailable');
        if (rpc === 'reception_update_case') {
          if (
            input.p_revision !== receptionCase.revision ||
            (input.p_action === 'claim' && receptionCase.assignedTo && receptionCase.assignedTo !== actor)
          )
            return error('40001', 'Stale case');
          if (input.p_action === 'claim') {
            receptionCase.assignedTo = actor;
            receptionCase.status = 'assigned';
          }
          if (input.p_action === 'status') receptionCase.status = input.p_value.status;
          if (input.p_action === 'transfer') {
            receptionCase.assignedTo = input.p_value.assigneeId;
            receptionCase.status = 'assigned';
          }
          if (input.p_action === 'route') receptionCase.doctorId = input.p_value.doctorId;
          if (input.p_action === 'reopen') {
            receptionCase.assignedTo = null;
            receptionCase.status = 'new';
          }
          metrics.caseWrites++;
          return send(++receptionCase.revision);
        }
        const draft = receptionCase.drafts[actor] ?? { body: '', revision: 0 };
        if (rpc === 'reception_save_draft') {
          if (input.p_revision !== draft.revision) return error('40001', 'Draft changed');
          receptionCase.drafts[actor] = { body: input.p_body, revision: draft.revision + 1 };
          return send(draft.revision + 1);
        }
        if (!receptionCase.notes.some((n) => n.id === input.p_request))
          receptionCase.notes.push({
            id: input.p_request,
            body: input.p_body,
            actorId: actor,
            actorName: member?.name ?? 'Admin',
            createdAt: now(),
          });
        if (draft.body.trim() === input.p_body.trim())
          receptionCase.drafts[actor] = { body: '', revision: draft.revision + 1 };
        return send({ id: input.p_request, draft: receptionCase.drafts[actor] ?? draft });
      }
      if (rpc === 'reception_patient_search')
        return send(
          beneficiaries
            .filter((p) => p.name.toLowerCase().includes(input.p_search.toLowerCase()))
            .map(({ id, name, dateOfBirth }) => ({ id, name, dateOfBirth })),
        );
      if (rpc === 'reception_link_patient') {
        const link = contact?.beneficiaries.find((p) => p.id === input.p_patient && p.doctorId === input.p_doctor);
        if (link && link.relationship !== input.p_relationship)
          return error('22023', 'Este vínculo já foi confirmado com outra relação. Confira o cadastro antes de reservar.');
        return send(true);
      }
      if (rpc === 'reception_appointments')
        return send({
          items: appointments.filter(
            (a) =>
              permitted(a.doctorId) &&
              (!input.p_doctor || a.doctorId === input.p_doctor) &&
              a.startTime < input.p_end &&
              a.endTime > input.p_start,
          ),
          blocks: blocks.filter((b) => permitted(b.doctorId)),
        });
      if (rpc === 'reception_book_appointment') {
        if (requests.has(input.p_request)) return send(requests.get(input.p_request));
        const d = input.p_details;
        if (
          appointments.some(
            (a) =>
              a.doctorId === d.doctorId &&
              a.status !== 'cancelado' &&
              a.startTime < d.endTime &&
              a.endTime > d.startTime,
          )
        )
          return error('23P01', 'Occupied');
        const id = randomUUID();
        appointments.push({
          id,
          doctorId: d.doctorId,
          patientId: d.patientId ?? randomUUID(),
          contactId: d.contactId,
          caseId: d.caseId ?? null,
          patientName: d.patientId ? beneficiaries[0].name : d.beneficiaryName,
          startTime: d.startTime,
          endTime: d.endTime,
          type: d.type,
          status: 'agendado',
          revision: 1,
          checkedInAt: null,
          googleSyncStatus: 'idle',
        });
        requests.set(input.p_request, id);
        metrics.bookings++;
        return send(id);
      }
      if (rpc === 'reception_change_appointment') {
        const a = appointments.find((a) => a.id === input.p_appointment);
        if (!a || !permitted(a.doctorId)) return error('42501', 'Appointment unavailable');
        if (a.revision !== input.p_revision) return error('40001', 'Stale appointment');
        if (input.p_action === 'confirm') a.status = 'confirmado';
        if (input.p_action === 'cancel') a.status = 'cancelado';
        if (input.p_action === 'check_in') a.checkedInAt = now();
        if (input.p_action === 'undo_check_in') a.checkedInAt = null;
        if (input.p_action === 'reschedule')
          Object.assign(a, { startTime: input.p_start, endTime: input.p_end, status: 'agendado', checkedInAt: null });
        return send(++a.revision);
      }
      if (rpc === 'update_reception_staff' && actor === ids.admin) {
        const s = staff.find((s) => s.id === input.p_staff);
        Object.assign(s, { active: input.p_active, doctorIds: input.p_doctors });
        for (const c of cases)
          if (c.assignedTo === s.id && (!s.active || (c.doctorId && !s.doctorIds.includes(c.doctorId)))) {
            c.assignedTo = null;
            c.status = 'new';
            c.revision++;
          }
        return send(true);
      }
      if (rpc === 'reception_block_time' && actor === ids.admin) {
        const id = randomUUID();
        blocks.push({
          id,
          doctorId: input.p_doctor,
          startTime: input.p_start,
          endTime: input.p_end,
          reason: input.p_reason,
          revision: 1,
        });
        return send(id);
      }
      if (rpc === 'reception_unblock_time' && actor === ids.admin) {
        blocks.splice(
          blocks.findIndex((b) => b.id === input.p_block),
          1,
        );
        return send(true);
      }
      metrics.unknown.push(rpc);
      return send({ code: 'TEST_UNHANDLED', message: 'Unhandled synthetic RPC ' + rpc }, 500);
    } catch (error) {
      res.writeHead(500, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    setTeamDirectoryFailure: (failed) => { teamDirectoryFailure = failed; },
    metrics,
    cases,
    contacts,
    staff,
    appointments,
    failNextCase: () => {
      failCaseOnce = true;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
