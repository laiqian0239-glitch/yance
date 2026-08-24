#!/usr/bin/env bash
set -euo pipefail

node_root="$RUNNER_TEMP/node-v22.19.0-linux-x64"
curl -fsSL 'https://nodejs.org/dist/v22.19.0/node-v22.19.0-linux-x64.tar.xz' -o "$RUNNER_TEMP/node.tar.xz"
tar -xJf "$RUNNER_TEMP/node.tar.xz" -C "$RUNNER_TEMP"
export PATH="$node_root/bin:$PATH"
npm install --global npm@10.9.2 --ignore-scripts --no-audit --no-fund
node --version
npm --version

cp package-lock.json /tmp/package-lock.before.json
node .github/tmp-v21-electron-pin-reviewed-graph.js
npm install --package-lock-only --ignore-scripts --no-audit --no-fund --save-dev --save-exact electron@43.4.1
node .github/tmp-v21-electron-normalize-lock.js

mkdir -p vendor/npm /tmp/yance-electron-seeds
pack_one() {
  local spec="$1"
  local dest="$2"
  local json filename
  json="$(cd /tmp/yance-electron-seeds && npm pack "$spec" --json)"
  filename="$(printf '%s' "$json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s)[0].filename))")"
  test -n "$filename"
  mv -f "/tmp/yance-electron-seeds/$filename" "$dest"
}
pack_one '@electron-internal/extract-zip@1.0.3' 'vendor/npm/_at_electron-internal__extract-zip-1.0.3.tgz'
pack_one '@electron/get@5.0.0' 'vendor/npm/_at_electron__get-5.0.0.tgz'
pack_one '@types/node@24.10.13' 'vendor/npm/_at_types__node-24.10.13.tgz'
pack_one 'electron@43.4.1' 'vendor/npm/electron-43.4.1.tgz'
pack_one 'env-paths@3.0.0' 'vendor/npm/env-paths-3.0.0.tgz'
pack_one 'undici@7.25.0' 'vendor/npm/undici-7.25.0.tgz'
pack_one 'undici-types@7.16.0' 'vendor/npm/undici-types-7.16.0.tgz'

curl -fsSL \
  -H 'Accept: application/vnd.github+json' \
  -H "Authorization: Bearer ${GH_TOKEN}" \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  -H 'User-Agent: yance-electron-production-tree' \
  'https://api.github.com/repos/electron/electron/releases/tags/v43.4.1' \
  -o /tmp/electron-release.json

node .github/tmp-v21-electron-allow-trusted-reuse.js
node .github/tmp-v21-electron-43-4-1-factory.js
node .github/tmp-v21-electron-post-generate-fix.js
node .github/tmp-v21-electron-fix-source-test-import.js

node --test tests/wp0/v21-electron-supported-runtime-p0.test.js
node --test tests/runtime-delivery/electron-archive-tracking-authority.test.js tests/runtime-delivery/source-uat-delivery.test.js
node --test tests/layered-ci/governance-policy.test.js
node -e "require('./tools/runtime-delivery/dependency-install-authority').verifyTrustedDependencySeeds(process.cwd()); console.log('trusted dependency seeds PASS')"

cat > /tmp/expected-production-paths.txt <<'EOF'
.github/workflows/stage-6459-wp0-gates.yml
.github/workflows/v21-product-experience-shell-p0-final-validation.yml
.github/workflows/windows-production-release.yml
governance/dependency-install-batch-manifest.json
governance/dependency-install-policy.json
governance/layered-ci/risk-policy.json
package-lock.json
package.json
release/electron-distribution-trust.json
tests/layered-ci/governance-policy.test.js
tests/runtime-delivery/electron-archive-tracking-authority.test.js
tests/runtime-delivery/source-uat-delivery.test.js
tools/release-closure/RUN_WINDOWS_ASSISTED_PIPELINE.ps1
tools/release-closure/WINDOWS_PREVIEW_UAT_RUNNER.template.ps1
tools/windows/VERIFY_RUNTIME_IDENTITY.ps1
tools/wp7/generate-trusted-product-probe-blocker.js
vendor/npm/_at_electron-internal__extract-zip-1.0.3.tgz
vendor/npm/_at_electron__get-5.0.0.tgz
vendor/npm/_at_types__node-24.10.13.tgz
vendor/npm/electron-43.4.1.tgz
vendor/npm/env-paths-3.0.0.tgz
vendor/npm/undici-7.25.0.tgz
vendor/npm/undici-types-7.16.0.tgz
EOF
git diff --name-only | sort > /tmp/actual-production-paths.txt
sort -o /tmp/expected-production-paths.txt /tmp/expected-production-paths.txt
diff -u /tmp/expected-production-paths.txt /tmp/actual-production-paths.txt

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add -- $(cat /tmp/expected-production-paths.txt)
git diff --cached --quiet && { echo 'Exact production tree already generated.'; exit 0; }
git commit -m '[staging] Generate exact Electron 43.4.1 production tree'
git push origin HEAD:"$GITHUB_HEAD_REF"
