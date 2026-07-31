# M1 Startup State Transitions

## BackendProcessHost process states
| From | To | Allowed reason |
|---|---|---|
| NOT_STARTED | STARTING | start requested |
| STARTING | RUNNING | credential hydrated and backend ready |
| STARTING | START_FAILED | launch preflight, startup frame, child exit, ready timeout, or ready contract failure |
| RUNNING | STOPPING | requested shutdown |
| STOPPING | STOPPED | child exit confirmed |
| RUNNING | CRASHED | unexpected child exit |

## M1 state ownership
- Launch preflight and startup-frame validation belong to M1.
- Backend internal runtime lifecycle belongs to M3.
- Rejected owner containment belongs to M4.
- SQLite ownership belongs to M5.
- Release layout generation belongs to M6.
- Installer overwrite safety belongs to M7.
- Native binary scan belongs to M8.

## Containment rule
A child that fails before durable owner claim or credential authority must transition to START_FAILED and must not create FATAL_OWNER_CONTAINMENT.
