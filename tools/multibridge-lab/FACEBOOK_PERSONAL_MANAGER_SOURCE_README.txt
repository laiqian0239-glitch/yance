YANCE-MULTIBRIDGE-LAB — Facebook Personal / mautrix-manager source launcher

Why this package exists
-----------------------
The official mautrix-manager v0.2.1 Windows Squirrel installer is not Authenticode-signed and may be blocked by Microsoft Defender SmartScreen as an unknown publisher. Do not click "Run anyway" / "仍要运行" and do not disable SmartScreen.

This launcher avoids that unsigned-installer boundary by running the exact official source instead of the installer. It does not fork or modify mautrix-manager and does not implement any login UI itself.

Frozen official source
----------------------
Repository: https://github.com/mautrix/manager.git
Version: mautrix-manager v0.2.1
Exact commit: d2c08e60c7a877602bc6da2961daf2daffcff79b
Official package entrypoint: npm start -> electron-forge start
Exact Electron dependency declared upstream: 43.2.0

What the launcher does
----------------------
1. Requires Git for Windows, Node.js 22+ and npm.
2. Uses a dedicated cache under %%LOCALAPPDATA%%\YanceLab\mautrix-manager-v0.2.1\source.
3. Fetches only the official mautrix/manager repository and checks out the exact frozen commit detached.
4. Verifies the actual Git HEAD plus upstream package name/version/Electron identity.
5. Runs the upstream lockfile install with `npm ci --include=dev`.
6. Runs upstream `npm run lint` before opening the app.
7. Starts the unchanged official source with `npm start`.

The launcher does not use the unsigned Setup.exe, does not alter SmartScreen, does not unblock downloaded executables, does not modify PowerShell execution policy, and does not read or copy Matrix/Facebook authorization material.

Human authorization boundary
----------------------------
When the mautrix-manager GUI opens, the project is at HUMAN_AUTH_REQUIRED. Facebook Personal must use the pinned Meta bridge's upstream bridgev2 login/provisioning flow. Do not send Matrix credentials, Facebook credentials, browser authorization material, verification codes or device-confirmation data to ChatGPT.

If the launcher prints REAL_RED, leave the window open and send only a screenshot of the bounded status/error text. Do not upload the managed source directory or any Lab runtime/config files.
