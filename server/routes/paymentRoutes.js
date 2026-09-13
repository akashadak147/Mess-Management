const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { db, recalculateAllBills, logAudit } = require('../database');
const { verifyToken, optionalAuth, requireAdmin } = require('../middleware/auth');

// Setup upload destination
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'payments');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `proof-${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, PNG, and WebP image formats are accepted as proof.'), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter
});

// Generate dynamic UPI QR Code (self-contained, offline-ready)
router.get('/qr-code', optionalAuth, async (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM mess_settings WHERE id = 1').get();
    const upiId = req.query.upi_id || settings.upi_id || '8927971674@fam';
    const upiName = req.query.upi_name || settings.upi_name || 'Bhabani Prasad Ghosh';
    const scannerName = settings.scanner_name || 'Bhabani Payment Scanner';
    const scannerImage = settings.scanner_image || '/assets/bhabani_scanner.jpeg';
    const amount = req.query.amount ? parseFloat(req.query.amount) : null;

    let upiUri = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(upiName)}&cu=INR`;
    let txnNote = `Mess Mate Bill Payment`;
    if (amount && amount > 0) {
      upiUri += `&am=${amount.toFixed(2)}&tn=${encodeURIComponent(txnNote)}`;
    } else {
      upiUri += `&tn=${encodeURIComponent(txnNote)}`;
    }

    // App-specific intent URIs for seamless mobile payment
    const gpayUri = `tez://upi/pay?pa=${upiId}&pn=${encodeURIComponent(upiName)}&cu=INR${amount && amount > 0 ? `&am=${amount.toFixed(2)}` : ''}&tn=${encodeURIComponent(txnNote)}`;
    const phonepeUri = `phonepe://pay?pa=${upiId}&pn=${encodeURIComponent(upiName)}&cu=INR${amount && amount > 0 ? `&am=${amount.toFixed(2)}` : ''}&tn=${encodeURIComponent(txnNote)}`;
    const paytmUri = `paytmmp://pay?pa=${upiId}&pn=${encodeURIComponent(upiName)}&cu=INR${amount && amount > 0 ? `&am=${amount.toFixed(2)}` : ''}&tn=${encodeURIComponent(txnNote)}`;
    const bhimUri = `bhim://pay?pa=${upiId}&pn=${encodeURIComponent(upiName)}&cu=INR${amount && amount > 0 ? `&am=${amount.toFixed(2)}` : ''}&tn=${encodeURIComponent(txnNote)}`;

    const qrDataUrl = await QRCode.toDataURL(upiUri, {
      margin: 2,
      width: 280,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    return res.json({
      success: true,
      upi_id: upiId,
      upi_name: upiName,
      scanner_name: scannerName,
      scanner_image: scannerImage,
      monthly_fee: settings.monthly_fee || 700.0,
      amount,
      upi_uri: upiUri,
      gpay_uri: gpayUri,
      phonepe_uri: phonepeUri,
      paytm_uri: paytmUri,
      bhim_uri: bhimUri,
      qr_data_url: qrDataUrl
    });
  } catch (err) {
    console.error('Error generating QR code:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate QR code' });
  }
});

// Submit payment proof
router.post('/submit', verifyToken, upload.single('screenshot'), (req, res) => {
  try {
    const { amount, payment_date, utr_number, month, note, payer_upi_id, upi_app } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Payment screenshot proof is required.' });
    }

    if (!amount || !utr_number) {
      // Clean up uploaded file if missing required fields
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Amount and UTR/Transaction ID are required.' });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Valid payment amount is required.' });
    }

    const targetMonth = month || new Date().toISOString().slice(0, 7);
    const dateOfPayment = payment_date || new Date().toISOString().split('T')[0];

    // Find or create billing record
    let billing = db.prepare('SELECT id FROM billing WHERE user_id = ? AND month = ?').get(req.user.id, targetMonth);
    let billingId = billing ? billing.id : null;

    const relativePath = `/uploads/payments/${req.file.filename}`;

    const stmt = db.prepare(`
      INSERT INTO payments (
        user_id, billing_id, month, amount, payment_date, utr_number,
        screenshot_path, note, payer_upi_id, upi_app, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', CURRENT_TIMESTAMP)
    `);

    const info = stmt.run(
      req.user.id,
      billingId,
      targetMonth,
      parsedAmount,
      dateOfPayment,
      utr_number.trim(),
      relativePath,
      note ? note.trim() : null,
      payer_upi_id ? payer_upi_id.trim() : null,
      upi_app ? upi_app.trim() : 'UPI App'
    );

    return res.status(201).json({
      success: true,
      message: 'Payment proof submitted successfully! The Mess Manager will verify and update your balance shortly.',
      payment_id: info.lastInsertRowid,
      screenshot_url: relativePath
    });
  } catch (err) {
    console.error('Payment submission error:', err);
    return res.status(500).json({ success: false, message: 'Failed to submit payment proof.' });
  }
});

// User's submitted payments
router.get('/my', verifyToken, (req, res) => {
  try {
    const payments = db.prepare(`
      SELECT p.*, u.name as reviewer_name
      FROM payments p
      LEFT JOIN users u ON p.reviewed_by = u.id
      WHERE p.user_id = ?
      ORDER BY p.created_at DESC
    `).all(req.user.id);

    return res.json({ success: true, payments });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Could not fetch payments.' });
  }
});

// Admin: pending payment proofs
router.get('/pending', verifyToken, requireAdmin, (req, res) => {
  try {
    const payments = db.prepare(`
      SELECT 
        p.*,
        u.name as user_name,
        u.email as user_email,
        u.room_no,
        u.phone,
        b.total_payable,
        b.paid_amount,
        (b.total_payable - b.paid_amount) as due_balance
      FROM payments p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN billing b ON p.billing_id = b.id
      WHERE p.status = 'PENDING'
      ORDER BY p.created_at ASC
    `).all();

    return res.json({ success: true, count: payments.length, payments });
  } catch (err) {
    console.error('Error fetching pending payments:', err);
    return res.status(500).json({ success: false, message: 'Failed to load pending payments.' });
  }
});

// Admin: all payments
router.get('/all', verifyToken, requireAdmin, (req, res) => {
  try {
    const status = req.query.status;
    let query = `
      SELECT 
        p.*,
        u.name as user_name,
        u.email as user_email,
        u.room_no,
        u.phone,
        r.name as reviewer_name
      FROM payments p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN users r ON p.reviewed_by = r.id
    `;
    const params = [];

    if (status) {
      query += ` WHERE p.status = ?`;
      params.push(status);
    }
    query += ` ORDER BY p.created_at DESC`;

    const payments = db.prepare(query).all(...params);
    return res.json({ success: true, payments });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch payments.' });
  }
});

// Admin: verify payment (approve or reject)
router.post('/verify/:id', verifyToken, requireAdmin, (req, res) => {
  try {
    const paymentId = req.params.id;
    const { action, admin_note } = req.body; // action: 'APPROVE' or 'REJECT'

    if (!['APPROVE', 'REJECT'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be APPROVE or REJECT.' });
    }

    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment record not found.' });
    }

    if (payment.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: `Payment is already ${payment.status}.` });
    }

    const trans = db.transaction(() => {
      if (action === 'APPROVE') {
        // Mark payment as APPROVED
        db.prepare(`
          UPDATE payments
          SET status = 'APPROVED', admin_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(admin_note || 'Verified and approved by manager', req.user.id, paymentId);

        // Update billing
        let billing = db.prepare('SELECT * FROM billing WHERE user_id = ? AND month = ?').get(payment.user_id, payment.month);
        const settings = db.prepare('SELECT * FROM mess_settings WHERE id = 1').get();

        if (billing) {
          const newPaidAmount = billing.paid_amount + payment.amount;
          const isMasiPaid = (billing.masi_paid === 1 || newPaidAmount >= settings.masi_fee) ? 1 : 0;
          let newStatus = 'PENDING';

          if (newPaidAmount >= billing.total_payable) {
            newStatus = 'PAID';
          } else if (billing.fine_applied === 1) {
            newStatus = 'OVERDUE';
          }

          db.prepare(`
            UPDATE billing
            SET paid_amount = ?, masi_paid = ?, status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(newPaidAmount, isMasiPaid, newStatus, billing.id);
        }
      } else {
        // Reject payment
        db.prepare(`
          UPDATE payments
          SET status = 'REJECTED', admin_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(admin_note || 'Payment proof verification rejected by manager', req.user.id, paymentId);
      }
    });

    trans();

    // Recalculate target month to keep fine logic coherent
    recalculateAllBills(payment.month);

    // Audit activity logging
    const targetUser = db.prepare('SELECT name FROM users WHERE id = ?').get(payment.user_id);
    const targetName = targetUser ? targetUser.name : `Student #${payment.user_id}`;
    if (action === 'APPROVE') {
      logAudit(
        req.user.id,
        req.user.name,
        'PAYMENT_APPROVED',
        payment.user_id,
        targetName,
        `Approved payment of ₹${payment.amount} for ${payment.month} (UTR: ${payment.utr_number}). Note: ${admin_note || 'Approved'}`
      );
    } else {
      logAudit(
        req.user.id,
        req.user.name,
        'PAYMENT_REJECTED',
        payment.user_id,
        targetName,
        `Rejected payment proof of ₹${payment.amount} for ${payment.month} (UTR: ${payment.utr_number}). Note: ${admin_note || 'Rejected'}`
      );
    }

    return res.json({
      success: true,
      message: `Payment successfully ${action === 'APPROVE' ? 'approved' : 'rejected'}.`
    });
  } catch (err) {
    console.error('Payment verification error:', err);
    return res.status(500).json({ success: false, message: 'Error processing verification.' });
  }
});

module.exports = router;
