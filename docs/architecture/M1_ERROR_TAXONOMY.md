# M1 Error Taxonomy

| Code | Meaning | Owner containment? |
|---|---|---:|
| M1_START_CONFIGURATION_INVALID | DesktopHost start request is incomplete | no |
| M1_APP_ROOT_MISSING | app root does not exist | no |
| M1_BACKEND_ENTRY_MISSING | backend entry does not exist | no |
| M1_NODE_RUNTIME_MISSING | trusted Node runtime does not exist | no |
| M1_NODE_MODULES_MISSING | supplied NODE_PATH has no existing target | no |
| M1_BACKEND_PORT_INVALID | backend port is invalid | no |
| M1_READY_TIMEOUT_INVALID | ready timeout is invalid | no |
| M1_RELEASE_CONTRACT_INVALID | release startup config is malformed | no |
| M1_RELEASE_MANIFEST_MISSING | declared release manifest is absent | no |
| M1_RELEASE_MANIFEST_SHA256_MISSING | declared manifest hash file is absent | no |
| M1_RUNTIME_CONTRACT_VERSION_MISMATCH | startup contract version unsupported | no |
| M1_RUNTIME_CONTRACT_INVALID | startup frame lacks required runtime contract field | no |
| M1_READY_PROTOCOL_VERSION_MISMATCH | backend ready protocol is unsupported | no |
| M1_READY_STARTUP_ATTEMPT_MISMATCH | backend ready belongs to another startup attempt | no |
| M1_READY_BACKEND_SESSION_MISMATCH | backend ready belongs to another backend session | no |

Owner containment codes remain in M4 and must only apply after owner claim or credential authority exists.
