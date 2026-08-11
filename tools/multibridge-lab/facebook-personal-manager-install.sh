#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
deb_path="${2:-}"
bridge_url="${3:-}"
homeserver_url="${4:-}"
expected_name='mautrix-manager_0.2.1_amd64.deb'
expected_sha256='94cca9ffe2087521a042f8afc656c1403dcc79af980acd229420829b367ea1fd'
expected_package='mautrix-manager'
expected_version='0.2.1'
expected_arch='amd64'

real_red() {
  printf 'REAL_RED: %s\n' "$1" >&2
  echo 'FINAL STATUS: REAL_RED' >&2
  exit 1
}

case "$mode" in
  --install-and-smoke|--install-and-launch) ;;
  *) real_red 'unsupported manager installer mode' ;;
esac

[ -f "$deb_path" ] || real_red 'official deb path is missing'
[ "$(basename "$deb_path")" = "$expected_name" ] || real_red 'official deb filename changed'
printf '%s  %s\n' "$expected_sha256" "$deb_path" | sha256sum --check --strict >/dev/null || real_red 'official deb SHA256 mismatch'
echo "MAUTRIX_MANAGER_LINUX_DEB_SHA256_GREEN=$expected_sha256"

package_name="$(dpkg-deb -f "$deb_path" Package)"
package_version="$(dpkg-deb -f "$deb_path" Version)"
package_arch="$(dpkg-deb -f "$deb_path" Architecture)"
[ "$package_name" = "$expected_package" ] || real_red 'official deb package name changed'
[ "$package_version" = "$expected_version" ] || real_red 'official deb package version changed'
[ "$package_arch" = "$expected_arch" ] || real_red 'official deb architecture changed'
echo "MAUTRIX_MANAGER_LINUX_DEB_IDENTITY_GREEN package=$package_name version=$package_version arch=$package_arch"

installed_version=''
if dpkg-query -W -f='${Version}' "$expected_package" >/dev/null 2>&1; then
  installed_version="$(dpkg-query -W -f='${Version}' "$expected_package")"
fi
if [ -n "$installed_version" ] && [ "$installed_version" != "$expected_version" ]; then
  real_red "a different mautrix-manager version is already installed: $installed_version"
fi
if [ -z "$installed_version" ]; then
  sudo -v
  sudo apt-get update
  sudo apt-get install -y "$deb_path"
fi

actual_version="$(dpkg-query -W -f='${Version}' "$expected_package" 2>/dev/null || true)"
[ "$actual_version" = "$expected_version" ] || real_red 'exact mautrix-manager package is not installed'

mapfile -t sandboxes < <(dpkg -L "$expected_package" | grep '/chrome-sandbox$' || true)
[ "${#sandboxes[@]}" -eq 1 ] || real_red "expected exactly one installed chrome-sandbox, found ${#sandboxes[@]}"
sandbox="${sandboxes[0]}"
sandbox_meta="$(stat -c 'path=%n owner=%U group=%G mode=%a uid=%u gid=%g' "$sandbox")"
echo "$sandbox_meta"
grep -Fq 'owner=root' <<<"$sandbox_meta" || real_red 'installed sandbox owner is not root'
grep -Fq 'group=root' <<<"$sandbox_meta" || real_red 'installed sandbox group is not root'
grep -Fq 'mode=4755' <<<"$sandbox_meta" || real_red 'installed sandbox mode is not 4755'
echo 'MAUTRIX_MANAGER_LINUX_DEB_SANDBOX_GREEN'

exe=''
while IFS= read -r candidate; do
  [ -e "$candidate" ] || continue
  resolved="$(readlink -f "$candidate")"
  identity="$(file -L "$resolved")"
  if grep -Fq 'ELF 64-bit' <<<"$identity" && grep -Eq 'x86-64|x86_64' <<<"$identity"; then
    exe="$resolved"
    break
  fi
done < <(dpkg -L "$expected_package" | grep '/mautrix-manager$' || true)
[ -n "$exe" ] || real_red 'installed mautrix-manager ELF executable was not found'
echo "MAUTRIX_MANAGER_EXECUTABLE_GREEN=$exe"

ldd_output="$(ldd "$exe" 2>&1)" || real_red 'ldd failed for installed manager'
printf '%s\n' "$ldd_output"
if grep -Fq 'not found' <<<"$ldd_output"; then
  real_red 'installed manager has missing shared libraries'
fi
echo 'MAUTRIX_MANAGER_LINUX_DEB_DEPENDENCIES_GREEN'

if [ "$mode" = '--install-and-smoke' ]; then
  command -v xvfb-run >/dev/null 2>&1 || real_red 'xvfb-run is required for CI smoke'
  set +e
  timeout --signal=TERM --kill-after=3s 8s xvfb-run -a "$exe" >/tmp/yance-manager-smoke.stdout 2>/tmp/yance-manager-smoke.stderr
  smoke_rc=$?
  set -e
  if [ "$smoke_rc" -ne 124 ]; then
    echo '=== bounded stdout ===' >&2
    sed -n '1,80p' /tmp/yance-manager-smoke.stdout >&2 || true
    echo '=== bounded stderr ===' >&2
    sed -n '1,80p' /tmp/yance-manager-smoke.stderr >&2 || true
    real_red "manager exited before the 8-second smoke window: exit=$smoke_rc"
  fi
  echo 'MANAGER_INSTALL_SMOKE_GREEN'
  exit 0
fi

launch_uid="$(id -u)"
launch_user="$(id -un)"
[ "$launch_uid" -ne 0 ] || real_red 'mautrix-manager GUI launch requires a non-root WSL user'
[ "$launch_user" != 'root' ] || real_red 'mautrix-manager GUI launch resolved root unexpectedly'
echo "MAUTRIX_MANAGER_GUI_USER_GREEN user=$launch_user uid=$launch_uid"

[ -d /mnt/wslg ] || real_red 'WSLg runtime directory is unavailable'
if [ -z "${WAYLAND_DISPLAY:-}" ] && [ -z "${DISPLAY:-}" ]; then
  real_red 'WSLg display environment is unavailable'
fi
[ -n "$bridge_url" ] || real_red 'Facebook Personal bridge URL was not supplied by the preflight'
[ -n "$homeserver_url" ] || real_red 'Matrix homeserver URL was not supplied by the preflight'

state_root="${XDG_STATE_HOME:-$HOME/.local/state}/yance-multibridge-lab"
mkdir -p "$state_root"
manager_log="$state_root/mautrix-manager.log"
if ! pgrep -f -- "$exe" >/dev/null 2>&1; then
  nohup "$exe" >"$manager_log" 2>&1 </dev/null &
  sleep 5
fi
if ! pgrep -f -- "$exe" >/dev/null 2>&1; then
  echo '=== bounded manager log ===' >&2
  sed -n '1,80p' "$manager_log" >&2 || true
  real_red 'mautrix-manager did not remain running under WSLg'
fi

echo 'MAUTRIX_MANAGER_GUI_LAUNCHED'
echo "MATRIX_HOMESERVER=$homeserver_url"
echo "FACEBOOK_PERSONAL_BRIDGE_URL=$bridge_url"
echo 'Use the existing local Matrix Lab account in the upstream GUI, then add the displayed Bridge URL.'
echo 'No remote-network authorization is performed by this package.'
echo 'FINAL STATUS: HUMAN_AUTH_REQUIRED'