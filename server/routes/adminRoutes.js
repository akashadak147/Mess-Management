const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

// Get Pending Students Queue
router.get('/pending-students', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await db.execute({
      sql: "SELECT id, name, email, room_no, phone, created_at FROM users WHERE status = 'pending' AND role != 'admin'",
      args: []
    });
    res.json({ success: true, students: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Approve Student Registration
router.post('/approve-student/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    await db.execute({
      sql: "UPDATE users SET status = 'active' WHERE id = ?",
      args: [userId]
    });
    res.json({ success: true, message: 'Student approved successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Reject Student Registration
router.post('/reject-student/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    await db.execute({
      sql: "UPDATE users SET status = 'rejected' WHERE id = ?",
      args: [userId]
    });
    res.json({ success: true, message: 'Student registration rejected.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Dashboard Stats Overview
router.get('/dashboard-stats', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const result = await db.execute({
      sql: `
        SELECT 
          (SELECT COUNT(*) FROM users WHERE status = 'pending' AND role != 'admin') as pending_users_count,
          (SELECT COUNT(*) FROM meals WHERE date = ? AND morning = 1) as today_morning_eating,
          (SELECT COUNT(*) FROM meals WHERE date = ? AND night = 1) as today_night_eating,
          (SELECT COUNT(*) FROM payments WHERE status = 'pending') as pending_proofs_count
      `,
      args: [today, today]
    });

    res.json({ success: true, stats: result.rows[0] || {} });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin Toggle Meal for a Student on a Specific Date
router.post('/toggle-meal', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { userId, date, morning, night } = req.body;
    if (!userId || !date) {
      return res.status(400).json({ success: false, message: 'userId and date are required.' });
    }

    await db.execute({
      sql: `INSERT INTO meals (user_id, date, morning, night)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, date) DO UPDATE SET morning = excluded.morning, night = excluded.night, updated_at = CURRENT_TIMESTAMP`,
      args: [userId, date, morning ?? 1, night ?? 1]
    });

    res.json({ success: true, message: 'Meal status updated.' });
  } catch (err) {
    console.error('toggle-meal error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;