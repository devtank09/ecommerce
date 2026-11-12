const express = require('express');
const cors = require('cors');
const os = require('os');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3004;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://cloudmart:cloudmart_pass@postgres-db:5432/cloudmart_sql';

app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
let dbConnected = false;
const memoryShipments = new Map();

const shippingMethods = [
  { id: 'standard', name: 'Azure Ground Standard', baseFee: 5.99, perKgFee: 1.50, freeOver: 250, etaDays: '4-6 business days' },
  { id: 'express', name: 'Priority Air Express', baseFee: 14.99, perKgFee: 2.75, freeOver: 600, etaDays: '1-2 business days' },
  { id: 'overnight', name: 'Next-Day Prime Courier', baseFee: 29.99, perKgFee: 4.20, freeOver: 1200, etaDays: 'Next business day' }
];

async function initPostgres() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shipments (
        tracking_id VARCHAR(32) PRIMARY KEY,
        order_id VARCHAR(32) NOT NULL,
        customer_name VARCHAR(120),
        address TEXT NOT NULL,
        carrier_name VARCHAR(80),
        eta_days VARCHAR(40),
        shipping_cost NUMERIC(10,2),
        grand_total NUMERIC(10,2),
        status VARCHAR(64) DEFAULT 'DISPATCHED_FROM_FULFILLMENT_HUB',
        pod VARCHAR(80),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    dbConnected = true;
    console.log('[shipping-service] Connected to PostgreSQL shipments table.');
  } catch (err) {
    dbConnected = false;
    console.warn('[shipping-service] PostgreSQL warming up, using fallback store:', err.message);
  }
}
initPostgres();
setInterval(() => { if (!dbConnected) initPostgres(); }, 10000);

function computeQuote(subtotal = 0, weightKg = 1.0, methodId = 'standard', region = 'IN-Central') {
  const method = shippingMethods.find(m => m.id === methodId) || shippingMethods[0];
  const regionalMultiplier = region === 'Intl' ? 1.85 : (region === 'Remote' ? 1.25 : 1.0);
  let shippingCost = 0;
  if (subtotal < method.freeOver) {
    shippingCost = Number(((method.baseFee + weightKg * method.perKgFee) * regionalMultiplier).toFixed(2));
  }
  const taxAmount = Number((subtotal * 0.08).toFixed(2));
  const grandTotal = Number((subtotal + shippingCost + taxAmount).toFixed(2));
  return {
    methodId: method.id,
    carrierName: method.name,
    etaDays: method.etaDays,
    region,
    weightKg: Number(weightKg.toFixed(2)),
    subtotal: Number(subtotal.toFixed(2)),
    shippingCost,
    taxAmount,
    grandTotal
  };
}

app.get('/health', (req, res) => {
  res.json({
    service: 'shipping-service',
    database: 'PostgreSQL',
    dbConnected,
    status: 'UP',
    pod: os.hostname(),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/shipping/rates', (req, res) => {
  res.json({ database: 'PostgreSQL', pod: os.hostname(), methods: shippingMethods });
});

app.post('/api/shipping/calculate', (req, res) => {
  const { subtotal = 0, weightKg = 1.0, methodId = 'standard', region = 'IN-Central' } = req.body || {};
  res.json({ database: 'PostgreSQL', pod: os.hostname(), quote: computeQuote(Number(subtotal), Number(weightKg), methodId, region) });
});

app.post('/api/shipping/orders', async (req, res) => {
  const { orderId, customerName, address, subtotal = 0, weightKg = 1.0, methodId = 'standard', region = 'IN-Central' } = req.body || {};
  if (!address) return res.status(400).json({ error: 'Shipping address is required.' });
  const quote = computeQuote(Number(subtotal), Number(weightKg), methodId, region);
  const trackingId = 'AKS-TRK-' + Math.floor(100000 + Math.random() * 900000);
  const resolvedOrderId = orderId || ('ORD-' + Math.floor(10000 + Math.random() * 90000));

  const shipment = {
    orderId: resolvedOrderId,
    trackingId,
    customerName: customerName || 'Customer',
    address,
    quote,
    status: 'DISPATCHED_FROM_FULFILLMENT_HUB',
    pod: os.hostname(),
    createdAt: new Date().toISOString()
  };

  if (dbConnected) {
    try {
      await pool.query(
        `INSERT INTO shipments (tracking_id, order_id, customer_name, address, carrier_name, eta_days, shipping_cost, grand_total, status, pod)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [trackingId, resolvedOrderId, shipment.customerName, address, quote.carrierName, quote.etaDays, quote.shippingCost, quote.grandTotal, shipment.status, shipment.pod]
      );
    } catch (e) {}
  }
  memoryShipments.set(trackingId, shipment);
  res.status(201).json({ database: 'PostgreSQL', pod: os.hostname(), order: shipment });
});

app.listen(PORT, () => console.log(`[shipping-service] listening on port ${PORT} (PostgreSQL backend)`));
