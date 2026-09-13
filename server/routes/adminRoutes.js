const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db, recalculateAllBills, logAudit } = require('../database');
const { verifyToken, requireAdmin, requireOwner } = require('../middleware/auth');

// All endpoints in this router require a verified, active Administrator
router.use(verifyToken, requireAdmin);

// ============================================================================
// DASHBOARD OVERVIEW METRICS
// ============================================================================
router.get('/dashboard-stats', (req, res) => {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const currentMonthStr = todayStr.slice(0, 7);

    // Run recalculation to get accurate figures
    recalculateAllBills(currentMonthStr);

    const totalMembers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'user' AND status = 'active'").get().count;

    // Today's meal headcounts - Unmarked students default to EATING. Only explicit 0s count as skipping / no-show.
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
    const morningEating = Math.max(0, totalMembers - morningSkipping);
    const nightEating = Math.max(0, totalMembers - nightSkipping);

    // Monthly billing aggregates
    const billingStats = db.prepare(`
      SELECT 
        COALESCE(SUM(total_payable), 0) as total_billed,
        COALESCE(SUM(paid_amount), 0) as total_collected,
        COALESCE(SUM(total_payable - paid_amount), 0) as total_due,
        COALESCE(SUM(fine_amount), 0) as total_fines,
        COUNT(CASE WHEN status = 'OVERDUE' THEN 1 END) as overdue_count,
        COUNT(CASE WHEN status = 'PAID' THEN 1 END) as paid_count
      FROM billing
      WHERE month = ?
    `).get(currentMonthStr);

    // Pending payment proofs count
    const pendingProofs = db.prepare("SELECT COUNT(*) as count FROM payments WHERE status = 'PENDING'").get().count;

    // Pending student registration approval count
    const pendingUsersCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'user' AND status = 'pending'").get().count;

    // Pending password reset requests count
    let pendingResetsCount = 0;
    try {
      pendingResetsCount = db.prepare("SELECT COUNT(*) as count FROM password_reset_requests WHERE status = 'pending'").get().count;
    } catch (e) {}

    // Settings
    const settings = db.prepare('SELECT * FROM mess_settings WHERE id = 1').get();

    // Rannar Masi fund
    const masiPoolTotal = totalMembers * settings.masi_fee;
    const masiCollectedRow = db.prepare(`
      SELECT COUNT(*) as count FROM billing WHERE month = ? AND masi_paid = 1
    `).get(currentMonthStr);
    const masiCollected = (masiCollectedRow ? masiCollectedRow.count : 0) * settings.masi_fee;

    return res.json({
      success: true,
      stats: {
        total_members: totalMembers,
        today_morning_eating: morningEating,
        today_morning_skipping: morningSkipping,
        today_night_eating: nightEating,
        today_night_skipping: nightSkipping,
        total_billed: Math.round(billingStats.total_billed),
        total_collected: Math.round(billingStats.total_collected),
        total_due: Math.round(billingStats.total_due),
        total_fines: Math.round(billingStats.total_fines),
        overdue_members: billingStats.overdue_count,
        paid_members: billingStats.paid_count,
        pending_proofs_count: pendingProofs,
        pending_users_count: pendingUsersCount,
        pending_resets_count: pendingResetsCount,
        masi_pool_total: masiPoolTotal,
        masi_collected: masiCollected,
        masi_pending: Math.max(0, masiPoolTotal - masiCollected)
      }
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve dashboard stats.' });
  }
});

// ============================================================================
// PENDING STUDENT REGISTRATIONS QUEUE
// ============================================================================
router.get('/pending-users', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, name, email, phone, room_no, created_at, status
      FROM users
      WHERE role = 'user' AND status = 'pending'
      ORDER BY created_at DESC
    `).all();
    return res.json({ success: true, users });
  } catch (err) {
    console.error('Fetch pending users error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch pending approval users.' });
  }
});

router.post('/users/:id/approve', (req, res) => {
  try {
    const userId = req.params.id;
    const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Student account not found.' });
    }

    db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(userId);

    const currentMonthStr = new Date().toISOString().slice(0, 7);
    recalculateAllBills(currentMonthStr);

    logAudit(
      req.user.id,
      req.user.name,
      'STUDENT_APPROVED',
      user.id,
      user.name,
      `Approved student registration for ${user.name} (${user.email})`
    );

    return res.json({
      success: true,
      message: `Student ${user.name} approved successfully! They can now sign in with their email and password.`
    });
  } catch (err) {
    console.error('Approve student error:', err);
    return res.status(500).json({ success: false, message: 'Failed to approve student.' });
  }
});

router.post('/users/:id/reject', (req, res) => {
  try {
    const userId = req.params.id;
    const user = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Student account not found.' });
    }

    db.prepare("UPDATE users SET status = 'rejected' WHERE id = ?").run(userId);

    logAudit(
      req.user.id,
      req.user.name,
      'STUDENT_REJECTED',
      user.id,
      user.name,
      `Rejected student registration for ${user.name} (${user.email})`
    );

    return res.json({
      success: true,
      message: `Student registration for ${user.name} has been rejected.`
    });
  } catch (err) {
    console.error('Reject student error:', err);
    return res.status(500).json({ success: false, message: 'Failed to reject student.' });
  }
});

// ============================================================================
// FULL STUDENT CONTROL & LIFECYCLE MANAGEMENT
// ============================================================================

// List students with filter support: all, active, inactive
router.get('/users', (req, res) => {
  try {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const statusFilter = req.query.status || 'all';

    let query = `
      SELECT 
        u.id, u.name, u.email, u.phone, u.room_no, u.role, u.status, u.created_at,
        COALESCE(b.monthly_fee, 700.0) as monthly_fee,
        COALESCE(b.masi_fee, 400.0) as masi_fee,
        COALESCE(b.prev_due, 0.0) as prev_due,
        COALESCE(b.total_payable, 0.0) as total_payable,
        COALESCE(b.paid_amount, 0.0) as paid_amount,
        COALESCE((b.total_payable - b.paid_amount), 0.0) as due_balance,
        COALESCE(b.status, 'PENDING') as billing_status,
        COALESCE(b.masi_paid, 0) as masi_paid,
        (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE user_id = u.id AND status = 'APPROVED') as lifetime_paid
      FROM users u
      LEFT JOIN billing b ON u.id = b.user_id AND b.month = ?
      WHERE u.role = 'user'
    `;

    const params = [currentMonth];
    if (statusFilter === 'active') {
      query += " AND u.status = 'active'";
    } else if (statusFilter === 'inactive') {
      query += " AND u.status != 'active'";
    }

    query += " ORDER BY CASE WHEN u.status = 'active' THEN 0 ELSE 1 END, u.room_no ASC, u.name ASC";
    const users = db.prepare(query).all(...params);

    return res.json({ success: true, users });
  } catch (err) {
    console.error('Fetch users error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch students list.' });
  }
});

// View complete student dossier (Profile, Current Dues, Payment History, Billing History, Attendance)
router.get('/users/:id/details', (req, res) => {
  try {
    const userId = req.params.id;
    const user = db.prepare(`
      SELECT id, name, email, phone, room_no, role, status, created_at
      FROM users
      WHERE id = ? AND role = 'user'
    `).get(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const currentMonth = new Date().toISOString().slice(0, 7);
    const currentBill = db.prepare('SELECT * FROM billing WHERE user_id = ? AND month = ?').get(userId, currentMonth);

    const payments = db.prepare(`
      SELECT id, month, amount, payment_date, utr_number, screenshot_path, status, admin_note, payer_upi_id, upi_app, created_at
      FROM payments
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(userId);

    const billingHistory = db.prepare(`
      SELECT month, meals_count, monthly_fee, prev_due, masi_fee, masi_paid, fine_amount, total_payable, paid_amount, (total_payable - paid_amount) as due_balance, status
      FROM billing
      WHERE user_id = ?
      ORDER BY month DESC
    `).all(userId);

    const meals = db.prepare(`
      SELECT id, user_id, date, morning, night,
             CASE WHEN morning = 1 THEN 'eat' ELSE 'skip' END as morning_att,
             CASE WHEN night = 1 THEN 'eat' ELSE 'skip' END as night_att,
             updated_at
      FROM meals
      WHERE user_id = ?
      ORDER BY date DESC
      LIMIT 30
    `).all(userId);

    const lifetimePaid = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM payments
      WHERE user_id = ? AND UPPER(status) = 'APPROVED'
    `).get(userId).total;

    return res.json({
      success: true,
      user,
      lifetime_paid: lifetimePaid,
      currentBill: currentBill || null,
      current_bill: currentBill || null,
      payments,
      billing_history: billingHistory,
      meals,
      attendance: meals
    });
  } catch (err) {
    console.error('Fetch user dossier error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch student details dossier.' });
  }
});

// Add student directly
router.post('/users', (req, res) => {
  try {
    const { name, email, phone, room_no, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(trimmedEmail);
    if (existing) {
      return res.status(400).json({ success: false, message: 'User with this email already exists.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);

    const stmt = db.prepare(`
      INSERT INTO users (name, email, phone, room_no, password_hash, role, status)
      VALUES (?, ?, ?, ?, ?, 'user', 'active')
    `);
    const info = stmt.run(name.trim(), trimmedEmail, phone ? phone.trim() : null, room_no ? room_no.trim() : null, hash);

    const currentMonthStr = new Date().toISOString().slice(0, 7);
    recalculateAllBills(currentMonthStr);

    logAudit(
      req.user.id,
      req.user.name,
      'STUDENT_ADDED',
      info.lastInsertRowid,
      name.trim(),
      `Added new student (Room: ${room_no || 'N/A'}, Phone: ${phone || 'N/A'})`
    );

    return res.status(201).json({
      success: true,
      message: `Student ${name.trim()} added successfully.`,
      id: info.lastInsertRowid,
      user: {
        id: info.lastInsertRowid,
        name: name.trim(),
        email: trimmedEmail,
        room_no: room_no ? room_no.trim() : null,
        phone: phone ? phone.trim() : null,
        status: 'active'
      }
    });
  } catch (err) {
    console.error('Add user error:', err);
    return res.status(500).json({ success: false, message: 'Failed to add student.' });
  }
});

// Update student details
router.put('/users/:id', (req, res) => {
  try {
    const userId = req.params.id;
    const { name, email, phone, room_no, status, new_password } = req.body;

    const existing = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(userId);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    if (new_password && new_password.trim().length >= 4) {
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync(new_password.trim(), salt);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
    }

    db.prepare(`
      UPDATE users
      SET name = COALESCE(?, name),
          email = COALESCE(?, email),
          phone = COALESCE(?, phone),
          room_no = COALESCE(?, room_no),
          status = COALESCE(?, status)
      WHERE id = ?
    `).run(
      name ? name.trim() : null,
      email ? email.trim().toLowerCase() : null,
      phone ? phone.trim() : null,
      room_no ? room_no.trim() : null,
      status || null,
      userId
    );

    const currentMonthStr = new Date().toISOString().slice(0, 7);
    recalculateAllBills(currentMonthStr);

    logAudit(
      req.user.id,
      req.user.name,
      'STUDENT_EDITED',
      userId,
      name || existing.name,
      `Updated student information (Room: ${room_no || existing.room_no}, Phone: ${phone || existing.phone}, Status: ${status || existing.status})`
    );

    return res.json({ success: true, message: 'Student details updated successfully.' });
  } catch (err) {
    console.error('Update student error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update student.' });
  }
});

// Reset student password
router.post('/users/:id/reset-password', (req, res) => {
  try {
    const userId = req.params.id;
    const { password } = req.body;
    const student = db.prepare("SELECT id, name, email FROM users WHERE id = ? AND role = 'user'").get(userId);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const newPwd = (password && password.trim().length >= 4) ? password.trim() : 'user123';
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(newPwd, salt);

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);

    logAudit(
      req.user.id,
      req.user.name,
      'STUDENT_PASSWORD_RESET',
      userId,
      student.name,
      `Reset password for student ${student.name} (${student.email})`
    );

    return res.json({
      success: true,
      message: `Password for ${student.name} was reset successfully!`,
      tempPassword: newPwd
    });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ success: false, message: 'Failed to reset student password.' });
  }
});

// Toggle student status (active/inactive)
router.post('/users/:id/toggle-status', (req, res) => {
  try {
    const userId = req.params.id;
    const student = db.prepare("SELECT id, name, status FROM users WHERE id = ? AND role = 'user'").get(userId);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const newStatus = student.status === 'active' ? 'inactive' : 'active';
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(newStatus, userId);

    const currentMonthStr = new Date().toISOString().slice(0, 7);
    recalculateAllBills(currentMonthStr);

    logAudit(
      req.user.id,
      req.user.name,
      newStatus === 'active' ? 'STUDENT_ACTIVATED' : 'STUDENT_DEACTIVATED',
      userId,
      student.name,
      `Student status set to ${newStatus}. All historical payment and attendance records preserved.`
    );

    return res.json({
      success: true,
      message: `Student ${student.name} is now ${newStatus}.`,
      status: newStatus,
      user: { id: student.id, status: newStatus }
    });
  } catch (err) {
    console.error('Toggle student status error:', err);
    return res.status(500).json({ success: false, message: 'Failed to toggle student status.' });
  }
});

// Soft-remove student from active users
router.post('/users/:id/remove', (req, res) => {
  try {
    const userId = req.params.id;
    const student = db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'user'").get(userId);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    // Soft-delete: set status to 'inactive' so all financial and attendance records are preserved
    db.prepare("UPDATE users SET status = 'inactive' WHERE id = ?").run(userId);

    const currentMonthStr = new Date().toISOString().slice(0, 7);
    recalculateAllBills(currentMonthStr);

    logAudit(
      req.user.id,
      req.user.name,
      'STUDENT_REMOVED',
      userId,
      student.name,
      `Student ${student.name} was removed from active members. All historical records preserved.`
    );

    return res.json({
      success: true,
      message: `Student ${student.name} has been soft-removed from active members. Their payment and meal records remain preserved.`
    });
  } catch (err) {
    console.error('Remove student error:', err);
    return res.status(500).json({ success: false, message: 'Failed to remove student.' });
  }
});

// ============================================================================
// ADMIN MANAGEMENT (OWNER EXCLUSIVE)
// ============================================================================

// List all administrators
router.get('/admins', (req, res) => {
  try {
    const admins = db.prepare(`
      SELECT id, name, email, phone, room_no, role, is_owner, status, permissions, created_at
      FROM users
      WHERE role = 'admin'
      ORDER BY is_owner DESC, name ASC
    `).all();

    return res.json({
      success: true,
      admins,
      isCallerOwner: req.user.is_owner === 1
    });
  } catch (err) {
    console.error('Fetch admins error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch admin accounts.' });
  }
});

// Add another administrator (Owner only)
router.post('/admins', requireOwner, (req, res) => {
  try {
    const { name, email, phone, password, permissions } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(trimmedEmail);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Account with this email already exists.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const permStr = permissions || 'all';

    const stmt = db.prepare(`
      INSERT INTO users (name, email, phone, room_no, password_hash, role, is_owner, permissions, status)
      VALUES (?, ?, ?, 'Admin Office', ?, 'admin', 0, ?, 'active')
    `);
    const info = stmt.run(name.trim(), trimmedEmail, phone ? phone.trim() : null, hash, permStr);

    logAudit(
      req.user.id,
      req.user.name,
      'ADMIN_CREATED',
      info.lastInsertRowid,
      name.trim(),
      `Owner created secondary admin: ${name.trim()} (${trimmedEmail}) with permissions: ${permStr}`
    );

    return res.status(201).json({
      success: true,
      message: `Admin ${name.trim()} created successfully!`,
      id: info.lastInsertRowid,
      admin: {
        id: info.lastInsertRowid,
        name: name.trim(),
        email: trimmedEmail,
        permissions: permStr,
        status: 'active'
      }
    });
  } catch (err) {
    console.error('Create admin error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create admin.' });
  }
});

// Update admin details & permissions (Owner only)
router.put('/admins/:id', requireOwner, (req, res) => {
  try {
    const adminId = parseInt(req.params.id, 10);
    const { name, phone, permissions, status, new_password } = req.body;

    const targetAdmin = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'admin'").get(adminId);
    if (!targetAdmin) {
      return res.status(404).json({ success: false, message: 'Admin account not found.' });
    }

    if (new_password && new_password.trim().length >= 4) {
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync(new_password.trim(), salt);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, adminId);
    }

    // Owner cannot be made inactive
    let finalStatus = status || targetAdmin.status;
    if (targetAdmin.is_owner === 1 && finalStatus !== 'active') {
      finalStatus = 'active';
    }

    db.prepare(`
      UPDATE users
      SET name = COALESCE(?, name),
          phone = COALESCE(?, phone),
          permissions = COALESCE(?, permissions),
          status = ?
      WHERE id = ?
    `).run(
      name ? name.trim() : null,
      phone ? phone.trim() : null,
      permissions || null,
      finalStatus,
      adminId
    );

    logAudit(
      req.user.id,
      req.user.name,
      'ADMIN_UPDATED',
      adminId,
      targetAdmin.name,
      `Updated admin settings: Permissions: ${permissions || targetAdmin.permissions}, Status: ${finalStatus}`
    );

    return res.json({ success: true, message: 'Admin details updated successfully.' });
  } catch (err) {
    console.error('Update admin error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update admin.' });
  }
});

// Toggle admin active/inactive (Owner only)
router.post('/admins/:id/toggle-status', requireOwner, (req, res) => {
  try {
    const adminId = parseInt(req.params.id, 10);
    const targetAdmin = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'admin'").get(adminId);
    if (!targetAdmin) {
      return res.status(404).json({ success: false, message: 'Admin not found.' });
    }

    if (targetAdmin.is_owner === 1) {
      return res.status(400).json({ success: false, message: 'Cannot deactivate the primary Owner account.' });
    }

    if (targetAdmin.id === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own admin account.' });
    }

    const newStatus = targetAdmin.status === 'active' ? 'inactive' : 'active';
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(newStatus, adminId);

    logAudit(
      req.user.id,
      req.user.name,
      newStatus === 'active' ? 'ADMIN_ACTIVATED' : 'ADMIN_DEACTIVATED',
      adminId,
      targetAdmin.name,
      `Admin ${targetAdmin.name} account was set to ${newStatus}`
    );

    return res.json({
      success: true,
      message: `Admin ${targetAdmin.name} is now ${newStatus}.`,
      status: newStatus,
      admin: { id: adminId, status: newStatus }
    });
  } catch (err) {
    console.error('Toggle admin status error:', err);
    return res.status(500).json({ success: false, message: 'Failed to toggle admin status.' });
  }
});

// ============================================================================
// AUDIT LOG VIEWER
// ============================================================================
router.get('/audit-logs', (req, res) => {
  try {
    const search = req.query.search ? `%${req.query.search.trim().toLowerCase()}%` : null;
    const action = req.query.action || null;
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
    const offset = parseInt(req.query.offset, 10) || 0;

    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];

    if (action && action !== 'ALL') {
      query += ' AND action = ?';
      params.push(action);
    }

    if (search) {
      query += ' AND (LOWER(admin_name) LIKE ? OR LOWER(target_user_name) LIKE ? OR LOWER(details) LIKE ? OR LOWER(action) LIKE ?)';
      params.push(search, search, search, search);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const logs = db.prepare(query).all(...params);
    const totalRow = db.prepare('SELECT COUNT(*) as count FROM audit_logs').get();

    return res.json({
      success: true,
      logs,
      total: totalRow.count
    });
  } catch (err) {
    console.error('Audit logs error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve audit activity logs.' });
  }
});

// ============================================================================
// RANNAR MASI COOK SALARY TRACKING
// ============================================================================
router.get('/masi-fund', (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const settings = db.prepare('SELECT * FROM mess_settings WHERE id = 1').get();

    const now = new Date();
    const [tYear, tMonth] = month.split('-').map(Number);
    const isCurrentMonth = (now.getFullYear() === tYear && (now.getMonth() + 1) === tMonth);
    const isPastCutoff = isCurrentMonth ? now.getDate() > settings.masi_cutoff_day : true;

    const list = db.prepare(`
      SELECT 
        u.id, u.name, u.email, u.room_no, u.phone,
        COALESCE(b.masi_fee, ?) as fee,
        COALESCE(b.masi_paid, 0) as is_paid,
        b.paid_amount,
        b.total_payable
      FROM users u
      LEFT JOIN billing b ON u.id = b.user_id AND b.month = ?
      WHERE u.role = 'user' AND u.status = 'active'
      ORDER BY b.masi_paid ASC, u.room_no ASC
    `).all(settings.masi_fee, month);

    let paidCount = 0;
    let pendingCount = 0;
    let overdueCount = 0;

    const students = list.map(item => {
      const paid = item.is_paid === 1 || item.paid_amount >= item.fee;
      let status = 'PAID';
      if (paid) {
        paidCount++;
      } else {
        if (isPastCutoff) {
          status = 'OVERDUE';
          overdueCount++;
        } else {
          status = 'PENDING';
          pendingCount++;
        }
      }

      return {
        id: item.id,
        name: item.name,
        email: item.email,
        room_no: item.room_no || 'N/A',
        phone: item.phone,
        fee: item.fee,
        status: status,
        is_paid: paid
      };
    });

    const totalTarget = students.length * settings.masi_fee;
    const totalCollected = paidCount * settings.masi_fee;

    return res.json({
      success: true,
      month,
      cutoff_day: settings.masi_cutoff_day,
      fee_per_student: settings.masi_fee,
      summary: {
        total_students: students.length,
        paid_count: paidCount,
        pending_count: pendingCount,
        overdue_count: overdueCount,
        total_target: totalTarget,
        total_collected: totalCollected,
        total_pending: totalTarget - totalCollected
      },
      students
    });
  } catch (err) {
    console.error('Error fetching masi fund:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve cook salary data.' });
  }
});

// ============================================================================
// MESS SETTINGS & CONFIGURATION
// ============================================================================
router.get('/settings', (req, res) => {
  try {
    const settings = db.prepare('SELECT * FROM mess_settings WHERE id = 1').get();
    return res.json({ success: true, settings });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to fetch mess settings.' });
  }
});

router.put('/settings', (req, res) => {
  try {
    const {
      mess_name,
      scanner_name,
      scanner_image,
      monthly_fee,
      meal_rate,
      fine_amount,
      fine_cutoff_day,
      masi_fee,
      masi_cutoff_day,
      upi_id,
      upi_name,
      bank_name,
      account_number,
      ifsc_code,
      morning_cutoff_time,
      night_cutoff_time,
      announcement,
      sms_provider,
      sms_api_key
    } = req.body;

    db.prepare(`
      UPDATE mess_settings
      SET mess_name = COALESCE(?, mess_name),
          scanner_name = COALESCE(?, scanner_name),
          scanner_image = COALESCE(?, scanner_image),
          monthly_fee = COALESCE(?, monthly_fee),
          meal_rate = COALESCE(?, meal_rate),
          fine_amount = COALESCE(?, fine_amount),
          fine_cutoff_day = COALESCE(?, fine_cutoff_day),
          masi_fee = COALESCE(?, masi_fee),
          masi_cutoff_day = COALESCE(?, masi_cutoff_day),
          upi_id = COALESCE(?, upi_id),
          upi_name = COALESCE(?, upi_name),
          bank_name = COALESCE(?, bank_name),
          account_number = COALESCE(?, account_number),
          ifsc_code = COALESCE(?, ifsc_code),
          morning_cutoff_time = COALESCE(?, morning_cutoff_time),
          night_cutoff_time = COALESCE(?, night_cutoff_time),
          announcement = COALESCE(?, announcement),
          sms_provider = COALESCE(?, sms_provider),
          sms_api_key = COALESCE(?, sms_api_key)
      WHERE id = 1
    `).run(
      mess_name, scanner_name, scanner_image, monthly_fee, meal_rate, fine_amount, fine_cutoff_day, masi_fee, masi_cutoff_day,
      upi_id, upi_name, bank_name, account_number, ifsc_code,
      morning_cutoff_time, night_cutoff_time, announcement,
      sms_provider, sms_api_key
    );

    const currentMonth = new Date().toISOString().slice(0, 7);
    recalculateAllBills(currentMonth);

    logAudit(
      req.user.id,
      req.user.name,
      'SETTINGS_UPDATED',
      null,
      null,
      `Updated mess settings: Fee ₹${monthly_fee || '700'}, Fine cutoff day ${fine_cutoff_day || '5'}, Maid fee ₹${masi_fee || '400'}`
    );

    return res.json({ success: true, message: 'Mess settings updated successfully.' });
  } catch (err) {
    console.error('Settings update error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update settings.' });
  }
});

// =========================================================================
// PASSWORD RESET REQUESTS MANAGEMENT
// =========================================================================

// Get all password reset requests
router.get('/password-resets', (req, res) => {
  try {
    const requests = db.prepare(`
      SELECT pr.*, u.status as user_status, u.role as user_role, admin.name as resolved_by_name
      FROM password_reset_requests pr
      LEFT JOIN users u ON pr.user_id = u.id
      LEFT JOIN users admin ON pr.resolved_by = admin.id
      ORDER BY 
        CASE WHEN pr.status = 'pending' THEN 0 ELSE 1 END,
        pr.created_at DESC
    `).all();

    const pendingCount = requests.filter(r => r.status === 'pending').length;

    return res.json({ success: true, requests, pending_count: pendingCount });
  } catch (err) {
    console.error('Fetch password resets error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch password reset requests.' });
  }
});

// Resolve password reset request by setting new password for student
router.post('/password-resets/:id/resolve', (req, res) => {
  try {
    const requestId = req.params.id;
    const { newPassword } = req.body;

    const request = db.prepare('SELECT * FROM password_reset_requests WHERE id = ?').get(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Password reset request not found.' });
    }

    const student = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(request.user_id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Associated student account no longer exists.' });
    }

    const assignedPassword = (newPassword && newPassword.trim().length >= 4) ? newPassword.trim() : 'student@123';
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(assignedPassword, salt);

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, student.id);

    db.prepare(`
      UPDATE password_reset_requests
      SET status = 'resolved',
          resolved_at = CURRENT_TIMESTAMP,
          resolved_by = ?
      WHERE id = ?
    `).run(req.user.id, requestId);

    logAudit(
      req.user.id,
      req.user.name,
      'PASSWORD_RESET_RESOLVED',
      student.id,
      student.name,
      `Admin resolved password reset request #${requestId} and set new password for ${student.name} (${student.email})`
    );

    return res.json({
      success: true,
      message: `New password assigned successfully for ${student.name}!`,
      newPassword: assignedPassword,
      student: { id: student.id, name: student.name, email: student.email }
    });
  } catch (err) {
    console.error('Resolve password reset error:', err);
    return res.status(500).json({ success: false, message: 'Failed to resolve password reset request.' });
  }
});

// Reject password reset request
router.post('/password-resets/:id/reject', (req, res) => {
  try {
    const requestId = req.params.id;
    const { reason } = req.body;

    const request = db.prepare('SELECT * FROM password_reset_requests WHERE id = ?').get(requestId);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Password reset request not found.' });
    }

    db.prepare(`
      UPDATE password_reset_requests
      SET status = 'rejected',
          resolved_at = CURRENT_TIMESTAMP,
          resolved_by = ?
      WHERE id = ?
    `).run(req.user.id, requestId);

    logAudit(
      req.user.id,
      req.user.name,
      'PASSWORD_RESET_REJECTED',
      request.user_id,
      request.name,
      `Admin rejected password reset request #${requestId}. Reason: ${reason || 'Not specified'}`
    );

    return res.json({ success: true, message: 'Password reset request rejected.' });
  } catch (err) {
    console.error('Reject password reset error:', err);
    return res.status(500).json({ success: false, message: 'Failed to reject password reset request.' });
  }
});

module.exports = router;
