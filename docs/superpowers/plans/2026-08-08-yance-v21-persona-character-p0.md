# Yance V2.1 Persona / Character P0 Implementation

## Authority

This work package is authorized by ordinary two-parent main merge `801217f73cd249d6398d7b3c9fa7a35b770bc377` and implements only the frozen `V21-PERSONA-CHARACTER-P0` path set.

SillyTavern `1.18.0` at exact commit `51ad27fb86d39a3daca3adaa970375c9670c12df` is the mandatory OSS authority for Character Card parsing/validation and Persona/Character/prompt-composition semantics. The implementation does not create a second Yance Persona, Character, or prompt framework.

## Product composition

The runtime preserves six distinct inputs:

1. Yance Persona Card
2. Relationship Card
3. Locale Profile
4. Chat Register
5. Style Overlay
6. Example Dialogues

`backend/personaBrain/sillyTavernAdapter.js` is deliberately thin. It projects these Yance-owned product inputs into the vendored SillyTavern `Prompt`, `PromptCollection`, default ordering, injection position/depth/order, Example Dialogue, Author Note, and CharacterBook matching primitives.

## Runtime boundaries

- Persona Card owns who the user is and how the user speaks.
- Relationship Card is a read-only communication-context projection and never a second contact-fact database.
- Letta remains long-term Agent/interaction-memory authority.
- Graphiti remains temporal relationship-fact authority.
- Parlant remains Goal/Journey authority.
- CharacterBook/Lorebook material can affect persona/scenario/example composition only; it cannot create or persist real contact facts.
- The existing Yance AI gateway and unique send authority remain unchanged.
- No SillyTavern UI, provider gateway, server shell, global chat state, or swipe UI is introduced.

## Flat prompt removal

The former `stylePolicy.describeStylePolicy() -> prompt -> truthSafePacket.style.prompt -> contextAwareReplyBrain` path is removed. Style labels and weights now remain structured resolver inputs. The required labels are preserved: 暧昧、小女人、风骚、调情、个性、温柔、成熟、高冷、主动、神秘、幽默、俏皮.

## Native register P0

`de-DE` and `de-AT` use a native short-form WhatsApp register contract. It rejects translationese, customer-service/email tone, over-explaining, overly complete AI sentences, repeated questions, emoji overuse, neediness, relationship-stage mismatch, and assistant clichés. Age and nationality do not select persona templates.

## Provenance

`vendor/sillytavern/1.18.0/UPSTREAM.json` records the exact upstream release/commit, whole-module Git blobs, all 18 authorized source-slice line ranges and SHA-256 values, destination region markers, destination-region hashes, transformations, and exact PNG dependencies. Permanent WP0 tests fail closed on marker/hash drift.

## Failure-first evidence

Implementation commit `6153824a4dd698432c28350b6875e24cf839941c` intentionally added tests before product code. Stage run `31266869552` produced the causal RED: 7 new Persona/Character tests failed because the vendored SillyTavern modules and thin adapter did not yet exist; the other 156 WP0 tests passed.

The implementation then proceeds only by satisfying those contracts through the authorized OSS source and in-place removal/thinning of the legacy Yance flat composition path.
