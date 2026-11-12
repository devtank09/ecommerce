const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const os = require('os');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://cloudmart:cloudmart_pass@postgres-db:5432/cloudmart_sql';

app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
let dbConnected = false;

// Fallback in-memory map if PostgreSQL is still initializing
const memoryUsers = new Map([
  ['demo@cloudmart.dev', {
    id: 'usr-1001',
    name: 'Aarav Sharma',
    email: 'demo@cloudmart.dev',
    passwordHash: crypto.createHash('sha256').update('Pass@123').digest('hex'),
    role: 'customer',
    address: '42 MG Road, Indore, MP 452001, India',
    createdAt: '2026-11-01T10:00:00Z'
  }]
]);
const sessions = new Map();

async function initPostgres() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(32) PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(160) UNIQUE NOT NULL,
        password_hash VARCHAR(128) NOT NULL,
        role VARCHAR(32) DEFAULT 'customer',
        address TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    const demoHash = crypto.createHash('sha256').update('Pass@123').digest('hex');
    await pool.query(`
      INSERT INTO users (id, name, email, password_hash, role, address)
      VALUES ('usr-1001', 'Aarav Sharma', 'demo@cloudmart.dev', $1, 'customer', '42 MG Road, Indore, MP 452001, India')
      ON CONFLICT (email) DO NOTHING;
    `, [demoHash]);
    dbConnected = true;
    console.log('[user-service] Connected to PostgreSQL and verified users table.');
  } catch (err) {
    dbConnected = false;
    console.warn('[user-service] PostgreSQL warming up, using fallback store:', err.message);
  }
}
initPostgres();
setInterval(() => { if (!dbConnected) initPostgres(); }, 10000);

app.get('/health', (req, res) => {
  res.json({
    service: 'user-service',
    database: 'PostgreSQL',
    dbConnected,
    status: 'UP',
    pod: os.hostname(),
    timestamp: new Date().toISOString()
  });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, address } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }
  const normalized = email.trim().toLowerCase();
  const id = 'usr-' + Math.floor(1000 + Math.random() * 9000);
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  const userAddress = address || 'Indore, Madhya Pradesh, India';

  if (dbConnected) {
    try {
      const result = await pool.query(
        'INSERT INTO users (id, name, email, password_hash, address) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, address, created_at',
        [id, name.trim(), normalized, passwordHash, userAddress]
      );
      const u = result.rows[0];
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, u.email);
      return res.status(201).json({ token, database: 'PostgreSQL', pod: os.hostname(), user: u });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Account already exists with this email.' });
    }
  }

  if (memoryUsers.has(normalized)) {
    return res.status(409).json({ error: 'Account already exists with this email.' });
  }
  const user = { id, name: name.trim(), email: normalized, passwordHash, address: userAddress, createdAt: new Date().toISOString() };
  memoryUsers.set(normalized, user);
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, user.email);
  res.status(201).json({ token, database: 'PostgreSQL-Fallback', pod: os.hostname(), user: { id, name: user.name, email: user.email, address: user.address } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const normalized = email.trim().toLowerCase();
  const hash = crypto.createHash('sha256').update(password).digest('hex');

  if (dbConnected) {
    try {
      const { rows } = await pool.query('SELECT id, name, email, password_hash, address FROM users WHERE email = $1', [normalized]);
      if (!rows.length || rows[0].password_hash !== hash) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      const u = rows[0];
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, u.email);
      return res.json({ token, database: 'PostgreSQL', pod: os.hostname(), user: { id: u.id, name: u.name, email: u.email, address: u.address } });
    } catch (e) {}
  }

  const user = memoryUsers.get(normalized);
  if (!user || user.passwordHash !== hash) return res.status(401).json({ error: 'Invalid email or password.' });
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, user.email);
  res.json({ token, database: 'PostgreSQL-Fallback', pod: os.hostname(), user: { id: user.id, name: user.name, email: user.email, address: user.address } });
});

app.get('/api/auth/profile', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  const email = sessions.get(token) || 'demo@cloudmart.dev';
  if (dbConnected) {
    try {
      const { rows } = await pool.query('SELECT id, name, email, address, created_at FROM users WHERE email = $1', [email]);
      if (rows.length) return res.json({ database: 'PostgreSQL', pod: os.hostname(), user: rows[0] });
    } catch (e) {}
  }
  const u = memoryUsers.get(email);
  if (!u) return res.status(401).json({ error: 'Unauthorized session token.' });
  res.json({ database: 'PostgreSQL-Fallback', pod: os.hostname(), user: { id: u.id, name: u.name, email: u.email, address: u.address } });
});

app.listen(PORT, () => console.log(`[user-service] listening on port ${PORT} (PostgreSQL backend)`));
