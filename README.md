# RCL Design-Build

A design-build and field-service desk: jobs, sheets, RFIs, change orders, daily logs, and dispatched work orders.

People sign in with a single-use magic link sent by email or text, or with email and password, Google, or X. Each link belongs to one account.

Text messages use Twilio. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM` (an E.164 number such as `+18595550100`, or a Messaging Service SID `MG...`). See `.env.example`. Sign-in links and dispatch updates (a person's location, their instruction, or an instruction on the location they're on) are the texts the desk sends. With those variables unset, the desk still saves the change and records the text as skipped. The demo company never sends a real text.

Foreman is the in-app assistant. When someone asks it to change the product (a phase, a status, a tagline), it stages a patch to `src/product/copy.ts` or `src/product/workflows.ts` and texts and emails every admin a staging link. The live desk does not change until an admin approves that build.
