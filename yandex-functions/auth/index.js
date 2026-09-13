const crypto = require('crypto');
const { Driver, MetadataAuthService, TypedValues } = require('ydb-sdk');
const { createClient } = require('@supabase/supabase-js');

const {
  INTERNAL_TOKEN,
  YDB_ENDPOINT,
  YDB_DATABASE,
  MAGIC_LINK_PEPPER,
  SESSION_PEPPER,
  SEND_LOGIN_EMAIL_URL,
  SEND_LOGIN_EMAIL_TOKEN,
  SITE_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

const MAGIC_LINK_TTL_MINUTES = 15;
const SESSION_IDLE_DAYS = 90;
const SESSION_ABSOLUTE_DAYS = 180;
const REQUEST_RATE_LIMIT_WINDOW_MINUTES = 15;
const REQUEST_RATE_LIMIT_MAX = 3;

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
  };
}

function parseBody(event) {
  if (!event?.body) return {};
  try {
    return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch {
    return null;
  }
}

function getMethod(event) {
  return (
    event?.httpMethod ||
    event?.requestContext?.http?.method ||
    event?.requestContext?.httpMethod ||
    'POST'
  ).toUpperCase();
}

function getPath(event) {
  return (
    event?.path ||
    event?.requestContext?.http?.path ||
    event?.requestContext?.path ||
    '/'
  );
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashMagicToken(rawToken) {
  return sha256(`${rawToken}:${MAGIC_LINK_PEPPER}`);
}

function hashSessionToken(rawToken) {
  return sha256(`${rawToken}:${SESSION_PEPPER}`);
}

function sessionTokenFingerprint(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) return undefined;
  return sha256(token).slice(0, 16);
}

function generateRawToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function nowDate() {
  return new Date();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function stringToYdb(value) {
  return TypedValues.utf8(value);
}

function boolToYdb(value) {
  return TypedValues.bool(Boolean(value));
}

function getClientIp(event) {
  return (
    event?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    event?.headers?.['X-Forwarded-For']?.split(',')[0]?.trim() ||
    event?.requestContext?.http?.sourceIp ||
    ''
  );
}

function getUserAgent(event) {
  return event?.headers?.['user-agent'] || event?.headers?.['User-Agent'] || '';
}

function logValidateSessionDiagnostic({ reason, status, startedAt, sessionFingerprint }) {
  const logger = status >= 400 ? console.warn : console.log;
  logger('[AUTH_VALIDATE_SESSION]', {
    action: 'validate_session',
    reason,
    status,
    durationMs: Date.now() - startedAt,
    sessionFingerprint,
  });
}

function assertEnv() {
  const required = [
    'INTERNAL_TOKEN',
    'YDB_ENDPOINT',
    'YDB_DATABASE',
    'MAGIC_LINK_PEPPER',
    'SESSION_PEPPER',
    'SEND_LOGIN_EMAIL_URL',
    'SEND_LOGIN_EMAIL_TOKEN',
    'SITE_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];

  const missing = required.filter((name) => !process.env[name]);

  if (missing.length) {
    throw new Error(`Missing env: ${missing.join(', ')}`);
  }
}

let cachedDriver = null;
let cachedSupabase = null;

function getSupabase() {
  if (cachedSupabase) {
    return cachedSupabase;
  }

  cachedSupabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );

  return cachedSupabase;
}

async function getDriver() {
  if (cachedDriver) return cachedDriver;

  const driver = new Driver({
    endpoint: YDB_ENDPOINT,
    database: YDB_DATABASE,
    authService: new MetadataAuthService(),
  });

  await driver.ready(10000);
  cachedDriver = driver;
  return driver;
}

async function runDataQuery(query, params = {}) {
  const driver = await getDriver();
  const tableClient = driver.tableClient;

  return tableClient.withSession(async (session) => {
    return session.executeQuery(query, params);
  });
}

function rowsFromResultSets(result) {
  return result.resultSets || result.result_sets || [];
}

function fieldValue(field) {
  if (field == null) return null;

  const plain =
    typeof field === 'object' ? JSON.parse(JSON.stringify(field)) : field;

  if (plain.value !== undefined) {
    return fieldValue(plain.value);
  }

  if (plain.optionalValue !== undefined) {
    return fieldValue(plain.optionalValue);
  }

  if (plain.nullFlagValue !== undefined) {
    return null;
  }

  if (plain.textValue !== undefined) return String(plain.textValue);
  if (plain.utf8Value !== undefined) return String(plain.utf8Value);
  if (plain.boolValue !== undefined) return Boolean(plain.boolValue);

  // YDB Timestamp часто приходит как микросекунды
  if (plain.uint64Value !== undefined) {
    const micros = Number(plain.uint64Value);
    if (!Number.isFinite(micros)) return null;
    return new Date(Math.floor(micros / 1000)).toISOString();
  }

  if (plain.int64Value !== undefined) {
    const micros = Number(plain.int64Value);
    if (!Number.isFinite(micros)) return null;
    return new Date(Math.floor(micros / 1000)).toISOString();
  }

  if (plain.timestampValue !== undefined) {
    return typeof plain.timestampValue === 'string'
      ? plain.timestampValue
      : String(plain.timestampValue);
  }

  if (plain.low !== undefined && plain.high !== undefined) {
    const micros = Number(plain.low);
    if (!Number.isFinite(micros)) return null;
    return new Date(Math.floor(micros / 1000)).toISOString();
  }

  return null;
}

function resultSetToObjects(resultSet) {
  const plainResultSet = JSON.parse(JSON.stringify(resultSet || {}));
  const columns = (plainResultSet.columns || []).map((c) => c.name);

  return (plainResultSet.rows || []).map((row) => {
    const obj = {};
    (row.items || []).forEach((item, idx) => {
      obj[columns[idx]] = fieldValue(item);
    });
    return obj;
  });
}

async function countRecentMagicLinkRequests(email, ip, sinceIso) {
  const query = `
    DECLARE $email AS Utf8;
    DECLARE $ip AS Utf8;

    SELECT COUNT(*) AS cnt
    FROM auth_magic_links
    VIEW idx_magic_email
    WHERE email = $email
      AND created_at >= Timestamp("${sinceIso}")
      AND requested_ip = $ip;
  `;

  const result = await runDataQuery(query, {
    $email: stringToYdb(email),
    $ip: stringToYdb(ip),
  });

  const rows = resultSetToObjects(rowsFromResultSets(result)[0]);
  return Number(rows?.[0]?.cnt || 0);
}

async function insertMagicLink({
  tokenHash,
  email,
  createdAtIso,
  expiresAtIso,
  requestedIp,
  requestedUa,
}) {
  const requestedIpLiteral = requestedIp ? '$requested_ip' : 'NULL';
  const requestedUaLiteral = requestedUa ? '$requested_ua' : 'NULL';

  const query = `
    DECLARE $token_hash AS Utf8;
    DECLARE $email AS Utf8;
    DECLARE $requested_ip AS Utf8;
    DECLARE $requested_ua AS Utf8;

    UPSERT INTO auth_magic_links (
      token_hash,
      email,
      created_at,
      expires_at,
      consumed_at,
      requested_ip,
      requested_ua
    ) VALUES (
      $token_hash,
      $email,
      Timestamp("${createdAtIso}"),
      Timestamp("${expiresAtIso}"),
      NULL,
      ${requestedIpLiteral},
      ${requestedUaLiteral}
    );
  `;

  await runDataQuery(query, {
    $token_hash: stringToYdb(tokenHash),
    $email: stringToYdb(email),
    $requested_ip: stringToYdb(requestedIp || ''),
    $requested_ua: stringToYdb(requestedUa || ''),
  });
}

async function getMagicLinkByHash(tokenHash) {
  const query = `
    DECLARE $token_hash AS Utf8;

    SELECT token_hash, email, created_at, expires_at, consumed_at, requested_ip, requested_ua
    FROM auth_magic_links
    WHERE token_hash = $token_hash;
  `;

  const result = await runDataQuery(query, {
    $token_hash: stringToYdb(tokenHash),
  });

  const sets = rowsFromResultSets(result);
  const firstSet = sets?.[0];
  const rows = resultSetToObjects(firstSet);

  return rows[0] || null;
}

async function consumeMagicLinkAndCreateSession({
  tokenHash,
  nowIso,
  sessionHash,
  email,
  ip,
  ua,
}) {
  const magicLink = await getMagicLinkByHash(tokenHash);

  if (!magicLink) return { ok: false, reason: 'not_found' };
  if (magicLink.consumed_at) return { ok: false, reason: 'already_consumed' };

  const expiresAt = new Date(magicLink.expires_at);
  const now = new Date(nowIso);

  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error(`Invalid expires_at value: ${magicLink.expires_at}`);
  }

  if (expiresAt <= now) return { ok: false, reason: 'expired' };

  const consumeQuery = `
    DECLARE $token_hash AS Utf8;

    UPSERT INTO auth_magic_links (
      token_hash,
      consumed_at
    ) VALUES (
      $token_hash,
      Timestamp("${nowIso}")
    );
  `;

  await runDataQuery(consumeQuery, {
    $token_hash: stringToYdb(tokenHash),
  });

  const expiresAtIso = addDays(now, SESSION_IDLE_DAYS).toISOString();
  const absoluteExpiresAtIso = addDays(now, SESSION_ABSOLUTE_DAYS).toISOString();

  const ipCreatedLiteral = ip ? '$ip_created' : 'NULL';
  const ipLastSeenLiteral = ip ? '$ip_last_seen' : 'NULL';
  const uaCreatedLiteral = ua ? '$ua_created' : 'NULL';
  const uaLastSeenLiteral = ua ? '$ua_last_seen' : 'NULL';

  const insertSessionQuery = `
    DECLARE $session_hash AS Utf8;
    DECLARE $email AS Utf8;
    DECLARE $revoked AS Bool;
    DECLARE $ip_created AS Utf8;
    DECLARE $ip_last_seen AS Utf8;
    DECLARE $ua_created AS Utf8;
    DECLARE $ua_last_seen AS Utf8;

    UPSERT INTO auth_sessions (
      session_hash,
      email,
      created_at,
      expires_at,
      absolute_expires_at,
      last_seen_at,
      revoked,
      revoked_at,
      ip_created,
      ip_last_seen,
      ua_created,
      ua_last_seen
    ) VALUES (
      $session_hash,
      $email,
      Timestamp("${nowIso}"),
      Timestamp("${expiresAtIso}"),
      Timestamp("${absoluteExpiresAtIso}"),
      Timestamp("${nowIso}"),
      $revoked,
      NULL,
      ${ipCreatedLiteral},
      ${ipLastSeenLiteral},
      ${uaCreatedLiteral},
      ${uaLastSeenLiteral}
    );
  `;

  await runDataQuery(insertSessionQuery, {
    $session_hash: stringToYdb(sessionHash),
    $email: stringToYdb(email),
    $revoked: boolToYdb(false),
    $ip_created: stringToYdb(ip || ''),
    $ip_last_seen: stringToYdb(ip || ''),
    $ua_created: stringToYdb(ua || ''),
    $ua_last_seen: stringToYdb(ua || ''),
  });

  return {
    ok: true,
    sessionExpiresAt: expiresAtIso,
    absoluteExpiresAt: absoluteExpiresAtIso,
  };
}

async function getSessionByHash(sessionHash) {
  const query = `
    DECLARE $session_hash AS Utf8;

    SELECT
      session_hash,
      email,
      created_at,
      expires_at,
      absolute_expires_at,
      last_seen_at,
      revoked,
      revoked_at,
      ip_created,
      ip_last_seen,
      ua_created,
      ua_last_seen
    FROM auth_sessions
    WHERE session_hash = $session_hash;
  `;

  const result = await runDataQuery(query, {
    $session_hash: stringToYdb(sessionHash),
  });

  const sets = rowsFromResultSets(result);
  const firstSet = sets?.[0];
  const rows = resultSetToObjects(firstSet);

  return rows[0] || null;
}

async function updateSessionActivity({
  sessionHash,
  nowIso,
  expiresAtIso,
  ip,
  ua,
}) {
  const ipLastSeenLiteral = ip ? '$ip_last_seen' : 'ip_last_seen';
  const uaLastSeenLiteral = ua ? '$ua_last_seen' : 'ua_last_seen';

  const query = `
    DECLARE $session_hash AS Utf8;
    DECLARE $ip_last_seen AS Utf8;
    DECLARE $ua_last_seen AS Utf8;

    UPDATE auth_sessions
    SET
      expires_at = Timestamp("${expiresAtIso}"),
      last_seen_at = Timestamp("${nowIso}"),
      ip_last_seen = ${ipLastSeenLiteral},
      ua_last_seen = ${uaLastSeenLiteral}
    WHERE session_hash = $session_hash;
  `;

  await runDataQuery(query, {
    $session_hash: stringToYdb(sessionHash),
    $ip_last_seen: stringToYdb(ip || ''),
    $ua_last_seen: stringToYdb(ua || ''),
  });
}

async function revokeSessionByHash(sessionHash, nowIso) {
  const query = `
    DECLARE $session_hash AS Utf8;

    UPSERT INTO auth_sessions (
      session_hash,
      revoked,
      revoked_at
    ) VALUES (
      $session_hash,
      true,
      Timestamp("${nowIso}")
    );
  `;

  await runDataQuery(query, {
    $session_hash: stringToYdb(sessionHash),
  });
}

async function findSupabaseUserByEmail(email) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('lk_users')
    .select('id, email, role, lk_enabled, coach_name')
    .eq('email', email)
    .limit(2);

  if (error) {
    throw new Error(
      `Supabase lk_users lookup failed: ${error.message}`
    );
  }

  if (!data || data.length === 0) {
    return null;
  }

  if (data.length > 1) {
    throw new Error(
      `Multiple lk_users rows found for email: ${email}`
    );
  }

  const row = data[0];

  return {
    id: row.id,
    email: normalizeEmail(row.email),
    lk_enabled: row.lk_enabled === true,
    role: String(row.role || '').trim().toLowerCase(),
    coach_name: String(row.coach_name || '').trim(),
  };
}

async function findSupabaseClientByEmail(email) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('clients')
    .select('id, email, lk_enabled, is_active')
    .eq('email', email)
    .limit(2);

  if (error) {
    throw new Error(
      `Supabase clients lookup failed: ${error.message}`
    );
  }

  if (!data || data.length === 0) {
    return null;
  }

  if (data.length > 1) {
    throw new Error(
      `Multiple clients rows found for email: ${email}`
    );
  }

  const row = data[0];

  return {
    id: row.id,
    email: normalizeEmail(row.email),
    lk_enabled: row.lk_enabled === true,
    is_active: row.is_active === true,
  };
}

async function sendLoginEmail({ to, loginUrl, ttlMinutes }) {
  const res = await fetch(SEND_LOGIN_EMAIL_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      token: SEND_LOGIN_EMAIL_TOKEN,
      to,
      login_url: loginUrl,
      ttl_minutes: ttlMinutes,
    }),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`send-login-email failed: ${res.status} ${text}`);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!parsed?.ok) {
    throw new Error(`send-login-email returned not ok: ${text}`);
  }
}

function neutralRequestResponse() {
  return json(200, {
    ok: true,
    message: 'Если такой email есть в системе, мы отправим ссылку для входа.',
  });
}

async function handleRequest(event) {
  const body = parseBody(event);

  if (body === null) {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const providedInternalToken = String(body?.token || '');

  if (providedInternalToken !== INTERNAL_TOKEN) {
    return json(403, { ok: false, error: 'forbidden' });
  }

  const email = normalizeEmail(body?.email);



  if (!email || !isValidEmail(email)) {
    return neutralRequestResponse();
  }

  try {
    const now = nowDate();
    const ip = getClientIp(event);
    const ua = getUserAgent(event);

    const sinceIso = addMinutes(
      now,
      -REQUEST_RATE_LIMIT_WINDOW_MINUTES
    ).toISOString();

    const recentCount = await countRecentMagicLinkRequests(
      email,
      ip,
      sinceIso
    );


    if (recentCount >= REQUEST_RATE_LIMIT_MAX) {

      return neutralRequestResponse();
    }

    const user = await findSupabaseUserByEmail(email);

    if (user) {

      if (!user.lk_enabled) {
        return neutralRequestResponse();
      }
    } else {
      const supabaseClient = await findSupabaseClientByEmail(email);

      if (!supabaseClient || !supabaseClient.lk_enabled) {
        return neutralRequestResponse();
      }
    }

    const rawToken = generateRawToken(32);
    const tokenHash = hashMagicToken(rawToken);
    const createdAtIso = now.toISOString();
    const expiresAtIso = addMinutes(
      now,
      MAGIC_LINK_TTL_MINUTES
    ).toISOString();

    const client = String(body?.client || '')
      .trim()
      .toLowerCase();

    const baseSiteUrl = SITE_URL.replace(/\/$/, '');

const loginUrl =
  client === 'student_mobile'
    ? `${baseSiteUrl}/mobile/consume?token=${encodeURIComponent(rawToken)}`
    : `${baseSiteUrl}/lk/verify?token=${encodeURIComponent(rawToken)}`;


    await insertMagicLink({
      tokenHash,
      email,
      createdAtIso,
      expiresAtIso,
      requestedIp: ip,
      requestedUa: ua,
    });


    await sendLoginEmail({
      to: email,
      loginUrl,
      ttlMinutes: MAGIC_LINK_TTL_MINUTES,
    });

    return neutralRequestResponse();
} catch (error) {
  console.error('[AUTH_REQUEST_FAILED]', {
    name: error?.name || 'Error',
  });

  return neutralRequestResponse();
}
}

async function handleConsume(event) {
  const body = parseBody(event);
  if (body === null) {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const providedInternalToken = String(body?.token || '');
  if (providedInternalToken !== INTERNAL_TOKEN) {
    return json(403, { ok: false, error: 'forbidden' });
  }

  const token =
    String(body?.magic_token || '').trim() ||
    String(body?.token_value || '').trim() ||
    String(body?.raw_token || '').trim() ||
    String(body?.verify_token || '').trim() ||
    String(body?.consume_token || '').trim();

  if (!token) {
    return json(400, { ok: false, error: 'missing_token' });
  }

  try {
    const tokenHash = hashMagicToken(token);
    const magicLink = await getMagicLinkByHash(tokenHash);

    if (!magicLink) {
      return json(400, { ok: false, error: 'invalid_or_expired_token' });
    }

    const now = nowDate();
    const ip = getClientIp(event);
    const ua = getUserAgent(event);

    const rawSessionToken = generateRawToken(32);
    const sessionHash = hashSessionToken(rawSessionToken);

    const consumed = await consumeMagicLinkAndCreateSession({
      tokenHash,
      nowIso: now.toISOString(),
      sessionHash,
      email: magicLink.email,
      ip,
      ua,
    });

    if (!consumed?.ok) {
      return json(400, { ok: false, error: 'invalid_or_expired_token' });
    }

    return json(200, {
      ok: true,
      session_token: rawSessionToken,
      email: magicLink.email,
      expires_at: consumed.sessionExpiresAt,
      absolute_expires_at: consumed.absoluteExpiresAt,
    });
  } catch (error) {
    return json(500, { ok: false, error: 'internal_error' });
  }
}

async function handleValidateSession(event) {
  const body = parseBody(event);
  if (body === null) {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const providedInternalToken = String(body?.token || '');
  if (providedInternalToken !== INTERNAL_TOKEN) {
    return json(403, { ok: false, error: 'forbidden' });
  }

  const rawSessionToken =
    String(body?.session_token || '').trim() ||
    String(body?.sessionToken || '').trim() ||
    String(body?.token_value || '').trim();

  if (!rawSessionToken) {
    return json(400, {
      ok: false,
      error: 'missing_session_token',
    });
  }

  const startedAt = Date.now();
  const fingerprint = sessionTokenFingerprint(rawSessionToken);
  let failureLogged = false;

  try {
    const sessionHash = hashSessionToken(rawSessionToken);
    const session = await getSessionByHash(sessionHash);

    if (!session) {
      logValidateSessionDiagnostic({
        reason: 'session_not_found',
        status: 401,
        startedAt,
        sessionFingerprint: fingerprint,
      });
      failureLogged = true;
      return json(401, {
        ok: false,
        error: 'invalid_session',
      });
    }

    if (session.revoked) {
      logValidateSessionDiagnostic({
        reason: 'session_revoked',
        status: 401,
        startedAt,
        sessionFingerprint: fingerprint,
      });
      failureLogged = true;
      return json(401, {
        ok: false,
        error: 'invalid_session',
      });
    }

    const now = nowDate();
    const expiresAt = new Date(session.expires_at);
    const absoluteExpiresAt = new Date(session.absolute_expires_at);

    if (
      Number.isNaN(expiresAt.getTime()) ||
      Number.isNaN(absoluteExpiresAt.getTime())
    ) {
      logValidateSessionDiagnostic({
        reason: 'invalid_timestamps',
        status: 500,
        startedAt,
        sessionFingerprint: fingerprint,
      });
      failureLogged = true;
      throw new Error('Invalid session timestamps');
    }

    if (absoluteExpiresAt <= now) {
      logValidateSessionDiagnostic({
        reason: 'absolute_expired',
        status: 401,
        startedAt,
        sessionFingerprint: fingerprint,
      });
      failureLogged = true;
      return json(401, {
        ok: false,
        error: 'invalid_session',
      });
    }

    if (expiresAt <= now) {
      logValidateSessionDiagnostic({
        reason: 'idle_expired',
        status: 401,
        startedAt,
        sessionFingerprint: fingerprint,
      });
      failureLogged = true;
      return json(401, {
        ok: false,
        error: 'invalid_session',
      });
    }

    const proposedExpiresAt = addDays(now, SESSION_IDLE_DAYS);

    const nextExpiresAt =
      proposedExpiresAt < absoluteExpiresAt
        ? proposedExpiresAt
        : absoluteExpiresAt;

    const nextExpiresAtIso = nextExpiresAt.toISOString();
    const nowIso = now.toISOString();

    const ip = getClientIp(event);
    const ua = getUserAgent(event);

    await updateSessionActivity({
      sessionHash,
      nowIso,
      expiresAtIso: nextExpiresAtIso,
      ip,
      ua,
    });

    logValidateSessionDiagnostic({
      reason: 'validated',
      status: 200,
      startedAt,
      sessionFingerprint: fingerprint,
    });

    return json(200, {
      ok: true,
      email: session.email,
      expires_at: nextExpiresAtIso,
      absolute_expires_at: session.absolute_expires_at,
    });
  } catch (error) {
    if (!failureLogged) {
      logValidateSessionDiagnostic({
        reason: 'ydb_error',
        status: 500,
        startedAt,
        sessionFingerprint: fingerprint,
      });
    }

    return json(500, {
      ok: false,
      error: 'internal_error',
    });
  }
}

async function handleRevokeSession(event) {
  const body = parseBody(event);
  if (body === null) {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const providedInternalToken = String(body?.token || '');
  if (providedInternalToken !== INTERNAL_TOKEN) {
    return json(403, { ok: false, error: 'forbidden' });
  }

  const rawSessionToken =
    String(body?.session_token || '').trim() ||
    String(body?.sessionToken || '').trim() ||
    String(body?.token_value || '').trim();

  if (!rawSessionToken) {
    return json(400, { ok: false, error: 'missing_session_token' });
  }

  try {
    const sessionHash = hashSessionToken(rawSessionToken);
    const nowIso = nowDate().toISOString();

    await revokeSessionByHash(sessionHash, nowIso);

    return json(200, { ok: true });
  } catch (error) {
    return json(500, { ok: false, error: 'internal_error' });
  }
}

module.exports.handler = async function handler(event) {
  try {
    assertEnv();

    const method = getMethod(event);
    if (method !== 'POST') {
      return json(405, { ok: false, error: 'method_not_allowed' });
    }

    const body = parseBody(event);
    if (body === null) {
      return json(400, { ok: false, error: 'invalid_json' });
    }

    const path = getPath(event);
    const action = String(body?.action || '').trim().toLowerCase();

    if (path.endsWith('/request') || action === 'request') {
      return await handleRequest(event);
    }

    if (path.endsWith('/consume') || action === 'consume') {
      return await handleConsume(event);
    }

    if (path.endsWith('/validate') || action === 'validate_session') {
      return await handleValidateSession(event);
    }

    if (path.endsWith('/logout') || action === 'revoke_session') {
      return await handleRevokeSession(event);
    }

    return json(404, { ok: false, error: 'not_found' });
  } catch (error) {
    return json(500, { ok: false, error: 'internal_error' });
  }
};