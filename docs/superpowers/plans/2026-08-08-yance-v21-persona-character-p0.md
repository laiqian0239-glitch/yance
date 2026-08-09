# Yance V2.1 Persona / Character P0 V2 Implementation

## Authority

This work package is `V21-PERSONA-CHARACTER-P0-V2`.

Its authorization became effective only after ordinary two-parent merge `96c35d8064b299fb64f9740cc91e29634bf1a404` landed on trusted `main`. The implementation branch `product/v21-persona-character-p0-v2` starts exactly from that authorization merge and must remain within the frozen 24-path implementation set with path-set SHA-256 `bd54ef1d70ca76801773232b068c799ad26bb3ffd773b9cfe2620b4ad3e2f527`.

The V2 authorization supersedes the historical Persona V1 authority. V1 implementation commits are not implementation parents for V2 and are not reused as authority; historical V1 bytes are acceptable only after independent source/base verification against the V2 authorization and current trusted-main inputs.

## Mandatory OSS authority

SillyTavern `1.18.0` at exact upstream commit `51ad27fb86d39a3daca3adaa970375c9670c12df` is the mandatory OSS authority for Character Card parsing/validation and Persona/Character/prompt-composition semantics. Yance does not create a second Persona, Character, Character Card, or prompt-composition framework.

Adopted portable whole modules are limited to the authorized Character Card parser, PNG encoder, and Tavern Card validator with mechanical CommonJS compatibility only. Exact upstream/vendored Git blobs and source-slice provenance are recorded in `vendor/sillytavern/1.18.0/UPSTREAM.json`.

The implementation excludes SillyTavern UI, provider/model gateway, server endpoints, global chat state, swipe UI, and recursive World Info token-budget authority.

## V2 provenance correction

V1 used an incomplete statement slice from `public/scripts/authors-note.js:331-361`. V2 rejects that provenance and adopts the complete upstream `setFloatingPrompt` function at 1-based inclusive lines `324-392`.

The canonical upstream source-slice SHA-256 is:

`b0a20c23230a885f272a1ffc3f32a0630616ef2d1f98a77c91b064f00a6990f6`

`vendor/sillytavern/1.18.0/src/prompt/prompt-composition-core.cjs` preserves the complete upstream function body and supplies its required runtime globals only through lexical bindings. `backend/personaBrain/sillyTavernAdapter.js` calls that source-derived runtime and captures `setExtensionPrompt`; Yance does not retain the historical handwritten `resolveFloatingPromptInjection` equivalent as an authority.

The other 17 authorized SillyTavern source-derived regions remain frozen under their existing provenance records.

## Product composition

The runtime preserves six distinct structured inputs:

1. Yance Persona Card
2. Relationship Card
3. Locale Profile
4. Chat Register
5. Style Overlay
6. Example Dialogues

Character Description, Personality, Scenario, Character Note, Example Dialogues, Relationship Card, Locale Profile, Chat Register, and Style Overlay remain distinct composition units. They are not flattened into a synthetic style prompt.

`backend/personaBrain/compiler.js` reads persisted structured Persona fields by default so data saved from the product UI participates in real live-reply compilation without requiring request-side composition overrides. Request-side composition remains an explicit override rather than a hidden second storage authority.

## Product UI closure

V2 reuses the existing Product Shell `人物基线` panel instead of introducing a SillyTavern UI or second Persona shell.

The existing validation/export/import/version-save controls remain present. The same panel adds:

- backend-backed Character Card PNG/JSON preview and apply;
- Persona Description, Character Description, Personality, Scenario, and Character Note editors;
- add/remove Example Dialogues;
- all 12 structured Style Overlay controls: 暧昧、小女人、风骚、调情、个性、温柔、成熟、高冷、主动、神秘、幽默、俏皮;
- `de-DE` and `de-AT` Locale Profile selection;
- native short-form Chat Register selection;
- read-only Relationship Card projection;
- backend `compile-context` composition preview;
- loading, dirty, success, error, disabled, accessibility, and responsive states.

Character Card PNG parsing remains backend-only through the vendored SillyTavern parser. The browser does not reimplement PNG chunks, CRC, `tEXt`, `ccv3`, or `chara` parsing.

## Runtime boundaries

- Persona Card owns who the user is and how the user presents/speaks.
- Relationship Card is a read-only communication-context projection and is never a second contact-fact database.
- Letta remains long-term Agent/interaction-memory authority.
- Graphiti remains temporal relationship-fact authority and episode/provenance authority.
- Parlant remains Goal/Journey authority.
- CharacterBook/Lorebook material can affect persona/scenario/example composition only; it cannot create or persist real contact facts.
- Learning/feedback authorities remain separate and do not automatically promote generated text into authoritative Persona facts.
- The existing Yance model gateway and unique final send authority remain unchanged.

## Live reply closure

The legacy flat path `truthSafePacket.style.prompt -> contextAwareReplyBrain -> whatsappReplyStyleAuthority.stylePrompt` is removed from live model instructions.

`contextAwareReplyBrain` carries structured `persona.composition` through context compaction, instructs the model to preserve Persona/Relationship/Locale/Register/Style/Examples as distinct units, and sends the aggregated incoming text into Persona composition so authorized CharacterBook matching can execute against the actual current turn.

The final candidate remains subject to the existing Persona truth receipt, contact-language authority, Director strategy authority, model routing authority, quality gates, stale-context fencing, translation, user approval, and final send authority.

## Exact dependencies

Only these direct runtime dependencies are introduced:

- `crc@4.3.2`
- `png-chunk-text@1.0.0`
- `png-chunks-extract@1.0.0`

`crc-32@0.3.0` is the transitive dependency of `png-chunks-extract` recorded by the lockfile. The V2 dependency delta is applied to the exact package/lock baseline shared by the V1 authorization base and the V2 trusted-main base, rather than replacing a newer lockfile with an historical one.

Workflow modifications are forbidden.

## Failure-first evidence

The V2 implementation began with tests-only commit `961d73838cae095590c5b082b1a1ee06c7a979e3`, whose parent is the exact authorization merge `96c35d8064b299fb64f9740cc91e29634bf1a404`.

That first commit changed five authorized test files and zero product files. Stage run `31290470139` established the causal RED: route authorization, Electron LFS, locked dependencies, Ubuntu sealed-export, and Windows sealed-export passed, while `Run WP0 required tests` failed only on the new Persona/SillyTavern/UI contracts (`191 total / 177 pass / 14 fail`).

A corrupt test-only 1x1 PNG fixture was later identified by the upstream parser's CRC validation and replaced with a valid PNG; the parser was not weakened.

After the OSS integration, UI/backend Character Card closure, persisted composition, complete `setFloatingPrompt` provenance repair, and live compiler work, exact Head `4a203924a5dc9120125be12436229ed5ca906ea4` passed the complete Stage workflow, including route, Electron LFS, `npm ci`, required tests, secret scanner, identity/Electron regressions, protocol checks, base-owned executable gate, and Ubuntu/Windows sealed-export.

A further tests-only live-reply regression commit `20d6d44216d449879be10c0d13df80d89240beea` intentionally re-established a single causal RED: `192 total / 191 pass / 1 fail`, with all route/supply-chain/sealed-export prerequisites still GREEN. The sole failure proved that `contextAwareReplyBrain` had not yet carried structured Persona composition through the real live-reply path. The production successor fixes that root cause rather than bypassing the contract.

## Frozen implementation paths

1. `THIRD_PARTY_NOTICES.md`
2. `backend/personaBrain/compiler.js`
3. `backend/personaBrain/runtimeTruthAuthority.js`
4. `backend/personaBrain/sillyTavernAdapter.js`
5. `backend/personaBrain/stylePolicy.js`
6. `backend/personaBrain/truthFirewall.js`
7. `backend/routes/personaBrain.js`
8. `backend/services/contextAwareReplyBrain.js`
9. `backend/tests/personaBrain/compiler.test.js`
10. `docs/superpowers/plans/2026-08-08-yance-v21-persona-character-p0.md`
11. `frontend/js/r32-persona-runtime.js`
12. `frontend/r32-persona.css`
13. `package-lock.json`
14. `package.json`
15. `tests/wp0/sillytavern-tavern-card-validator.test.js`
16. `tests/wp0/v21-persona-character-p0.test.js`
17. `tests/wp0/v21-persona-character-ui.test.js`
18. `tests/wp0/v21-persona-native-register.test.js`
19. `vendor/sillytavern/1.18.0/LICENSE`
20. `vendor/sillytavern/1.18.0/UPSTREAM.json`
21. `vendor/sillytavern/1.18.0/src/character-card-parser.cjs`
22. `vendor/sillytavern/1.18.0/src/png/encode.cjs`
23. `vendor/sillytavern/1.18.0/src/prompt/prompt-composition-core.cjs`
24. `vendor/sillytavern/1.18.0/src/validator/TavernCardValidator.cjs`

## Completion gate

Final completion is exact-Head evidence only. Before merge, the implementation must remain inside the frozen 24-path set; Stage, layered authorization, ACV2/WP-A and relevant sealed-runtime gates must be GREEN; source/license/dependency provenance must remain closed; and actionable review findings must be resolved. The implementation is not merged without explicit owner authorization at the final merge boundary.
