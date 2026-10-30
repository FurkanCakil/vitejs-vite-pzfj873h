# Okey / XOX performance measurements

This stage adds observation only. Region, transaction boundaries, game rules,
heartbeat intervals, matching, optimistic updates and board sizes are unchanged.

## Controls

- Server: `GAME_PERF_ENABLED=true` permits timing headers on authenticated Okey /
  XOX requests carrying `X-Game-Perf: 1`. Missing/false disables the server layer.
  Vercel environment changes take effect on the next deployment.
- Browser: open `/?gamePerf=1`, then use the small Performance details panel.
  Ordinary URLs do not enable collection or show the panel. The stop button is
  immediate for that tab. A session expires after ten minutes; reload or re-enable
  to start another session.
- At most 256 retained samples, 32 pending commands, eight transient room keys
  and 64 observations per stream/room. Data is in memory; refresh clears it.
- The panel refreshes only on demand, without periodic report renders. Copy its
  readonly JSON or use the JSON download button when needed. No telemetry service,
  DB collection or log sink. Error reasons are retained only from a fixed allowlist.
- No payload, tile, token, user identity, nickname, room ID or round ID appears in
  exports. Transient room/version keys only correlate the already-authorized
  local streams. Server headers contain fixed numeric fields and a region code.
- Other games and presence/room heartbeats are not measured. A generic join is
  classified once its actual room is known; unsupported rooms are discarded.

## Metric definitions

All durations are milliseconds, using a monotonic clock. Percentiles use nearest
rank (`ceil(n*p)-1`). Different metrics can have different sample counts: missing
observations are not zero-filled. Outcomes are separated in the report.

| Metric | Meaning |
| --- | --- |
| `queue_wait_ms` | Command enqueue to execution. Okey layout starts before the existing 140 ms debounce and includes waiting behind earlier writes. |
| `client_token_ms` | Time obtaining the browser Firebase token, summed across attempts. |
| `http_ms` | Fetch plus JSON decoding, summed across attempts; includes network and server time. |
| `api_total_ms` | Enqueue to a decoded successful HTTP result, or terminal error. |
| `auth_ms` | Entire server auth callback, including service initialization when needed. |
| `auth_verify_ms` | Firebase token verification callback. |
| `auth_session_ms` | Optional existing account-state check; cache hits remain enabled. |
| `db_read_ms` | Time awaiting transaction `get` / `getAll`, summed across attempts. A `getAll` batch is measured once. |
| `db_write_enqueue_ms` | Synchronous transaction write scheduling / serialization. **Not network write latency.** |
| `tx_compute_ms` | Callback wall time excluding measured reads and write enqueue. Includes rules, clones and projections; not a CPU profiler. |
| `tx_begin_ms` | Transaction start to first callback entry. |
| `tx_retry_wait_ms` | Time between callback attempts, including SDK retries/backoff. |
| `tx_finalize_ms` | Last callback exit to transaction resolution, including commit/SDK finalization (or failure). Not an isolated provider write RPC. |
| `tx_ms` | Whole `runTransaction`, including attempts, reads, compute and commit. |
| `tx_attempts`, `db_reads`, `db_writes` | Callback attempts and requested document reads / queued writes over all attempts; not billing counters. |
| `server_ms` | Measured handler work from opt-in creation to response headers. Excludes platform startup before handler entry. |
| `public_snapshot_ms`, `private_snapshot_ms` | Enqueue to a matching server-derived public/private snapshot. Unchanged private hands have no new private-snapshot duration. |
| `view_commit_ms` | Enqueue to a React layout commit displaying the target or newer version. Okey waits for a coherent public/private view. |
| `render_commit_ms` | Component render entry to layout commit: wall time, not precise React CPU duration. |
| `next_frame_ms` | Enqueue to two rAF callbacks after the committed view: a frame opportunity, not proof of physical display paint. Background tabs can delay it. |
| `snapshot_wait_after_http_ms` | Positive time from HTTP response to the matching view commit; zero if commit already arrived. |
| `command_snapshot_barrier_ms` | Existing Okey command barrier after HTTP. Its unchanged 6s timeout can resolve without a matching snapshot; inspect missing/error outcomes too. |

Do not sum nested timings. HTTP and Firestore delivery overlap, so end-to-end
latency is not simply HTTP plus snapshot time. Clocks from different devices
cannot establish exact one-way latency. No cold-start claim is inferred from
handler time alone. Peer-to-peer click-to-display requires a separate controlled
two-client capture; these local metrics describe the initiating tab.

## Validation and baseline procedure

1. `npm test`, `npm run lint`, `npx tsc --noEmit -p tsconfig.app.json`, `npm run build`.
2. `npm run test:performance` uses only the named local demo emulator. It checks
   real SDK transaction wrapping, XOX state and coherent/private Okey views.
3. For browser demo QA: set `GAME_PERF_ENABLED=true`, then `npm run dev:xox` and
   open `http://127.0.0.1:5173/?gamePerf=1`. Compare the ordinary URL and stop mode.
4. For production baseline use private test rooms and normal leave operations.
   Separate first requests, warm successful single-attempt actions, retries,
   snapshot timeouts and failed commands. Record sample counts alongside p50/p95.
5. Record client/browser/network, server region, DB location and capture time.
   Compare the same scenarios before any subsequent optimization. Do not use
   local emulator or Node microbenchmarks as production UI measurements.

## Read batching (step a, 30 October 2026)

For existing rooms, the action receipt, rate record, public room and connection
record now share one transaction `getAll`. Direct Okey commands also include
the private state in this batch. Successful XOX moves therefore go from two
sequential read batches to one; Okey draw/discard/layout go from three to one.
Their document counts remain four and five respectively, with unchanged writes.
Generic room commands need the room's game type first; Okey then reads its queue
and private state together. Match candidate selection remains bounded/ordered.

Saved receipts are still checked before room validation, even if the room has
since been removed. A replay or rate-rejected request now also reads the batched
room records instead of stopping after just the two actor/rate reads. This is a
read-cost tradeoff; replayed commands still do not run or write a second time.
These are application-level read stages, not a measured latency improvement.
Heartbeat storage and retry diagnostics are separate follow-up work.

## Okey lease separation (31 October 2026)

Healthy room heartbeats renew only the room lease plus the existing bounded
receipt/rate records; they do not read the private Okey state or lobby queue.
Expired-seat recovery still uses the atomic game-state repair path. Gameplay
commands read leases for authorization but no longer rewrite them: a successful
draw/discard/layout now queues five writes instead of six. Actor receipt/rate
records remain shared to preserve their existing replay and abuse boundaries.

Okey queue entries are structural hints. Server matching validates their room
leases; the picker combines lease-managed entries with the existing verified
public presence stream. Waiting-room heartbeats no longer rewrite the queue.
Older entries retain the old timestamp interpretation in the picker.

## Region observation (30 October 2026)

Vercel Functions settings selected `iad1` (Washington, D.C., USA) with Fluid
Compute enabled. Firebase's default database Data page showed `nam5` (US
multi-region). Both are in the US, but are not the same cloud region/data center.
No cross-continent API-to-DB mismatch was observed. Turkish clients still cross
the Atlantic; actual contributions need the baseline. No location was changed.

Sources: [Vercel project functions](https://vercel.com/yap-ai/vitejs-vite-pzfj873h-1hy2/settings/functions),
[Firebase database](https://console.firebase.google.com/project/oyun-odasi-8ecee/firestore/databases/-default-/data),
[Firestore locations](https://firebase.google.com/docs/firestore/locations).
