const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Error handling middleware
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
};

const envPath = path.resolve(__dirname, '.env');
console.log('Reading .env from:', envPath);
console.log('File exists:', fs.existsSync(envPath));
if (fs.existsSync(envPath)) {
  console.log('Raw .env content:', fs.readFileSync(envPath, 'utf8'));
}
// === DOTENV CONFIG - SIMPLIFIED FOR RENDER ===
require('dotenv').config();  // ← இப்படி simple ஆ விடுங்க

console.log('Environment Variables Loaded:');
console.log('JWT_SECRET:', process.env.JWT_SECRET ? '✅ Present' : '❌ Missing');
console.log('MONGODB_URI:', process.env.MONGODB_URI ? '✅ Present' : '❌ Missing');
console.log('CLOUDINARY_CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME ? '✅ Present' : '❌ Missing');

// Validate required environment variables
if (!process.env.JWT_SECRET) {
  console.error('Error: JWT_SECRET is not set in .env. Authentication will fail.');
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error('Error: MONGODB_URI is not set in .env. Database connection will fail.');
  process.exit(1);
}
if (!process.env.GOOGLE_CLIENT_ID) {
  console.error('Error: GOOGLE_CLIENT_ID is not set in .env. Google login will fail.');
  process.exit(1);
}

const app = express();

// CORS - Updated for Flutter + Render
app.use(cors({
  origin: '*',                    // Development-க்கு
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-refresh-token'],
  credentials: true,
  maxAge: 86400                   // 24 hours preflight cache
}));

const uploadsPath = path.join(__dirname, 'uploads');

// app.use('/uploads', express.static(uploadsPath));

console.log('[STATIC] Serving /uploads from:', uploadsPath);


// Body parsers (must be before routes)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}] ${req.method} ${req.url} - Started`);
  res.on('finish', () => {
    console.log(`[${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}] ${req.method} ${req.url} - ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// Database connection
connectDB()
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });

// Routes
console.log('Registering routes at /api/admin');
app.use('/api/admin', authRoutes);
console.log("🔥 authRoutes loaded:", authRoutes);
// Test route
app.post('/api/admin/test', (req, res) => {
  res.status(200).json({ success: true, message: 'Test route working' });
});

// Health check
app.get('/health', (req, res) => {
  const currentTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  res.status(200).json({
    success: true,
    message: 'Server is healthy',
    timestamp: currentTime,
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
  });
});

// Root route
app.get('/', (req, res) => {
  res.send('Turf App Backend is running');
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  const startTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  console.log(`Server running on port ${PORT} at ${startTime}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});