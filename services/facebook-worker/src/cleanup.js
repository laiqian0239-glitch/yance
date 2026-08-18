import { run } from './db.js';
import { addDays, utcNow } from './utils.js';

export async function cleanup(env, options = {}) {
  const now = options.now || utcNow();
  const deadLetterRetentionDays = Math.max(7, Math.min(90, Number(options.deadLetterRetentionDays || env.DEAD_LETTER_RETENTION_DAYS || 30)));
  const completedOAuthCutoff = addDays(now, -1);
  const deadLetterCutoff = addDays(now, -deadLetterRetentionDays);
  const statements = [
    [`DELETE FROM facebook_device_requests WHERE expires_at<=?`, [now]],
    [`DELETE FROM facebook_send_idempotency WHERE expires_at<=?`, [now]],
    [`DELETE FROM facebook_oauth_page_candidates WHERE flow_id IN (SELECT flow_id FROM facebook_oauth_states WHERE expires_at<=? OR status IN ('completed','cancelled','denied','error'))`, [now]],
    [`DELETE FROM facebook_oauth_states WHERE expires_at<=? OR (status IN ('completed','cancelled','denied','error') AND updated_at<=?)`, [now, completedOAuthCutoff]],
    [`DELETE FROM facebook_webhook_events WHERE expires_at<=? AND processing_status='acked'`, [now]],
    [`DELETE FROM facebook_webhook_events WHERE created_at<=? AND EXISTS (SELECT 1 FROM facebook_event_deliveries d WHERE d.event_id=facebook_webhook_events.id AND d.status='dead-letter')`, [deadLetterCutoff]],
    [`UPDATE facebook_webhook_events SET processing_status='expired',updated_at=? WHERE expires_at<=? AND processing_status NOT IN ('acked','expired') AND NOT EXISTS (SELECT 1 FROM facebook_event_deliveries d WHERE d.event_id=facebook_webhook_events.id AND d.status='dead-letter')`, [now, now]],
    [`DELETE FROM facebook_webhook_events WHERE expires_at<=? AND processing_status='expired'`, [now]]
  ];
  await run(env.DB, `CREATE TABLE IF NOT EXISTS facebook_oauth_diagnostics (flow_id TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT '',diagnostics_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
  statements.splice(3, 0, [`DELETE FROM facebook_oauth_diagnostics WHERE flow_id IN (SELECT flow_id FROM facebook_oauth_states WHERE expires_at<=? OR (status IN ('completed','cancelled','denied','error') AND updated_at<=?))`, [now, completedOAuthCutoff]]);
  const results = [];
  for (const [sql, values] of statements) results.push(await run(env.DB, sql, values));
  return { databaseActions: results.length, deadLetterRetentionDays, at: now };
}
