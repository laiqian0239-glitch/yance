YANCE-MULTIBRIDGE-LAB — R12 Runtime Repair / Readiness

Purpose
-------
This package repairs only the five proven R12 bridge database fields and then
runs strict Docker Compose readiness gates. It does not rebuild the Lab, does
not regenerate registrations, does not start real platform login, and does not
collect or upload runtime logs or credentials.

Default existing Lab root
-------------------------
C:\Users\1\Downloads\yance-multibridge-lab

Run
---
1. Keep the existing Lab directory above in place.
2. Extract this package to any normal local folder.
3. Double-click RUN_R12_RUNTIME_REPAIR_READINESS.cmd.
4. The console stays open after completion so the final status remains visible.

Optional Lab root override from Command Prompt:
RUN_R12_RUNTIME_REPAIR_READINESS.cmd -LabRoot "D:\path\to\yance-multibridge-lab"

What it changes
---------------
For exactly these five existing bridge configs:
  facebook-personal
  instagram-dm
  google-messages
  signal
  line

it repairs only:
  .database.type = sqlite3-fk-wal
  .database.uri  = file:/data/<service>.db?_txlock=immediate

Before committing each repair, the script proves that the complete config
semantics with only those two database fields removed are unchanged.
registration.yaml is not rewritten.

Readiness gates
---------------
The package uses runtime/docker-compose.lab.yml as the sole service/network
authority and requires:
  - exact staged image identity for all five bridges;
  - repaired upstream config startup GREEN;
  - all five bridge processes sustained and RestartCount stable;
  - Synapse healthy;
  - Synapse -> each bridge DNS/TCP GREEN using the existing Compose names;
  - each bridge -> Synapse Matrix versions endpoint GREEN;
  - exact frozen upstream login-flow authority for all five services.

Only after all non-human gates pass does it print LAB_RUNTIME_READY.

Final status
------------
REAL_RED
  A non-human runtime gate failed. Do not start account authorization.

HUMAN_AUTH_REQUIRED
  Runtime readiness is GREEN and the next step is real account/device
  authorization. This package intentionally stops before cookies, QR scans,
  phone pairing, credentials, 2FA, or device linking.

GREEN
  Reserved terminal classification for a completely non-human work package.
  This package normally ends at HUMAN_AUTH_REQUIRED because account login is
  intentionally outside its authority.

Sensitive-data boundary
-----------------------
Keep .runtime local. Do not upload config.yaml, registration.yaml, database
files, credentials, cookies, tokens, account metadata, device-link material,
or user-data logs. If a later REAL_RED needs evidence, use only a separately
authorized bounded collector; do not improvise by uploading the Lab directory.
