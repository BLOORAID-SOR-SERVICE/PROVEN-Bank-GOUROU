import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'site');
const PORT = Number(process.env.PORT) || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'data', 'proven.db'));
db.pragma('journal_mode = WAL');

try { db.exec('ALTER TABLE clients ADD COLUMN identity_document TEXT'); } catch {}
try { db.exec('ALTER TABLE clients ADD COLUMN residence_certificate TEXT'); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    first_name TEXT, last_name TEXT, date_of_birth TEXT,
    passport_number TEXT, email TEXT, telephone TEXT, cellphone TEXT,
    username TEXT UNIQUE, account_type TEXT, corporate_full_name TEXT,
    subsidiary TEXT, branch TEXT, home_address TEXT, home_city TEXT, home_country TEXT,
    status TEXT DEFAULT 'pending', balance REAL DEFAULT 0, password TEXT,
    identity_document TEXT, residence_certificate TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, client_id TEXT, subject TEXT, body TEXT,
    from_admin INTEGER DEFAULT 0, read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, client_id TEXT, type TEXT, amount REAL,
    description TEXT, status TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS withdrawals (
    id TEXT PRIMARY KEY, client_id TEXT, amount REAL,
    status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now'))
  );
`);

/* ─── Import legacy JSON data if DB is empty ─── */
const row = db.prepare('SELECT COUNT(*) AS c FROM clients').get();
if (row.c === 0) {
  const DATA = path.join(__dirname, 'data');
  for (const [table, file] of [['clients','clients.json'],['messages','messages.json'],['transactions','transactions.json'],['withdrawals','withdrawals.json']]) {
    try {
      const rows = JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf-8'));
      if (rows.length === 0) continue;
      const cols = Object.keys(rows[0]);
      const placeholders = cols.map(() => '?').join(',');
      const insert = db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`);
      const tx = db.transaction(() => { for (const r of rows) insert.run(cols.map(c => r[c])); });
      tx();
    } catch {}
  }
}

const app = express();
app.use(express.json());

/* ─── Admin auth ─── */
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const TOKENS = new Set();

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !TOKENS.has(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

/* ─── Auth ─── */
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

/* ─── Registration ─── */
app.post('/api/register', (req, res) => {
  const id = crypto.randomUUID();
  const created = new Date().toISOString();
  const identityDoc = saveBase64File(req.body.identity_document);
  const residenceCert = saveBase64File(req.body.residence_certificate);
  try {
    db.prepare(`INSERT INTO clients (id, first_name, last_name, date_of_birth, passport_number, email, telephone, cellphone, username, account_type, corporate_full_name, subsidiary, branch, home_address, home_city, home_country, identity_document, residence_certificate, status, balance, password, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',0,NULL,?)`).run(
      id, req.body.first_name, req.body.last_name, req.body.date_of_birth,
      req.body.passport_number, req.body.email, req.body.telephone, req.body.cellphone,
      req.body.username, req.body.account_type, req.body.corporate_full_name || null,
      req.body.subsidiary, req.body.branch, req.body.home_address, req.body.home_city,
      req.body.home_country, identityDoc, residenceCert, created
    );
    res.json({ success: true, client: { id, ...req.body, identity_document: identityDoc, residence_certificate: residenceCert, status: 'pending', balance: 0 } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ─── Client login ─── */
app.post('/api/client/login', (req, res) => {
  const { username, password } = req.body;
  const client = db.prepare('SELECT * FROM clients WHERE username = ? AND password = ?').get(username, password);
  if (!client) return res.status(401).json({ error: 'Invalid credentials' });
  if (client.status !== 'active') return res.status(403).json({ error: 'Account not activated' });
  const { password: _, ...safe } = client;
  res.json({ client: safe });
});

/* ─── Client profile update ─── */
app.put('/api/client/profile/:id', (req, res) => {
  const allowed = ['first_name','last_name','date_of_birth','passport_number','email','telephone','cellphone','home_address','home_city','home_country','branch','identity_document','residence_certificate'];
  const sets = allowed.filter(f => req.body[f] !== undefined).map(f => `${f} = ?`).join(', ');
  const vals = allowed.filter(f => req.body[f] !== undefined).map(f => req.body[f]);
  if (req.body.new_password && req.body.new_password.length >= 4) {
    sets += ', password = ?';
    vals.push(req.body.new_password);
  }
  if (!sets) return res.status(400).json({ error: 'No fields to update' });
  vals.push(req.params.id);
  db.prepare(`UPDATE clients SET ${sets} WHERE id = ?`).run(...vals);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  const { password: _, ...safe } = client;
  res.json({ success: true, client: safe });
});

/* ─── Messages ─── */
app.get('/api/messages/:clientId', (req, res) => {
  res.json(db.prepare('SELECT * FROM messages WHERE client_id = ? OR client_id = ? ORDER BY created_at DESC').all(req.params.clientId, '*'));
});

/* ─── Withdrawals (client) ─── */
app.post('/api/withdrawals', (req, res) => {
  const { client_id, amount } = req.body;
  const wid = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO withdrawals (id, client_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?)').run(wid, client_id, Number(amount), 'pending', now);
  db.prepare('INSERT INTO transactions (id, client_id, type, amount, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), client_id, 'withdrawal', Number(amount), 'Withdrawal request (pending)', 'pending', now);
  res.json({ success: true });
});

/* ─── Client data ─── */
app.get('/api/client/data/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  const { password: _, ...safe } = client;
  res.json(safe);
});

/* ─── Client transactions ─── */
app.get('/api/client/transactions/:clientId', (req, res) => {
  res.json(db.prepare('SELECT * FROM transactions WHERE client_id = ? ORDER BY created_at DESC').all(req.params.clientId));
});

/* ─── Admin routes ─── */
app.get('/api/admin/clients', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM clients').all());
});

app.get('/api/admin/clients/:id', requireAdmin, (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  res.json(client);
});

app.put('/api/admin/clients/:id/activate', requireAdmin, (req, res) => {
  db.prepare("UPDATE clients SET status = 'active', password = ? WHERE id = ?").run(req.body.password || 'default123', req.params.id);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  db.prepare('INSERT INTO transactions (id, client_id, type, amount, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), req.params.id, 'deposit', 0, 'Account activation', 'completed', new Date().toISOString());
  res.json({ success: true, client });
});

app.put('/api/admin/clients/:id/credit', requireAdmin, (req, res) => {
  const amount = Number(req.body.amount);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE clients SET balance = balance + ? WHERE id = ?').run(amount, req.params.id);
  db.prepare('INSERT INTO transactions (id, client_id, type, amount, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), req.params.id, 'deposit', amount, 'Deposit by bank', 'completed', new Date().toISOString());
  const updated = db.prepare('SELECT balance FROM clients WHERE id = ?').get(req.params.id);
  res.json({ success: true, balance: updated.balance });
});

app.get('/api/admin/clients/:id/withdrawals', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM withdrawals WHERE client_id = ? ORDER BY created_at DESC').all(req.params.id));
});

app.put('/api/admin/withdrawals/:id/validate', requireAdmin, (req, res) => {
  db.prepare("UPDATE withdrawals SET status = 'approved' WHERE id = ?").run(req.params.id);
  const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (withdrawal) {
    const txn = db.prepare("SELECT * FROM transactions WHERE client_id = ? AND amount = ? AND status = 'pending' AND type = 'withdrawal' ORDER BY created_at DESC LIMIT 1").get(withdrawal.client_id, withdrawal.amount);
    if (txn) {
      db.prepare("UPDATE transactions SET status = 'completed', description = 'Withdrawal approved' WHERE id = ?").run(txn.id);
    }
  }
  db.prepare('UPDATE clients SET balance = balance - ? WHERE id = ?').run(withdrawal.amount, withdrawal.client_id);
  res.json({ success: true, withdrawal });
});

app.post('/api/admin/messages', requireAdmin, (req, res) => {
  const { client_id, subject, body } = req.body;
  const now = new Date().toISOString();
  if (client_id === '*') {
    const clients = db.prepare('SELECT id FROM clients').all();
    const insert = db.prepare('INSERT INTO messages (id, client_id, subject, body, from_admin, read, created_at) VALUES (?, ?, ?, ?, 1, 0, ?)');
    const tx = db.transaction(() => { for (const c of clients) insert.run(crypto.randomUUID(), c.id, subject, body, now); });
    tx();
  } else {
    db.prepare('INSERT INTO messages (id, client_id, subject, body, from_admin, read, created_at) VALUES (?, ?, ?, ?, 1, 0, ?)').run(crypto.randomUUID(), client_id, subject, body, now);
  }
  res.json({ success: true });
});

/* ─── Static files ─── */
app.use(express.static(ROOT, { extensions: ['html'], index: ['index.html'] }));
app.use('/uploads', express.static(UPLOADS_DIR));

app.listen(PORT, () => {
  console.log(`PROVEN Bank site: http://localhost:${PORT}/`);
});
