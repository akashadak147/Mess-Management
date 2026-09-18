const express = require('express');
const router = express.Router();
const { db, recalculateAllBills } = require('../database');
const { verifyToken, verifyAdmin } = require('../middleware/auth');

// Helper to check cutoff times
function isCutoffPassed(timeStr) {
  if (!timeStr) return false;
  const [cutoffHour, cutoffMinute] = timeStr.split(':').map(Number);
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  if (currentHour > cutoffHour) return true;
  if (currentHour === cutoffHour && currentMinute >= cutoffMinute) return true;
  return false;
}

// 1. Get user meal status for a specific date
router.get('/my-status', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const date = req.query.date || new Date().toISOString().split('T')[0];

    const mealResult = await db.execute({
      sql: 'SELECT morning, night FROM meals WHERE user_id = ? AND date = ?',
      args: [userId, date]
    });
    const meal = mealResult.rows[0];

    const settingsResult = await db.execute({
      sql: 'SELECT morning_cutoff_time, night_cutoff_time FROM mess_settings WHERE id = 1',
      args: []
    });
    const settings = settingsResult.rows[0] || {};

    return res.json({
      success: true,
      date,
      morning: meal ? Number(meal.morning) : 1,
      night: meal ? Number(meal.night) : 1,
      morning_cutoff_passed: isCutoffPassed(settings.morning_cutoff_time),
      night_cutoff_passed: isCutoffPassed(settings.night_cutoff_time)
    });
  } catch (err) {
    console.error('Get my meal status error:', err);
    return res.status(500).json({ success: false, message: 'Server error retrieving meal status.' });
  }
});

// 2. Get current user's meals for a month (default current month)
router.get('/my', verifyToken, async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM
    const mealsResult = await db.execute({
      sql: `
        SELECT date, morning, night, updated_at
        FROM meals
        WHERE user_id = ? AND date LIKE ?
        ORDER BY date ASC
      `,
      args: [req.user.id, `${month}-%`]
    });
    const meals = mealsResult.rows;

    const summaryResult = await db.execute({
      sql: `
        SELECT 
          COUNT(*) as days_logged,
          COALESCE(SUM(morning), 0) as morning_count,
          COALESCE(SUM(night), 0) as night_count,
          COALESCE(SUM(morning + night), 0) as total_meals
        FROM meals
        WHERE user_id = ? AND date LIKE ?
      `,
      args: [req.user.id, `${month}-%`]
    });
    const summary = summaryResult.rows[0];

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

// 3. Toggle user meal (Morning/Night)
router.post('/toggle', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { date, mealType, status } = req.body;

    if (!date || !mealType || (status !== 0 && status !== 1)) {
      return res.status(400).json({ success: false, message: 'Invalid payload.' });
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const settingsResult = await db.execute({
      sql: 'SELECT morning_cutoff_time, night_cutoff_time FROM mess_settings WHERE id = 1',
      args: []
    });
    const settings = settingsResult.rows[0] || {};

    if (date === todayStr) {
      if (mealType === 'morning' && isCutoffPassed(settings.morning_cutoff_time)) {
        return res.status(400).json({ success: false, message: `Morning meal cutoff time (${settings.morning_cutoff_time}) has passed for today.` });
      }
      if (mealType === 'night' && isCutoffPassed(settings.night_cutoff_time)) {
        return res.status(400).json({ success: false, message: `Night meal cutoff time (${settings.night_cutoff_time}) has passed for today.` });
      }
    }

    const existingResult = await db.execute({
      sql: 'SELECT morning, night FROM meals WHERE user_id = ? AND date = ?',
      args: [userId, date]
    });
    const existing = existingResult.rows[0];

    let morning = existing ? Number(existing.morning) : 1;
    let night = existing ? Number(existing.night) : 1;

    if (mealType === 'morning') morning = status;
    if (mealType === 'night') night = status;

    await db.execute({
      sql: `
        INSERT INTO meals (user_id, date, morning, night)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET
          morning = excluded.morning,
          night = excluded.night,
          updated_at = CURRENT_TIMESTAMP
      `,
      args: [userId, date, morning, night]
    });

    const targetMonth = date.substring(0, 7);
    await recalculateAllBills(targetMonth);

    return res.json({
      success: true,
      message: `${mealType.toUpperCase()} meal updated to ${status === 1 ? 'ON' : 'OFF'} for ${date}.`,
      morning,
      night
    });
  } catch (err) {
    console.error('Toggle meal error:', err);
    return res.status(500).json({ success: false, message: 'Server error updating meal setting.' });
  }
});

// 4. Mark meal response for a date
router.post('/mark', verifyToken, async (req, res) => {
  try {
    const { date, morning, night } = req.body;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'Date must be in YYYY-MM-DD format.' });
    }

    const morningVal = (morning === 1 || morning === true || morning === '1') ? 1 : 0;
    const nightVal = (night === 1 || night === true || night === '1') ? 1 : 0;

    await db.execute({
      sql: `
        INSERT INTO meals (user_id, date, morning, night, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, date) DO UPDATE SET
          morning = excluded.morning,
          night = excluded.night,
          updated_at = CURRENT_TIMESTAMP
      `,
      args: [req.user.id, date, morningVal, nightVal]
    });

    const targetMonth = date.slice(0, 7);
    await recalculateAllBills(targetMonth);

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

// 5. Admin: Get all students meal sheet
router.get('/admin-sheet', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];

    const usersResult = await db.execute({
      sql: "SELECT id, name, room_no, phone FROM users WHERE role = 'user' AND status = 'active' ORDER BY name ASC",
      args: []
    });

    const mealsResult = await db.execute({
      sql: 'SELECT user_id, morning, night FROM meals WHERE date = ?',
      args: [date]
    });

    const mealsMap = {};
    for (const m of mealsResult.rows) {
      mealsMap[m.user_id] = { morning: Number(m.morning), night: Number(m.night) };
    }

    const sheet = usersResult.rows.map(u => ({
      user_id: u.id,
      name: u.name,
      room_no: u.room_no || 'N/A',
      phone: u.phone || 'N/A',
      morning: mealsMap[u.id] ? mealsMap[u.id].morning : 1,
      night: mealsMap[u.id] ? mealsMap[u.id].night : 1
    }));

    return res.json({ success: true, date, sheet });
  } catch (err) {
    console.error('Admin meal sheet error:', err);
    return res.status(500).json({ success: false, message: 'Server error retrieving admin meal sheet.' });
  }
});

// 6. Admin override meal attendance
router.post('/admin/override', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { user_id, date, morning, night } = req.body;
    if (!user_id || !date) {
      return res.status(400).json({ success: false, message: 'User ID and Date are required.' });
    }

    const morningVal = (morning === 1 || morning === true || morning === '1') ? 1 : 0;
    const nightVal = (night === 1 || night === true || night === '1') ? 1 : 0;

    await db.execute({
      sql: `
        INSERT INTO meals (user_id, date, morning, night, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, date) DO UPDATE SET
          morning = excluded.morning,
          night = excluded.night,
          updated_at = CURRENT_TIMESTAMP
      `,
      args: [user_id, date, morningVal, nightVal]
    });

    const targetMonth = date.slice(0, 7);
    await recalculateAllBills(targetMonth);

    return res.json({ success: true, message: 'Meal attendance updated successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to override meal attendance.' });
  }
});

// 7. Get headcount and member response list for any date
router.get('/date/:date', verifyToken, async (req, res) => {
  try {
    const targetDate = req.params.date || new Date().toISOString().split('T')[0];

    const rowsResult = await db.execute({
      sql: `
        SELECT 
          u.id, u.name, u.email, u.room_no, u.phone,
          m.morning as raw_morning,
          m.night as raw_night,
          m.updated_at
        FROM users u
        LEFT JOIN meals m ON u.id = m.user_id AND m.date = ?
        WHERE u.role = 'user' AND u.status = 'active'
        ORDER BY u.room_no ASC, u.name ASC
      `,
      args: [targetDate]
    });

    let morningEaters = 0, morningSkippers = 0, morningDefaultEaters = 0, morningMarkedEaters = 0;
    let nightEaters = 0, nightSkippers = 0, nightDefaultEaters = 0, nightMarkedEaters = 0;

    const morningNoShows = [];
    const nightNoShows = [];

    const processedMembers = rowsResult.rows.map(r => {
      const morningMarked = (r.raw_morning !== null && r.raw_morning !== undefined);
      const morningVal = morningMarked ? Number(r.raw_morning) : 1;
      const morningDefault = !morningMarked;

      const nightMarked = (r.raw_night !== null && r.raw_night !== undefined);
      const nightVal = nightMarked ? Number(r.raw_night) : 1;
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
        morning_skippers: morningSkippers,
        morning_default_eaters: morningDefaultEaters,
        morning_marked_eaters: morningMarkedEaters,
        night_eaters: nightEaters,
        night_skippers: nightSkippers,
        night_default_eaters: nightDefaultEaters,
        night_marked_eaters: nightMarkedEaters
      },
      no_shows: { morning: morningNoShows, night: nightNoShows },
      members: processedMembers
    });
  } catch (err) {
    console.error('Error fetching date meals:', err);
    return res.status(500).json({ success: false, message: 'Could not fetch meal headcount.' });
  }
});

// 8. Headcount summary
router.get('/headcount-summary', verifyToken, async (req, res) => {
  try {
    const todayStr = new Date().toISOString().split('T')[0];

    const totalStudentsRes = await db.execute({
      sql: "SELECT COUNT(*) as count FROM users WHERE role = 'user' AND status = 'active'",
      args: []
    });
    const totalStudents = Number(totalStudentsRes.rows[0].count);

    const skipStatsRes = await db.execute({
      sql: `
        SELECT 
          COUNT(CASE WHEN m.morning = 0 THEN 1 END) as morning_skipping,
          COUNT(CASE WHEN m.night = 0 THEN 1 END) as night_skipping
        FROM meals m
        JOIN users u ON m.user_id = u.id
        WHERE m.date = ? AND u.role = 'user' AND u.status = 'active'
      `,
      args: [todayStr]
    });
    const skipStats = skipStatsRes.rows[0] || {};

    const morningSkipping = skipStats.morning_skipping ? Number(skipStats.morning_skipping) : 0;
    const nightSkipping = skipStats.night_skipping ? Number(skipStats.night_skipping) : 0;

    const morningEating = Math.max(0, totalStudents - morningSkipping);
    const nightEating = Math.max(0, totalStudents - nightSkipping);

    const morningNoShowsRes = await db.execute({
      sql: `
        SELECT u.id, u.name, u.room_no
        FROM meals m
        JOIN users u ON m.user_id = u.id
        WHERE m.date = ? AND m.morning = 0 AND u.role = 'user' AND u.status = 'active'
        ORDER BY u.room_no ASC
      `,
      args: [todayStr]
    });

    const nightNoShowsRes = await db.execute({
      sql: `
        SELECT u.id, u.name, u.room_no
        FROM meals m
        JOIN users u ON m.user_id = u.id
        WHERE m.date = ? AND m.night = 0 AND u.role = 'user' AND u.status = 'active'
        ORDER BY u.room_no ASC
      `,
      args: [todayStr]
    });

    return res.json({
      success: true,
      date: todayStr,
      total_students: totalStudents,
      breakfast: { eating: morningEating, not_eating: morningSkipping, no_shows: morningNoShowsRes.rows },
      dinner: { eating: nightEating, not_eating: nightSkipping, no_shows: nightNoShowsRes.rows }
    });
  } catch (err) {
    console.error('Error fetching headcount summary:', err);
    return res.status(500).json({ success: false, message: 'Could not fetch headcount summary.' });
  }
});

// 9. Weekly Menu
router.get('/menu', verifyToken, async (req, res) => {
  try {
    const menuRes = await db.execute({
      sql: `
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
      `,
      args: []
    });
    return res.json({ success: true, menu: menuRes.rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch menu.' });
  }
});

// 10. Today's duty
router.get('/today-duty', verifyToken, async (req, res) => {
  try {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayName = days[new Date().getDay()];
    const dutyRes = await db.execute({
      sql: 'SELECT * FROM weekly_menu WHERE day_of_week = ?',
      args: [todayName]
    });
    return res.json({ success: true, today: dutyRes.rows[0] || null, dayName: todayName });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Could not fetch today duty.' });
  }
});

// 11. Update Weekly Menu (Admin)
router.post('/menu', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { menu } = req.body;
    if (!Array.isArray(menu)) {
      return res.status(400).json({ success: false, message: 'Invalid menu format.' });
    }

    for (const item of menu) {
      await db.execute({
        sql: `
          INSERT INTO weekly_menu (day_of_week, bengali_day, market_duty, morning_menu, night_menu, special_note)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(day_of_week) DO UPDATE SET
            bengali_day = COALESCE(excluded.bengali_day, weekly_menu.bengali_day),
            market_duty = COALESCE(excluded.market_duty, weekly_menu.market_duty),
            morning_menu = excluded.morning_menu,
            night_menu = excluded.night_menu,
            special_note = excluded.special_note
        `,
        args: [
          item.day_of_week,
          item.bengali_day || null,
          item.market_duty || null,
          item.morning_menu,
          item.night_menu,
          item.special_note || null
        ]
      });
    }

    return res.json({ success: true, message: 'Food & Market Routine updated successfully.' });
  } catch (err) {
    console.error('Menu update error:', err);
    return res.status(500).json({ success: false, message: 'Could not update routine.' });
  }
});

module.exports = router;