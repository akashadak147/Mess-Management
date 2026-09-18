const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

// GET /api/admin/pending-students
router.get('/pending-students', verifyToken, verifyAdmin, async (req, res) => {
  try {
    // Query matching both 'status = pending' and role filters
    const result = await db.execute({
      sql: "SELECT id, name, email, phone, room_no, created_at, status FROM users WHERE status = 'pending' ORDER BY id DESC",
      args: []
    });

    return res.json({ 
      success: true, 
      students: result.rows || [],
      users: result.rows || [] // Duplicate key for fallback compatibility
    });
  } catch (err) {
    console.error('Fetch pending students error:', err);
    return res.status(500).json({ success: false, message: 'Error retrieving pending registration requests.' });
  }
});

// POST /api/admin/approve-student/:id
router.post('/approve-student/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    await db.execute({
      sql: "UPDATE users SET status = 'active' WHERE id = ?",
      args: [userId]
    });

    return res.json({ success: true, message: 'Student approved successfully.' });
  } catch (err) {
    console.error('Approve student error:', err);
    return res.status(500).json({ success: false, message: 'Error approving student.' });
  }
});

// POST /api/admin/reject-student/:id
router.post('/reject-student/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    await db.execute({
      sql: "DELETE FROM users WHERE id = ? AND status = 'pending'",
      args: [userId]
    });

    return res.json({ success: true, message: 'Student registration rejected.' });
  } catch (err) {
    console.error('Reject student error:', err);
    return res.status(500).json({ success: false, message: 'Error rejecting student.' });
  }
});

module.exports = router;