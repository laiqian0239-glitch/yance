'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const lockfile = require('proper-lockfile');

const ACTIVE_FLAG_KEY = 'yance-learning-policy-active';
const SHA256_RE = /^[0-9a-f]{64}$/u;

function promotionError(reasonCode, message, details = {}) {
  return Object.assign(new Error(message), { reasonCode, code: reasonCode, ...details });
}
function clean(value) { return String(value == null ? '' : value).trim(); }
function sha256File(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
function canonicalRoots(env = process.env) {
  const dataRoot = clean(env.YANCE_DATA_DIR);
  if (!dataRoot || !path.isAbsolute(dataRoot)) {
    throw promotionError('YANCE_DATA_DIR_REQUIRED', 'Production Learning promotion requires an absolute YANCE_DATA_DIR.');
  }
  const root = path.join(path.resolve(dataRoot), 'learning', 'learned-policy');
  return Object.freeze({
    root,
    flagRoot: path.join(root, 'flagd'),
    flagFile: path.join(root, 'flagd', 'flags.json'),
    candidateRoot: path.join(root, 'candidates'),
    artifactRoot: path.join(root, 'artifacts')
  });
}
function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, filePath);
}
function candidateIdentity(candidate = {}) {
  const version = clean(candidate.version);
  const id = clean(candidate.id);
  if (!SHA256_RE.test(version) || id !== `policy:${version}`) {
    throw promotionError('LEARNING_PROMOTION_CANDIDATE_IDENTITY_INVALID', 'Candidate must use policy:<sha256> / <sha256> content identity.');
  }
  return Object.freeze({ id, version, policyVersion: clean(candidate.policyVersion) || 'vw-p1-v1' });
}
function nativeFlagDocument(rollout) {
  return {
    flags: {
      [ACTIVE_FLAG_KEY]: {
        state: 'ENABLED',
        variants: { active: rollout },
        defaultVariant: 'active'
      }
    }
  };
}
function readNativeRollout(flagFile) {
  if (!fs.existsSync(flagFile)) return null;
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(flagFile, 'utf8'));
  } catch (error) {
    throw promotionError('LEARNING_PROMOTION_NATIVE_FLAG_DOCUMENT_INVALID', 'Native Learning flag document is not valid JSON.', { message: clean(error?.message) });
  }
  return doc?.flags?.[ACTIVE_FLAG_KEY]?.variants?.active || null;
}
async function withNativeRolloutLock(roots, operation) {
  fs.mkdirSync(roots.flagRoot, { recursive: true });
  let release;
  try {
    release = await lockfile.lock(roots.flagRoot, {
      realpath: true,
      retries: { retries: 20, factor: 1.2, minTimeout: 25, maxTimeout: 100 }
    });
  } catch (error) {
    throw promotionError('LEARNING_PROMOTION_LOCK_UNAVAILABLE', 'Native Learning rollout lock could not be acquired.', { causeCode: clean(error?.code) });
  }
  let value;
  let operationError = null;
  try {
    value = await operation();
  } catch (error) {
    operationError = error;
  }
  try {
    await release();
  } catch (error) {
    if (!operationError) {
      throw promotionError('LEARNING_PROMOTION_LOCK_RELEASE_FAILED', 'Native Learning rollout lock could not be released.', { causeCode: clean(error?.code) });
    }
  }
  if (operationError) throw operationError;
  return value;
}
function materializeCandidate(roots, candidate) {
  fs.mkdirSync(roots.artifactRoot, { recursive: true });
  const source = path.join(roots.candidateRoot, `${candidate.version}.vw`);
  const destination = path.join(roots.artifactRoot, `${candidate.version}.vw`);
  if (fs.existsSync(destination)) {
    const existingHash = sha256File(destination);
    if (existingHash !== candidate.version) {
      throw promotionError('LEARNING_PROMOTION_ARTIFACT_IDENTITY_MISMATCH', 'Existing promoted artifact bytes do not match candidate identity.');
    }
    return destination;
  }
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw promotionError('LEARNING_PROMOTION_CANONICAL_CANDIDATE_MISSING', 'Canonical Learning candidate artifact is missing.');
  }
  const actual = sha256File(source);
  if (actual !== candidate.version) {
    throw promotionError('LEARNING_PROMOTION_ARTIFACT_IDENTITY_MISMATCH', 'Candidate artifact bytes do not match candidate identity.', { expected: candidate.version, actual });
  }
  const temp = `${destination}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  fs.copyFileSync(source, temp, fs.constants.COPYFILE_EXCL);
  if (sha256File(temp) !== candidate.version) {
    fs.rmSync(temp, { force: true });
    throw promotionError('LEARNING_PROMOTION_ARTIFACT_COPY_MISMATCH', 'Copied candidate artifact failed content-address verification.');
  }
  fs.renameSync(temp, destination);
  return destination;
}
async function verifyNativeFlagd(flagFile, expectedVersion) {
  const { OpenFeature, NOOP_PROVIDER } = require('@openfeature/server-sdk');
  const { FlagdProvider } = require('@openfeature/flagd-provider');
  const domain = 'yance-learning-policy-promotion';
  const provider = new FlagdProvider({ resolverType: 'in-process', offlineFlagSourcePath: flagFile });
  await OpenFeature.setProviderAndWait(domain, provider);
  try {
    const evaluated = await OpenFeature.getClient(domain).getObjectValue(ACTIVE_FLAG_KEY, null);
    if (!evaluated || clean(evaluated?.candidate?.version) !== expectedVersion) {
      throw promotionError('LEARNING_PROMOTION_FLAGD_VERIFICATION_FAILED', 'Native flagd activation did not resolve the promoted candidate.');
    }
    return evaluated;
  } finally {
    // Replace only this verification domain. The SDK lifecycle closes the
    // FlagdProvider watcher without shutting down unrelated OpenFeature domains.
    await OpenFeature.setProviderAndWait(domain, NOOP_PROVIDER);
  }
}

function createLearningPromotionAdapter(options = {}) {
  const openFeature = options.openFeature || null;
  const flagd = options.flagd || null;
  const langfuse = options.langfuse || null;
  const injectedAuthority = Boolean(openFeature || flagd);

  function requireInjectedRolloutAuthority() {
    if (!openFeature || typeof openFeature.setEvaluationContext !== 'function') {
      throw promotionError('OPENFEATURE_UNAVAILABLE', 'OpenFeature runtime is required for staged rollout.');
    }
    if (!flagd || flagd.mode !== 'in-process-offline') {
      throw promotionError('FLAGD_OFFLINE_PROVIDER_REQUIRED', 'flagd must run in-process/offline for Learning P0.');
    }
  }

  async function promote(proposal = {}, input = {}) {
    if (input.approved !== true) throw promotionError('LEARNING_APPROVAL_REQUIRED', 'Explicit approval is required before Promotion.');
    if (proposal.status !== 'READY_FOR_REVIEW') throw promotionError('LEARNING_EVALUATION_INCOMPLETE', 'Regression and Shadow evidence must pass before Promotion.');
    if (!proposal.Regression?.passed || !proposal.Shadow?.passed) throw promotionError('LEARNING_EVIDENCE_REJECTED', 'Regression and Shadow must both pass.');
    const candidate = candidateIdentity(proposal.Candidate || {});
    const evidenceId = clean(input.evidence?.id);
    if (!evidenceId) throw promotionError('LEARNING_PROMOTION_EVIDENCE_REQUIRED', 'Promotion evidence is required.');

    if (injectedAuthority) {
      // Explicit test/UAT seam retained for existing contracts. It is not the
      // production-default activation path and does not claim V3 closure.
      requireInjectedRolloutAuthority();
      const rollout = Object.freeze({
        kind: 'LEARNING_ROLLOUT', candidate: proposal.Candidate, approvedAt: new Date().toISOString(),
        OpenFeature: true, flagd: 'in-process-offline', automaticPromotion: false
      });
      await langfuse?.recordPromotion?.({ proposal, rollout });
      return rollout;
    }

    const roots = canonicalRoots();
    const rollout = await withNativeRolloutLock(roots, async () => {
      materializeCandidate(roots, candidate);
      const previous = readNativeRollout(roots.flagFile);
      const previousCandidates = [previous?.candidate, ...(Array.isArray(previous?.history) ? previous.history : [])]
        .filter(row => row && clean(row.version) && clean(row.version) !== candidate.version)
        .slice(0, 8)
        .map(row => ({ id: clean(row.id), version: clean(row.version), policyVersion: clean(row.policyVersion) || 'vw-p1-v1' }));
      const next = Object.freeze({
        kind: 'LEARNING_ROLLOUT',
        candidate,
        history: Object.freeze(previousCandidates),
        evidenceId,
        approvedAt: new Date().toISOString(),
        OpenFeature: true,
        flagd: 'in-process-offline',
        automaticPromotion: false
      });
      atomicWriteJson(roots.flagFile, nativeFlagDocument(next));
      await verifyNativeFlagd(roots.flagFile, candidate.version);
      return next;
    });
    await langfuse?.recordPromotion?.({ proposal, rollout });
    return rollout;
  }

  async function rollback(rollout = {}, input = {}) {
    if (input.approved !== true) {
      throw promotionError('LEARNING_ROLLBACK_APPROVAL_REQUIRED', 'Explicit Learning approval is required before rollback.');
    }
    const evidenceId = clean(input.evidence?.id);
    if (!evidenceId) throw promotionError('LEARNING_ROLLBACK_EVIDENCE_REQUIRED', 'Explicit rollback evidence is required.');
    if (rollout.kind !== 'LEARNING_ROLLOUT') throw promotionError('LEARNING_ROLLBACK_ROLLOUT_REQUIRED', 'Rollback requires a canonical Learning rollout.');
    if (!clean(rollout.candidate?.id)) throw promotionError('LEARNING_ROLLBACK_CANDIDATE_REQUIRED', 'Rollback requires the Learning rollout candidate identity.');

    if (injectedAuthority) {
      requireInjectedRolloutAuthority();
      const receipt = Object.freeze({
        kind: 'LEARNING_ROLLBACK', rollout, candidate: rollout.candidate, evidenceId,
        rolledBackAt: new Date().toISOString(), OpenFeature: true, flagd: 'in-process-offline', automaticPromotion: false
      });
      await langfuse?.recordRollback?.({ rollout, evidence: input.evidence, receipt });
      return receipt;
    }

    const requestedCandidate = candidateIdentity(rollout.candidate || {});
    const roots = canonicalRoots();
    const restoredCandidate = await withNativeRolloutLock(roots, async () => {
      const canonical = readNativeRollout(roots.flagFile);
      const activeVersion = clean(canonical?.candidate?.version);
      if (!activeVersion || activeVersion !== requestedCandidate.version) {
        throw promotionError('LEARNING_ROLLBACK_STALE_ROLLOUT', 'Rollback receipt does not identify the currently active Learning rollout.', { requestedVersion: requestedCandidate.version, activeVersion });
      }
      const history = Array.isArray(canonical?.history) ? canonical.history : [];
      const previous = history[0] ? candidateIdentity(history[0]) : null;
      if (previous) {
        const previousPath = path.join(roots.artifactRoot, `${previous.version}.vw`);
        if (!fs.existsSync(previousPath) || sha256File(previousPath) !== previous.version) {
          throw promotionError('LEARNING_ROLLBACK_LAST_KNOWN_GOOD_INVALID', 'Rollback target is not a verified content-addressed promoted artifact.');
        }
        const next = Object.freeze({
          kind: 'LEARNING_ROLLOUT', candidate: previous, history: Object.freeze(history.slice(1)),
          evidenceId, approvedAt: new Date().toISOString(), OpenFeature: true, flagd: 'in-process-offline', automaticPromotion: false
        });
        atomicWriteJson(roots.flagFile, nativeFlagDocument(next));
        await verifyNativeFlagd(roots.flagFile, previous.version);
      } else {
        atomicWriteJson(roots.flagFile, { flags: {} });
      }
      return previous;
    });
    const receipt = Object.freeze({
      kind: 'LEARNING_ROLLBACK', rollout, candidate: rollout.candidate, restoredCandidate,
      evidenceId, rolledBackAt: new Date().toISOString(), OpenFeature: true, flagd: 'in-process-offline', automaticPromotion: false
    });
    await langfuse?.recordRollback?.({ rollout, evidence: input.evidence, receipt });
    return receipt;
  }

  return Object.freeze({ promote, rollback, authority: 'OpenFeature + flagd; Langfuse evidence' });
}

module.exports = { createLearningPromotionAdapter, ACTIVE_FLAG_KEY };
