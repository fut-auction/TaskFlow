# TaskFlow

TaskFlow is a private task manager with an AI Copilot. You can create tasks, set priorities and due dates, add labels, notes and checklists, and move or reorder tasks on a Kanban board.

TaskFlow opens immediately in **guest/local mode**, with no sign-in or Firebase setup required. A new workspace starts with zero tasks. The app does not create or restore sample tasks.

Guest tasks and chat are saved in localStorage in this browser only. **They do not sync across devices.** Export backups to keep a separate copy. Firebase cloud accounts are optional and available through Settings; live cross-device storage requires real Firebase configuration and verification.

## Pages

- **Dashboard:** total, To Do, In Progress, completed, and overdue task counts.
- **Board:** Kanban columns with drag and drop, editing, search, and filters.
- **All Tasks:** a searchable list with status and priority filters and sorting.
- **Settings:** account sign-out, JSON import/export, browser migration review, and Clear All Data.

The top-right **AI Assistant** button opens and closes the assistant. The sidebar can be hidden on desktop and opened as a drawer on mobile. The existing dark brown and bronze design is kept.

## Architecture

```text
React + TypeScript + Vite
  +--> Guest workspace: browser localStorage (tasks and chat)
  |      +--> Local Express backend --> OpenRouter (optional AI)
  |
  +--> Optional Firebase sign-in
         +--> Authenticated Express API --> private Firestore data
                                      +--> OpenRouter
```

- The frontend is in `src/`; the backend is in `server/`.
- Guest tasks and recent chat use one versioned `taskflow:guest:v1` localStorage entry. Saves are validated before writing; storage/quota errors keep the previous saved value and show an error. Same-origin tabs refresh on storage events. Separate browsers/devices have independent guest workspaces.
- Existing legacy `taskflow:tasks:v1` data is preserved and can be reviewed/imported explicitly in Settings. No automatic migration, deletion, or upload occurs when signing in or changing modes.
- Guest Clear All Data empties only the current browser's guest tasks and chat after choosing Confirm Delete in the confirmation dialog. Unclaimed legacy data and cloud account data are kept.
- Optional cloud mode uses Firebase Authentication and per-user Firestore documents. Token verification, revision-checked transactions, saved chat, and account isolation remain in place. Cloud APIs still require authentication.
- Task lists are limited to 250 tasks. Guest data is limited to 900 KB of JSON, including up to 150 KB of recent chat. Cloud task JSON is limited to 700 KB, with a 900 KB account total. Failed saves do not replace the last confirmed state.
- The dark brown/bronze theme, safe Markdown, sidebar controls, useful pages, imports/exports, and task actions work in guest mode.

## Install and run

Use Node.js 22 or later, npm, and Git.

```powershell
git clone https://github.com/fut-auction/TaskFlow.git
cd TaskFlow
npm ci
```

For an existing checkout, run `npm ci` from the project root. Guest mode does not need an `.env`. When enabling AI or cloud mode, preserve any existing `.env` and add only the missing settings.

For guest task management, start Vite:

```powershell
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The full interface opens without Firebase or even the backend. Local task editing, navigation, imports/exports, and Clear All Data use browser storage.

For the optional AI Copilot, add a real OpenRouter key to your existing `.env` (or copy `.env.example` if no `.env` exists):

```dotenv
OPENROUTER_API_KEY=your_server_side_openrouter_key
OPENROUTER_MODEL=openai/gpt-4o-mini
PORT=8080
```

Start the backend in a second terminal:

```powershell
npm run dev:server
```

Vite forwards `/api` to port 8080. You can set `TASKFLOW_API_TARGET` in Vite's process environment to use another local backend URL. The API key stays on the server. If the backend/key is unavailable, Copilot shows an error; the task interface continues to work.

Guest AI uses `/api/guest/agent/step` and the browser's current task snapshot. That endpoint is restricted to loopback connections/local hostnames and is disabled when `NODE_ENV=production`. It never reads or writes a cloud user's data. Cloud AI continues to require sign-in.

### Optional cloud sign-in

In Settings, choose **Cloud sign-in (optional)**. You can close the dialog with **Continue as guest**. Signing in switches to a separate cloud workspace; it never uploads or deletes guest tasks automatically. Signing out returns to the guest workspace.

Only for cloud mode, complete the Firebase setup below and add:

```dotenv
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_WEB_API_KEY=your-public-firebase-web-api-key
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_APP_ID=your-firebase-web-app-id
```

These Firebase web values are public app configuration, not service-account credentials. For local development against a real development Firestore project, use `gcloud auth application-default login` with the permissions below. Guest mode does not need Google credentials. Live cloud synchronization is not verified by the local tests.

### Production build locally

```powershell
npm run build
node --env-file-if-exists=.env server/index.mjs
```

Open [http://localhost:8080](http://localhost:8080). Express serves both `dist/` and the API. `npm start` starts the server without loading `.env`; the host must supply its environment variables.

## Optional Firebase and Google Cloud setup

These are setup instructions for review. No cloud resources are created by installing or building this project.

1. Choose a Firebase project for TaskFlow. You can add Firebase to the existing TaskFlow Google Cloud project. A separate TaskFlow Firebase project is also supported; its ID is `FIREBASE_PROJECT_ID`, which may differ from `GCP_PROJECT_ID`. Keep unrelated apps and services, including `leap-coop`, unchanged.
2. In Firebase Console, register a Web app. Copy its `apiKey`, `authDomain`, `projectId`, and `appId` into the matching environment variables above.
3. Open **Authentication > Sign-in method**. Enable **Google** and choose a support email. Enable **Email/Password** for the email sign-in and account creation buttons. Enable the password provider, not only email-link sign-in.
4. In **Authentication > Settings > Authorized domains**, add `localhost`, the TaskFlow Cloud Run hostname, and any custom TaskFlow domain you use. Use the same account/provider on each device.
5. Create the `(default)` Firestore database in **Native mode**, in a suitable region. Do not recreate or replace an existing database.
6. Deny direct browser access to `taskflowUsers`. All access goes through Express. `firestore.rules` shows the required rule. Apply reviewed rules from Firestore Console > Rules > Publish before using the app. For a dedicated TaskFlow database, it can be used as the database rules. For a shared database, merge and audit rules carefully: another broad allow rule could allow this collection. Do not replace rules for unrelated apps.
7. Do not set emulator environment variables on Cloud Run. Production startup rejects them.

For a selected TaskFlow development project, an operator with the required permissions can enable APIs:

```powershell
$firebaseProjectId = "your-taskflow-firebase-project-id"
gcloud services enable firestore.googleapis.com identitytoolkit.googleapis.com --project $firebaseProjectId
```

If the default database does not exist yet, create it through the Firebase Console, or use the following command after choosing a location:

```powershell
gcloud firestore databases create --database="(default)" --location="your-region" --type=firestore-native --project $firebaseProjectId
```

### Required IAM permissions

The **Cloud Run runtime service account** needs these roles in the Firebase project:

- `roles/datastore.user` for Firestore reads and transaction writes.
- `roles/firebaseauth.viewer` for user lookups used by token revocation checks (`firebaseauth.users.get`).

It also needs `roles/secretmanager.secretAccessor` on the TaskFlow OpenRouter secret in the deployment project. Use the existing runtime service account; no downloaded JSON key is required on Cloud Run.

Example bindings for review:

```powershell
$runtimeAccount = "your-taskflow-runtime-service-account-email"
gcloud projects add-iam-policy-binding $firebaseProjectId --member="serviceAccount:$runtimeAccount" --role="roles/datastore.user"
gcloud projects add-iam-policy-binding $firebaseProjectId --member="serviceAccount:$runtimeAccount" --role="roles/firebaseauth.viewer"
```

Give a local developer the same data/auth read permissions in a development project. Keep runtime credentials on the server. The Admin SDK uses IAM and bypasses Firestore rules, so the API's verified-UID checks are required.

The **setup operator** needs permission to enable services (`serviceusage.services.enable`, commonly `roles/serviceusage.serviceUsageAdmin`), create the database (`datastore.databases.create`, included in `roles/datastore.owner`), configure Firebase Authentication (`roles/firebaseauth.admin`), register the Firebase web app, and grant the IAM bindings (`resourcemanager.projects.setIamPolicy`, commonly `roles/resourcemanager.projectIamAdmin`). These are setup privileges, not runtime roles. An existing project administrator can perform setup without granting them to the app.

See the official guides for [Firebase Admin setup](https://firebase.google.com/docs/admin/setup), [Google sign-in](https://firebase.google.com/docs/auth/web/google-signin), [ID token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens), and [Firestore IAM](https://cloud.google.com/firestore/native/docs/security/iam), and [Firebase Authentication roles](https://cloud.google.com/iam/docs/roles-permissions/firebaseauth).

## AI Copilot

1. In guest mode, the browser sends chat and its local task snapshot to `/api/guest/agent/step` on the local backend. Cloud mode sends chat to `/api/agent/step` with the signed-in user's ID token.
2. Guest AI uses the validated browser snapshot. Cloud AI reads only that authenticated user's saved tasks from Firestore.
3. It sends the conversation, task snapshot, and tool definitions to OpenRouter. The default model is `openai/gpt-4o-mini`; choose a tool-capable model with `OPENROUTER_MODEL`.
4. OpenRouter streams text and tool calls through Express using Server-Sent Events.
5. The browser validates tool arguments with Zod, requests approval where needed, and saves accepted changes to localStorage in guest mode or through the authenticated backend in cloud mode. Results go back to the model only after the save succeeds.

Tools support listing/searching, reading, creating, editing, moving/reordering, deleting, bulk updating, and adding notes. Edits include labels, checklists, priorities, and dates. Deletes, bulk updates, and groups of several separate task changes require approval. A request stops after at most six model steps.

Examples:

- "Create a high priority task called Prepare demo due tomorrow."
- "Move Prepare demo to In Progress."
- "Add a checklist to Prepare demo."
- "Show overdue tasks."
- "Summarize my board."

Messages and streaming replies use `react-markdown` and `remark-gfm`. They support bold text, headings, lists, tables, links, and code blocks. HTML is skipped. Text direction is detected for Arabic and English.

Task data and chat are sent to OpenRouter when you use AI. The OpenRouter key stays on the backend. Network/provider failures appear in chat. No AI save is reported as successful before the task API confirms it.

## Import, export, migration, and deletion

In **Settings**:

- **Export tasks** downloads a JSON file with `format: "taskflow"`, `version: 1`, `exportedAt`, and every task field. Credentials and tokens are excluded.
- **Import tasks** validates the version, all task fields, dates, limits, and unique IDs. Merge keeps current tasks and gives matching incoming IDs new IDs. Replace asks for confirmation and changes only the active guest or cloud workspace. Save failures keep the last confirmed state.
- **Review browser migration** reads the old `taskflow:tasks:v1` data only when you click it. Review the titles before importing: old data may contain sample tasks. The browser copy is kept. Successful migration records which account claimed that legacy copy; it never uploads it automatically.
- **Guest Clear All Data** uses a Cancel/Confirm Delete dialog and clears only guest tasks/chat in this browser. It keeps cloud workspaces and unclaimed legacy data.
- **Cloud Clear All Data** uses a Cancel/Confirm Delete dialog. The backend still checks authentication and the existing confirmation request field sent by the app. It atomically empties only that account's task document, retaining the revision counter to prevent stale writes. The account is kept. Saved cloud chat and current chat are cleared in the same transaction. Other open devices reset their chat on the next task sync. Old browser task/chat keys are cleared only if migration previously associated them with this account; unclaimed legacy data is preserved because its owner is unknown.

Data controls are disabled while Copilot changes are in progress. If another device changes data during a clear/import, the revision check rejects the stale operation. Refresh, review, and retry. Firestore deletion is atomic; a network failure may leave the outcome uncertain, so the app tries to reload the saved state without silently retrying the deletion.

## CI/CD and Cloud Run

`.github/workflows/ci.yml` runs for pushes to `main` and `feature/**`, and pull requests to `main`. It installs dependencies, runs ESLint and Vitest, builds the frontend, and runs Playwright with Chromium against an isolated local test server.

`.github/workflows/deploy.yml` is manual (`workflow_dispatch`) and uses the `production` environment. It runs lint, unit tests, and build, authenticates with GitHub OIDC/Workload Identity Federation, builds Docker on the GitHub runner, pushes a commit-tagged image to Artifact Registry, deploys service `taskflow`, and checks `/healthz`. It does not deploy on every push.

Required GitHub Actions variables:

| Variable                         | Purpose                                       |
| -------------------------------- | --------------------------------------------- |
| `GCP_PROJECT_ID`                 | Cloud Run and Artifact Registry project       |
| `GCP_REGION`                     | Deployment region                             |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full Workload Identity provider resource name |
| `GCP_DEPLOY_SERVICE_ACCOUNT`     | GitHub deployer service account email         |
| `GCP_RUNTIME_SERVICE_ACCOUNT`    | TaskFlow runtime service account email        |
| `FIREBASE_PROJECT_ID`            | Firebase Authentication and Firestore project |
| `FIREBASE_WEB_API_KEY`           | Public Firebase web API key                   |
| `FIREBASE_AUTH_DOMAIN`           | Firebase auth domain                          |
| `FIREBASE_APP_ID`                | Firebase web app ID                           |

Use an Artifact Registry Docker repository named `taskflow`. The workflow injects `OPENROUTER_API_KEY` from Secret Manager secret `taskflow-openrouter-key`, version `1`. The deploy identity needs Artifact Registry write access, Cloud Run deployment permissions, permission to use the runtime service account, and permission to configure public invocation. The runtime needs the data/auth/secret permissions listed above.

The Dockerfile uses Node.js 22, builds `dist/` in a separate stage, and runs Express as a non-root user. Cloud Run's `PORT` is used, with 8080 as the default.

### Google Cloud Build alternative

There is no `cloudbuild.yaml`. The GitHub workflow builds with Docker on its runner. For a separate manual source deployment, `gcloud run deploy --source .` uses Cloud Build and this Dockerfile.

Prepare the runtime Firebase variables in an environment file outside Git, use your chosen project/region/runtime account, and review the command before running it:

```powershell
gcloud run deploy taskflow --source . --project "your-deployment-project" --region "your-region" --allow-unauthenticated --service-account "your-runtime-account-email" --set-secrets OPENROUTER_API_KEY=taskflow-openrouter-key:1 --env-vars-file "path-to-taskflow-runtime-env.yaml"
```

That YAML file must contain the Firebase variables above and `OPENROUTER_MODEL`. Do not put the OpenRouter key in the file. Source deployment also requires Cloud Build and source-build IAM permissions. This path is separate from GitHub Actions.

Health endpoints:

- `GET /healthz`: the server is running.
- `GET /api/health`: whether an OpenRouter key is set; it does not test the key.
- `GET /api/config`: optional public Firebase configuration; returns `firebase: null` and `mode: "guest"` when Firebase is unavailable.

A green health check alone does not verify Firebase access or a real AI request.

## Tests and local review

```powershell
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest checks task actions, import validation, configuration safeguards, and the real Express data router with isolated test identities/storage. Playwright retains the cloud regression suite with test-only storage/sign-in/AI responses. A separate guest suite opens the real Vite app at localhost:5173 against a real backend with all Firebase settings disabled. Guest AI responses are mocked for action/Markdown tests, and its missing-key error is checked against the real backend. The suites test empty state, task editing, reload persistence, two browser contexts for one account, another user's isolation, Markdown safety, navigation, sidebar, imports/exports, replacement confirmation, confirmed deletion, and mobile width. Guest tests also cover local saves across reload, local import/export, confirmed deletion with legacy-data preservation, and local Copilot chat. These tests do not prove live Google sign-in, Firestore access, or real OpenRouter output.

### Optional real Firebase emulator integration test

Install Java 21+ and the Firebase CLI before running emulators. No cloud project or production credentials are needed. Use the reserved `demo-taskflow` project:

```powershell
$env:FIREBASE_PROJECT_ID = "demo-taskflow"
$env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8085"
npx firebase-tools emulators:exec --only auth,firestore --project demo-taskflow "npm run test:cloud"
```

The integration script refuses to run unless both emulator hosts are localhost and the project starts with `demo-`. It creates emulator accounts, verifies real emulator tokens through the Admin SDK, writes and reads Firestore, checks isolation and concurrent-write conflicts, and clears only its test data. This test needs the Firebase CLI and Java; it is separate from `npm test`.

To review the UI against emulators, run `npx firebase-tools emulators:start --only auth,firestore --project demo-taskflow` in another terminal. Set the same three emulator variables for the backend, plus `FIREBASE_WEB_API_KEY=test-key`, `FIREBASE_AUTH_DOMAIN=localhost`, and `FIREBASE_APP_ID=test-app`. Then run the backend and Vite and create an email/password account. Emulator data is disposable. Never use these settings for a real project or production.

For live verification in a development Firebase project:

1. Sign in and confirm the task list starts empty.
2. Create a task with labels, notes, a checklist, and a due date; edit and reorder it.
3. Refresh and sign in to the same account in a second browser or phone. Confirm saved tasks appear there.
4. Sign in to another account and check that its tasks are separate.
5. Use Copilot to create and edit a task, and review a delete approval.
6. Export, merge/import, and confirm replacement with a backup.
7. Test Clear All Data only with disposable development-account tasks.

Live Firestore, Google sign-in, OpenRouter, GitHub Actions, and Cloud Run deployment must be verified in the configured environment before claiming production readiness.

## Project links

- [GitHub repository](https://github.com/fut-auction/TaskFlow)
- [GitHub Actions](https://github.com/fut-auction/TaskFlow/actions)
- Live website: **TODO: add the Cloud Run service URL**
