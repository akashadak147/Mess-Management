const express = require('express');
const router = express.Router();
const { db, recalculateAllBills } = require('../database');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

// 1. Get current student's billing history
router.get('/my-bills', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const billsResult = await db.execute({
      sql: `
        SELECT * FROM billing 
        WHERE user_id = ? 
        ORDER BY month DESC
      `,
      args: [userId]
    });

    return res.json({
      success: true,
      bills: billsResult.rows
    });
  } catch (err) {
    console.error('Get my bills error:', err);
    return res.status(500).json({ success: false, message: 'Server error retrieving billing records.' });
  }
});

// 2. Get billing details for a specific month for logged-in user
router.get('/my-bill/:month', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const month = req.params.month; // Format: YYYY-MM

    // Recalculate bill to ensure up-to-date data before fetching
    await recalculateAllBills(month);

    const billResult = await db.execute({
      sql: `
        SELECT b.*, u.name as user_name, u.room_no 
        FROM billing b
        JOIN users u ON b.user_id = u.id
        WHERE b.user_id = ? AND b.month = ?
      `,
      args: [userId, month]
    });

    const bill = billResult.rows[0];

    if (!bill) {
      return res.status(404).json({ success: false, message: 'Bill record not found for this month.' });
    }

    return res.json({
      success: true,
      bill
    });
  } catch (err) {
    console.error('Get my bill detail error:', err);
    return res.status(500).json({ success: false, message: 'Server error retrieving bill details.' });
  }
});

// 3. Admin: Get billing sheet for all active students for a specific month
router.get('/admin-sheet', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().substring(0, 7);

    // Recalculate bills for all users for requested month
    await recalculateAllBills(month);

    const billsResult = await db.execute({
      sql: `
        SELECT b.*, u.name as student_name, u.room_no, u.phone
        FROM billing b
        JOIN users u ON b.user_id = u.id
        WHERE b.month = ? AND u.role = 'user' AND u.status = 'active'
        ORDER BY u.name ASC
      `,
      args: [month]
    });

    return res.json({
      success: true,
      month,
      bills: billsResult.rows
    });
  } catch (err) {
    console.error('Admin billing sheet error:', err);
    return res.status(500).json({ success: false, message: 'Server error generating billing sheet.' });
  }
});

// 4. Admin: Force recalculation of bills for a given month
router.post('/recalculate', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const month = req.body.month || new Date().toISOString().substring(0, 7);

    await recalculateAllBills(month);

    return res.json({
      success: true,
      message: `Bills successfully recalculated for all active students for month ${month}.`
    });
  } catch (err) {
    console.error('Recalculate bills error:', err);
    return res.status(500).json({ success: false, message: 'Server error recalculating bills.' });
  }
});

module.exports = router;