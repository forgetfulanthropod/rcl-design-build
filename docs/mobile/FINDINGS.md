# Mobile audit: employee (field role) views

Headless Chrome at 375x812 and 414x896 (mobile emulation, touch), signed in as a field employee invited by an admin. The audit lives in `e2e/mobile.spec.ts` and writes screenshots plus an `*-audit.json` file covering horizontal overflow, targets under 44 px, text under 13 px, and inputs under 16 px.

## Fixed in this branch (CSS/markup only)
1. **iOS focus zoom:** `.field` inputs, selects, and textareas were under 16 px on phones, so Safari zoomed the page on focus. `.field` is now 16 px below 768 px (`src/styles.css`).
2. **Small tap targets on the Jobs page:**
   - Phase pills went from 36 to 44 px, and the RFI and change-order status selects from 36 to 44 px. Both are back to 36 px from `md` up.
   - Milestone checkboxes went from 13 to 20 px, inside a label with a 44 px minimum height.
3. **Sign out:** the target went from 38x40 to at least 44 px high (`src/lib/auth/gates.tsx`).
4. **Work-order editor off screen:** tapping a work-order card on a phone updated an editor below the fold, so it looked like nothing happened. The editor now scrolls into view.
5. **Missing labels:**
   - The daily-log crew-count input had no label or placeholder; it now says "Crew on site".
   - The call-notes textarea and the assignee select in the order editor now have labels.

After the fixes, no view has horizontal page overflow, and every interactive element is at least 44 px. The checkboxes are 20 px, but the label around each one is a 44 px target.

## Recommendations (not changed; larger or product decisions)
1. **Field page order:** the Dispatch form comes first, so a tech has to scroll past seven inputs to reach their own calls. Put the board, or "My calls", first on mobile and hide Dispatch behind a button. Consider hiding it for the field role.
2. **No "assigned to me" view:** techs see the whole company board. Add a filter, defaulting to mine for the field role.
3. **Board scrolls sideways:** the Kanban board is a 256 px-per-column horizontal scroller, and only about 1.3 columns fit. On phones, use a status filter or a stacked list.
4. **Landing page flash:** right after a magic-link sign-in, the marketing landing page renders while the session loads (`docs/mobile/375x812-02-loading-flash.png`). Show a neutral loading state instead.
5. **Bottom nav:** six 12 px labels, about 62 px each. That's readable but tight. Consider five tabs plus "More", or 13 px labels.
6. **Header tagline:** it truncates at 375 px. Hide it on mobile.
7. **Role permissions (security/product):** the field role sees contract values and can create jobs, change orders, phases, and dispatches. On the server, only archive (admin/pm), invite (admin), and code approval (admin) check the role.
8. **Pending invites:** an invitee doesn't appear under Crew → People until they open the link, and there's no pending list.
9. **No auto-select:** a newly saved job or dispatched work order isn't selected automatically.
