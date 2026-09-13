const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Ensure upload folders exist
const uploadsDir = path.join(__dirname, 'uploads', 'payments');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Database init
require('./server/database');

const authRoutes = require('./server/routes/authRoutes');
const mealRoutes = require('./server/routes/mealRoutes');
const billingRoutes = require('./server/routes/billingRoutes');
const paymentRoutes = require('./server/routes/paymentRoutes');
const adminRoutes = require('./server/routes/adminRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded payment proofs
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve frontend static assets
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/meals', mealRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA Fallback for all other requests
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
  }
  res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🍽️  Mess Food Management Portal Server is running!`);
  console.log(`🚀 URL: http://localhost:${PORT}`);
  console.log(`👑 Owner Admin: akashadak162006@gmail.com | Password: Akash@147`);
  console.log(`🛡️ Assistant Manager: adakakash2006@gmail.com | Password: 1@bpg1947`);
  console.log(`👥 Students Roster: Clean Slate (0 Students)`);
  console.log(`====================================================`);
});
