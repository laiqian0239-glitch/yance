YANCE Facebook Personal — Matrix-side invitation reconciliation + acceptance probe

Purpose
-------
This package verifies the already-authorized Facebook Personal bridge from the Matrix side. It does not install software, launch WSL, modify Docker/Compose, change bridge configuration, change Synapse configuration, or perform Facebook login again.

The exact pinned mautrix bridge behavior creates the personal filtering space as a private Matrix room and invites the local Matrix user when homeserver auto-join/double-puppet support is unavailable. Portal rooms are likewise invited to the user. A Matrix client must accept those existing invitations before their state/history is readable.

The probe therefore performs only the minimum Matrix membership reconciliation required by that upstream behavior: it accepts the exact personal space_room returned by the already-CONNECTED provisioning identity, then accepts only child rooms named by that validated space's m.space.child state. It does not discover or join unrelated rooms.

The probe uses the existing local Matrix Lab account @lab:yance-lab.local and reads its password only from:

C:\Users\1\Downloads\yance-multibridge-lab\.runtime\synapse\lab-password.txt

The password is used only for an ephemeral local Matrix login against http://127.0.0.1:8008. The access token and password are never printed. The token is logged out before the probe exits.

What it proves
--------------
1. Local Matrix password login resolves exactly @lab:yance-lab.local.
2. Facebook Personal provisioning at http://127.0.0.1:29319 reports exactly one login and that login is CONNECTED.
3. The provisioning login exposes a Matrix space_room.
4. If the exact upstream private space is invited but not joined, that invitation can be accepted by the local Matrix user.
5. That room is a real Matrix m.space room.
6. The Facebook space has one or more m.space.child rooms.
7. If those exact child rooms are invited but not joined, their invitations can be accepted by the local Matrix user.
8. At least one child room exposes m.room.message events through the Matrix Client-Server API, proving initial history is visible from the Matrix side without printing any message body.
9. The temporary Matrix access token is logged out.

The package never sends messages, creates rooms, modifies bridge/Synapse configuration, triggers Facebook login, reads Facebook cookies, or performs 2FA/device authorization. Its only persistent action is accepting existing Matrix invitations that are already owned by the validated Facebook Personal provisioning space.

Expected success markers
------------------------
MATRIX_LOCAL_LOGIN_GREEN
FACEBOOK_PROVISIONING_CONNECTED_GREEN login_count=1
MATRIX_SPACE_INVITE_ACCEPTED_GREEN              (printed only if the space was not already joined)
FACEBOOK_MATRIX_SPACE_GREEN child_rooms=<count>
MATRIX_CHILD_INVITES_ACCEPTED_GREEN count=<count>
FACEBOOK_MATRIX_HISTORY_GREEN rooms_with_messages=<count> message_events=<count>
MATRIX_EPHEMERAL_LOGOUT_GREEN
FINAL STATUS: FACEBOOK_PERSONAL_MATRIX_ACCEPTANCE_GREEN

If the bridge is CONNECTED but the exact upstream invitations cannot be accepted, or initial history is still not observable after joining, the probe stops REAL_RED rather than weakening the acceptance gate.

Security
--------
Do not send lab-password.txt, Matrix access tokens, Facebook passwords, cookies, 2FA codes, verification codes, or private message bodies to ChatGPT or include them in screenshots. The package intentionally prints only counts and non-secret local authority markers.
