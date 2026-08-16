# Yance V2.1 Media Brain P0 V1 design

## Authority

- Work package: `V21-MEDIA-BRAIN-P0-V1`
- Immich `v3.1.0` / `8aa95c67470a02a8ddedf03c2e52963af33065ff` owns media assets, smart search, people and albums.
- ComfyUI `v0.31.0` / `43cb4fffc89bba20ab7bd61467a36d0339338dab` owns workflow validation, queueing, image/model execution and output history.
- Existing Yance CredentialVault remains the only credential custody.
- Existing `/api/r32/messages/:platform/:accountId/send-media-stream` path remains final send authority.

## Product flow

1. Import or select an Immich asset.
2. Search, People and Albums are queried from Immich directly through the thin Electron adapter.
3. Generate/Edit parameters are applied to a reviewed ComfyUI API-format workflow and submitted to `/prompt`; ComfyUI performs all node/model execution.
4. `/history/{prompt_id}` and `/view` expose the result as non-selectable output.
5. Save back imports the output into Immich. Only the returned Immich asset becomes selectable.
6. Send downloads the Immich original and delegates it to the existing Yance send-media-stream route.

## Network and privacy

Loopback is the default for both upstreams. Non-loopback endpoints fail closed unless the user explicitly configures `allowExternalEndpoint`. Immich API keys are never projected to renderer health/results and remain in the existing vault.

## Forbidden duplicate authorities

No Yance asset database, catalog, smart-search index, people/face index, image inference engine, node executor, model loader, workflow queue, credential store, or Media send queue is introduced.
