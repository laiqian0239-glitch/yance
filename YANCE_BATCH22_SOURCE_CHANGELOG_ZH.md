# YANCE Batch 22 Source Changelog

- Baseline PackageTree: `feffa17382ce18a54e5349a95800f342fc46d59b`
- Branch: `development/windows-uat-f25fe2e-repair-batch22-root-authority-closure`
- ImplementationCommit: `012685f2f89b4668f8f1ab0d60387506794ed28b`
- ImplementationTree: `4aef90a1d14ca89fa603e4b21aa8faf8e3486576`

## Public-layer changes

1. Unified account send-attempt and real ACK authority across Store, AccountManager, AI Outbox and send queue.
2. Added Schema 15 ExternalIdentity, OutboxRoute and durable identity event outbox contracts.
3. Made inbound identity/message and outbound route/queue writes transactional.
4. Removed realtime UI message-array mutation; SQLite reload is authoritative.
5. Extended persistent operation lifecycle across complete authentication workflows.
6. Scoped delivery health to text, emoji-only and media capabilities.
7. Preserved verified legacy SQLite accounts during restart hydration without deriving send truth from connectivity.
8. Repaired behavioral tests and completed 956/956 isolated backend regression.

This changelog does not authorize Windows UAT completion or release.
