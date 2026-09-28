---
name: yance-mature-authority-audit
description: Audit every planned Yance production mutation against the admitted mature owner, ownership boundaries, narrow public seams, source patterns, and allowed paths. Use before changing production code that touches Matrix/Element, Electron, package management, packaging, runtime lifecycle, or another mature subsystem, and again after the change to produce fail-closed proof.
---

# Yance Mature Authority Audit

Use this skill before any production mutation that integrates with a mature subsystem. It is an admission gate, not a design suggestion. A RED result stops the mutation until the manifest or proposed design is corrected. It never grants mutation, promotion, merge, or release authority.

## Required sequence

1. Read the mature owner's exact source and public API used by the proposed change.
2. Create one JSON manifest for the causal batch using the contract below.
3. Run `admission.js` before changing production bytes. Preserve its JSON output outside production paths.
4. Stop on any non-zero exit code or `status: "RED"`. Do not waive a violation in prose.
5. Make only the admitted mutations through the declared public seam.
6. Record executed local checks in `localProof.checks`, without claiming checks that were not run.
7. Run `proof.js` with the unchanged manifest and the preserved admission evidence. Stop on RED.

Run from the repository root on Windows or any Node-supported host:

```powershell
node skills/yance-mature-authority-audit/admission.js --manifest <manifest.json> --output <admission-evidence.json>
node skills/yance-mature-authority-audit/proof.js --manifest <manifest.json> --admission <admission-evidence.json> --output <proof-evidence.json>
```

Both commands support `--help`. GREEN exits `0`; every policy, input, scan, or evidence failure exits non-zero and emits RED evidence.

## Non-negotiable decisions

- Name every admitted mature owner. Yance must not own capability lifecycle, state, retry, recovery, resolution, or materialization when an admitted mature owner already owns it.
- Keep the Product integration `stateless-projection` or `thin-adapter`, with no second owner, shadow authority, parallel lifecycle, mirrored state, custom fallback, or Product-owned capability state.
- Use one named, mature-owner public seam and assert that it is the narrowest sufficient seam.
- Declare every planned production path and action. Each path must be inside `allowedPaths` and outside `forbiddenPaths`.
- Separate affected Product code into `sourceScan.integrationFiles` and mature implementation/API code into `sourceScan.ownerFiles`. Every mutation path must belong to exactly one list.
- Shadow-authority signatures are scanned only in integration files. Owner files are instead checked for the declared `publicSeam.name`, so a mature owner's legitimate internal state cannot be misclassified as Product shadow state.
- The gate scans real bytes; declarations alone cannot turn a detected shadow mapping GREEN.
- Do not put exceptions around built-in shadow-authority signatures. Additional patterns may only make the scan stricter.

For example, `matrixPeerUserByRoomId`, `roomAvatarByRoomId`, or a similar Yance-owned room/member/avatar/user lookup is a release-blocking second state owner when Element/Matrix owns Room, Member, and Avatar authority. Delete the mapping and use the mature public seam; do not add a compatibility layer around it.

## Manifest contract

Paths are repository-relative and use `/` separators. `modify` and `delete` inputs must exist at admission time. `add` may not exist until proof. A deleted path must be absent at proof time.

```json
{
  "schemaVersion": 1,
  "auditId": "current-causal-batch-stable-id",
  "capability": "room-avatar-projection",
  "authority": {
    "productOwner": "Yance",
    "matureOwners": ["Element/Matrix"],
    "ownership": {
      "lifecycle": { "owner": "Element/Matrix", "source": "Room lifecycle source reference" },
      "state": { "owner": "Element/Matrix", "source": "Room state source reference" },
      "retry": { "owner": "Element/Matrix", "source": "SDK retry source reference" },
      "recovery": { "owner": "Element/Matrix", "source": "SDK recovery source reference" },
      "resolution": { "owner": "Element/Matrix", "source": "Avatar resolution source reference" },
      "materialization": { "owner": "Element/Matrix", "source": "RoomAvatar materialization source reference" }
    }
  },
  "integration": {
    "role": "stateless-projection",
    "addsSecondOwner": false,
    "shadowAuthority": false,
    "parallelLifecycle": false,
    "mirrorState": false,
    "customFallback": false,
    "productOwnedCapabilityState": [],
    "publicSeam": {
      "name": "renderRoomAvatar",
      "owner": "Element/Matrix",
      "kind": "public",
      "narrowest": true
    }
  },
  "mutation": {
    "changes": [
      { "path": "integration/example.tsx", "action": "modify" }
    ]
  },
  "pathPolicy": {
    "allowedPaths": ["integration/**"],
    "forbiddenPaths": ["integration/generated/**"]
  },
  "sourceScan": {
    "integrationFiles": ["integration/example.tsx"],
    "ownerFiles": ["vendor/owner-public-seam.ts"],
    "additionalForbiddenPatterns": []
  },
  "localProof": {
    "checks": [
      {
        "id": "focused-owner-contract",
        "command": "node --test path/to/focused.test.js",
        "status": "PASS",
        "evidence": "Preserved terminal output or evidence path"
      }
    ]
  }
}
```

Each `additionalForbiddenPatterns` entry has `id`, `regex`, and optional `flags`. It supplements the built-in integration-source patterns and cannot suppress them. The declared public seam must occur in at least one owner source file. `localProof.checks` is required by `proof.js`; the script validates receipts but does not execute arbitrary manifest commands.

Evidence emitted by both gates conforms to [evidence-schema.json](evidence-schema.json).
