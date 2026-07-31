# M1 Release Contract Boundary

M1 verifies release inputs. M1 does not generate or repair release layout.

## Required release inputs
- resourcesPath
- expectedBuildId
- manifestSha256
- releaseManifestPath or manifestPath
- releaseManifestSha256Path or detachedHashPath
- appRoot
- backendEntryPath
- nodeRuntimeExecutablePath
- nodeModulesPath when supplied

## Failure behavior
- Missing app root: M1_APP_ROOT_MISSING
- Missing backend entry: M1_BACKEND_ENTRY_MISSING
- Missing trusted Node runtime: M1_NODE_RUNTIME_MISSING
- Missing NODE_PATH target: M1_NODE_MODULES_MISSING
- Missing release manifest: M1_RELEASE_MANIFEST_MISSING
- Missing release manifest sha256: M1_RELEASE_MANIFEST_SHA256_MISSING
- Invalid release contract fields: M1_RELEASE_CONTRACT_INVALID

## Boundary
- M6 creates production layout and manifest.
- M7 installs and overwrites resources safely.
- M8 blocks invalid native binaries.
- M1 only validates the contract and fails closed.
