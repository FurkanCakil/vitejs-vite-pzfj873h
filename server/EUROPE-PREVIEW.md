# Isolated Frankfurt Preview

The user explicitly approved cutover on 1 November 2026. The Preview preparation
below is historical; the authorized Production configuration is described at the
end of this file. The old Firebase project must still remain untouched.

The new Spark project is `oyun-portali-avrupa`, default Firestore database in
`europe-west3`. The branch's `vercel.json` selects `fra1`; Production keeps its
existing `iad1` deployment. Firebase client settings already come from Vite
environment variables, and server credentials from the existing `GCP_*` variables.
The 31 Europe variables are scoped to Preview branch `codex/europe-preview` only.

`server/firebase.js` additionally requires `GAME_PREVIEW_ENABLED=true`, the exact
branch, `GAME_PREVIEW_PROJECT_ID=oyun-portali-avrupa`, and matching server/client
project IDs. Other Preview builds remain disabled. Neither Preview path accepts
the old Firebase project. Browser API origins are the deployment and branch URLs.

Keyless federation is recorded in `gcp-europe-access-plan.json`. Google IAM admits
only this Vercel project's Preview subject. Vercel OIDC has no documented branch
claim; branch isolation is enforced by branch-scoped variables and application
guards, not an invented Google IAM claim. The service account has only the
default database's document role. Production federation is not granted yet.

Production rules were compared to `firestore.rollout.rules` and copied unchanged.
Both databases have no manual indexes and the three `firestore.indexes.json`
exemptions; automatic collection/group defaults match. Firebase settings are
separate from Vercel deployments. Anonymous sign-in is enabled without automatic
account cleanup. Source authorized domains and the Europe Preview branch domain
are configured; no Analytics, Hosting, billing or payment account was enabled.

## Acceptance and latency

The preferred test entry is the Preview URL with `?europeQa=1`. It runs the probes
using the already authenticated browser's Vercel cookies, without a bypass secret
or extra account login. This entry is compiled only when the deployment is Preview,
the exact Europe branch and the new GCP project; a normal Production build excludes
the QA component and probes. The app's ordinary route and game UI are unchanged.

The browser probes use four independent, in-memory Firebase SDK anonymous accounts
and the same REST action/read sequence. Browser fetch HTTP timings are identified
as such; the recorded production reference used Node fetch. This transport and the
different measurement times limit causal interpretation of the comparison.

Optional CLI execution keeps Firebase web settings and the branch URL in ignored
`.env.europe.local`. It can use the existing Vercel Trusted Sources rule with an
official, short-lived CLI OIDC token in ignored `.europe-preview-oidc.local`. Do not
create a public protection exception, long-lived bypass secret, or service-account key.

`node scripts/verify-europe-preview.mjs --verify-europe-preview` creates only new
private Europe rooms. Four normal SDK anonymous accounts verify all seven games,
real moves, identical-request receipts, SDK snapshot reconnection, and private
Okey/Battleship reads. Expected privacy denials are reported separately. No Admin
SDK, state seeding, existing rooms or old project writes are allowed.

`node scripts/measure-game-api.mjs --europe-preview-private-baseline --isolated-layout`
uses the same 60 XOX moves, 36 Okey draws and 38 discards as the recorded production
scenario. Output is `performance-europe-preview.local`. The old project must stay
untouched, so comparison uses the existing 31 October production sample at
`0f982fe`, rather than opening new production rooms. This is a different-time
comparison, not a concurrent A/B experiment. OIDC protection overhead applies to
Preview requests. Snapshot/render are not included in the REST timing table.

These scripts do normal room-leave cleanup; no production data is migrated or
deleted. Fresh Europe anonymous UIDs cannot resume old rooms or their scores.
Nickname, displayed device ID and volume survive a same-origin cutover, but a
Preview origin has separate storage. Old Auth persistence remains available for
rollback because no old project accounts/settings are changed.

The final measurement, cutover proposal and rollback decisions belong in the
existing Notion project record. Cutover remains a separate approval gate.

The browser acceptance and bounded measurement were verified against `3dc5ff4`
in Ready Preview `E3ZUvVCCCZ6xyPBLtPL5Me7BqXpG` on 1 November 2026 (Turkey time).
All seven games passed; the normal room-leave cleanup completed. The measurement
reported `fra1` on every measured response. Anonymous output stays in ignored
`.local` artifacts; the result table is in the Notion project record.

Do not promote the Preview artifact directly to Production. It contains the
Preview-only QA entry, Preview origins and Preview IAM settings. After cutover
approval, authorize a Production identity only in the new Firebase project,
set the new Production variables and perform a fresh Production build (QA entry
excluded). The retained old Production deployment and original variables are the
rollback target; a rollback must also restore `iad1` with the old database.

## Authorized Production cutover

Production uses its own keyless service account `oyun-portali-production` in the
new project, with the default-DB-only document role. The `vercel-production`
provider in the Europe pool accepts only the exact Vercel project + Production
environment/subject. Preview cannot impersonate this account. No private key is
created. `gcp-europe-production-access-plan.json` records the non-secret access
configuration.

The original six public `VITE_FIREBASE_*` values are legacy immutable Vercel
Secret entries shared with general Preview. Vercel rejects edits to public-prefix
Secret entries and does not permit changing their type. They are preserved for
rollback, without deletion or changes to other branches. Production instead sets
six public `EUROPE_FIREBASE_*` Config values and
`FIREBASE_CLIENT_TARGET=oyun-portali-avrupa`. `europeClientOverrides` requires the
new client/server project IDs to match, then Vite compiles these values into the
normal client configuration. The server session lookup uses the same selected
API key. Incomplete/mismatched configuration stops the build. No admin credential
is included in the client. The five `GCP_*` Production values select the new
Production service account/provider. Game flags remain enabled as before.

Build a fresh Production artifact on main with `fra1`; do not promote Preview.
The QA UI is excluded from Production. Live validation uses the explicit bounded
Node commands `node scripts/verify-europe-production.mjs --verify-europe-production`
and `node scripts/verify-europe-production.mjs --measure-europe-production`.
These are pinned to the new project and canonical live origin; only new private
test rooms are created. Reports are ignored `.local` files. All seven games,
replay, real SDK reconnect and Okey privacy/draw/discard are checked. The bounded
latency scenario is unchanged; report Node transport accurately.

Rollback: route the custom domains back to Ready `0f982fe` / deployment
`8ByUXWdzPQksitcYQBq7jf5it169`, restore the five original `GCP_*` values from the
ignored `production-env-rollback.local`, clear `FIREBASE_CLIENT_TARGET`, and restore
`iad1` in source (revert the transition commits without rewriting main history).
Original client values remain intact. Retain both Firebase projects. New Europe
rooms/scores are not automatically copied back. Old open tabs/deployment URLs may
still access the preserved old project; the no-old-write verification concerns
the newly built Production and its test requests, not all historical clients.
