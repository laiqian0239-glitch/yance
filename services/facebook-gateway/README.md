# Yance Facebook Gateway

This service is the production-side companion for the Yance Windows desktop Facebook Page Messenger adapter. It keeps the Meta App Secret off the desktop and provides:

- browser OAuth callback and Page Access Token acquisition;
- Page-level `messages` Webhook subscription;
- Meta `X-Hub-Signature-256` verification;
- encrypted persistence of OAuth flow and relay credentials;
- authenticated WebSocket relay to the desktop;
- per-event HMAC signing and replay-resistant event IDs;
- Click-to-Messenger and referral metadata relay for ad-originated inbox conversations;
- authenticated remote Relay credential revocation during desktop logout.

## Required environment

```text
YANCE_FACEBOOK_GATEWAY_APP_ID=<Meta App ID>
YANCE_FACEBOOK_GATEWAY_APP_SECRET=<Meta App Secret>
YANCE_FACEBOOK_GATEWAY_PUBLIC_BASE_URL=https://facebook-gateway.example.com
YANCE_FACEBOOK_GATEWAY_REDIRECT_URI=https://facebook-gateway.example.com/oauth/facebook/callback
YANCE_FACEBOOK_GATEWAY_WEBHOOK_VERIFY_TOKEN=<random 24+ character value>
YANCE_FACEBOOK_GATEWAY_MASTER_KEY=<64 hex characters or base64 for exactly 32 bytes>
YANCE_FACEBOOK_GATEWAY_DATA_FILE=/var/lib/yance/facebook-gateway.enc.json
YANCE_FACEBOOK_GRAPH_VERSION=v25.0
YANCE_FACEBOOK_GATEWAY_HOST=127.0.0.1
YANCE_FACEBOOK_GATEWAY_PORT=8787
```

Run behind a TLS reverse proxy:

```bash
npm ci --omit=dev
node services/facebook-gateway/server.js
```

## Meta App configuration

1. Configure Facebook Login and add the exact redirect URI above.
2. Configure the Webhooks product for the `Page` object.
3. Set the callback URL to `https://facebook-gateway.example.com/webhooks/facebook` and use the same verify token.
4. Subscribe the app-level Page fields required for Messenger, including `messages`, `messaging_referrals`, `messaging_postbacks`, `message_deliveries`, and `message_reads`.
5. Request/approve the permissions used by the desktop flow: `pages_show_list`, `pages_messaging`, and `pages_manage_metadata`.
6. Put the public gateway base URL into the desktop Facebook OAuth Broker and Relay fields. The desktop converts HTTPS to WSS and uses `/relay/facebook`.

The service performs Page-level `/subscribed_apps` subscription during OAuth. Meta still requires the app-level Webhooks configuration in the App Dashboard.

## Desktop configuration

In **统一账号中心 → 平台配置 → Facebook 公共主页**:

- App ID: same Meta App ID;
- OAuth Broker URL: public gateway base URL;
- Relay URL: public gateway base URL or `wss://.../relay/facebook`;
- Graph API: `v25.0`.

No App Secret is stored on the Windows desktop.
