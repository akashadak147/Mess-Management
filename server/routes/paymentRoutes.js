const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const eventBus = require('../events');
const { db, recalculateAllBills, logAudit } = require('../database');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

// Configure Multer storage for payment proof screenshot uploads
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'payments');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `proof-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// =========================================================================
// 1. STUDENT PAYMENT ROUTES
// =========================================================================

// Submit payment proof (Student)
router.post('/submit', verifyToken, upload.single('screenshot'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { month, amount, payment_date, utr_number, note, payer_upi_id, upi_app } = req.body;

    if (!month || !amount || !payment_date || !utr_number) {
      return res.status(400).json({ success: false, message: 'Month, amount, payment date, and UTR number are required.' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Payment screenshot proof is required.' });
    }

    const cleanUtr = utr_number.trim();

    // Check duplicate UTR number across payments
    const existingUtr = await db.execute({
      sql: 'SELECT id FROM payments WHERE utr_number = ? AND status != "REJECTED"',
      args: [cleanUtr]
    });

    if (existingUtr.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'This UTR / Transaction Reference Number has already been submitted.' });
    }

    // Get billing record ID
    const billRes = await db.execute({
      sql: 'SELECT id FROM billing WHERE user_id = ? AND month = ?',
      args: [userId, month]
    });
    const billingId = billRes.rows[0] ? billRes.rows[0].id : null;

    const screenshotPath = `/uploads/payments/${req.file.filename}`;

    const insertRes = await db.execute({
      sql: `
        INSERT INTO payments (
          user_id, billing_id, month, amount, payment_date, utr_number,
          screenshot_path, note, status, payer_upi_id, upi_app
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
      `,
      args: [
        userId,
        billingId,
        month,
        parseFloat(amount),
        payment_date,
        cleanUtr,
        screenshotPath,
        note ? note.trim() : null,
        payer_upi_id ? payer_upi_id.trim() : null,
        upi_app ? upi_app.trim() : null
      ]
    });

    const newPaymentId = Number(insertRes.lastInsertRowid);

    // Emit live event for Admin dashboard
    try {
      eventBus.emit('NEW_PAYMENT_SUBMITTED', {
        id: newPaymentId,
        user_id: userId,
        user_name: req.user.name,
        month,
        amount: parseFloat(amount),
        utr_number: cleanUtr,
        created_at: new Date().toISOString()
      });
    } catch (e) {
      console.error('eventBus emit error:', e);
    }

    return res.status(201).json({
      success: true,
      message: 'Payment proof submitted successfully! It is pending approval by the Mess Manager.',
      payment_id: newPaymentId
    });
  } catch (err) {
    console.error('Submit payment error:', err);
    return res.status(500).json({ success: false, message: 'Server error submitting payment proof.' });
  }
});

// Get student's own payment history
router.get('/my-payments', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const paymentsRes = await db.execute({
      sql: 'SELECT * FROM payments WHERE user_id = ? ORDER BY id DESC',
      args: [userId]
    });

    return res.json({ success: true, payments: paymentsRes.rows });
  } catch (err) {
    console.error('Get my payments error:', err);
    return res.status(500).json({ success: false, message: 'Error retrieving payment history.' });
  }
});

// =========================================================================
// 2. ADMIN PAYMENT VERIFICATION & APPROVAL ROUTES
// =========================================================================

// List pending payment verifications (Admin)
router.get('/admin/pending', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const pendingRes = await db.execute({
      sql: `
        SELECT p.*, u.name as student_name, u.room_no, u.phone, u.email
        FROM payments p
        JOIN users u ON p.user_id = u.id
        WHERE p.status = 'PENDING'
        ORDER BY p.id ASC
      `,
      args: []
    });

    return res.json({ success: true, payments: pendingRes.rows });
  } catch (err) {
    console.error('Get pending payments error:', err);
    return res.status(500).json({ success: false, message: 'Error retrieving pending payments.' });
  }
});

// List all payment logs (Admin)
router.get('/admin/all', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const allRes = await db.execute({
      sql: `
        SELECT p.*, u.name as student_name, u.room_no, u.phone
        FROM payments p
        JOIN users u ON p.user_id = u.id
        ORDER BY p.id DESC
        LIMIT 200
      `,
      args: []
    });

    return res.json({ success: true, payments: allRes.rows });
  } catch (err) {
    console.error('Get all payments error:', err);
    return res.status(500).json({ success: false, message: 'Error retrieving payments list.' });
  }
});

// Approve payment (Admin)
router.post('/admin/approve/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const paymentId = req.params.id;
    const { admin_note } = req.body;

    const paymentRes = await db.execute({
      sql: 'SELECT * FROM payments WHERE id = ?',
      args: [paymentId]
    });
    const payment = paymentRes.rows[0];

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment record not found.' });
    }

    if (payment.status === 'APPROVED') {
      return res.status(400).json({ success: false, message: 'Payment is already approved.' });
    }

    // Mark payment as APPROVED
    await db.execute({
      sql: `
        UPDATE payments
        SET status = 'APPROVED', admin_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [admin_note ? admin_note.trim() : null, req.user.id, paymentId]
    });

    // Fetch user info for logging
    const userRes = await db.execute({
      sql: 'SELECT name FROM users WHERE id = ?',
      args: [payment.user_id]
    });
    const userName = userRes.rows[0] ? userRes.rows[0].name : 'Student';

    // Credit paid_amount in billing table
    const billingRes = await db.execute({
      sql: 'SELECT paid_amount FROM billing WHERE user_id = ? AND month = ?',
      args: [payment.user_id, payment.month]
    });
    const existingBill = billingRes.rows[0];

    if (existingBill) {
      const newPaidAmount = Number(existingBill.paid_amount) + Number(payment.amount);
      await db.execute({
        sql: 'UPDATE billing SET paid_amount = ? WHERE user_id = ? AND month = ?',
        args: [newPaidAmount, payment.user_id, payment.month]
      });
    }

    // Recalculate bill status for student
    await recalculateAllBills(payment.month);

    // Write Audit Log
    await logAudit(
      req.user.id,
      req.user.name,
      'APPROVE_PAYMENT',
      payment.user_id,
      userName,
      `Approved payment of ₹${payment.amount} for month ${payment.month} (UTR: ${payment.utr_number})`
    );

    return res.json({ success: true, message: `Payment of ₹${payment.amount} approved successfully for ${userName}.` });
  } catch (err) {
    console.error('Approve payment error:', err);
    return res.status(500).json({ success: false, message: 'Error approving payment.' });
  }
});

// Reject payment (Admin)
router.post('/admin/reject/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const paymentId = req.params.id;
    const { admin_note } = req.body;

    const paymentRes = await db.execute({
      sql: 'SELECT * FROM payments WHERE id = ?',
      args: [paymentId]
    });
    const payment = paymentRes.rows[0];

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment record not found.' });
    }

    await db.execute({
      sql: `
        UPDATE payments
        SET status = 'REJECTED', admin_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [admin_note ? admin_note.trim() : 'Rejected by Mess Manager', req.user.id, paymentId]
    });

    const userRes = await db.execute({
      sql: 'SELECT name FROM users WHERE id = ?',
      args: [payment.user_id]
    });
    const userName = userRes.rows[0] ? userRes.rows[0].name : 'Student';

    await recalculateAllBills(payment.month);

    await logAudit(
      req.user.id,
      req.user.name,
      'REJECT_PAYMENT',
      payment.user_id,
      userName,
      `Rejected payment of ₹${payment.amount} for month ${payment.month} (UTR: ${payment.utr_number}). Reason: ${admin_note || 'N/A'}`
    );

    return res.json({ success: true, message: `Payment submission rejected for ${userName}.` });
  } catch (err) {
    console.error('Reject payment error:', err);
    return res.status(500).json({ success: false, message: 'Error rejecting payment.' });
  }
});

module.exports = router;