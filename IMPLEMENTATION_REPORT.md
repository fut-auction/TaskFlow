# TaskFlow guest-mode correction

## What changed for this fix

TaskFlow now opens its main interface immediately in guest/local mode at localhost:5173. Firebase configuration, a backend connection, and sign-in are not required for local task management. A new guest workspace contains zero tasks; no sample generation was added.

Firebase Authentication and Firestore remain available as an optional separate workspace. Settings contains Cloud sign-in (optional), with Continue as guest to close the dialog. Signing in never automatically uploads, replaces, or deletes guest data. Signing out returns to the saved guest workspace. The protected cloud task/chat APIs still require authentication.

Guest tasks and recent Copilot chat use a single versioned localStorage entry, taskflow:guest:v1. Task operations, notes, labels, checklists, moves/reordering, imports, exports, and confirmed Clear All Data use this local store. Saves validate data and revisions, coordinate browser tabs with Web Locks when available, and retain the old saved value on failed writes. Storage events/focus refresh the current guest workspace. A deletion epoch prevents stale saved chat from restoring cleared content.

Guest Clear All Data uses a Cancel/Confirm Delete dialog, without a text input. It clears only guest tasks and chat in this browser. It does not clear cloud accounts, unrelated localStorage entries, or unclaimed legacy task data. The original taskflow:tasks:v1 data is preserved; the existing explicit migration review remains available.

AI Markdown rendering, Arabic/English support, approvals, useful navigation, the collapsible sidebar, Import/Export, and the dark brown/bronze theme are preserved. Settings messages, empty states, save notices, and deletion confirmations now describe the active local or cloud workspace correctly.

Guest Copilot uses a separate /api/guest/agent/step endpoint with the current local task snapshot. Accepted task actions save locally. The endpoint never reads or writes a cloud user's data, is limited to local development connections/hostnames, and is disabled in production. It still requires a backend OpenRouter key for actual AI responses. Missing AI configuration shows a chat error without blocking the app. Keys remain server-side.

## Files changed for this correction

- src/auth.tsx: main workspace renders immediately; sign-in is an optional dialog opened from Settings.
- src/auth-client.ts: explicit guest requests do not require Firebase tokens; absent cloud config produces an optional sign-in message.
- src/session.ts (new): guest identity and local storage key.
- src/local-store.ts (new): validated local task/chat persistence, revisions, clear, and cross-tab locking.
- src/store.ts: selects guest storage or the existing authenticated cloud API and listens for local storage changes.
- src/App.tsx: optional sign-in access, guest workspace notices, and correct local/cloud wording.
- src/components/Settings.tsx: guest-mode data controls and account actions.
- src/components/Copilot.tsx: local guest chat loading/saving while retaining cloud chat.
- src/agent/client.ts: routes guest AI requests separately and sends the local snapshot only for guest AI.
- src/styles.css: bronze guest-mode notice.
- server/index.mjs: returns guest config when Firebase is missing and shares the AI stream handler between separate guest/cloud routes.
- server/guest.mjs (new): validates local guest snapshots and restricts the guest AI endpoint.
- server/schema.mjs, server/schema.d.mts: allow safe chat validation in browser code with TextEncoder and typed declarations.
- vite.config.ts: supports TASKFLOW_API_TARGET for a separate local test backend; default backend stays localhost:8080.
- playwright.config.ts: retains cloud regressions and adds real localhost:5173 guest testing with a no-Firebase backend. An existing Vite instance is reused without stopping it.
- tests/taskflow.spec.ts: opens optional sign-in through Settings, including mobile drawer navigation.
- tests/guest.spec.ts (new): real local opening, no-backend behavior, persistence, data controls, guest AI/Markdown, and separate-browser isolation.
- tests/support/guest-server.mjs (new): runs the actual Express backend without Firebase settings or real provider credentials for tests.
- src/local-store.test.ts (new), server/guest.test.mjs (new): storage preservation, stale writes, clear behavior, and guest AI access restrictions.
- .env.example: marks Firebase settings as optional.
- README.md: guest-first setup, local-only storage limits, optional cloud sign-in, guest AI requirements, and updated test descriptions.
- IMPLEMENTATION_REPORT.md: this correction report, replacing the earlier report that described mandatory sign-in.

No packages were installed for this correction. Existing Firebase packages, cloud code, rules, deployment workflow, and tests remain in place.

## Verification

- TypeScript and production build (`npm run build`): passed.
- ESLint (`npm run lint`): passed, no errors or warnings.
- Vitest (`npm test`): 30 tests passed in 6 files.
- Playwright (`npm run test:e2e`): 14 tests passed, including 8 cloud regressions and 6 guest tests.
- `git diff --check`: passed.
- Guest desktop screenshot: reviewed at `test-results/guest-local-review.png`.

The build still reports the existing large-bundle/dependency-annotation warnings; they do not fail the build.

The guest E2E suite uses the real Vite interface at localhost:5173 and a real Express backend with Firebase environment variables removed and the OpenRouter key blank. It confirms that cloud configuration is null, the workspace opens empty, task creation/editing survives reload, and local data controls work. It also verifies that task management works when the config/backend request is unavailable. Guest Copilot action/Markdown tests mock AI output to avoid external calls. Existing cloud regressions continue to use isolated test identities and storage.

The no-Firebase backend is separate from any existing user backend. Tests use fresh browser contexts and never edit the user's actual browser workspace or production data.

## Local use and limits

```powershell
npm run dev
```

Open http://localhost:5173. The interface works immediately in guest mode. No Firebase setup is needed.

For actual AI responses, set OPENROUTER_API_KEY in the existing .env and start the backend in another terminal:

```powershell
npm run dev:server
```

Guest tasks and chat stay only in the current browser profile and site origin. They do not sync across devices or separate browsers. Clearing site data removes the guest copy; use Export tasks for backups. Changing from localhost to 127.0.0.1, or changing ports, uses a different browser origin and therefore a different guest store.

Live cross-device persistence remains an optional Firebase feature that requires real configuration and verification. It has not been claimed as working in guest mode. No live Firebase or OpenRouter request was needed for these tests.

No existing user data was automatically deleted or migrated. The existing .env was not changed. During local implementation, no commit, push, deployment, cloud resource change, or change to leap-coop was performed. Publishing is handled separately after release checks.

## Final interface cleanup

The sidebar contains Dashboard, Board, All Tasks, and Settings. The AI Assistant is opened and closed from the top-right header; the duplicate mobile shortcut and decorative TF avatar have been removed. Clear All Data uses the requested simple confirmation and displays deletion errors inside the dialog. Backend authorization remains unchanged.

## Publishing review: stopped before commit/push

The release review verified origin https://github.com/fut-auction/TaskFlow.git and local branch main. Fetching origin/main succeeded; local HEAD and origin/main matched before publishing.

Release checks passed: lint, 30 unit/API tests, 14 Playwright tests, production build, secret-pattern scanning of all 57 candidate files, and comparison against locally configured secret values. Actual .env files and generated assets are ignored; only the blank .env.example template is a candidate.

An isolated NODE_ENV=production run without Firebase passed startup, empty guest workspace, task creation/reload persistence, the four navigation items, header-only Assistant access, removed TF avatar, mobile layout, Settings, Cancel/Confirm Delete, and no demo restoration. All test mutations were confined to fresh local browser contexts and a temporary local server.

The production guest AI readiness check failed with HTTP 403: Guest AI is available only on the local development server. Cloud AI requires sign-in. server/guest.mjs rejects production before the OpenRouter key is checked. Therefore, with Firebase absent, the production task interface works but AI is unavailable. No production security policy was changed to bypass this restriction.

Per the publishing instruction to stop if any check fails, no commit or push was performed. No Cloud Build deployment was triggered or verified, and no Google Cloud service or production data was changed. The Google Cloud CLI was unavailable, so the external Cloud Build trigger and current Cloud Run deployment could not be inspected. The existing pipeline and service configuration were left alone.

The final review removed the remaining floating mobile Assistant shortcut and its unused selectors to satisfy the explicit header-only requirement, and added a mobile assertion. Those edits and all earlier improvements remain local for review.

## Production guest AI fix (not committed or deployed)

The earlier release blocker is addressed in code by explicit `GUEST_AI_ENABLED=true` production opt-in and configured public origins, without Firebase or login. The shared provider stream handler is in server/agent.mjs. Cloud-account routes still use their existing authentication middleware. Guest snapshots and messages are validated and bounded; client overrides of model/provider options are rejected.

New safeguards include per-client and per-instance fixed-window admissions, minute/hour/day instance budgets, bounded concurrency, a backend-controlled output token cap, a 128 KB raw body limit, an input JSON cap, a stream byte cap, timeout/disconnect cancellation, and no automatic backend retries. Counters are memory-only per instance, reset on restart, and are not global Cloud Run budgets. A dedicated OpenRouter key spending cap remains required for shared/provider-level budget control. README.md and .env.example document the exact variables and limitations.

The production API suite uses the real route middleware and stream handler with a simulated provider. The production browser fixture runs the actual NODE_ENV=production server with no Firebase and a test-only provider module excluded from Docker builds. It exercises task tools and approvals without real API charges. No UI, localStorage workflow, or theme changes were made for this fix. No commit, push, deployment, or cloud setting change was performed.

### Verification of the production guest AI fix

- ESLint: passed with no errors or warnings.
- TypeScript and production build: passed (existing bundle-size/dependency annotation warnings remain).
- Unit/API suite: 45 tests passed across 6 files, including 18 production guest access/safeguard cases.
- Full Playwright suite: 15 tests passed, including the actual production-mode server with no Firebase and simulated OpenRouter create/edit/move/delete responses plus decline/confirm approvals.
- Formatting and Git whitespace checks: passed.

Provider responses were simulated; live OpenRouter billing/credentials and the deployed Cloud Run service were not tested or changed. For a future deployment, set GUEST_AI_ENABLED=true and the actual HTTPS PUBLIC_APP_URL on taskflow, keep OPENROUTER_API_KEY in the backend Secret Manager binding, and configure a dedicated OpenRouter key credit/spending cap with the desired reset period. Proxy hop trust remains zero unless the deployment's forwarding chain is explicitly verified. Full limits and tuning variables are listed in README.md. No packages were added. No commit, push, or deployment was performed.
