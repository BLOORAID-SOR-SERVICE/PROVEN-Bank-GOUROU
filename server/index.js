import express from 'express';
import { createClient } from '@libsql/client';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'site');
const PORT = Number(process.env.PORT) || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const dbUrl = process.env.TURSO_DATABASE_URL || ('file:' + path.join(__dirname, 'data', 'proven.db'));
const db = createClient({ url: dbUrl, authToken: process.env.TURSO_AUTH_TOKEN });

function row(result, index) {
  const r = result.rows[index];
  if (!r) return null;
  const o = {};
  for (let i = 0; i < result.columns.length; i++) o[result.columns[i]] = r[i];
  return o;
}
function rows(result) {
  const out = [];
  for (let i = 0; i < result.rows.length; i++) out.push(row(result, i));
  return out;
}

for (const stmt of [
  'PRAGMA journal_mode = WAL',
  'ALTER TABLE clients ADD COLUMN identity_document TEXT',
  'ALTER TABLE clients ADD COLUMN residence_certificate TEXT',
  `CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    first_name TEXT, last_name TEXT, date_of_birth TEXT,
    passport_number TEXT, email TEXT, telephone TEXT, cellphone TEXT,
    username TEXT UNIQUE, account_type TEXT, corporate_full_name TEXT,
    subsidiary TEXT, home_city TEXT, home_country TEXT,
    status TEXT DEFAULT 'pending', balance REAL DEFAULT 0, password TEXT,
    identity_document TEXT, residence_certificate TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, client_id TEXT, subject TEXT, body TEXT,
    from_admin INTEGER DEFAULT 0, read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, client_id TEXT, type TEXT, amount REAL,
    description TEXT, status TEXT, created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS withdrawals (
    id TEXT PRIMARY KEY, client_id TEXT, amount REAL,
    status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now'))
  )`,
  `ALTER TABLE withdrawals ADD COLUMN full_name TEXT`,
  `ALTER TABLE withdrawals ADD COLUMN rib TEXT`,
  `ALTER TABLE withdrawals ADD COLUMN iban TEXT`,
  `ALTER TABLE withdrawals ADD COLUMN swift TEXT`,
  `ALTER TABLE withdrawals ADD COLUMN transit_number TEXT`,
  `ALTER TABLE withdrawals ADD COLUMN institutional_number TEXT`,
  `ALTER TABLE withdrawals ADD COLUMN reference TEXT`,
  `ALTER TABLE withdrawals ADD COLUMN currency TEXT DEFAULT 'USD'`,
  `ALTER TABLE withdrawals ADD COLUMN amount_original REAL`,
]) {
  try { await db.execute(stmt); } catch {}
}

/* ─── Import legacy JSON data if DB is empty ─── */
const countResult = await db.execute('SELECT COUNT(*) AS c FROM clients');
const r0 = row(countResult, 0);
if (r0.c === 0) {
  const DATA = path.join(__dirname, 'data');
  for (const [table, file] of [['clients','clients.json'],['messages','messages.json'],['transactions','transactions.json'],['withdrawals','withdrawals.json']]) {
    try {
      const jsonRows = JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf-8'));
      if (jsonRows.length === 0) continue;
      const cols = Object.keys(jsonRows[0]);
      const placeholders = cols.map(() => '?').join(',');
      for (const r of jsonRows) {
        try { await db.execute(`INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`, cols.map(c => r[c])); } catch {}
      }
    } catch {}
  }
}

const app = express();
app.use(express.json({ limit: '100mb' }));

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const TOKENS = new Set();

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !TOKENS.has(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = crypto.randomBytes(16).toString('hex');
    TOKENS.add(token);
    return res.json({ token });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

function saveBase64File(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return null;
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) return null;
  const ext = matches[1].split('/')[1] || 'bin';
  const filename = Date.now() + '-' + crypto.randomBytes(8).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), matches[2], 'base64');
  return filename;
}

function v(v) { return v === undefined ? null : v; }

app.post('/api/register', async (req, res) => {
  const id = crypto.randomUUID();
  const created = new Date().toISOString();
  const identityDoc = saveBase64File(req.body.identity_document);
  const residenceCert = saveBase64File(req.body.residence_certificate);
  try {
    await db.execute(
      `INSERT INTO clients (id, first_name, last_name, date_of_birth, passport_number, email, telephone, cellphone, username, account_type, corporate_full_name, subsidiary, home_city, home_country, identity_document, residence_certificate, status, balance, password, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',0,NULL,?)`,
      [id, v(req.body.first_name), v(req.body.last_name), v(req.body.date_of_birth),
       v(req.body.passport_number), v(req.body.email), v(req.body.telephone), v(req.body.cellphone),
       v(req.body.username), v(req.body.account_type), v(req.body.corporate_full_name),
       v(req.body.subsidiary), v(req.body.home_city),
       v(req.body.home_country), identityDoc, residenceCert, created]
    );
    res.json({ success: true, client: { id, ...req.body, identity_document: identityDoc, residence_certificate: residenceCert, status: 'pending', balance: 0 } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/client/login', async (req, res) => {
  const { username, password } = req.body;
  const result = await db.execute('SELECT * FROM clients WHERE (username = ? OR email = ?) AND password = ?', [username, username, password]);
  const client = row(result, 0);
  if (!client) return res.status(401).json({ error: 'Invalid credentials' });
  if (client.status !== 'active') return res.status(403).json({ error: 'Account not activated' });
  const { password: _, ...safe } = client;
  res.json({ client: safe });
});

app.put('/api/client/profile/:id', async (req, res) => {
  const allowed = ['first_name','last_name','date_of_birth','passport_number','email','telephone','cellphone','home_city','home_country','identity_document','residence_certificate'];
  const sets = allowed.filter(f => req.body[f] !== undefined).map(f => `${f} = ?`).join(', ');
  const vals = allowed.filter(f => req.body[f] !== undefined).map(f => v(req.body[f]));
  if (req.body.new_password && req.body.new_password.length >= 4) {
    sets += ', password = ?';
    vals.push(req.body.new_password);
  }
  if (!sets) return res.status(400).json({ error: 'No fields to update' });
  vals.push(req.params.id);
  await db.execute(`UPDATE clients SET ${sets} WHERE id = ?`, vals);
  const result = await db.execute('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  const client = row(result, 0);
  if (!client) return res.status(404).json({ error: 'Not found' });
  const { password: _, ...safe } = client;
  res.json({ success: true, client: safe });
});

app.get('/api/messages/:clientId', async (req, res) => {
  const result = await db.execute('SELECT * FROM messages WHERE client_id = ? OR client_id = ? ORDER BY created_at DESC', [req.params.clientId, '*']);
  res.json(rows(result));
});

app.post('/api/withdrawals', async (req, res) => {
  const { client_id, amount, full_name, rib, iban, swift, transit_number, institutional_number, reference, currency, amount_original } = req.body;
  const wid = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute('INSERT INTO withdrawals (id, client_id, amount, full_name, rib, iban, swift, transit_number, institutional_number, reference, currency, amount_original, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [wid, client_id, Number(amount), full_name || null, rib || null, iban || null, swift || null, transit_number || null, institutional_number || null, reference || null, currency || 'USD', amount_original ? Number(amount_original) : null, 'pending', now]);
  await db.execute('INSERT INTO transactions (id, client_id, type, amount, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), client_id, 'withdrawal', Number(amount), 'Withdrawal request (pending)', 'pending', now]);
  res.json({ success: true });
});

app.get('/api/client/data/:id', async (req, res) => {
  const result = await db.execute('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  const client = row(result, 0);
  if (!client) return res.status(404).json({ error: 'Not found' });
  const { password: _, ...safe } = client;
  res.json(safe);
});

app.get('/api/client/transactions/:clientId', async (req, res) => {
  const result = await db.execute('SELECT * FROM transactions WHERE client_id = ? ORDER BY created_at DESC', [req.params.clientId]);
  res.json(rows(result));
});

app.get('/api/admin/clients', requireAdmin, async (req, res) => {
  const result = await db.execute('SELECT * FROM clients');
  res.json(rows(result));
});

app.get('/api/admin/clients/:id', requireAdmin, async (req, res) => {
  const result = await db.execute('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  const client = row(result, 0);
  if (!client) return res.status(404).json({ error: 'Not found' });
  res.json(client);
});

app.put('/api/admin/clients/:id/activate', requireAdmin, async (req, res) => {
  await db.execute("UPDATE clients SET status = 'active', password = ? WHERE id = ?", [req.body.password || 'default123', req.params.id]);
  const result = await db.execute('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  const client = row(result, 0);
  if (!client) return res.status(404).json({ error: 'Not found' });
  await db.execute('INSERT INTO transactions (id, client_id, type, amount, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), req.params.id, 'deposit', 0, 'Account activation', 'completed', new Date().toISOString()]);
  res.json({ success: true, client });
});

app.put('/api/admin/clients/:id/credit', requireAdmin, async (req, res) => {
  const amount = Number(req.body.amount);
  const result = await db.execute('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  const client = row(result, 0);
  if (!client) return res.status(404).json({ error: 'Not found' });
  await db.execute('UPDATE clients SET balance = balance + ? WHERE id = ?', [amount, req.params.id]);
  await db.execute('INSERT INTO transactions (id, client_id, type, amount, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), req.params.id, 'deposit', amount, 'Deposit by bank', 'completed', new Date().toISOString()]);
  const updatedResult = await db.execute('SELECT balance FROM clients WHERE id = ?', [req.params.id]);
  const updated = row(updatedResult, 0);
  res.json({ success: true, balance: updated.balance });
});

app.put('/api/admin/clients/:id/balance', requireAdmin, async (req, res) => {
  const newBalance = Number(req.body.balance);
  const result = await db.execute('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  const client = row(result, 0);
  if (!client) return res.status(404).json({ error: 'Not found' });
  const oldBalance = client.balance;
  await db.execute('UPDATE clients SET balance = ? WHERE id = ?', [newBalance, req.params.id]);
  const diff = newBalance - oldBalance;
  const txnType = diff >= 0 ? 'deposit' : 'withdrawal';
  await db.execute('INSERT INTO transactions (id, client_id, type, amount, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), req.params.id, txnType, Math.abs(diff), 'Balance adjustment by admin', 'completed', new Date().toISOString()]);
  const updatedResult = await db.execute('SELECT balance FROM clients WHERE id = ?', [req.params.id]);
  const updated = row(updatedResult, 0);
  res.json({ success: true, balance: updated.balance, old_balance: oldBalance });
});

app.get('/api/admin/withdrawals/pending', requireAdmin, async (req, res) => {
  const result = await db.execute("SELECT client_id FROM withdrawals WHERE status = 'pending'");
  const ids = rows(result).map(r => r.client_id);
  res.json(ids);
});

app.get('/api/admin/clients/:id/withdrawals', requireAdmin, async (req, res) => {
  const result = await db.execute('SELECT * FROM withdrawals WHERE client_id = ? ORDER BY created_at DESC', [req.params.id]);
  res.json(rows(result));
});

app.put('/api/admin/withdrawals/:id/validate', requireAdmin, async (req, res) => {
  await db.execute("UPDATE withdrawals SET status = 'approved' WHERE id = ?", [req.params.id]);
  const withdrawalResult = await db.execute('SELECT * FROM withdrawals WHERE id = ?', [req.params.id]);
  const withdrawal = row(withdrawalResult, 0);
  if (withdrawal) {
    const txnResult = await db.execute("SELECT * FROM transactions WHERE client_id = ? AND amount = ? AND status = 'pending' AND type = 'withdrawal' ORDER BY created_at DESC LIMIT 1", [withdrawal.client_id, withdrawal.amount]);
    const txn = row(txnResult, 0);
    if (txn) {
      await db.execute("UPDATE transactions SET status = 'completed', description = 'Withdrawal approved' WHERE id = ?", [txn.id]);
    }
  }
  await db.execute('UPDATE clients SET balance = balance - ? WHERE id = ?', [withdrawal.amount, withdrawal.client_id]);
  res.json({ success: true, withdrawal });
});

app.post('/api/admin/messages', requireAdmin, async (req, res) => {
  const { client_id, subject, body } = req.body;
  const now = new Date().toISOString();
  if (client_id === '*') {
    const clientsResult = await db.execute('SELECT id FROM clients');
    const allClients = rows(clientsResult);
    for (const c of allClients) {
      await db.execute('INSERT INTO messages (id, client_id, subject, body, from_admin, read, created_at) VALUES (?, ?, ?, ?, 1, 0, ?)', [crypto.randomUUID(), c.id, subject, body, now]);
    }
  } else {
    await db.execute('INSERT INTO messages (id, client_id, subject, body, from_admin, read, created_at) VALUES (?, ?, ?, ?, 1, 0, ?)', [crypto.randomUUID(), client_id, subject, body, now]);
  }
  res.json({ success: true });
});

app.use(express.static(ROOT, { extensions: ['html'], index: ['index.html'] }));
app.use('/uploads', express.static(UPLOADS_DIR));

app.listen(PORT, () => {
  console.log(`PROVEN Bank site: http://localhost:${PORT}/`);
});
