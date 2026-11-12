const express = require('express');
const cors = require('cors');
const os = require('os');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3005;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://cloudmart:cloudmart_pass@postgres-db:5432/cloudmart_sql';

app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
let dbConnected = false;
const memoryOrders = [];

async function initPostgres() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        order_id VARCHAR(32) PRIMARY KEY,
        user_id VARCHAR(32) NOT NULL,
        customer_name VARCHAR(120) NOT NULL,
        address TEXT NOT NULL,
        subtotal NUMERIC(10,2) NOT NULL,
        shipping_cost NUMERIC(10,2) NOT NULL,
        tax_amount NUMERIC(10,2) NOT NULL,
        grand_total NUMERIC(10,2) NOT NULL,
        payment_status VARCHAR(32) DEFAULT 'PAID_VERIFIED',
        tracking_id VARCHAR(32),
        items_json JSONB NOT NULL,
        pod VARCHAR(80),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    dbConnected = true;
    console.log('[order-service] Connected to PostgreSQL orders table.');
  } catch (err) {
    dbConnected = false;
    console.warn('[order-service] PostgreSQL warming up, using fallback store:', err.message);
  }
}
initPostgres();
setInterval(() => { if (!dbConnected) initPostgres(); }, 10000);

app.get('/health', (req, res) => {
  res.json({
    service: 'order-service',
    database: 'PostgreSQL',
    dbConnected,
    status: 'UP',
    pod: os.hostname(),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/orders', async (req, res) => {
  if (dbConnected) {
    try {
      const { rows } = await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 50');
      return res.json({ database: 'PostgreSQL', pod: os.hostname(), count: rows.length, orders: rows });
    } catch (e) {}
  }
  res.json({ database: 'PostgreSQL-Fallback', pod: os.hostname(), count: memoryOrders.length, orders: memoryOrders });
});

app.post('/api/orders', async (req, res) => {
  const { userId = 'usr-1001', customerName = 'Customer', address, items = [], subtotal = 0, shippingCost = 0, taxAmount = 0, grandTotal = 0, trackingId } = req.body || {};
  if (!address || !items.length) {
    return res.status(400).json({ error: 'Address and order items are required.' });
  }
  const orderId = 'ORD-' + Math.floor(10000 + Math.random() * 90000);
  const resolvedTracking = trackingId || ('AKS-TRK-' + Math.floor(100000 + Math.random() * 900000));
  const record = {
    orderId,
    userId,
    customerName,
    address,
    subtotal: Number(subtotal),
    shippingCost: Number(shippingCost),
    taxAmount: Number(taxAmount),
    grandTotal: Number(grandTotal),
    paymentStatus: 'PAID_VERIFIED',
    trackingId: resolvedTracking,
    items,
    pod: os.hostname(),
    createdAt: new Date().toISOString()
  };

  if (dbConnected) {
    try {
      await pool.query(
        `INSERT INTO orders (order_id, user_id, customer_name, address, subtotal, shipping_cost, tax_amount, grand_total, payment_status, tracking_id, items_json, pod)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PAID_VERIFIED', $9, $10, $11)`,
        [orderId, userId, customerName, address, record.subtotal, record.shippingCost, record.taxAmount, record.grandTotal, resolvedTracking, JSON.stringify(items), record.pod]
      );
    } catch (e) {}
  }
  memoryOrders.unshift(record);
  res.status(201).json({ database: 'PostgreSQL', pod: os.hostname(), order: record });
});

app.listen(PORT, () => console.log(`[order-service] listening on port ${PORT} (PostgreSQL backend)`));
