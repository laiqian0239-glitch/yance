YANCE-MULTIBRIDGE-LAB — Facebook Personal WSL2 / WSLg Readiness

Purpose
-------
This is a read-only capability checker for the mature upstream Linux operator
path. It does not install WSL, does not update WSL, does not change a distro
version or default distro, does not install Linux packages, and does not modify
Windows networking, firewall, registry, optional features, or .wslconfig.

Why this exists
---------------
The official mautrix-manager v0.2.1 Windows application is not Authenticode
signed. The official Linux ZIP also cannot safely launch on the audited Ubuntu
24.04 sandbox policy because its extracted chrome-sandbox is not installed with
package-manager setuid semantics. The exact official amd64 .deb has passed the
project's upstream CI gate: package-manager installation gives the expected
root-owned 4755 sandbox and the application survives a bounded no-login GUI
smoke without disabling Chromium sandboxing.

What this checker reads
-----------------------
- WSL general status and component version information.
- The installed distro list and whether a distro uses WSL 2.
- Inside an existing WSL 2 distro only: CPU architecture, presence of apt-get
  and dpkg, and WSLg display markers.
- A bounded TCP check from that distro to the existing Windows Synapse port
  8008. It first checks localhost and then the Windows host address exposed by
  the distro's default route.

No Matrix password, access token, Facebook credential, cookie, 2FA code,
bridge configuration, database, registration, or message data is read.

Run
---
Double-click RUN_FACEBOOK_PERSONAL_WSL_READINESS.cmd.
The window stays open so the final status can be photographed.

Possible final statuses
-----------------------
WSL_GUI_READY
  An existing amd64 Debian-family WSL 2 distro has WSLg, apt/dpkg, and can
  reach the current Windows Lab Synapse port. This is the required precondition
  before requesting permission to install the exact official mautrix-manager
  .deb inside that distro.

WSL_SETUP_REQUIRED
  WSL, WSL 2, an amd64 apt/dpkg distro, or WSLg is not currently available.
  The checker does not install or change any of those system components.

WSL_LAB_NETWORK_REQUIRED
  WSLg is available, but the selected distro cannot reach the existing Windows
  Lab Synapse endpoint through either localhost or the Windows host address.
  The checker does not change networking to force this GREEN.

REAL_RED
  An unexpected checker/runtime failure occurred before a valid classification.

Safety boundary
---------------
Do not enter any account credentials during this check. This package is only a
read-only capability probe. Actual Linux package installation and all real
Facebook/Matrix authorization remain separate human/system authorization
boundaries.
