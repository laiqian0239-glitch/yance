"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "../..");
const mode = process.argv[2] || "runtime";
const env = process.env;
const elementUrl = (env.YANCE_ACCEPTANCE_ELEMENT_URL || env.YANCE_ELEMENT_URL || "http://127.0.0.1:53796").replace(/\/$/, "");
const matrixUrl = (env.YANCE_ACCEPTANCE_MATRIX_URL || env.YANCE_MATRIX_BASE_URL || "http://127.0.0.1:53795").replace(/\/$/, "");
const backendUrl = (env.YANCE_ACCEPTANCE_BACKEND_URL || "http://127.0.0.1:27632").replace(/\/$/, "");
const cdpUrl = (env.YANCE_ACCEPTANCE_CDP_URL || "http://127.0.0.1:9223").replace(/\/$/, "");
const readyTimeoutMs = Number(env.YANCE_ACCEPTANCE_READY_TIMEOUT_MS || 20000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const out = (payload) => process.stdout.write(JSON.stringify(payload, null, 2) + "\n");

function fail(classification, code, evidence = {}) {
  out({ status: "RED", classification, code, evidence });
  process.exit(1);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: repoRoot, encoding: "utf8", windowsHide: true, ...options });
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function fetchJson(url, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
function packageManager(filePath) {
  const pkg = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return String(pkg.packageManager || "");
}

function resolveShell() {
  const where = run(process.platform === "win32" ? "where.exe" : "which", ["sh"]);
  if (where.status === 0) return String(where.stdout || "").trim().split(/\r?\n/)[0];
  if (process.platform === "win32") {
    const gitSh = "C:\\Program Files\\Git\\bin\\sh.exe";
    if (fs.existsSync(gitSh)) return gitSh;
  }
  return "";
}

function buildAdmission() {
  const rootManager = packageManager(path.join(repoRoot, "package.json"));
  if (!rootManager.startsWith("npm@")) {
    fail("HARNESS_RED", "ROOT_PACKAGE_MANAGER_DRIFT", { rootManager });
  }
  const ambientNpm = process.platform === "win32"
    ? run("cmd.exe", ["/d", "/s", "/c", "npm --version"])
    : run("npm", ["--version"]);
  const rootNpm = process.platform === "win32"
    ? run("cmd.exe", ["/d", "/s", "/c", "corepack npm --version"])
    : run("corepack", ["npm", "--version"]);
  if (rootNpm.status !== 0) {
    fail("HARNESS_RED", "ROOT_COREPACK_NPM_UNAVAILABLE", { stderr: rootNpm.stderr, error: String(rootNpm.error || "") });
  }
  const expectedNpm = rootManager.split("@").pop();
  const rootNpmVersion = String(rootNpm.stdout || "").trim();
  if (expectedNpm && rootNpmVersion !== expectedNpm) {
    fail("HARNESS_RED", "ROOT_NPM_VERSION_DRIFT", { expectedNpm, rootNpmVersion });
  }

  const elementRoot = path.join(repoRoot, "services", "matrix", ".runtime", "element-web");
  const elementPkg = path.join(elementRoot, "package.json");
  if (!fs.existsSync(elementPkg)) fail("HARNESS_RED", "ELEMENT_RUNTIME_NOT_MATERIALIZED");
  const elementManager = packageManager(elementPkg);
  if (!elementManager.startsWith("pnpm@")) {
    fail("HARNESS_RED", "ELEMENT_PACKAGE_MANAGER_DRIFT", { elementManager });
  }

  const corepack = process.platform === "win32"
    ? run("cmd.exe", ["/d", "/s", "/c", "corepack pnpm --version"], { cwd: elementRoot })
    : run("corepack", ["pnpm", "--version"], { cwd: elementRoot });
  if (corepack.status !== 0) fail("HARNESS_RED", "COREPACK_PNPM_UNAVAILABLE", { stderr: corepack.stderr, error: String(corepack.error || "") });
  const pnpmVersion = String(corepack.stdout || "").trim();
  const expectedPnpm = elementManager.split("@").pop();
  if (expectedPnpm && pnpmVersion !== expectedPnpm) {
    fail("HARNESS_RED", "ELEMENT_PNPM_VERSION_DRIFT", { expectedPnpm, pnpmVersion });
  }

  const shPath = resolveShell();
  if (!shPath) fail("HARNESS_RED", "ELEMENT_SH_UNAVAILABLE");
  const nxPath = path.join(elementRoot, "node_modules", ".bin", process.platform === "win32" ? "nx.CMD" : "nx");
  if (!fs.existsSync(nxPath)) fail("HARNESS_RED", "ELEMENT_NX_NOT_MATERIALIZED", { nxPath });

  return {
    rootManager,
    rootNpmVersion,
    ambientNpmVersion: ambientNpm.status === 0 ? String(ambientNpm.stdout || "").trim() : "",
    elementManager,
    pnpmVersion,
    shPath,
    nxPath,
  };
}
function elementPort() {
  const parsed = new URL(elementUrl);
  return parsed.port || (parsed.protocol === "https:" ? "443" : "80");
}

function dockerAdmission() {
  const docker = run("docker", ["version", "--format", "{{.Server.Version}}"]);
  if (docker.status !== 0) fail("HARNESS_RED", "DOCKER_ENGINE_UNAVAILABLE", { stderr: docker.stderr });

  const ps = run("docker", ["ps", "--filter", `publish=${elementPort()}`, "--format", "{{.Names}}"]);
  if (ps.status !== 0) fail("HARNESS_RED", "ELEMENT_CONTAINER_DISCOVERY_RED", { stderr: ps.stderr });
  const names = String(ps.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  if (names.length !== 1) fail("HARNESS_RED", "ELEMENT_CONTAINER_IDENTITY_AMBIGUOUS", { names });

  const elementContainer = names[0];
  const inspect = run("docker", ["inspect", elementContainer]);
  if (inspect.status !== 0) fail("HARNESS_RED", "ELEMENT_CONTAINER_INSPECT_RED");
  const info = JSON.parse(inspect.stdout)[0];
  if (info?.State?.Running !== true) fail("HARNESS_RED", "ELEMENT_CONTAINER_NOT_RUNNING", { elementContainer });

  const networks = Object.keys(info?.NetworkSettings?.Networks || {});
  const peers = new Set();
  for (const network of networks) {
    const peer = run("docker", ["ps", "--filter", `network=${network}`, "--format", "{{.Names}}"]);
    if (peer.status === 0) {
      for (const name of String(peer.stdout || "").trim().split(/\r?\n/).filter(Boolean)) peers.add(name);
    }
  }
  const required = ["synapse", "mautrix-meta", "mautrix-whatsapp", "mautrix-telegram"];
  const missing = required.filter((token) => ![...peers].some((name) => name.includes(token)));
  if (missing.length) fail("HARNESS_RED", "ACCEPTANCE_RUNTIME_CONTAINER_BOUNDARY_INCOMPLETE", { missing, peers: [...peers] });

  const mounts = info.Mounts || [];
  const yanceMount = mounts.find((m) => m.Destination === "/modules/yance/lib");
  const configMount = mounts.find((m) => m.Destination === "/app/config.json");
  if (!yanceMount || !configMount) {
    fail("HARNESS_RED", "ACCEPTANCE_MATERIALIZED_MOUNTS_INCOMPLETE", { mounts: mounts.map((m) => m.Destination) });
  }

  const hostLib = path.join(yanceMount.Source, "index.js");
  if (!fs.existsSync(hostLib)) fail("HARNESS_RED", "YANCE_MATERIALIZED_LIB_MISSING", { hostLib });
  const containerHash = run("docker", ["exec", elementContainer, "sh", "-lc", "sha256sum /modules/yance/lib/index.js"]);
  if (containerHash.status !== 0) fail("HARNESS_RED", "YANCE_CONTAINER_HASH_RED");
  const actual = String(containerHash.stdout || "").trim().split(/\s+/)[0];
  const expected = sha256(hostLib);
  if (actual !== expected) fail("HARNESS_RED", "YANCE_MATERIALIZED_LIB_IDENTITY_DRIFT", { expected, actual });

  return { dockerVersion: String(docker.stdout || "").trim(), elementContainer, networks, yanceLibSha256: actual };
}
async function openCdp() {
  if (typeof WebSocket !== "function") fail("HELPER_RED", "NODE_WEBSOCKET_UNAVAILABLE");
  const targets = await fetchJson(cdpUrl + "/json");
  const target = targets.find((item) => item.type === "page" && String(item.url || "").startsWith(elementUrl));
  if (!target) fail("HARNESS_RED", "ELEMENT_CDP_TARGET_NOT_FOUND", { elementUrl, targets: targets.map((t) => t.url) });

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP websocket timeout")), 4000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener("error", (event) => { clearTimeout(timer); reject(event.error || new Error("CDP websocket error")); }, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const item = pending.get(message.id);
    pending.delete(message.id);
    message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id;
    pending.set(next, { resolve, reject });
    ws.send(JSON.stringify({ id: next, method, params }));
  });
  await send("Runtime.enable");
  await send("Page.enable");
  return { ws, send };
}

const pageExpression = `(()=>{const h=(selector)=>{const node=document.querySelector(selector);return node?Math.round(node.getBoundingClientRect().height):0;};const conversationActive=!!document.querySelector(".yance-product-conversation--immersive");const contactRows=[...document.querySelectorAll(".yance-product-conversation__people-list > button")];const facebookRows=contactRows.filter((row)=>/facebook/i.test(row.innerText||""));const facebookAvatarImages=facebookRows.map((row)=>row.querySelector(".yance-product-conversation__people-avatar img"));const avatarImageReady=(img)=>{if(!img)return false;const style=getComputedStyle(img);const rect=img.getBoundingClientRect();return img.complete===true&&img.naturalWidth>0&&img.naturalHeight>0&&style.display!=="none"&&style.visibility!=="hidden"&&Number(style.opacity)>0&&rect.width>0&&rect.height>0;};return {
  href: location.href,
  route: location.hash,
  rawLogin: !!document.querySelector(".mx_Login"),
  rawAuth: !!document.querySelector(".mx_AuthPage"),
  productShell: !!document.querySelector(".yance-product-shell"),
  personalAccess: !!document.querySelector(".yance-personal-access"),
  userId: localStorage.getItem("mx_user_id") || "",
  deviceId: localStorage.getItem("mx_device_id") || "",
  serviceWorkerAvailable: "serviceWorker" in navigator,
  serviceWorkerControlled: !("serviceWorker" in navigator) || !!navigator.serviceWorker.controller,
  viewportHeight: window.innerHeight,
  conversationActive,
  conversationRailCount: document.querySelectorAll(".yance-conversation-rail").length,
  outerRailCount: document.querySelectorAll(".yance-product-shell > .yance-desktop-rail").length,
  conversationRootHeight: h(".yance-product-conversation--immersive"),
  conversationWorkspaceHeight: h(".yance-product-conversation__workspace"),
  conversationPeopleHeight: h(".yance-product-conversation__people-list"),
  conversationRoomHeight: h(".mx_RoomView"),
  conversationPresentation: !!document.querySelector(".mx_RoomView_yanceProductConversation"),
  conversationIdentityCard: !!document.querySelector(".yance-conversation-inspector__identity"),
  conversationFacebookRowCount: facebookRows.length,
  conversationFacebookAvatarImageCount: facebookAvatarImages.filter(Boolean).length,
  conversationFacebookAvatarLoadedVisibleCount: facebookAvatarImages.filter(avatarImageReady).length,
  conversationFacebookAvatarDiagnostics: facebookAvatarImages.map((img)=>img?{complete:img.complete,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,src:img.currentSrc||img.src||""}:null),
  conversationInspectorTabCount: document.querySelectorAll(".yance-conversation-inspector__tabs button").length,
  conversationPaneToggleCount: document.querySelectorAll(".yance-native-pane-toggle").length,
  conversationRichReplyToolCount: document.querySelectorAll(".yance-rich-reply-tools > button").length,
  conversationComposerPresent: !!document.querySelector(".mx_RoomView_yanceProductConversation .mx_MessageComposer"),
  conversationNewRoomIntroCount: document.querySelectorAll(".mx_RoomView_yanceProductConversation .mx_NewRoomIntro").length,
  conversationCryptoEventCount: document.querySelectorAll(".mx_RoomView_yanceProductConversation .mx_cryptoEvent").length,
  conversationSystemSummaryCount: document.querySelectorAll(".mx_RoomView_yanceProductConversation .mx_GenericEventListSummary_summary").length,
  bodyText: (document.body?.innerText || "").slice(0, 360)
};})()`;

async function pageState(cdp) {
  const result = await cdp.send("Runtime.evaluate", { expression: pageExpression, returnByValue: true });
  return result?.result?.value || {};
}
async function waitForSessionReady(cdp) {
  const deadline = Date.now() + readyTimeoutMs;
  let last = {};
  while (Date.now() < deadline) {
    try {
      last = await pageState(cdp);
      if (last.rawLogin || last.rawAuth) {
        fail("PRODUCT_RED", "ACCEPTANCE_LOGIN_ROUTE_FORBIDDEN", last);
      }
      if (last.productShell && !last.personalAccess && last.userId && last.deviceId) return last;
    } catch {
      // The renderer context can disappear briefly while becoming reload-ready.
    }
    await sleep(350);
  }
  fail("PRODUCT_RED", "ACCEPTANCE_SESSION_OR_ENTITLEMENT_NOT_READY", last);
}
async function waitForConversationActive(cdp) {
  const deadline = Date.now() + readyTimeoutMs;
  let last = {};
  while (Date.now() < deadline) {
    try {
      last = await pageState(cdp);
      if (last.rawLogin || last.rawAuth) {
        fail("PRODUCT_RED", "ACCEPTANCE_LOGIN_ROUTE_FORBIDDEN", last);
      }
      if (last.productShell && !last.personalAccess && last.userId && last.deviceId && last.conversationActive) return last;
      if (last.productShell && !last.personalAccess && last.userId && last.deviceId) {
        await cdp.send("Runtime.evaluate", {
          expression: `(()=>{const target=[...document.querySelectorAll("button,[role='button']")].find((node)=>(node.innerText||"").trim()==="对话");if(!target)return false;target.click();return true;})()`,
          returnByValue: true,
        });
      }
    } catch {
      // The renderer context can disappear briefly while restoring Product Conversation.
    }
    await sleep(500);
  }
  fail("PRODUCT_RED", "ACCEPTANCE_CONVERSATION_RESTORE_NOT_READY", last);
}
async function waitForReady(cdp) {
  const deadline = Date.now() + readyTimeoutMs;
  let last = {};
  while (Date.now() < deadline) {
    try {
      last = await pageState(cdp);
      if (last.rawLogin || last.rawAuth) {
        fail("PRODUCT_RED", "ACCEPTANCE_LOGIN_ROUTE_FORBIDDEN", last);
      }
      const conversationGeometryReady = !last.conversationActive || (
        last.conversationRailCount === 0 &&
        last.outerRailCount === 1 &&
        last.conversationRootHeight >= Math.max(320, last.viewportHeight * 0.75) &&
        last.conversationWorkspaceHeight >= Math.max(320, last.viewportHeight * 0.75) &&
        last.conversationPeopleHeight >= Math.max(180, last.viewportHeight * 0.35) &&
        last.conversationRoomHeight >= Math.max(240, last.viewportHeight * 0.55)
      );
      const conversationPresentationReady = !last.conversationActive || (
        last.conversationPresentation === true &&
        last.conversationIdentityCard === true &&
        last.conversationInspectorTabCount === 5 &&
        last.conversationPaneToggleCount === 2 &&
        last.conversationRichReplyToolCount === 4 &&
        last.conversationComposerPresent === true &&
        last.conversationNewRoomIntroCount === 0 &&
        last.conversationCryptoEventCount === 0 &&
        last.conversationSystemSummaryCount === 0
      );
      const conversationAuthenticatedMediaReady = !last.conversationActive ||
        last.conversationFacebookRowCount < 3 ||
        last.serviceWorkerControlled === true;
      const conversationAvatarProjectionReady = !last.conversationActive ||
        last.conversationFacebookRowCount < 3 ||
        (
          last.conversationFacebookAvatarImageCount === last.conversationFacebookRowCount &&
          last.conversationFacebookAvatarLoadedVisibleCount === last.conversationFacebookRowCount
        );
      if (
        last.productShell &&
        !last.personalAccess &&
        last.userId &&
        last.deviceId &&
        conversationGeometryReady &&
        conversationPresentationReady &&
        conversationAuthenticatedMediaReady &&
        conversationAvatarProjectionReady
      ) return last;
    } catch {
      // The renderer context can disappear briefly during a safe reload.
    }
    await sleep(350);
  }
  if (last.productShell && !last.personalAccess && last.userId && last.deviceId && last.conversationActive) {
    const geometryFailed =
      last.conversationRailCount !== 0 ||
      last.outerRailCount !== 1 ||
      last.conversationRootHeight < Math.max(320, last.viewportHeight * 0.75) ||
      last.conversationWorkspaceHeight < Math.max(320, last.viewportHeight * 0.75) ||
      last.conversationPeopleHeight < Math.max(180, last.viewportHeight * 0.35) ||
      last.conversationRoomHeight < Math.max(240, last.viewportHeight * 0.55);
    if (geometryFailed) fail("PRODUCT_RED", "ACCEPTANCE_CONVERSATION_GEOMETRY_NOT_READY", last);
    if (
      !last.conversationPresentation ||
      !last.conversationIdentityCard ||
      last.conversationInspectorTabCount !== 5 ||
      last.conversationPaneToggleCount !== 2 ||
      last.conversationRichReplyToolCount !== 4 ||
      !last.conversationComposerPresent
    ) {
      fail("PRODUCT_RED", "ACCEPTANCE_CONVERSATION_PRESENTATION_NOT_READY", last);
    }
    if (
      last.conversationNewRoomIntroCount !== 0 ||
      last.conversationCryptoEventCount !== 0 ||
      last.conversationSystemSummaryCount !== 0
    ) {
      fail("PRODUCT_RED", "ACCEPTANCE_CONVERSATION_SYSTEM_CHROME_VISIBLE", last);
    }
    if (
      last.conversationFacebookRowCount >= 3 &&
      last.serviceWorkerControlled !== true
    ) {
      fail("PRODUCT_RED", "ACCEPTANCE_AUTHENTICATED_MEDIA_PATH_NOT_READY", last);
    }
    if (
      last.conversationFacebookRowCount >= 3 &&
      (
        last.conversationFacebookAvatarImageCount !== last.conversationFacebookRowCount ||
        last.conversationFacebookAvatarLoadedVisibleCount !== last.conversationFacebookRowCount
      )
    ) {
      fail("PRODUCT_RED", "ACCEPTANCE_CONTACT_AVATAR_PROJECTION_NOT_READY", last);
    }
  }
  fail("PRODUCT_RED", "ACCEPTANCE_SESSION_OR_ENTITLEMENT_NOT_READY", last);
}

async function runtimeBoundaryAdmission() {
  let health;
  try {
    health = await fetchJson(backendUrl + "/api/health", readyTimeoutMs);
  } catch (error) {
    fail("HARNESS_RED", "BACKEND_HEALTH_UNREACHABLE", { error: String(error.message || error) });
  }
  if (health?.readiness?.ready !== true || health?.runtimeMode !== "production") {
    fail("PRODUCT_RED", "BACKEND_NOT_PRODUCTION_READY", { readiness: health?.readiness, runtimeMode: health?.runtimeMode });
  }

  let config;
  try {
    config = await fetchJson(elementUrl + "/config.json");
    await fetchJson(matrixUrl + "/_matrix/client/versions");
  } catch (error) {
    fail("HARNESS_RED", "ELEMENT_OR_MATRIX_RUNTIME_UNREACHABLE", { error: String(error.message || error) });
  }
  const homeserver = String(config?.default_server_config?.["m.homeserver"]?.base_url || "").replace(/\/$/, "");
  if (homeserver !== matrixUrl) {
    fail("HARNESS_RED", "ELEMENT_HOMESERVER_ORIGIN_DRIFT", { expected: matrixUrl, actual: homeserver });
  }

  const docker = dockerAdmission();
  return { backendReady: true, runtimeMode: health.runtimeMode, homeserver, ...docker };
}

async function runtimeAdmission(existingCdp) {
  const boundary = await runtimeBoundaryAdmission();
  const cdp = existingCdp || await openCdp();
  const page = await waitForReady(cdp);
  return { cdp, evidence: { ...boundary, page } };
}
async function safeReload() {
  const boundary = await runtimeBoundaryAdmission();
  const cdp = await openCdp();
  const prePage = await waitForSessionReady(cdp);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Runtime.evaluate", { expression: "window.location.reload()" });
  const postSession = await waitForSessionReady(cdp);
  if (prePage.conversationActive && !postSession.conversationActive) {
    await waitForConversationActive(cdp);
  }
  const page = await waitForReady(cdp);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  if (prePage.conversationActive && !page.conversationActive) {
    fail("PRODUCT_RED", "ACCEPTANCE_CONVERSATION_RESTORE_NOT_READY", { prePage, page });
  }
  const evidence = { ...boundary, prePage, page, reload: "renderer_only", admission: "GREEN" };
  cdp.ws.close();
  out({ status: "GREEN", mode: "reload", evidence });
}

async function main() {
  if (!["runtime", "build", "reload"].includes(mode)) {
    fail("HELPER_RED", "UNKNOWN_ACCEPTANCE_MODE", { mode });
  }
  if (mode === "build") {
    const toolchain = buildAdmission();
    const boundary = await runtimeBoundaryAdmission();
    out({ status: "GREEN", mode, evidence: { toolchain, ...boundary } });
    return;
  }
  if (mode === "reload") {
    await safeReload();
    return;
  }
  const runtime = await runtimeAdmission();
  runtime.cdp.ws.close();
  out({ status: "GREEN", mode, evidence: runtime.evidence });
}

main().catch((error) => {
  fail("HELPER_RED", "ACCEPTANCE_GUARD_UNCAUGHT", { error: String(error?.stack || error) });
});
