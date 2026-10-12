# RCL Design-Build: persona design plan

Read-only review of `main` @ 7cb85bb (PR #1 and PR #2 are both **already merged**), plus `docs/mobile/FINDINGS.md` and the screenshots in `/workspace/rcl-mobile/{before,after,monday,roles}`. Nothing was pushed.

## Ground truth today
- **Roles in code** (`src/lib/roles.ts`): `superadmin` (Elvira), `admin`, `pm`, `superintendent`, `office`, `field`. **Charlie's personas don't exist yet.** Proposed mapping: owner→`superadmin`/new `owner`, admin→`admin`, lead→`superintendent` (rename the label to "Lead"), labor→`field` (label "Labor"), subcontractor→new `sub`. `pm` and `office` stay as admin-like desk roles or get folded into admin.
- **Every role lands on the same Desk** (`DeskHome`): a marketing hero ("Keep the job on budget…"), stat cards, a **contract value chart that Labor can see**, RFIs, and Site work (see `roles/390x844-labor.png`).
- **Site view** (`FieldView`): a 7-input Dispatch form sits first, then a sideways-scrolling Kanban (about 1.3 columns visible at 390 px), then the editor (`monday/390x844-02`).
- **Server checks roles in only three places**: archive, invite, and code approval (`data.server.ts`).
- There is no "activity" entity with request/approve, no photos table, and no daily document. `daily_logs` is a crew-count plus notes record, and `work_orders` are dispatch calls.
- Six-tab bottom nav (Desk, Jobs, Site, Log, Foreman, Crew) with 12 px labels, shown to every role.

---

## Shared changes (do these first; the persona work depends on them)

| # | Change | Why | Acceptance | Files | Size |
|---|---|---|---|---|---|
| S1 | **Role model + server permission matrix** | Personas aren't in code; field roles can create jobs/COs and see money | `ROLES` includes owner/admin/lead/labor/sub (+ legacy aliases); one `can(role, action)` table; every mutating server fn and `loadDesk` calls it; money fields are stripped from payloads for labor/sub; e2e asserts a 403 for each forbidden action | `src/lib/roles.ts`, new `src/lib/permissions.ts`, `src/lib/server/data.server.ts`, `src/lib/server/fns.ts`, migration `0004_roles.sql`, `e2e/permissions.spec.ts` | M |
| S2 | **Role-based navigation shell** | Six tabs for everyone; field users need 3 to 4 | Nav comes from `navFor(role)`: Owner/Admin get Desk, Jobs, Site, Crew, More; Lead gets Today, Activities, Crew, Jobs; Labor/Sub get Today, Activities, Daily doc. Max 5 tabs, 13 px labels, 56 px tall, safe-area padding; desktop gets a sidebar | `src/components/desk-app.tsx` (NAV, NavButton) | M |
| S3 | **Field design tokens ("glove mode")** | Gloves, sunlight, one hand | Primary actions ≥56 px tall and full width on phones; ≥8 px gaps between targets; body text ≥16 px; WCAG AA contrast ≥7:1 on field screens (the dark theme's muted greys fail in sun); optional high-contrast light theme toggle; status shown by color **plus** icon/text | `src/styles.css`, `src/components/ui.tsx` | M |
| S4 | **State primitives: Empty / Loading / Error / Offline** | No consistent states; landing flash after sign-in | `<Skeleton>`, `<EmptyState action>`, `<ErrorBanner retry>`, `<OfflineBadge>` in `ui.tsx`; the landing flash is gone (neutral splash until session resolves); every list uses them | `src/components/ui.tsx`, `src/routes/index.tsx`, `desk-views.tsx` | S |
| S5 | **Offline outbox for field writes** | Bad signal on site | Status taps, notes, and photos queue in IndexedDB with an "n pending" badge and retry on reconnect; optimistic UI; server writes are idempotent via a client-generated id | new `src/lib/outbox.ts`, `src/lib/server/fns.ts`, PWA service worker (`scripts/grok-pwa-shared.mjs`) | L |
| S6 | **Notifications service** | Approvals and requests need to reach people | `notify(userIds, kind, payload)` writes an in-app inbox row and optionally SMS/email via the existing `mailer.server.ts`/`sms.server.ts`; bell with count in the header; per-user quiet hours | migration, `data.server.ts`, new `src/lib/server/notify.server.ts`, `desk-app.tsx` header | M |
| S7 | **Mobile header cleanup** | Tagline truncates; name + Sign out crowd the bar | Phone header = page title + avatar menu (name, role, Sign out); tagline hidden <768 px | `desk-app.tsx`, `src/lib/auth/gates.tsx` | S |

---

## Owner
Primary screen: **Portfolio desk** (desktop first, still works on a phone).
1. **Owner desk: money and risk first** (M). Why: owners decide on margin and exceptions. AC: top row shows contract value, approved COs, pending CO $, and jobs at risk (behind milestone or with open RFIs >7 days); each card links to a filtered list; the marketing hero is removed. Files: `desk-views.tsx` (DeskHome, Stat).
2. **Approvals inbox** (M). Why: one place for COs, code proposals, and escalated activity requests. AC: a list sorted by age with approve/decline inline and the reason required on decline; the count appears in nav. Files: `desk-views.tsx`, `fns.ts`. Depends on S6.
3. **Daily compliance board** (M). Why: the photo-first-thing standard only works if someone sees gaps. AC: per job, today's crew with ✓/✗ for daily doc started, photos count, and submitted; first and last edit times; lunch minutes. Files: new `src/components/compliance.tsx`. Depends on WP-DOC.
4. **Crew & roles management** (S). AC: change role and deactivate (remove) employee; pending invites list with resend/revoke (FINDINGS #8). Files: `CrewView`, `data.server.ts`.
5. **Archive search** (S). AC: search archived jobs by name/client/address; the e2e skip is removed. Files: `JobsView`, `data.server.ts`, `e2e/core-flows.spec.ts`.
Hide: nothing. Notifications: daily 6 pm digest; immediate on CO > threshold.

## Admin
Primary screen: **Jobs + Crew** on desktop.
1. **Auto-select after create** (S). AC: a newly saved job or dispatched order is selected and scrolled into view (FINDINGS #9). Files: `JobsView`, `FieldView`.
2. **Bids & takeoff upload** (L). AC: a Bids tab on a job; upload .xlsx/.csv takeoff → preview table → line items with totals; submit bid changes status; e2e un-skipped. Files: new `src/components/bids.tsx`, migration, `data.server.ts`, `e2e/`.
3. **Dispatch as a modal, not a page header** (S). AC: the "New dispatch" button opens a sheet; the board is the default view. Files: `FieldView`.
4. **Board as list on phones, kanban on desktop** (M). AC: <768 px shows a status-segmented list (New / Scheduled / On site / Done) with counts; ≥768 px keeps columns. Files: `FieldView`, `styles.css`.
5. **Crew management** shared with Owner #4.
Hide: Foreman/code approval for everyone but Elvira (already server-enforced; also hide the tab).

## Lead
Primary screen: **Today: my crew, my jobs** (phone).
1. **Lead Today screen** (M). AC: top section "Needs your approval (n)" with request cards; then today's activities by job with assignee and status; then crew daily-doc status (started/submitted). Files: new `src/components/today.tsx`. Overlaps WP-ACT.
2. **Approve/decline requests in one tap** (M). AC: each request card shows the diff (what changes, requested by, photo if any); Approve is 56 px green, Decline asks for a short reason (presets + free text); requester is notified. Files: `today.tsx`, activity server fns. **Overlaps WP-ACT; build there.**
3. **Create activity fast** (S). AC: a 4-field sheet (title, job, assignees, date) with sane defaults (today, current job); "Repeat tomorrow". Files: activity components. Overlaps WP-ACT.
4. **Crew daily-doc nudges** (S). AC: by 9 am, if a crew member has no photos, the lead sees a flag and can tap "Remind" (SMS). Depends on S6, WP-DOC.
5. **Lead can see the job's RFIs/COs but not contract totals** (S). AC: permission matrix enforces it. Part of S1.
Hide: contract values, Foreman, Crew invites (unless granted).

## Labor
Primary screen: **Today** (phone, gloves, sun, bad signal). Top tasks in order: start daily doc with photos → see my activities → mark in progress/complete → request change/new → submit day with lunch.
1. **Labor Today = a 3-step checklist** (M). AC: the screen shows only (1) "Start your day: add site photos" until done, (2) "My activities" (assigned to me only), (3) "Submit day". No company stats, no money, no dispatch form. Files: `today.tsx`, `desk-app.tsx` routing by role. Overlaps WP-DOC/WP-ACT for the content; this item is the layout.
2. **Big status buttons on an activity** (S). AC: the activity card has one primary button that advances state (Start → Complete) at 56 px full width; undo toast for 5 s; works offline via S5. Overlaps WP-ACT (state machine); this owns the button UX.
3. **Request change / new activity** (S). AC: a sheet with type (change, new), a short note, an optional photo, and voice-to-text via the native keyboard mic; it shows "Pending lead" status until decided. Overlaps WP-ACT.
4. **Camera-first photo capture** (M). AC: `<input capture="environment" multiple>`, client-side downscale to ≤1600 px JPEG, thumbnails show upload progress, retries offline, and each photo is tagged with time and job. **Overlaps WP-DOC; build there.**
5. **Lunch dial** (S). AC: a circle with a draggable dot, snapping to 5 min from 0 to 60, a large numeric readout, and a ±5 stepper for gloves; required before submit. **Owned by WP-DOC.**
6. **Empty and error states** (S). AC: "No activities assigned today; ask your lead" with a call button; failed sync shows a red badge with Retry. Uses S4.
Hide: Desk stats, contract value, Jobs list (except their job's address and a map link), Foreman, Crew, Log.

## Subcontractor
Same as Labor, plus:
1. **Company-scoped view** (S). AC: subs see only activities on jobs they're assigned to, and never internal notes or other subs' names; enforced server side. Part of S1.
2. **Sub identity on the daily doc** (S). AC: the doc shows the sub company name; photos are attributed. In WP-DOC.
3. **Invite by SMS without an account password** (S). AC: magic link via SMS lands on Today; the link is scoped and expires in 7 days. Overlaps WP-LOGIN (already uses magic links).
4. **Language toggle EN/ES on field screens** (M). Why: common on crews. AC: field screens strings come from a dictionary; the toggle is in the avatar menu. Files: new `src/lib/i18n.ts`, field components.
Hide: everything Labor hides, plus Crew list and other companies.

---

## Work packages (parallel-safe)

| WP | Contents | Main files (ownership) | Overlap with in-flight work |
|---|---|---|---|
| **WP-LOGIN** *(in flight)* | Login-only landing, `DEBUG_LOGIN` role buttons, S4 landing-flash fix, Sub #3 | `src/routes/index.tsx`, `login.tsx`, `m.$token.tsx`, `magic.server.ts` | **Already underway; don't duplicate.** Make sure the debug buttons use the S1 role names. |
| **WP-ROLES** | S1 permission matrix, Lead #5, Sub #1, Owner/Admin hide rules | `roles.ts`, new `permissions.ts`, `data.server.ts` guards, `0004_roles.sql` | The in-flight activity work said it would "enforce permissions on the server". **Merge that intent here**, and WP-ACT consumes `can()`. Land first. |
| **WP-ACT** *(in flight)* | Activity entity + state machine (requested → approved → in progress → complete, change requests), Lead #2/#3, Labor #2/#3 logic | new `activities` table/migration, `src/lib/server/activities.server.ts`, `src/components/activities.tsx` | **Already underway.** This plan adds only UX acceptance criteria (56 px buttons, undo, decline reason). |
| **WP-DOC** *(in flight)* | Daily document, photos, first/last edit, lunch dial, Labor #4/#5, Sub #2 | new `daily_docs`, `photos` tables, `src/components/daily-doc.tsx`, `lunch-dial.tsx`, storage | **Already underway.** Add the photo downscale/offline criteria here. |
| **WP-SHELL** | S2 role nav, S7 header, Lead #1 and Labor #1 Today layouts (composes WP-ACT/WP-DOC components by import only) | `desk-app.tsx`, new `today.tsx` | Depends on the WP-ROLES API; uses stub components until WP-ACT/DOC land. |
| **WP-DESIGN** | S3 tokens, S4 primitives (minus landing), Labor #6 | `styles.css`, `ui.tsx` | None. Land early; other WPs adopt it. |
| **WP-OFFLINE** | S5 outbox + service worker | new `outbox.ts`, `scripts/grok-pwa-shared.mjs` | WP-ACT/WP-DOC call `outbox.enqueue()`; agree on the interface first. |
| **WP-NOTIFY** | S6, Owner #2 badge, Lead #4 reminders | new `notify.server.ts`, migration, header bell | Uses the merged `mailer`/`sms` modules. |
| **WP-OWNER** | Owner #1, #3, #5; Admin #1 | `DeskHome`, `JobsView`, new `compliance.tsx` | #3 reads WP-DOC tables (read-only). |
| **WP-DISPATCH** | Admin #3, #4 | `FieldView`, `OrderEditor` only | None. |
| **WP-CREW** | Owner #4 (remove employee, pending invites) | `CrewView`, invite fns | None. |
| **WP-BIDS** | Admin #2 bids & takeoff | new `bids.tsx`, migration | None. |
| **WP-I18N** | Sub #4 | `i18n.ts`, field strings | Do last; it touches strings in WP-ACT/DOC/SHELL. |

**Order:** WP-ROLES and WP-DESIGN first (small surface, everyone depends on them). Then WP-SHELL, WP-OFFLINE, WP-NOTIFY, WP-OWNER, WP-DISPATCH, WP-CREW, and WP-BIDS in parallel alongside the in-flight WP-LOGIN, WP-ACT, and WP-DOC. WP-I18N goes last.

**Migration numbering conflict:** several WPs add migrations. Reserve numbers up front: 0004 roles, 0005 activities, 0006 daily_docs/photos, 0007 notifications, 0008 bids.
