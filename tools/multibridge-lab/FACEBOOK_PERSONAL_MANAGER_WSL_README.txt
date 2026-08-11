YANCE Facebook Personal — official mautrix-manager WSL operator package

Purpose
-------
This package crosses only the qualified operator-runtime boundary for Facebook Personal. It uses the existing Ubuntu-24.04 WSL2/WSLg environment and the exact official mautrix-manager v0.2.1 amd64 .deb. It does not create a Yance login framework: upstream mautrix-manager and mautrix/meta remain the login/provisioning authority.

Runtime identity model
----------------------
The official Debian package is installed through the distro's native package-manager authority. If Ubuntu-24.04 is already running as a normal user, package installation may request sudo authorization. If the distro's current/default identity is root, package installation runs directly under that existing root package-manager authority.

The Electron GUI is never launched as root. The operator first tries to reuse an existing non-root Ubuntu account that has a usable WSLg display environment. If this Ubuntu-24.04 installation is root-only and no such account exists, the operator creates one narrowly scoped unprivileged Linux account named yance-manager using Ubuntu's standard useradd command. The account receives its own home directory and /bin/bash shell. It is not added to sudo/admin groups, does not become the WSL default user, and the operator does not modify /etc/wsl.conf or .wslconfig.

After the exact package is installed, the GUI is launched explicitly through:

wsl.exe --distribution Ubuntu-24.04 --user <resolved-non-root-user> ...

A root-only distro may therefore emit:
- WSL_GUI_USER_CREATED=yance-manager
- WSL_GUI_USER_GREEN user=yance-manager uid=<non-zero> created=True
- MAUTRIX_MANAGER_GUI_USER_GREEN user=yance-manager uid=<non-zero>

Before manager launch
---------------------
The Windows launcher re-runs the sealed WSL readiness checker and requires WSL_GUI_READY for Ubuntu-24.04. It reads the existing Lab authority at C:\Users\1\Downloads\yance-multibridge-lab and verifies the frozen Facebook Personal stage/image identity, the real .appservice.address, provisioning.allow_matrix_auth=true, the running Compose container, and the Compose-published provisioning port.

The launcher also proves that Ubuntu-24.04 can reach that published Facebook Personal port through 127.0.0.1. If that endpoint is not published and reachable, the package stops REAL_RED before manager launch. It does not use Docker/Windows networking workarounds, Windows Firewall changes, .wslconfig changes, host networking, or portproxy rules.

Qualified upstream package
--------------------------
File: mautrix-manager_0.2.1_amd64.deb
SHA256: 94cca9ffe2087521a042f8afc656c1403dcc79af980acd229420829b367ea1fd

Installation and launch remain separate authority phases. The installer refuses a different already-installed mautrix-manager version, verifies package/version/architecture, verifies the installed Chromium chrome-sandbox remains root-owned with mode 4755, verifies shared-library dependencies, and explicitly rejects a root GUI launch before Electron is started. It never runs npm or Electron Forge, never disables Chromium sandboxing, and never manually changes sandbox ownership or mode.

Upstream GUI lifecycle authority
--------------------------------
The GUI process is not daemonized or detached from the operator. The launcher starts the exact installed mautrix-manager executable, captures that exact top-level PID, and keeps the WSL invocation attached to it. It does not use nohup or broad pgrep matching, so Chromium GPU/network/zygote child processes cannot be mistaken for a healthy mautrix-manager main process.

Before declaring a human-authorization boundary, the exact manager PID must remain alive continuously for 15 seconds. Only after that sustained-session proof does the operator emit:

MAUTRIX_MANAGER_GUI_SESSION_GREEN pid=<exact-manager-pid> stable_seconds=15
MAUTRIX_MANAGER_GUI_LAUNCHED
FINAL STATUS: HUMAN_AUTH_REQUIRED

The operator then continues waiting on that exact upstream manager PID while the GUI is open. A normal user close that returns exit 0 ends the attached session cleanly. If the upstream main process exits before the 15-second gate, or later exits nonzero, the package prints a bounded excerpt from mautrix-manager.log and returns REAL_RED with the exact process exit status instead of reporting a false HUMAN_AUTH_REQUIRED state.

Chromium/Electron child-process messages such as GPU-process, network-service, or zygote failures are diagnostic evidence only. They do not become a Yance-managed compatibility switch. This package does not add --no-sandbox, --disable-gpu, --disable-gpu-sandbox, software-rendering overrides, XDG_RUNTIME_DIR permission changes, WSL configuration changes, or graphics-driver mutations.

Human authorization boundary
----------------------------
After the exact-PID sustained-session gate succeeds, the upstream mautrix-manager GUI is the authority for the remaining interaction. The GUI will show/use these non-secret local endpoints:
- Matrix homeserver: http://127.0.0.1:8008
- Facebook Personal Bridge URL: printed by the launcher as http://127.0.0.1:<published-port>

Use the existing local Matrix Lab account in the upstream GUI, then add the displayed Bridge URL. The package does not request or collect any Facebook password, cookies, verification codes, device confirmations, Matrix credentials, or other account secrets. Do not send those secrets to ChatGPT or include them in screenshots.

Expected terminal states
------------------------
- HUMAN_AUTH_REQUIRED: the exact official manager main PID survived the sustained WSLg session gate and remains attached; the next action is human authorization in the upstream GUI.
- MAUTRIX_MANAGER_GUI_SESSION_ENDED exit=0: the upstream GUI was later closed normally after the human-authorization boundary was reached.
- WSL_SETUP_REQUIRED / WSL_LAB_NETWORK_REQUIRED: the prerequisite checker stopped before package installation.
- REAL_RED: a runtime/package/provisioning/user-authority or exact-manager-process lifecycle check failed; do not bypass it.