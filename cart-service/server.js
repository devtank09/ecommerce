const express = require('express');
const cors = require('cors');
const os = require('os');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3003;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo-db:27017/cloudmart_nosql';

app.use(cors());
app.use(express.json());

let cartsCol = null;
let mongoConnected = false;
const memoryCarts = new Map();

async function initMongo() {
  try {
    const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 3000 });
    await client.connect();
    cartsCol = client.db('cloudmart_nosql').collection('carts');
    mongoConnected = true;
    console.log('[cart-service] Connected to MongoDB carts collection.');
  } catch (err) {
    mongoConnected = false;
    console.warn('[cart-service] MongoDB warming up, using fallback memory store:', err.message);
  }
}
initMongo();
setInterval(() => { if (!mongoConnected) initMongo(); }, 10000);

function summarizeCart(items) {
  const subtotal = Number(items.reduce((acc, i) => acc + i.price * i.quantity, 0).toFixed(2));
  const totalWeightKg = Number(items.reduce((acc, i) => acc + (i.weightKg || 0.5) * i.quantity, 0).toFixed(2));
  const totalQuantity = items.reduce((acc, i) => acc + i.quantity, 0);
  return { items, subtotal, totalWeightKg, totalQuantity };
}

async function getItems(userId) {
  if (mongoConnected && cartsCol) {
    const doc = await cartsCol.findOne({ userId });
    return doc ? doc.items : [];
  }
  return memoryCarts.get(userId) || [];
}

async function saveItems(userId, items) {
  memoryCarts.set(userId, items);
  if (mongoConnected && cartsCol) {
    await cartsCol.updateOne({ userId }, { $set: { userId, items, updatedAt: new Date() } }, { upsert: true });
  }
}

app.get('/health', (req, res) => {
  res.json({
    service: 'cart-service',
    database: 'MongoDB',
    mongoConnected,
    status: 'UP',
    pod: os.hostname(),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/cart/:userId', async (req, res) => {
  const items = await getItems(req.params.userId);
  res.json({ database: 'MongoDB', pod: os.hostname(), userId: req.params.userId, ...summarizeCart(items) });
});

app.post('/api/cart/:userId/items', async (req, res) => {
  const { userId } = req.params;
  const { productId, name, price, weightKg, quantity = 1 } = req.body || {};
  if (!productId || !name || typeof price !== 'number') {
    return res.status(400).json({ error: 'productId, name, and numeric price are required.' });
  }
  const items = await getItems(userId);
  const existing = items.find(i => i.productId === productId);
  if (existing) existing.quantity += Number(quantity);
  else items.push({ productId, name, price, weightKg: weightKg || 0.5, quantity: Number(quantity) });
  await saveItems(userId, items);
  res.status(201).json({ database: 'MongoDB', pod: os.hostname(), userId, ...summarizeCart(items) });
});

app.patch('/api/cart/:userId/items/:productId', async (req, res) => {
  const { userId, productId } = req.params;
  const { quantity } = req.body || {};
  let items = await getItems(userId);
  if (Number(quantity) <= 0) items = items.filter(i => i.productId !== productId);
  else {
    const item = items.find(i => i.productId === productId);
    if (item) item.quantity = Number(quantity);
  }
  await saveItems(userId, items);
  res.json({ database: 'MongoDB', pod: os.hostname(), userId, ...summarizeCart(items) });
});

app.delete('/api/cart/:userId', async (req, res) => {
  await saveItems(req.params.userId, []);
  res.json({ database: 'MongoDB', pod: os.hostname(), userId: req.params.userId, ...summarizeCart([]) });
});

app.listen(PORT, () => console.log(`[cart-service] listening on port ${PORT} (MongoDB backend)`));
