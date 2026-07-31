CREATE INDEX IF NOT EXISTS idx_fb_events_page_created ON facebook_webhook_events(page_id, created_at);
CREATE INDEX IF NOT EXISTS idx_fb_events_account_status ON facebook_webhook_events(account_id, processing_status, media_status, created_at);
CREATE INDEX IF NOT EXISTS idx_fb_deliveries_device_status ON facebook_event_deliveries(device_id, status, first_available_at);
CREATE INDEX IF NOT EXISTS idx_fb_deliveries_lease ON facebook_event_deliveries(status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_fb_devices_account_status ON facebook_desktop_devices(account_id, status);
CREATE INDEX IF NOT EXISTS idx_fb_oauth_expires ON facebook_oauth_states(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_fb_requests_device_created ON facebook_device_requests(device_id, created_at);
CREATE INDEX IF NOT EXISTS idx_fb_send_expires ON facebook_send_idempotency(expires_at);
CREATE INDEX IF NOT EXISTS idx_fb_media_event_status ON facebook_event_media(event_id, status);
CREATE INDEX IF NOT EXISTS idx_fb_media_expires ON facebook_event_media(expires_at);

CREATE INDEX IF NOT EXISTS idx_fb_media_retry ON facebook_event_media(status, next_retry_at);
