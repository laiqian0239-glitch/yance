ALTER TABLE facebook_accounts ADD COLUMN granted_scopes TEXT NOT NULL DEFAULT '[]';
ALTER TABLE facebook_accounts ADD COLUMN missing_permissions TEXT NOT NULL DEFAULT '[]';
ALTER TABLE facebook_accounts ADD COLUMN history_sync_available INTEGER NOT NULL DEFAULT 0;
ALTER TABLE facebook_accounts ADD COLUMN history_sync_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE facebook_accounts ADD COLUMN last_permission_check_at TEXT;
ALTER TABLE facebook_accounts ADD COLUMN permission_source TEXT NOT NULL DEFAULT '';

ALTER TABLE facebook_oauth_page_candidates ADD COLUMN permission_checked_at TEXT;
ALTER TABLE facebook_oauth_page_candidates ADD COLUMN permission_source TEXT NOT NULL DEFAULT '';
