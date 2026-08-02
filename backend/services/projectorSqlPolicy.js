'use strict';

const ALLOWED_ROOT_KEYWORDS = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'WITH']);
const FORBIDDEN_KEYWORDS = new Set([
  'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'PRAGMA', 'ATTACH', 'DETACH',
  'VACUUM', 'CREATE', 'ALTER', 'DROP', 'REINDEX'
]);
const NONDETERMINISTIC_FUNCTIONS = new Set([
  'random', 'randomblob', 'changes', 'total_changes', 'last_insert_rowid'
]);
const CLOCK_FUNCTIONS = new Set(['date', 'time', 'datetime', 'julianday', 'unixepoch', 'strftime']);
const CURRENT_CLOCK_KEYWORDS = new Set(['current_time', 'current_date', 'current_timestamp']);
const AUTHORITY_TABLES = new Set([
  'authority_write_host_bootstrap_metadata', 'authority_write_host_lease', 'canonical_event_headers',
  'authority_payload_store', 'event_type_registry', 'authority_command_receipts', 'projection_checkpoints_v2',
  'ledger_segments', 'ledger_snapshots', 'r32_schema_migrations', 'r32_meta'
]);

function sqlPolicyError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function isIdentifierStart(character) {
  return /[A-Za-z_]/.test(character || '');
}
function isIdentifierPart(character) {
  return /[A-Za-z0-9_$]/.test(character || '');
}

function readQuoted(sql, start, quote, escapePair, type) {
  let index = start + 1;
  let value = '';
  while (index < sql.length) {
    const character = sql[index];
    if (character === quote) {
      if (escapePair && sql[index + 1] === quote) {
        value += quote;
        index += 2;
        continue;
      }
      return { token: { type, value, raw: sql.slice(start, index + 1), position: start }, next: index + 1 };
    }
    value += character;
    index += 1;
  }
  throw sqlPolicyError('AUTHORITY_PROJECTOR_SQL_FORBIDDEN', 'Projector SQL contains an unterminated quoted token', {
    position: start,
    tokenType: type
  });
}

function tokenizeProjectorSql(sqlInput) {
  if (typeof sqlInput !== 'string') {
    throw sqlPolicyError('AUTHORITY_PROJECTOR_SQL_FORBIDDEN', 'Projector SQL must be a string');
  }
  const sql = sqlInput;
  if (!sql.trim()) throw sqlPolicyError('AUTHORITY_PROJECTOR_SQL_FORBIDDEN', 'Projector SQL cannot be empty');
  const tokens = [];
  let index = 0;
  while (index < sql.length) {
    const character = sql[index];
    if (/\s/.test(character)) { index += 1; continue; }

    if (character === '-' && sql[index + 1] === '-') {
      index += 2;
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') index += 1;
      continue;
    }
    if (character === '/' && sql[index + 1] === '*') {
      const start = index;
      const end = sql.indexOf('*/', index + 2);
      if (end < 0) {
        throw sqlPolicyError('AUTHORITY_PROJECTOR_SQL_FORBIDDEN', 'Projector SQL contains an unterminated block comment', { position: start });
      }
      index = end + 2;
      continue;
    }
    if (character === "'") {
      const quoted = readQuoted(sql, index, "'", true, 'string');
      tokens.push(quoted.token);
      index = quoted.next;
      continue;
    }
    if (character === '"') {
      const quoted = readQuoted(sql, index, '"', true, 'identifier');
      tokens.push({ ...quoted.token, value: quoted.token.value.toLowerCase() });
      index = quoted.next;
      continue;
    }
    if (character === '`') {
      const quoted = readQuoted(sql, index, '`', true, 'identifier');
      tokens.push({ ...quoted.token, value: quoted.token.value.toLowerCase() });
      index = quoted.next;
      continue;
    }
    if (character === '[') {
      const start = index;
      const end = sql.indexOf(']', index + 1);
      if (end < 0) {
        throw sqlPolicyError('AUTHORITY_PROJECTOR_SQL_FORBIDDEN', 'Projector SQL contains an unterminated bracket identifier', { position: start });
      }
      tokens.push({ type: 'identifier', value: sql.slice(index + 1, end).toLowerCase(), raw: sql.slice(start, end + 1), position: start });
      index = end + 1;
      continue;
    }
    if (isIdentifierStart(character)) {
      const start = index;
      index += 1;
      while (index < sql.length && isIdentifierPart(sql[index])) index += 1;
      const raw = sql.slice(start, index);
      tokens.push({ type: 'identifier', value: raw.toLowerCase(), raw, position: start });
      continue;
    }
    if (character === ';') {
      tokens.push({ type: 'semicolon', value: ';', raw: ';', position: index });
      index += 1;
      continue;
    }
    if ('(),.'.includes(character)) {
      tokens.push({ type: 'punctuation', value: character, raw: character, position: index });
      index += 1;
      continue;
    }
    tokens.push({ type: 'operator', value: character, raw: character, position: index });
    index += 1;
  }
  return Object.freeze(tokens.map(token => Object.freeze(token)));
}

function executableTokens(tokens) {
  const semicolons = [];
  for (let index = 0; index < tokens.length; index += 1) if (tokens[index].type === 'semicolon') semicolons.push(index);
  if (semicolons.length > 1 || (semicolons.length === 1 && semicolons[0] !== tokens.length - 1)) {
    throw sqlPolicyError('AUTHORITY_PROJECTOR_SQL_FORBIDDEN', 'Projector SQL must contain exactly one statement');
  }
  return semicolons.length === 1 ? tokens.slice(0, -1) : tokens.slice();
}

function tokenIdentifier(token) {
  return token?.type === 'identifier' ? token.value : '';
}

function matchingClose(tokens, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === '(') depth += 1;
    else if (tokens[index].value === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function assertDeterministicFunctions(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    const identifier = tokenIdentifier(tokens[index]);
    if (!identifier) continue;
    if (CURRENT_CLOCK_KEYWORDS.has(identifier) || (identifier === 'current_' && tokenIdentifier(tokens[index + 1]) === 'timestamp')) {
      throw sqlPolicyError('AUTHORITY_PROJECTOR_SQL_NONDETERMINISTIC', 'Projector SQL cannot read the current clock', { token: identifier });
    }
    if (identifier === 'load_extension') {
      throw sqlPolicyError('AUTHORITY_PROJECTOR_SQL_FORBIDDEN', 'Projector SQL cannot load SQLite extensions', { token: identifier });
    }
    const isCall = tokens[index + 1]?.value === '(';
    if (isCall && NONDETERMINISTIC_FUNCTIONS.has(identifier)) {
      throw sqlPolicyError('AUTHORITY_PROJECTOR_SQL_NONDETERMINISTIC', 'Projector SQL cannot depend on random or connection-local mutable state', { token: identifier });
    }
    if (isCall && CLOCK_FUNCTIONS.has(identifier)) {
      const close = matchingClose(tokens, index + 1);
      if (close < 0) throw sqlPolicyError('AUTHORITY_PROJECTOR_SQL_FORBIDDEN', 'Projector SQL contains an unbalanced function call', { token: identifier });
      const argumentsTokens = tokens.slice(index + 2, close);
      if (argumentsTokens.length === 0 || argumentsTokens.some(token => token.type === 'string' && token.value.toLowerCase() === 'now')) {
        throw sqlPolicyError('AUTHORITY_PROJECTOR_SQL_NONDETERMINISTIC', 'Projector SQL clock functions require explicit deterministic inputs', { token: identifier });
      }
    }
  }
}

function assertAuthorityIsolation(tokens) {
  for (const token of tokens) {
    const identifier = tokenIdentifier(token);
    if (!identifier) continue;
    if (identifier.startsWith('sqlite_')) {
      throw sqlPolicyError('AUTHORITY_PROJECTOR_SQL_FORBIDDEN', 'Projector SQL cannot access SQLite internal objects', { table: identifier });
    }
    if (AUTHORITY_TABLES.has(identifier)) {
      throw sqlPolicyError('AUTHORITY_PROJECTOR_SQL_FORBIDDEN', 'Projector SQL cannot access authority-owned tables directly', { table: identifier });
    }
  }
}

function validateProjectorSql(sqlInput) {
  const tokens = executableTokens(tokenizeProjectorSql(sqlInput));
  if (tokens.length === 0) throw sqlPolicyError('AUTHORITY_PROJECTOR_SQL_FORBIDDEN', 'Projector SQL contains no executable statement');
  const root = tokenIdentifier(tokens[0]).toUpperCase();
  if (!ALLOWED_ROOT_KEYWORDS.has(root)) {
    throw sqlPolicyError('AUTHORITY_PROJECTOR_SQL_FORBIDDEN', 'Projector SQL operation is outside the projection DML contract', { root });
  }
  for (const token of tokens) {
    const identifier = tokenIdentifier(token).toUpperCase();
    if (FORBIDDEN_KEYWORDS.has(identifier)) {
      throw sqlPolicyError('AUTHORITY_PROJECTOR_SQL_FORBIDDEN', 'Projector SQL contains transaction, schema or attachment control', { token: identifier });
    }
  }
  assertAuthorityIsolation(tokens);
  assertDeterministicFunctions(tokens);
  return Object.freeze({ sql: sqlInput, tokens });
}

module.exports = {
  AUTHORITY_TABLES,
  tokenizeProjectorSql,
  validateProjectorSql,
  sqlPolicyError
};
