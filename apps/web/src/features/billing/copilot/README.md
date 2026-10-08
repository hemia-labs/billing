# MIA (optional assistant)

This folder owns the chat, responsive drawer, state, API/SSE client, conversation routing, launcher and scoped animation. The chat (including Markdown rendering) is dynamically imported when opened. No model or agent requests run while it is closed.

## Integration boundary

Only `index.ts` is imported by other features:

- `AppWorkspace` wraps its content in `CopilotWorkspace`. All drawer state and authenticated user/organization resets belong here.
- Product and plan creation screens use the draft hooks and supply `CopilotLauncher` through the forms' optional `renderAssistAction` slot.
- Catalog forms know only their own editable data and the optional action slot. They have no copilot imports, strings, icons or network calls. `PlanFormDraft` belongs to the catalog form; MIA consumes that type.

Removing the workspace wrapper and the two creation-screen integrations leaves ordinary catalog forms working. Shared auth, UI primitives, branding fonts and the HTTP helper remain app dependencies; they are not copied here.

The backend is contained in `apps/api/src/modules/copilot`. Module registration, environment validation and package dependencies remain at the application's normal composition boundaries.

Tests are grouped under `apps/web/test/copilot` and `apps/api/test/copilot`. Run `bun test test/copilot` from the web app. See the backend module README for its test commands and session persistence details.
