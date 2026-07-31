# M1 Runtime Contract

| Field | Required | Producer | Consumer | Failure code |
|---|---:|---|---|---|
| protocolVersion | yes | Electron DesktopHost | Backend startup pipe | DESKTOP_STARTUP_PROTOCOL_MISMATCH |
| startupFrameProtocolVersion | yes | Electron DesktopHost | Backend startup pipe | M1_RUNTIME_CONTRACT_INVALID |
| m1StartupContractVersion | yes | Electron DesktopHost | Backend startup pipe | M1_RUNTIME_CONTRACT_VERSION_MISMATCH |
| readyProtocolVersion | yes | Electron DesktopHost / Backend ready | Backend / Electron ready validator | M1_READY_PROTOCOL_VERSION_MISMATCH |
| startupAttemptId | yes | Electron DesktopHost | Backend ready validator | M1_READY_STARTUP_ATTEMPT_MISMATCH |
| startupNonce | yes | Electron DesktopHost | Backend startup pipe / credential ack | DESKTOP_STARTUP_FRAME_INVALID |
| backendSessionId | yes | Electron DesktopHost | Backend ready validator | M1_READY_BACKEND_SESSION_MISMATCH |
| fd6PipeInstanceId | yes | Electron DesktopHost | Credential custody channel | M1_RUNTIME_CONTRACT_INVALID |
| appRoot | yes | Electron launch contract | Backend runtime | M1_APP_ROOT_MISSING / M1_RUNTIME_CONTRACT_INVALID |
| backendEntryPath | yes | Electron launch contract | Backend runtime | M1_BACKEND_ENTRY_MISSING / M1_RUNTIME_CONTRACT_INVALID |
| nodeRuntimeExecutablePath | yes | Electron launch contract | Backend runtime | M1_NODE_RUNTIME_MISSING / M1_RUNTIME_CONTRACT_INVALID |
| nodeModulesPath | optional | Electron launch contract | Backend module resolver | M1_NODE_MODULES_MISSING |
| backendPort | yes | Electron launch contract | Backend server / renderer API | M1_BACKEND_PORT_INVALID |
| readyTimeoutMs | yes | Electron launch contract | DesktopHost timeout | M1_READY_TIMEOUT_INVALID |
| runtimeMode | yes | Electron DesktopHost | Backend startup pipe | M1_RUNTIME_CONTRACT_INVALID |
| apiBaseUrl | yes | Electron DesktopHost | Backend ready/runtime projection | M1_RUNTIME_CONTRACT_INVALID |
| releaseManifestPath | yes | ReleaseManifestHost | Backend release identity | M1_RELEASE_MANIFEST_MISSING |
| releaseManifestSha256Path | yes | ReleaseManifestHost | Backend release identity | M1_RELEASE_MANIFEST_SHA256_MISSING |
| logRoot | yes | Electron DesktopHost | diagnostics | M1_RUNTIME_CONTRACT_INVALID |
| desktopLogPath | yes | Electron DesktopHost | diagnostics | M1_RUNTIME_CONTRACT_INVALID |
| backendLogPath | yes | Electron DesktopHost | diagnostics | M1_RUNTIME_CONTRACT_INVALID |

## Rule
Fields that can be validated before fork must fail before fork. Fields that must be echoed by backend ready must be validated before DesktopHost transitions to RUNNING.
