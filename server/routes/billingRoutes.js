const express = require('express');
const router = express.Router();
const { db, recalculateAllBills } = require('../database');
const { verifyToken, requireAdmin } = require('../middleware/auth');

// Mess Transparency Board (Visible ONLY to Mess Manager / Admin)
router.get('/transparency', verifyToken, requireAdmin, (req, res) => {
  try {
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const targetMonth = req.query.month || currentMonthStr;

    // Recalculate first to ensure real-time accuracy of meals, fines, and dues
    recalculateAllBills(targetMonth);

    const settings = db.prepare('SELECT * FROM mess_settings WHERE id = 1').get();

    // Fetch all user bills for the month
    const rows = db.prepare(`
      SELECT 
        u.id as user_id,
        u.name,
        u.email,
        u.room_no,
        u.phone,
        b.id as billing_id,
        b.month,
        b.meals_count,
        b.meal_rate,
        b.meal_cost,
        COALESCE(b.monthly_fee, 700.0) as monthly_fee,
        b.prev_due,
        b.masi_fee,
        b.masi_paid,
        b.fine_amount,
        b.fine_applied,
        b.total_payable,
        b.paid_amount,
        (b.total_payable - b.paid_amount) as due_balance,
        b.status,
        b.updated_at
      FROM users u
      LEFT JOIN billing b ON u.id = b.user_id AND b.month = ?
      WHERE u.role = 'user' AND u.status = 'active'
      ORDER BY 
        CASE 
          WHEN b.status = 'OVERDUE' THEN 1
          WHEN b.status = 'PENDING' THEN 2
          ELSE 3
        END,
        (b.total_payable - b.paid_amount) DESC,
        u.room_no ASC
    `).all(targetMonth);

    // Compute mess-wide aggregates
    let totalMeals = 0;
    let totalBilled = 0;
    let totalPaid = 0;
    let totalDue = 0;
    let paidMembersCount = 0;
    let pendingMembersCount = 0;
    let overdueMembersCount = 0;
    let totalFines = 0;
    let masiPaidCount = 0;

    const [tYear, tMonth] = targetMonth.split('-').map(Number);
    const isCurrentMonth = (now.getFullYear() === tYear && (now.getMonth() + 1) === tMonth);
    const isPastMasiCutoff = isCurrentMonth ? now.getDate() > settings.masi_cutoff_day : true;

    const memberDetails = rows.map(r => {
      const meals = r.meals_count || 0;
      const mealCost = 0; // No per-meal charging
      const monthlyFee = r.monthly_fee || settings.monthly_fee || 700.0;
      const prevDue = r.prev_due || 0;
      const masiFee = r.masi_fee || settings.masi_fee || 400.0;
      const fineAmount = r.fine_amount || 0;
      const totalPayable = r.total_payable || (monthlyFee + prevDue + masiFee + fineAmount);
      const paid = r.paid_amount || 0;
      const due = Math.max(0, totalPayable - paid);

      totalMeals += meals;
      totalBilled += totalPayable;
      totalPaid += paid;
      totalDue += due;
      totalFines += fineAmount;

      const isMasiPaid = r.masi_paid === 1 || paid >= masiFee;
      if (isMasiPaid) masiPaidCount++;

      let masiStatus = 'PAID';
      if (!isMasiPaid) {
        masiStatus = isPastMasiCutoff ? 'OVERDUE' : 'DUE';
      }

      let displayStatus = r.status || 'PENDING';
      if (due <= 0 && totalPayable > 0) {
        displayStatus = 'PAID';
        paidMembersCount++;
      } else if (r.fine_applied === 1 || displayStatus === 'OVERDUE') {
        displayStatus = 'OVERDUE';
        overdueMembersCount++;
      } else {
        displayStatus = 'PENDING';
        pendingMembersCount++;
      }

      return {
        user_id: r.user_id,
        name: r.name,
        email: r.email,
        room_no: r.room_no || 'N/A',
        phone: r.phone || '',
        billing_id: r.billing_id,
        month: targetMonth,
        meals_count: meals,
        meal_rate: r.meal_rate || settings.meal_rate,
        meal_cost: mealCost,
        monthly_fee: monthlyFee,
        prev_due: prevDue,
        masi_fee: masiFee,
        masi_status: masiStatus,
        fine_amount: fineAmount,
        fine_applied: r.fine_applied === 1,
        total_payable: totalPayable,
        paid_amount: paid,
        due_balance: due,
        status: displayStatus,
        updated_at: r.updated_at
      };
    });

    return res.json({
      success: true,
      month: targetMonth,
      settings: {
        mess_name: settings.mess_name,
        scanner_name: settings.scanner_name || 'Bhabani Payment Scanner',
        scanner_image: settings.scanner_image || '/assets/bhabani_scanner.jpeg',
        monthly_fee: settings.monthly_fee || 700.0,
        meal_rate: settings.meal_rate,
        fine_amount: settings.fine_amount,
        fine_cutoff_day: settings.fine_cutoff_day,
        masi_fee: settings.masi_fee,
        masi_cutoff_day: settings.masi_cutoff_day,
        upi_id: settings.upi_id,
        upi_name: settings.upi_name,
        bank_name: settings.bank_name,
        account_number: settings.account_number,
        ifsc_code: settings.ifsc_code
      },
      summary: {
        total_members: memberDetails.length,
        total_meals: totalMeals,
        total_billed: Math.round(totalBilled),
        total_paid: Math.round(totalPaid),
        total_due: Math.round(totalDue),
        paid_members_count: paidMembersCount,
        pending_members_count: pendingMembersCount,
        overdue_members_count: overdueMembersCount,
        total_fines_collected: Math.round(totalFines),
        masi_pool_collected: masiPaidCount * settings.masi_fee,
        masi_pool_total: memberDetails.length * settings.masi_fee,
        masi_paid_count: masiPaidCount
      },
      members: memberDetails
    });
  } catch (err) {
    console.error('Transparency board error:', err);
    return res.status(500).json({ success: false, message: 'Could not load transparency board.' });
  }
});

// Personal billing summary for current user
router.get('/my', verifyToken, (req, res) => {
  try {
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const targetMonth = req.query.month || currentMonthStr;

    recalculateAllBills(targetMonth);

    const bill = db.prepare(`
      SELECT * FROM billing WHERE user_id = ? AND month = ?
    `).get(req.user.id, targetMonth);

    const allBills = db.prepare(`
      SELECT * FROM billing WHERE user_id = ? ORDER BY month DESC LIMIT 12
    `).all(req.user.id);

    const pendingPayment = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as pending_total
      FROM payments
      WHERE user_id = ? AND status = 'PENDING' AND month = ?
    `).get(req.user.id, targetMonth);
    const pendingAmount = pendingPayment ? pendingPayment.pending_total : 0;

    const settings = db.prepare('SELECT * FROM mess_settings WHERE id = 1').get();

    const monthlyFee = bill ? (bill.monthly_fee || settings.monthly_fee || 700.0) : (settings.monthly_fee || 700.0);
    const masiFee = bill ? (bill.masi_fee || settings.masi_fee || 400.0) : (settings.masi_fee || 400.0);
    const prevDue = bill ? (bill.prev_due || 0) : 0;
    const fineAmount = bill ? (bill.fine_amount || 0) : 0;
    const totalPayable = bill ? bill.total_payable : (monthlyFee + masiFee + prevDue);
    const paidAmount = bill ? bill.paid_amount : 0;
    const dueBalance = Math.max(0, totalPayable - paidAmount);

    return res.json({
      success: true,
      current_month: targetMonth,
      mess_due_day: settings.fine_cutoff_day || 5,
      masi_due_day: settings.masi_cutoff_day || 7,
      combined_fee: monthlyFee + masiFee,
      settings: {
        mess_name: settings.mess_name,
        scanner_name: settings.scanner_name || 'Bhabani Payment Scanner',
        scanner_image: settings.scanner_image || '/assets/bhabani_scanner.jpeg',
        monthly_fee: monthlyFee,
        fine_cutoff_day: settings.fine_cutoff_day || 5,
        fine_amount: settings.fine_amount,
        masi_fee: masiFee,
        masi_cutoff_day: settings.masi_cutoff_day || 7,
        upi_id: settings.upi_id,
        upi_name: settings.upi_name,
        bank_name: settings.bank_name,
        account_number: settings.account_number,
        ifsc_code: settings.ifsc_code,
        announcement: settings.announcement
      },
      current_bill: {
        ...(bill || {}),
        monthly_fee: monthlyFee,
        masi_fee: masiFee,
        combined_fee: monthlyFee + masiFee,
        prev_due: prevDue,
        fine_amount: fineAmount,
        total_payable: totalPayable,
        paid_amount: paidAmount,
        due_balance: dueBalance,
        pending_verification_amount: pendingAmount,
        mess_due_day: settings.fine_cutoff_day || 5,
        masi_due_day: settings.masi_cutoff_day || 7
      },
      history: allBills
    });
  } catch (err) {
    console.error('Error fetching personal bill:', err);
    return res.status(500).json({ success: false, message: 'Could not retrieve personal billing info.' });
  }
});

// Admin force recalculate
router.post('/recalculate', verifyToken, requireAdmin, (req, res) => {
  try {
    const { month } = req.body;
    const targetMonth = month || new Date().toISOString().slice(0, 7);
    recalculateAllBills(targetMonth);
    return res.json({ success: true, message: `Bills recalculated successfully for ${targetMonth}` });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Recalculation failed.' });
  }
});

module.exports = router;
