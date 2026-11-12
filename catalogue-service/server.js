const express = require('express');
const cors = require('cors');
const os = require('os');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3002;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo-db:27017/cloudmart_nosql';

app.use(cors());
app.use(express.json());

const SEED_PRODUCTS = [
  {
    id: 'prd-101',
    sku: 'AZ-MECH-K8',
    name: 'CloudForge Wireless Mechanical Keyboard',
    category: 'Peripherals',
    price: 119.00,
    weightKg: 0.95,
    stock: 42,
    rating: 4.8,
    badge: 'Best Seller',
    description: 'Hot-swappable tactile switches, CNC aluminum frame, tri-mode Bluetooth 5.3 & 2.4GHz wireless.'
  },
  {
    id: 'prd-102',
    sku: 'AZ-MON-27',
    name: 'ProView 27" 4K USB-C Hub Monitor',
    category: 'Displays',
    price: 389.00,
    weightKg: 5.40,
    stock: 18,
    rating: 4.9,
    badge: 'AKS Pick',
    description: 'IPS Black panel with 90W USB-C power delivery, integrated RJ45 Ethernet, and KVM switch.'
  },
  {
    id: 'prd-103',
    sku: 'AZ-ANC-HP',
    name: 'AetherPods Studio ANC Headphones',
    category: 'Audio',
    price: 179.00,
    weightKg: 0.38,
    stock: 64,
    rating: 4.7,
    badge: 'Fast Ship',
    description: 'Hybrid 42dB active noise cancellation, 45-hour battery life, multipoint low-latency audio.'
  },
  {
    id: 'prd-104',
    sku: 'AZ-DOCK-TB4',
    name: 'ThunderDock 12-in-1 Thunderbolt 4 Station',
    category: 'Accessories',
    price: 215.00,
    weightKg: 0.68,
    stock: 29,
    rating: 4.6,
    badge: 'New',
    description: 'Dual 4K@60Hz display output, 2.5GbE LAN, UHS-II SD 4.0 slot, and 100W upstream charging.'
  },
  {
    id: 'prd-105',
    sku: 'AZ-NVME-2T',
    name: 'VelocityDrive 2TB USB4 Portable NVMe SSD',
    category: 'Storage',
    price: 159.00,
    weightKg: 0.18,
    stock: 85,
    rating: 4.9,
    badge: 'Top Rated',
    description: 'Sustained 3,800 MB/s read/write speeds, IP67 ruggedized enclosure, hardware AES-256 encryption.'
  },
  {
    id: 'prd-106',
    sku: 'AZ-CAM-4K',
    name: 'OptiStream 4K AI Developer Webcam',
    category: 'Peripherals',
    price: 129.00,
    weightKg: 0.31,
    stock: 37,
    rating: 4.5,
    badge: 'In Stock',
    description: 'Sony STARVIS 1/2.8" CMOS sensor, HDR60, dual beamforming mics, magnetic privacy shutter.'
  }
];

let productsCol = null;
let mongoConnected = false;

async function initMongo() {
  try {
    const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 3000 });
    await client.connect();
    const db = client.db('cloudmart_nosql');
    productsCol = db.collection('products');
    const count = await productsCol.countDocuments();
    if (count === 0) {
      await productsCol.insertMany(SEED_PRODUCTS);
    }
    mongoConnected = true;
    console.log('[catalogue-service] Connected to MongoDB and verified products collection.');
  } catch (err) {
    mongoConnected = false;
    console.warn('[catalogue-service] MongoDB warming up, using fallback seed list:', err.message);
  }
}
initMongo();
setInterval(() => { if (!mongoConnected) initMongo(); }, 10000);

app.get('/health', (req, res) => {
  res.json({
    service: 'catalogue-service',
    database: 'MongoDB',
    mongoConnected,
    status: 'UP',
    pod: os.hostname(),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/catalogue/products', async (req, res) => {
  const { category, q } = req.query;
  let list = SEED_PRODUCTS;
  if (mongoConnected && productsCol) {
    try {
      list = await productsCol.find({}, { projection: { _id: 0 } }).toArray();
    } catch (e) {}
  }
  if (category && category !== 'All') {
    list = list.filter(p => p.category.toLowerCase() === category.toLowerCase());
  }
  if (q) {
    const query = q.toLowerCase();
    list = list.filter(p =>
      p.name.toLowerCase().includes(query) ||
      p.description.toLowerCase().includes(query) ||
      p.sku.toLowerCase().includes(query)
    );
  }
  res.json({ database: 'MongoDB', pod: os.hostname(), count: list.length, products: list });
});

app.listen(PORT, () => console.log(`[catalogue-service] listening on port ${PORT} (MongoDB backend)`));
