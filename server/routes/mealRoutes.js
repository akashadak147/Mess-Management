const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

// ── GET /api/meals/headcount-summary ─────────────────────────────────────────
router.get('/headcount-summary', verifyToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const userResult = await db.execute({
      sql: "SELECT COUNT(*) as total FROM users WHERE status = 'active' AND role != 'admin'",
      args: []
    });
    const totalStudents = Number(userResult.rows[0]?.total || 0);

    const mealResult = await db.execute({
      sql: `SELECT
              SUM(CASE WHEN morning = 1 THEN 1 ELSE 0 END) as m_eat,
              SUM(CASE WHEN morning = 0 THEN 1 ELSE 0 END) as m_skip,
              SUM(CASE WHEN night = 1 THEN 1 ELSE 0 END) as n_eat,
              SUM(CASE WHEN night = 0 THEN 1 ELSE 0 END) as n_skip
            FROM meals WHERE date = ?`,
      args: [today]
    });
    const mealRow = mealResult.rows[0];

    res.json({
      success: true,
      total_students: totalStudents,
      breakfast: { eating: Number(mealRow?.m_eat || 0), not_eating: Number(mealRow?.m_skip || 0) },
      dinner:    { eating: Number(mealRow?.n_eat || 0), not_eating: Number(mealRow?.n_skip || 0) }
    });
  } catch (err) {
    console.error('headcount-summary error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/meals/today-duty ─────────────────────────────────────────────────
router.get('/today-duty', verifyToken, async (req, res) => {
  try {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayDayName = days[new Date().getDay()];

    const result = await db.execute({
      sql: 'SELECT * FROM weekly_menu WHERE day_of_week = ?',
      args: [todayDayName]
    });

    res.json({
      success: true,
      dayName: todayDayName,
      today: result.rows[0] || { market_duty: 'Not Assigned', morning_menu: 'Regular Meal', night_menu: 'Regular Meal' }
    });
  } catch (err) {
    console.error('today-duty error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/meals/my?month=YYYY-MM  (student's meal log for month) ───────────
router.get('/my', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const month  = req.query.month || new Date().toISOString().slice(0, 7);

    const mealsResult = await db.execute({
      sql: 'SELECT * FROM meals WHERE user_id = ? AND date LIKE ? ORDER BY date ASC',
      args: [userId, `${month}%`]
    });

    const meals = mealsResult.rows;
    const totalMorning = meals.filter(m => m.morning === 1).length;
    const totalNight   = meals.filter(m => m.night   === 1).length;

    res.json({
      success: true,
      meals,
      summary: {
        total_meals:   totalMorning + totalNight,
        morning_meals: totalMorning,
        night_meals:   totalNight
      }
    });
  } catch (err) {
    console.error('meals/my error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/meals/mark  (student marks today's attendance) ─────────────────
router.post('/mark', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { date, morning, night } = req.body;

    if (!date) {
      return res.status(400).json({ success: false, message: 'Date is required.' });
    }

    await db.execute({
      sql: `INSERT INTO meals (user_id, date, morning, night)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, date) DO UPDATE SET morning = excluded.morning, night = excluded.night, updated_at = CURRENT_TIMESTAMP`,
      args: [userId, date, morning ?? 1, night ?? 1]
    });

    res.json({ success: true, message: 'Meal preference saved.' });
  } catch (err) {
    console.error('meals/mark error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/meals/date/:date  (admin: all members' status for a date) ────────
router.get('/date/:date', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const dateStr = req.params.date;

    // Return all active students joined with their meal record (default eating if no record)
    const result = await db.execute({
      sql: `SELECT u.id, u.name, u.room_no,
                   COALESCE(m.morning, 1) as morning,
                   COALESCE(m.night, 1)   as night
            FROM users u
            LEFT JOIN meals m ON m.user_id = u.id AND m.date = ?
            WHERE u.status = 'active' AND u.role != 'admin'
            ORDER BY u.room_no, u.name`,
      args: [dateStr]
    });

    res.json({ success: true, members: result.rows });
  } catch (err) {
    console.error('meals/date error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;