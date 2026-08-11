YANCE Facebook Personal — official mautrix-manager WSL operator package

Purpose
-------
This package crosses only the qualified operator-runtime boundary for Facebook Personal. It uses the existing Ubuntu-24.04 WSL2/WSLg environment and the exact official mautrix-manager v0.2.1 amd64 .deb. It does not create a Yance login framework.

Before installation
-------------------
The Windows launcher first re-runs the sealed WSL readiness checker and requires WSL_GUI_READY for Ubuntu-24.04. It then resolves an existing non-root interactive Ubuntu account whose WSLg display session is usable. The upstream GUI is always launched with an explicit `wsl.exe --distribution Ubuntu-24.04 --user <resolved-user>` boundary; it is never launched as root.

The launcher then reads the existing Lab authority at C:\Users\1\Downloads\yance-multibridge-lab and verifies the frozen Facebook Personal stage/image identity, the real .appservice.address, provisioning.allow_matrix_auth=true, the running Compose container, and the Compose-published provisioning port.

The launcher also proves that Ubuntu-24.04 can reach that published Facebook Personal port through 127.0.0.1. If that endpoint is not published and reachable, the package stops REAL_RED before downloading or installing mautrix-manager. It does not use Docker/Windows networking workarounds, Windows Firewall changes, .wslconfig changes, host networking, or portproxy rules.

Qualified upstream package
--------------------------
File: mautrix-manager_0.2.1_amd64.deb
SHA256: 94cca9ffe2087521a042f8afc656c1403dcc79af980acd229420829b367ea1fd

Installation uses native Debian package-manager semantics only. Ubuntu may request sudo authorization for package installation, but the GUI process itself runs as the resolved non-root Ubuntu user. The installer refuses a different already-installed mautrix-manager version, verifies package/version/architecture, verifies the installed Chromium chrome-sandbox remains root-owned with mode 4755, verifies shared-library dependencies, and explicitly rejects a root GUI launch before Electron is started. It never runs npm or Electron Forge, never disables Chromium sandboxing, and never manually changes sandbox ownership or mode.

Human authorization boundary
----------------------------
After installation the package launches the upstream mautrix-manager GUI through WSLg and stops at:

FINAL STATUS: HUMAN_AUTH_REQUIRED

The GUI will show/use these non-secret local endpoints:
- Matrix homeserver: http://127.0.0.1:8008
- Facebook Personal Bridge URL: printed by the launcher as http://127.0.0.1:<published-port>

Use the existing local Matrix Lab account in the upstream GUI, then add the displayed Bridge URL. The package does not request or collect any Facebook password, cookies, verification codes, device confirmations, Matrix credentials, or other account secrets. Do not send those secrets to ChatGPT or include them in screenshots.

Expected terminal states
------------------------
- HUMAN_AUTH_REQUIRED: official manager is installed/running as the resolved non-root WSLg user and the next action is human authorization in the upstream GUI.
- WSL_SETUP_REQUIRED / WSL_LAB_NETWORK_REQUIRED: the prerequisite checker stopped before package installation.
- REAL_RED: a runtime/package/provisioning/user-authority check failed; do not bypass it.