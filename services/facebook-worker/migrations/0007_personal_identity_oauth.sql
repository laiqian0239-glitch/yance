ALTER TABLE facebook_oauth_states ADD COLUMN flow_mode TEXT NOT NULL DEFAULT 'page';
ALTER TABLE facebook_oauth_states ADD COLUMN identity_json TEXT NOT NULL DEFAULT '{}';
