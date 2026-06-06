import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'flowify-db.json');
let queue = Promise.resolve();

const COLLECTIONS = [
  'users',
  'profiles',
  'playlists',
  'playlist_members',
  'playlist_tracks',
  'saved_tracks',
  'cloud_tracks',
];

function defaultDatabase() {
  return {
    users: [],
    profiles: [],
    playlists: [],
    playlist_members: [],
    playlist_tracks: [],
    saved_tracks: [],
    cloud_tracks: [],
  };
}

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(dbPath);
  } catch {
    await fs.writeFile(dbPath, JSON.stringify(defaultDatabase(), null, 2), 'utf8');
  }
}

async function readStore() {
  await ensureStore();
  const text = await fs.readFile(dbPath, 'utf8');
  try {
    const parsed = JSON.parse(text);
    return { ...defaultDatabase(), ...parsed };
  } catch {
    return defaultDatabase();
  }
}

async function writeStore(store) {
  await ensureStore();
  await fs.writeFile(dbPath, JSON.stringify(store, null, 2), 'utf8');
}

function normalizeCollectionName(name) {
  if (!COLLECTIONS.includes(name)) {
    throw new Error(`Collection non autorisee: ${name}`);
  }
  return name;
}

function parseValue(raw) {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (/^".*"$/.test(trimmed) || /^'.*'$/.test(trimmed)) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  if (!Number.isNaN(Number(trimmed))) return Number(trimmed);
  return trimmed;
}

function splitInValues(raw) {
  const values = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
      } else if (char === '\\') {
        current += raw[i + 1] ?? '';
        i += 1;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
      continue;
    }

    if (char === ',') {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current !== '') {
    values.push(current.trim());
  }

  return values.map(parseValue);
}

function parseFilters(filterText) {
  if (!filterText) return [];
  return filterText
    .split('&&')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((clause) => {
      const inMatch = clause.match(/^([a-zA-Z0-9_]+)\s+in\s*\((.*)\)$/);
      if (inMatch) {
        return {
          field: inMatch[1],
          op: 'in',
          values: splitInValues(inMatch[2]),
        };
      }
      const eqMatch = clause.match(/^([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
      if (eqMatch) {
        return {
          field: eqMatch[1],
          op: 'eq',
          value: parseValue(eqMatch[2]),
        };
      }
      throw new Error(`Filtre invalide: ${clause}`);
    });
}

function normalizeFieldName(field) {
  if (field === '_created') return 'created_at';
  if (field === '_updated') return 'updated_at';
  return field;
}

function compareValues(a, b) {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function matchesRecord(record, filters) {
  return filters.every((filter) => {
    const field = normalizeFieldName(filter.field);
    const value = record[field];
    if (filter.op === 'eq') {
      if (value === undefined || value === null) {
        return filter.value === null;
      }
      if (typeof filter.value === 'string') {
        return String(value) === filter.value;
      }
      return value === filter.value;
    }
    if (filter.op === 'in') {
      return filter.values.some((expected) => {
        if (expected === null) return value === null || value === undefined;
        if (typeof expected === 'string') return String(value) === expected;
        return value === expected;
      });
    }
    return false;
  });
}

function sortRecords(records, sortText) {
  if (!sortText) return records;
  const direction = sortText.startsWith('-') ? -1 : 1;
  const field = normalizeFieldName(sortText.replace(/^-/, ''));
  return [...records].sort((a, b) => compareValues(a[field], b[field]) * direction);
}

function ensureRecordId(record) {
  if (!record.id) {
    return randomUUID();
  }
  return String(record.id);
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

async function withStore(fn) {
  queue = queue.then(async () => {
    const store = await readStore();
    const result = await fn(store);
    await writeStore(store);
    return result;
  });
  return queue;
}

export async function listRecords(collection, options = {}) {
  const name = normalizeCollectionName(collection);
  const store = await readStore();
  const entries = Array.isArray(store[name]) ? store[name] : [];
  const filters = parseFilters(String(options.filter || ''));
  const filtered = entries.filter((record) => matchesRecord(record, filters));
  const sorted = sortRecords(filtered, String(options.sort || ''));
  const limit = Number(options.limit || 200);
  return sorted.slice(0, Math.max(0, limit));
}

export async function getRecord(collection, id) {
  const name = normalizeCollectionName(collection);
  const store = await readStore();
  return (store[name] || []).find((record) => String(record.id) === String(id)) || null;
}

export async function createRecord(collection, payload) {
  return withStore(async (store) => {
    const name = normalizeCollectionName(collection);
    const records = store[name] || [];
    const id = ensureRecordId(payload);
    if (records.some((record) => String(record.id) === id)) {
      throw new Error(`Record ${id} already exists in ${collection}`);
    }
    const timestamp = new Date().toISOString();
    const next = {
      ...payload,
      id,
      created_at: payload.created_at || timestamp,
      updated_at: timestamp,
    };
    store[name] = [...records, next];
    return next;
  });
}

export async function updateRecords(collection, payload, filterText) {
  if (!filterText) {
    throw new Error('Filtre requis pour la mise a jour');
  }
  return withStore(async (store) => {
    const name = normalizeCollectionName(collection);
    const records = store[name] || [];
    const filters = parseFilters(filterText);
    let updatedCount = 0;
    store[name] = records.map((record) => {
      if (!matchesRecord(record, filters)) return record;
      updatedCount += 1;
      return {
        ...record,
        ...payload,
        updated_at: new Date().toISOString(),
      };
    });
    if (!updatedCount) {
      throw new Error('Enregistrement introuvable pour mise a jour');
    }
    return store[name].filter((record) => matchesRecord(record, filters));
  });
}

export async function deleteRecords(collection, filterText) {
  if (!filterText) {
    throw new Error('Filtre requis pour la suppression');
  }
  return withStore(async (store) => {
    const name = normalizeCollectionName(collection);
    const records = store[name] || [];
    const filters = parseFilters(filterText);
    const remaining = records.filter((record) => !matchesRecord(record, filters));
    if (remaining.length === records.length) {
      throw new Error('Enregistrement introuvable pour suppression');
    }
    store[name] = remaining;
    return true;
  });
}

export async function upsertRecord(collection, payload, key = 'id') {
  return withStore(async (store) => {
    const name = normalizeCollectionName(collection);
    const records = store[name] || [];
    const lookupValue = payload[key];
    if (lookupValue === undefined || lookupValue === null) {
      return createRecord(collection, payload);
    }
    const existingIndex = records.findIndex((record) => String(record[key]) === String(lookupValue));
    const timestamp = new Date().toISOString();
    if (existingIndex >= 0) {
      const updated = {
        ...records[existingIndex],
        ...payload,
        id: records[existingIndex].id,
        updated_at: timestamp,
      };
      store[name][existingIndex] = updated;
      return updated;
    }
    const id = ensureRecordId(payload);
    const next = {
      ...payload,
      id,
      created_at: payload.created_at || timestamp,
      updated_at: timestamp,
    };
    store[name] = [...records, next];
    return next;
  });
}

export async function findUserByEmail(email) {
  const store = await readStore();
  const users = store.users || [];
  return users.find((user) => String(user.email).toLowerCase() === String(email).toLowerCase()) || null;
}

export async function getUserById(id) {
  const store = await readStore();
  const users = store.users || [];
  return users.find((user) => String(user.id) === String(id)) || null;
}

export async function createUser({ email, password }) {
  const cleanEmail = String(email).trim().toLowerCase();
  if (!cleanEmail) throw new Error('Email requis');
  const existing = await findUserByEmail(cleanEmail);
  if (existing) throw new Error('Email deja utilise');
  const salt = randomUUID();
  const passwordHash = hashPassword(password, salt);
  const now = new Date().toISOString();
  const user = {
    id: randomUUID(),
    email: cleanEmail,
    passwordHash,
    passwordSalt: salt,
    created_at: now,
    updated_at: now,
  };
  await withStore(async (store) => {
    store.users = [...(store.users || []), user];
    return user;
  });
  return { id: user.id, email: user.email, created_at: user.created_at };
}

export async function verifyUserPassword(user, password) {
  if (!user || !user.passwordSalt || !user.passwordHash) return false;
  const expected = hashPassword(password, user.passwordSalt);
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(user.passwordHash, 'hex'));
  } catch {
    return false;
  }
}

export async function updateUserPassword(userId, password) {
  const salt = randomUUID();
  const passwordHash = hashPassword(password, salt);
  const updatedAt = new Date().toISOString();
  return withStore(async (store) => {
    const users = store.users || [];
    const index = users.findIndex((user) => String(user.id) === String(userId));
    if (index < 0) throw new Error('Utilisateur introuvable');
    users[index] = {
      ...users[index],
      passwordSalt: salt,
      passwordHash,
      updated_at: updatedAt,
    };
    store.users = users;
    return { id: users[index].id, email: users[index].email };
  });
}
