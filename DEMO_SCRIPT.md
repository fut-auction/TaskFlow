# 3-minute reviewer demo — TaskFlow

**0:00–0:30 | The product**
Open the public Cloud Run link on desktop. Show summary metrics, three Kanban columns, filters and list view. Resize to mobile. Explain that all task data is local browser storage by design.

**0:30–1:10 | Real task edits**
Create `Prepare stakeholder demo`, with `High` priority, tomorrow's date, two tags, and checklist steps. Drag it between columns and switch to List view. Reload; the task persists.

**1:10–2:10 | The AI differentiator**
Open Copilot. Ask: `Move all overdue tasks into In Progress and add the urgent label without removing other labels.` Inspect approval dialog, confirm and show immediate board changes. Show the actions log, then ask `Summarize my board and tell me what needs attention first.`

**2:10–2:35 | Safety**
Ask the AI to delete a task. Show confirmation and choose **Cancel**; prove that the task remains. Point to the prompt-injection warning and protected API key architecture.

**2:35–3:00 | Engineering quality**
Open the GitHub repository; show CI runs, tests, branch/PR history and deploy workflow. Show Cloud Run live URL and `/healthz`. Mention Secret Manager and non-root Docker container.

## Questions to prepare for

- **Why browser storage instead of database?** The project brief forbids server-side persistence and login. It also keeps the demo self-contained.
- **What makes it an agent?** Real function calls, validated client-side tool execution, iterative tool-result feedback, and visible side effects.
- **How is the key protected?** It exists only on the Cloud Run runtime via Secret Manager; the frontend calls the server, never OpenRouter directly.
- **What prevents dangerous edits?** Zod input validation, explicit review before deletion/bulk edits, no execution of task text as instructions, and clear error messages.
- **What would you improve next?** Auth, a database for sync, server-side rate limits, stronger eval suite, audit persistence, and observability.
