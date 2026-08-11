YANCE Facebook Personal — Matrix-side read-only acceptance probe

Purpose
-------
This package verifies the already-authorized Facebook Personal bridge from the Matrix side. It does not install software, launch WSL, modify Docker/Compose, change bridge configuration, change Synapse configuration, or perform Facebook login again.

The probe uses the existing local Matrix Lab account @lab:yance-lab.local and reads its password only from:

C:\Users\1\Downloads\yance-multibridge-lab\.runtime\synapse\lab-password.txt

The password is used only for an ephemeral local Matrix login against http://127.0.0.1:8008. The access token and password are never printed. The token is logged out before the probe exits.

What it proves
--------------
1. Local Matrix password login resolves exactly @lab:yance-lab.local.
2. Facebook Personal provisioning at http://127.0.0.1:29319 reports exactly one login and that login is CONNECTED.
3. The provisioning login exposes a Matrix space_room.
4. That room is a real Matrix m.space room.
5. The Facebook space has one or more m.space.child rooms.
6. At least one child room exposes m.room.message events through the Matrix Client-Server API, proving initial history is visible from the Matrix side without printing any message body.
7. The temporary Matrix access token is logged out.

The probe is read-only with respect to conversation state. It does not send messages, create or join rooms, modify profile/state, trigger Facebook login, read Facebook cookies, or perform 2FA/device authorization.

Expected success markers
------------------------
MATRIX_LOCAL_LOGIN_GREEN
FACEBOOK_PROVISIONING_CONNECTED_GREEN login_count=1
FACEBOOK_MATRIX_SPACE_GREEN child_rooms=<count>
FACEBOOK_MATRIX_HISTORY_GREEN rooms_with_messages=<count> message_events=<count>
MATRIX_EPHEMERAL_LOGOUT_GREEN
FINAL STATUS: FACEBOOK_PERSONAL_MATRIX_ACCEPTANCE_GREEN

If the bridge is CONNECTED but initial history has not populated yet, the probe stops REAL_RED rather than treating the connection state alone as full Matrix-side acceptance. This is an acceptance gate, not a repair tool.

Security
--------
Do not send lab-password.txt, Matrix access tokens, Facebook passwords, cookies, 2FA codes, verification codes, or private message bodies to ChatGPT or include them in screenshots. The package intentionally prints only counts and non-secret local authority markers.
