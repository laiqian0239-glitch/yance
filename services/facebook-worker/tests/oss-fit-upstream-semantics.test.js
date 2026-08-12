import test from 'node:test';
import assert from 'node:assert/strict';
import { SUBSCRIBED_FIELDS } from '../src/config.js';

const CHATWOOT_FACEBOOK_PAGE_PIN = '3f4d28f77bc8352bafcaf4fce94ba939f4527064';
const META_GRAPH_SDK_PIN = 'ebd272a36a1a54a10e846cc4c42200be54871f5a';

test('Facebook Public subscribes the message_echoes field required by its supported echo ingestion contract', () => {
  assert.ok(
    SUBSCRIBED_FIELDS.includes('message_echoes'),
    `Facebook Public handles message.is_echo and pinned Chatwoot ${CHATWOOT_FACEBOOK_PAGE_PIN} subscribes message_echoes, so the Meta Page subscription must include message_echoes`
  );
});

test('Facebook Public subscribes the message_reactions field required by its supported reaction ingestion contract', () => {
  assert.ok(
    SUBSCRIBED_FIELDS.includes('message_reactions'),
    `Facebook Public classifies and persists Messenger reactions and pinned Meta Graph SDK ${META_GRAPH_SDK_PIN} exposes message_reactions as a Page subscribed field, so the Page subscription must include message_reactions`
  );
});
