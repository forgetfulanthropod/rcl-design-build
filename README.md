# RCL Design-Build

A design-build and field-service desk: jobs, sheets, RFIs, change orders, daily logs, and dispatched work orders.

People sign in with a single-use magic link sent by email or text, or with email and password, Google, or X. Each link belongs to one account.

Foreman is the in-app assistant. When someone asks it to change the product (a phase, a status, a tagline), it stages a patch to `src/product/copy.ts` or `src/product/workflows.ts` and texts and emails every admin a staging link. The live desk does not change until an admin approves that build.
