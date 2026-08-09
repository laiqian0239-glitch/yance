# Yance V2.1 Media Brain runtime boundary

Media Brain P0 integrates two mature upstream authorities and intentionally does not create a Yance media framework.

## Immich

Immich `v3.1.0` at `8aa95c67470a02a8ddedf03c2e52963af33065ff` is the sole asset-library authority for upload/import, asset bytes and previews, smart search, people, and albums. **Immich owns the database** and storage layout; the Immich database is not a Yance database and is never recreated inside Electron.

The default endpoint is `http://127.0.0.1:2283`. A non-loopback endpoint is allowed only after explicit user configuration. The API key remains in the existing Yance `CredentialVault` under `media:immich:default`; Media Brain has no credential store of its own.

## ComfyUI

ComfyUI `v0.31.0` at `43cb4fffc89bba20ab7bd61467a36d0339338dab` is the sole workflow/model-execution authority. Yance uses the Local Server API (`/prompt`, `/history/{prompt_id}`, `/view`, `/upload/image`, `/object_info`, and model inventory endpoints) and does not implement node execution, image inference, model loading, or a second workflow engine.

The preferred Windows deployment is the official ComfyUI portable distribution. A user-managed ComfyUI endpoint is also supported. **Model weights are not bundled** with Yance; a missing model is surfaced as a degraded Media state and must be resolved in the user-managed ComfyUI installation.

The default endpoint is `http://127.0.0.1:8188`. External ComfyUI endpoints require explicit user configuration.

## Save-back and send authority

A ComfyUI output is not a Yance-selectable media asset. It remains `COMFYUI_OUTPUT_NOT_IMPORTED` / `IMMICH_SAVE_BACK_REQUIRED` until `saveWorkflowOutputToImmich` imports it into Immich. Only the resulting Immich asset is selectable for send.

Final delivery remains the existing Yance `/api/r32/messages/:platform/:accountId/send-media-stream` business-command/sendQueue authority. Media Brain downloads an Immich original and delegates bytes to that existing route; it does not create a Media send queue or channel driver.
