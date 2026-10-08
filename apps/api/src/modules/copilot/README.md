# MIA / Fevex

## Boundaries

- `copilot-agents.ts`: agent catalog, prompts, input schemas and semantic output validation.
- `billing-copilot.service.ts`: configured models, local product lookup and per-request Fevex runtime.
- `copilot-sessions.service.ts`: native Fevex session snapshots in Redis, scoped by authenticated user, organization, agent, product and conversation ID; atomic commits and a 150-second run lock.
- `billing-copilot.controller.ts`: authenticated SSE transport. Only public lifecycle events, text deltas and validated output reach the browser.
- `copilot-rate-limit.guard.ts`: Redis-backed limit of 10 runs/minute per authenticated user and organization, shared across API instances. Redis errors fail closed.

`GET /billing/console/copilot/agents` and `/models` describe the available configuration. `POST /billing/console/copilot/runs/stream` accepts an allowlisted agent and model. All endpoints require the console session and `billing.catalog.manage` permission.

Runs are bounded to 120 seconds, two model steps and 6,000 output tokens. The SSE adapter handles backpressure, disconnect cancellation, keepalive comments, missing terminal events and cleanup. Provider errors and request context are not forwarded or logged. Each run has its own in-memory Fevex store; no singleton store accumulates conversations across users.

## Current rollout

`product-draft` and `plan-draft` are enabled, including authorized messages, conversation history and editable proposals. Plan context excludes provider mappings and identifiers; the selected product is verified locally and scopes its conversation. Only its name, code, description and status are supplied to the plan agent, freshly loaded on each run. Product identifiers, provider mappings and unrelated catalog data are excluded from provider payloads. Explicit requests for random/example plans permit fictional commercial values, labeled as such by the agent; ordinary requests still require missing commercial inputs.

Forms open the appropriate agent. The frontend keeps one `sessionId` per conversation and sends it with each instruction, like the Fevex Playground. The backend restores the native `Session` into a request-local Fevex run store and passes `sessionId` to `streamAgent`. Only a successful, validated, non-cancelled completion commits the updated session to Redis. Native history includes the previous user input and full structured assistant proposal, even if not applied to the form. The browser cannot supply arbitrary assistant/system history or retrieve another owner's session by its ID.

There is no six-message limit: all successful exchanges remain until the session expires after 60 minutes without a successful update. New runs stop once stored context exceeds 200 KiB; commits are capped at 256 KiB. This is an application byte limit, not a provider token-window guarantee. No automatic truncation or summarization occurs. Expired/full sessions produce an explicit message asking for a new conversation. The reset action deletes the scoped Redis session and writer lock, then changes the session ID and clears the chat while preserving form edits. Successful product/plan creation also requests deletion. DELETE /billing/console/copilot/sessions is authenticated, idempotent and scoped using the server principal; it does not change rate-limit keys. Failed reset deletion keeps the conversation for retry. Cleanup failure after catalog save does not turn that successful save into an error. Failed/cancelled runs do not change stored history. Redis failures fail the run instead of silently losing context.

Conversation IDs are stored in browser sessionStorage, scoped by user, organization and task; messages and credentials are not stored there. Reopening MIA after a page reload retrieves completed messages and proposals through authenticated GET /billing/console/copilot/sessions with Cache-Control: no-store. The backend derives ownership from the authenticated principal and returns only display messages and validated proposals, not raw form snapshots. Expired sessions clear the browser pointer and show a notice. Recovery failures offer retry and block sending until recovery succeeds. New conversation and successful catalog save remove the browser pointer after cleanup. Form edits are not restored or auto-applied.

The TTL remains 60 minutes from the last successful agent response; reading history does not extend it. Unfinished or failed turns are not part of the restored history. Existing Redis keys retain their prior TTL until updated or deleted.

Agents only propose data. Saving remains an explicit action through the existing catalog forms and API. Plan prices use decimal strings, versions start as drafts, and provider mappings stay in local form state.

Agent instructions restrict conversations to their own fields and redirect unrelated requests. No tools are registered. Strict output schemas reject extra fields and cross-agent proposals. These are structural boundaries, not a semantic guarantee: free-text messages and descriptions still come from the model, and text deltas reach the browser before final validation. The local tests verify contracts and transport, not real-provider adherence to the instructions.

## Checks

From `apps/api`:

```sh
bun run test --runInBand copilot
bun test test/copilot/copilot-fevex.test.mjs
bun run build
```

From `apps/web`:

```sh
bun test test/copilot
bunx tsc --noEmit --incremental false
bun run build
```

The Fevex runtime test uses the installed package with a local model stub. It checks schema transport, incremental events and restoration across ten exchanges without contacting a provider. Storage tests check isolation, concurrent runs, stale writers and the size limit. Do not expose the Playground's demo-owner run endpoints in Billing.
