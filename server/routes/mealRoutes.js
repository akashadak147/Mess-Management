const express = require('express');
const router = express.Router();
const { db, recalculateAllBills } = require('../database');
const { verifyToken, requireAdmin } = require('../middleware/auth');

// Get current user's meals for a month (default current month)
router.get('/my', verifyToken, (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM
    const meals = db.prepare(`
      SELECT date, morning, night, updated_at
      FROM meals
      WHERE user_id = ? AND date LIKE ?
      ORDER BY date ASC
    `).all(req.user.id, `${month}-%`);

    const summary = db.prepare(`
      SELECT 
        COUNT(*) as days_logged,
        COALESCE(SUM(morning), 0) as morning_count,
        COALESCE(SUM(night), 0) as night_count,
        COALESCE(SUM(morning + night), 0) as total_meals
      FROM meals
      WHERE user_id = ? AND date LIKE ?
    `).get(req.user.id, `${month}-%`);

    const todayStr = new Date().toISOString().split('T')[0];
    const todayMeal = meals.find(m => m.date === todayStr);
    const today_status = todayMeal ? {
      date: todayStr,
      morning: todayMeal.morning,
      night: todayMeal.night,
      is_default: false,
      updated_at: todayMeal.updated_at
    } : {
      date: todayStr,
      morning: 1,
      night: 1,
      is_default: true,
      updated_at: null
    };

    return res.json({
      success: true,
      month,
      summary,
      today_status,
      meals
    });
  } catch (err) {
    console.error('Error fetching user meals:', err);
    return res.status(500).json({ success: false, message: 'Could not retrieve meals.' });
  }
});

// Mark meal response for a date (Morning and/or Night)
router.post('/mark', verifyToken, (req, res) => {
  try {
    const { date, morning, night } = req.body;

    if (!date) {
      return res.status(400).json({ success: false, message: 'Date is required.' });
    }

    // Validate date format YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'Date must be in YYYY-MM-DD format.' });
    }

    const morningVal = (morning === 1 || morning === true || morning === '1') ? 1 : 0;
    const nightVal = (night === 1 || night === true || night === '1') ? 1 : 0;

    const stmt = db.prepare(`
      INSERT INTO meals (user_id, date, morning, night, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, date) DO UPDATE SET
        morning = excluded.morning,
        night = excluded.night,
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(req.user.id, date, morningVal, nightVal);

    // Recalculate bill for that month
    const targetMonth = date.slice(0, 7);
    recalculateAllBills(targetMonth);

    return res.json({
      success: true,
      message: `Meal preferences saved for ${date}`,
      data: { date, morning: morningVal, night: nightVal }
    });
  } catch (err) {
    console.error('Error saving meal response:', err);
    return res.status(500).json({ success: false, message: 'Failed to record meal preference.' });
  }
});

// Admin override meal attendance
router.post('/admin/override', verifyToken, requireAdmin, (req, res) => {
  try {
    const { user_id, date, morning, night } = req.body;
    if (!user_id || !date) {
      return res.status(400).json({ success: false, message: 'User ID and Date are required.' });
    }

    const morningVal = (morning === 1 || morning === true || morning === '1') ? 1 : 0;
    const nightVal = (night === 1 || night === true || night === '1') ? 1 : 0;

    db.prepare(`
      INSERT INTO meals (user_id, date, morning, night, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, date) DO UPDATE SET
        morning = excluded.morning,
        night = excluded.night,
        updated_at = CURRENT_TIMESTAMP
    `).run(user_id, date, morningVal, nightVal);

    const targetMonth = date.slice(0, 7);
    recalculateAllBills(targetMonth);

    return res.json({ success: true, message: 'Meal attendance updated successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to override meal attendance.' });
  }
});

// Get headcount and member response list for any date (default today)
// Rule: If a student does not mark their meal attendance, the system shows them as "Eating" (1).
router.get('/date/:date', verifyToken, (req, res) => {
  try {
    const targetDate = req.params.date || new Date().toISOString().split('T')[0];

    // Fetch all active students with their meal response for that date
    const rows = db.prepare(`
      SELECT 
        u.id, u.name, u.email, u.room_no, u.phone,
        m.morning as raw_morning,
        m.night as raw_night,
        m.updated_at
      FROM users u
      LEFT JOIN meals m ON u.id = m.user_id AND m.date = ?
      WHERE u.role = 'user' AND u.status = 'active'
      ORDER BY u.room_no ASC, u.name ASC
    `).all(targetDate);

    let morningEaters = 0;
    let morningSkippers = 0;
    let morningDefaultEaters = 0;
    let morningMarkedEaters = 0;

    let nightEaters = 0;
    let nightSkippers = 0;
    let nightDefaultEaters = 0;
    let nightMarkedEaters = 0;

    const morningNoShows = [];
    const nightNoShows = [];

    const processedMembers = rows.map(r => {
      // If student did not mark meal attendance (NULL), system shows them as "Eating" (1) by default!
      const morningMarked = (r.raw_morning !== null && r.raw_morning !== undefined);
      const morningVal = morningMarked ? r.raw_morning : 1;
      const morningDefault = !morningMarked;

      const nightMarked = (r.raw_night !== null && r.raw_night !== undefined);
      const nightVal = nightMarked ? r.raw_night : 1;
      const nightDefault = !nightMarked;

      if (morningVal === 1) {
        morningEaters++;
        if (morningDefault) morningDefaultEaters++;
        else morningMarkedEaters++;
      } else {
        morningSkippers++;
        morningNoShows.push({ id: r.id, name: r.name, room_no: r.room_no, phone: r.phone });
      }

      if (nightVal === 1) {
        nightEaters++;
        if (nightDefault) nightDefaultEaters++;
        else nightMarkedEaters++;
      } else {
        nightSkippers++;
        nightNoShows.push({ id: r.id, name: r.name, room_no: r.room_no, phone: r.phone });
      }

      return {
        id: r.id,
        name: r.name,
        email: r.email,
        room_no: r.room_no,
        phone: r.phone,
        morning: morningVal,
        morning_marked: morningMarked,
        morning_default: morningDefault,
        night: nightVal,
        night_marked: nightMarked,
        night_default: nightDefault,
        updated_at: r.updated_at
      };
    });

    return res.json({
      success: true,
      date: targetDate,
      counts: {
        total_members: processedMembers.length,
        morning_eaters: morningEaters,
        morning_skippers: morningSkippers, // No-shows (explicitly opted out)
        morning_default_eaters: morningDefaultEaters,
        morning_marked_eaters: morningMarkedEaters,
        night_eaters: nightEaters,
        night_skippers: nightSkippers, // No-shows (explicitly opted out)
        night_default_eaters: nightDefaultEaters,
        night_marked_eaters: nightMarkedEaters
      },
      no_shows: {
        morning: morningNoShows,
        night: nightNoShows
      },
      members: processedMembers
    });
  } catch (err) {
    console.error('Error fetching date meals:', err);
    return res.status(500).json({ success: false, message: 'Could not fetch meal headcount.' });
  }
});

// Quick today endpoint
router.get('/today', verifyToken, (req, res) => {
  const todayStr = new Date().toISOString().split('T')[0];
  req.params.date = todayStr;
  return router.handle(req, res);
});

// Real-time headcount summary for the Corner Widget visible to all users (students & admins)
router.get('/headcount-summary', verifyToken, (req, res) => {
  try {
    const todayStr = new Date().toISOString().split('T')[0];

    const totalStudents = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'user' AND status = 'active'").get().count;

    // Count explicit opt-outs (skipping / no-shows)
    const skipStats = db.prepare(`
      SELECT 
        COUNT(CASE WHEN m.morning = 0 THEN 1 END) as morning_skipping,
        COUNT(CASE WHEN m.night = 0 THEN 1 END) as night_skipping
      FROM meals m
      JOIN users u ON m.user_id = u.id
      WHERE m.date = ? AND u.role = 'user' AND u.status = 'active'
    `).get(todayStr);

    const morningSkipping = skipStats ? skipStats.morning_skipping : 0;
    const nightSkipping = skipStats ? skipStats.night_skipping : 0;

    // By default, everyone who didn't opt out is Eating!
    const morningEating = Math.max(0, totalStudents - morningSkipping);
    const nightEating = Math.max(0, totalStudents - nightSkipping);

    // Also get lists of no-shows
    const morningNoShows = db.prepare(`
      SELECT u.id, u.name, u.room_no
      FROM meals m
      JOIN users u ON m.user_id = u.id
      WHERE m.date = ? AND m.morning = 0 AND u.role = 'user' AND u.status = 'active'
      ORDER BY u.room_no ASC
    `).all(todayStr);

    const nightNoShows = db.prepare(`
      SELECT u.id, u.name, u.room_no
      FROM meals m
      JOIN users u ON m.user_id = u.id
      WHERE m.date = ? AND m.night = 0 AND u.role = 'user' AND u.status = 'active'
      ORDER BY u.room_no ASC
    `).all(todayStr);

    return res.json({
      success: true,
      date: todayStr,
      total_students: totalStudents,
      breakfast: {
        eating: morningEating,
        not_eating: morningSkipping, // No-shows
        no_shows: morningNoShows
      },
      dinner: {
        eating: nightEating,
        not_eating: nightSkipping, // No-shows
        no_shows: nightNoShows
      }
    });
  } catch (err) {
    console.error('Error fetching headcount summary:', err);
    return res.status(500).json({ success: false, message: 'Could not fetch headcount summary.' });
  }
});

// Weekly menu & Market Duty Routine
router.get('/menu', verifyToken, (req, res) => {
  try {
    const menu = db.prepare(`
      SELECT * FROM weekly_menu
      ORDER BY CASE day_of_week
        WHEN 'Monday' THEN 1
        WHEN 'Tuesday' THEN 2
        WHEN 'Wednesday' THEN 3
        WHEN 'Thursday' THEN 4
        WHEN 'Friday' THEN 5
        WHEN 'Saturday' THEN 6
        WHEN 'Sunday' THEN 7
        ELSE 8
      END
    `).all();
    return res.json({ success: true, menu });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch menu.' });
  }
});

// Today's assigned market duty & menu
router.get('/today-duty', verifyToken, (req, res) => {
  try {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayName = days[new Date().getDay()];
    const duty = db.prepare('SELECT * FROM weekly_menu WHERE day_of_week = ?').get(todayName);
    return res.json({ success: true, today: duty || null, dayName: todayName });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Could not fetch today duty.' });
  }
});

router.post('/menu', verifyToken, requireAdmin, (req, res) => {
  try {
    const { menu } = req.body; // Array of { day_of_week, bengali_day, market_duty, morning_menu, night_menu, special_note }
    if (!Array.isArray(menu)) {
      return res.status(400).json({ success: false, message: 'Invalid menu format.' });
    }

    const updateMenu = db.prepare(`
      INSERT INTO weekly_menu (day_of_week, bengali_day, market_duty, morning_menu, night_menu, special_note)
      VALUES (@day_of_week, @bengali_day, @market_duty, @morning_menu, @night_menu, @special_note)
      ON CONFLICT(day_of_week) DO UPDATE SET
        bengali_day = COALESCE(excluded.bengali_day, weekly_menu.bengali_day),
        market_duty = COALESCE(excluded.market_duty, weekly_menu.market_duty),
        morning_menu = excluded.morning_menu,
        night_menu = excluded.night_menu,
        special_note = excluded.special_note
    `);

    const trans = db.transaction(() => {
      for (const item of menu) {
        updateMenu.run({
          day_of_week: item.day_of_week,
          bengali_day: item.bengali_day || null,
          market_duty: item.market_duty || null,
          morning_menu: item.morning_menu,
          night_menu: item.night_menu,
          special_note: item.special_note || null
        });
      }
    });
    trans();

    return res.json({ success: true, message: 'Food & Market Routine updated successfully.' });
  } catch (err) {
    console.error('Menu update error:', err);
    return res.status(500).json({ success: false, message: 'Could not update routine.' });
  }
});

module.exports = router;
