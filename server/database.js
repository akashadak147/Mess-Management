require('dotenv').config();
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

// Open the local SQLite database file
const dbPath = path.join(__dirname, '..', 'mess_management.db');
const sqliteDb = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
sqliteDb.pragma('journal_mode = WAL');
sqliteDb.pragma('foreign_keys = ON');

/**
 * Adapter: wraps better-sqlite3 (sync) in an async-compatible interface
 * so all route files using `await db.execute({ sql, args })` continue to work.
 */
const db = {
  execute(queryOrStr, extraArgs) {
    // Support both: db.execute('SQL') and db.execute({ sql, args: [] })
    let sql, params;
    if (typeof queryOrStr === 'string') {
      sql = queryOrStr;
      params = extraArgs || [];
    } else {
      sql = queryOrStr.sql;
      params = queryOrStr.args || [];
    }

    const trimmed = sql.trim().toUpperCase();
    let rows, lastInsertRowid, changes;

    const stmt = sqliteDb.prepare(sql);

    if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH') || trimmed.startsWith('PRAGMA')) {
      rows = stmt.all(...params);
      lastInsertRowid = null;
      changes = 0;
    } else {
      const info = stmt.run(...params);
      rows = [];
      lastInsertRowid = info.lastInsertRowid;
      changes = info.changes;
    }

    // Return a Promise resolving to a libsql-compatible result shape
    return Promise.resolve({ rows, lastInsertRowid, changes });
  }
};

/**
 * Initializes database schema, applies migrations, updates settings, and seeds initial data.
 */
async function initSchema() {
  try {
    // 1. Create Tables (synchronous exec — better-sqlite3)
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        room_no TEXT,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user')),
        status TEXT DEFAULT 'pending' CHECK (status IN ('active', 'pending', 'inactive', 'rejected')),
        is_owner INTEGER DEFAULT 0,
        permissions TEXT DEFAULT 'all',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS meals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        morning INTEGER DEFAULT 1 CHECK (morning IN (0, 1)),
        night INTEGER DEFAULT 1 CHECK (night IN (0, 1)),
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, date)
      )
    `);

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS billing (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        month TEXT NOT NULL,
        meals_count INTEGER DEFAULT 0,
        meal_rate REAL DEFAULT 50.0,
        meal_cost REAL DEFAULT 0.0,
        monthly_fee REAL DEFAULT 700.0,
        prev_due REAL DEFAULT 0.0,
        masi_fee REAL DEFAULT 400.0,
        masi_paid INTEGER DEFAULT 0 CHECK (masi_paid IN (0, 1)),
        fine_amount REAL DEFAULT 0.0,
        fine_applied INTEGER DEFAULT 0 CHECK (fine_applied IN (0, 1)),
        total_payable REAL DEFAULT 0.0,
        paid_amount REAL DEFAULT 0.0,
        status TEXT DEFAULT 'PENDING' CHECK (status IN ('PAID', 'PENDING', 'OVERDUE')),
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, month)
      )
    `);

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        billing_id INTEGER REFERENCES billing(id),
        month TEXT NOT NULL,
        amount REAL NOT NULL,
        payment_date TEXT NOT NULL,
        utr_number TEXT NOT NULL,
        screenshot_path TEXT NOT NULL,
        note TEXT,
        status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
        admin_note TEXT,
        reviewed_by INTEGER REFERENCES users(id),
        reviewed_at DATETIME,
        payer_upi_id TEXT,
        upi_app TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS mess_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        mess_name TEXT DEFAULT 'Mess Mate',
        scanner_name TEXT DEFAULT 'Bhabani Payment Scanner',
        scanner_image TEXT DEFAULT '/assets/bhabani_scanner.jpeg',
        monthly_fee REAL DEFAULT 700.0,
        meal_rate REAL DEFAULT 50.0,
        fine_amount REAL DEFAULT 100.0,
        fine_cutoff_day INTEGER DEFAULT 15,
        masi_fee REAL DEFAULT 400.0,
        masi_cutoff_day INTEGER DEFAULT 7,
        upi_id TEXT DEFAULT '8927971674@fam',
        upi_name TEXT DEFAULT 'Bhabani Prasad Ghosh',
        bank_name TEXT DEFAULT 'State Bank of India',
        account_number TEXT DEFAULT '382910482910',
        ifsc_code TEXT DEFAULT 'SBIN0012345',
        morning_cutoff_time TEXT DEFAULT '08:30',
        night_cutoff_time TEXT DEFAULT '18:00',
        announcement TEXT DEFAULT 'Welcome to Mess Mate! Every month payment must be made before 15th via Bhabani Payment Scanner.'
      )
    `);

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS weekly_menu (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day_of_week TEXT UNIQUE NOT NULL,
        morning_menu TEXT NOT NULL,
        night_menu TEXT NOT NULL
      )
    `);

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER REFERENCES users(id),
        admin_name TEXT NOT NULL,
        action TEXT NOT NULL,
        target_user_id INTEGER,
        target_user_name TEXT,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS password_reset_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        room_no TEXT,
        request_message TEXT,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'rejected')),
        resolved_at DATETIME,
        resolved_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Safe Migrations — add columns that may not exist yet
    const migrations = [
      "ALTER TABLE users ADD COLUMN is_owner INTEGER DEFAULT 0",
      "ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT 'all'",
      "ALTER TABLE billing ADD COLUMN monthly_fee REAL DEFAULT 700.0",
      "ALTER TABLE mess_settings ADD COLUMN monthly_fee REAL DEFAULT 700.0",
      "ALTER TABLE mess_settings ADD COLUMN scanner_name TEXT DEFAULT 'Bhabani Payment Scanner'",
      "ALTER TABLE mess_settings ADD COLUMN scanner_image TEXT DEFAULT '/assets/bhabani_scanner.jpeg'",
      "ALTER TABLE payments ADD COLUMN payer_upi_id TEXT",
      "ALTER TABLE payments ADD COLUMN upi_app TEXT",
      "ALTER TABLE weekly_menu ADD COLUMN bengali_day TEXT",
      "ALTER TABLE weekly_menu ADD COLUMN market_duty TEXT",
      "ALTER TABLE weekly_menu ADD COLUMN special_note TEXT",
      "ALTER TABLE mess_settings ADD COLUMN sms_provider TEXT DEFAULT 'fast2sms'",
      "ALTER TABLE mess_settings ADD COLUMN sms_api_key TEXT",
      "ALTER TABLE mess_settings ADD COLUMN sms_sender_id TEXT"
    ];

    for (const migration of migrations) {
      try { sqliteDb.exec(migration); } catch (e) { /* column already exists — ignore */ }
    }

    // 3. Ensure Default Settings
    const settingsRow = sqliteDb.prepare('SELECT id FROM mess_settings WHERE id = 1').get();
    if (!settingsRow) {
      sqliteDb.prepare(`
        INSERT INTO mess_settings (
          id, mess_name, scanner_name, scanner_image, monthly_fee, meal_rate, fine_amount,
          fine_cutoff_day, masi_fee, masi_cutoff_day, upi_id, upi_name, bank_name, account_number, ifsc_code, announcement
        ) VALUES (
          1, 'Mess Mate', 'Bhabani Payment Scanner', '/assets/bhabani_scanner.jpeg', 700.0, 50.0, 100.0,
          5, 400.0, 7, '8927971674@fam', 'Bhabani Prasad Ghosh', 'State Bank of India', '382910482910', 'SBIN0012345',
          'Welcome to Mess Mate! Every student must pay monthly mess fee by 5th of every month. Maid fee by 7th via Bhabani Payment Scanner.'
        )
      `).run();
    } else {
      sqliteDb.prepare(`
        UPDATE mess_settings
        SET mess_name = 'Mess Mate',
            scanner_name = 'Bhabani Payment Scanner',
            scanner_image = '/assets/bhabani_scanner.jpeg',
            monthly_fee = 700.0,
            fine_cutoff_day = 5,
            masi_fee = 400.0,
            masi_cutoff_day = 7,
            upi_id = '8927971674@fam',
            upi_name = 'Bhabani Prasad Ghosh',
            announcement = 'Welcome to Mess Mate! Every student must pay monthly mess fee by 5th of every month. Maid fee by 7th via Bhabani Payment Scanner.'
        WHERE id = 1
      `).run();
    }

    // 4. Populate Weekly Routine
    const handwrittenSchedule = [
      { day_of_week: 'Monday',    bengali_day: 'সোমবার',      market_duty: 'Souvik + Arnab + Ankur',          morning_menu: 'Veg + Dal (সবজি + ডাল)',         night_menu: 'Chana-Ponir + Dal (ছানা পনির + ডাল)', special_note: '' },
      { day_of_week: 'Tuesday',   bengali_day: 'মঙ্গলবার',    market_duty: 'Akash + Aritra + Tuhin',           morning_menu: 'Soyabean + Dal (সয়াবিন + ডাল)',   night_menu: 'Eggs (ডিম)',                           special_note: '' },
      { day_of_week: 'Wednesday', bengali_day: 'বুধবার',      market_duty: 'Kalyan + Sujan + Arghya',          morning_menu: 'Veg + Dal (সবজি + ডাল)',         night_menu: 'Chicken (মাংস)',                       special_note: '' },
      { day_of_week: 'Thursday',  bengali_day: 'বৃহস্পতিবার', market_duty: 'Amit + Soumen + Arijit',           morning_menu: 'Eggs + Dal (ডিম + ডাল)',          night_menu: 'Chana-Ponir + Dal (ছানা পনির + ডাল)', special_note: '' },
      { day_of_week: 'Friday',    bengali_day: 'শুক্রবার',    market_duty: 'Santanu + Suprovat',               morning_menu: 'Veg + Dal (সবজি + ডাল)',         night_menu: '(Kichuri + Potato) OR Eggs',           special_note: '' },
      { day_of_week: 'Saturday',  bengali_day: 'শনিবার',      market_duty: 'Monodeep + B.P.G',                 morning_menu: 'Soyabean + Dal (সয়াবিন + ডাল)',   night_menu: 'Fish or Chicken (মাছ বা মাংস)',        special_note: '' },
      { day_of_week: 'Sunday',    bengali_day: 'রবিবার',      market_duty: 'Pradip + Kinshuk + Shibom + D.K.', morning_menu: 'Veg + Dal (সবজি + ডাল)',         night_menu: 'Eggs + Dal (ডিম + ডাল)',               special_note: '' }
    ];

    const upsertMenu = sqliteDb.prepare(`
      INSERT INTO weekly_menu (day_of_week, bengali_day, market_duty, morning_menu, night_menu, special_note)
      VALUES (@day_of_week, @bengali_day, @market_duty, @morning_menu, @night_menu, @special_note)
      ON CONFLICT(day_of_week) DO UPDATE SET
        bengali_day  = excluded.bengali_day,
        market_duty  = excluded.market_duty,
        morning_menu = excluded.morning_menu,
        night_menu   = excluded.night_menu,
        special_note = excluded.special_note
    `);
    for (const item of handwrittenSchedule) {
      upsertMenu.run(item);
    }

    await seedInitialData();
    console.log('✅ Database schema initialized successfully.');
  } catch (err) {
    console.error('Error initializing database schema:', err);
  }
}

async function seedInitialData() {
  const salt = bcrypt.genSaltSync(10);
  const ownerHash = bcrypt.hashSync('Akash@147', salt);
  const asstHash  = bcrypt.hashSync('1@bpg1947', salt);

  // 1. Primary Website Owner: Akash Adak
  const ownerRow = sqliteDb.prepare("SELECT id FROM users WHERE email = ?").get('akashadak162006@gmail.com');
  if (!ownerRow) {
    sqliteDb.prepare(`
      INSERT INTO users (name, email, phone, room_no, password_hash, role, is_owner, permissions, status)
      VALUES ('Akash Adak', 'akashadak162006@gmail.com', '+91 8927971674', 'Owner Office', ?, 'admin', 1, 'all', 'active')
    `).run(ownerHash);
  } else {
    sqliteDb.prepare(`
      UPDATE users
      SET name = 'Akash Adak', phone = '+91 8927971674', room_no = 'Owner Office',
          role = 'admin', is_owner = 1, permissions = 'all', status = 'active'
      WHERE email = 'akashadak162006@gmail.com'
    `).run();
  }

  // 2. Assistant Manager: Bhabani Prasad Ghosh
  const asstRow = sqliteDb.prepare("SELECT id FROM users WHERE email = ?").get('adakakash2006@gmail.com');
  if (!asstRow) {
    sqliteDb.prepare(`
      INSERT INTO users (name, email, phone, room_no, password_hash, role, is_owner, permissions, status)
      VALUES ('Bhabani Prasad Ghosh', 'adakakash2006@gmail.com', '+91 8927971674', 'Manager Office', ?, 'admin', 0, 'all', 'active')
    `).run(asstHash);
  } else {
    sqliteDb.prepare(`
      UPDATE users
      SET name = 'Bhabani Prasad Ghosh', phone = '+91 8927971674', room_no = 'Manager Office',
          role = 'admin', is_owner = 0, permissions = 'all', status = 'active'
      WHERE email = 'adakakash2006@gmail.com'
    `).run();
  }
}

/**
 * Recalculate billings for all users for a given month (YYYY-MM).
 */
async function recalculateAllBills(targetMonth) {
  try {
    const settings = sqliteDb.prepare('SELECT * FROM mess_settings WHERE id = 1').get();
    if (!settings) return;

    const users = sqliteDb.prepare("SELECT id, name FROM users WHERE role = 'user' AND status = 'active'").all();

    const [year, month] = targetMonth.split('-').map(Number);
    const prevMonthDate = new Date(year, month - 2, 1);
    const prevMonthStr  = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;

    const today          = new Date();
    const currentDay     = today.getDate();
    const isCurrentMonth = (today.getFullYear() === year && (today.getMonth() + 1) === month);

    // Pre-compile statements once for efficiency inside the loop
    const getMeals    = sqliteDb.prepare('SELECT COALESCE(SUM(morning + night), 0) as total_meals FROM meals WHERE user_id = ? AND date LIKE ?');
    const getPrevDue  = sqliteDb.prepare('SELECT (total_payable - paid_amount) as due FROM billing WHERE user_id = ? AND month = ?');
    const getExisting = sqliteDb.prepare('SELECT * FROM billing WHERE user_id = ? AND month = ?');
    const upsertBill  = sqliteDb.prepare(`
      INSERT INTO billing (
        user_id, month, meals_count, meal_rate, meal_cost, monthly_fee, prev_due, masi_fee, masi_paid,
        fine_amount, fine_applied, total_payable, paid_amount, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, month) DO UPDATE SET
        meals_count   = excluded.meals_count,
        meal_rate     = excluded.meal_rate,
        meal_cost     = excluded.meal_cost,
        monthly_fee   = excluded.monthly_fee,
        prev_due      = excluded.prev_due,
        masi_fee      = excluded.masi_fee,
        fine_amount   = excluded.fine_amount,
        fine_applied  = excluded.fine_applied,
        total_payable = excluded.total_payable,
        status        = excluded.status,
        updated_at    = CURRENT_TIMESTAMP
    `);

    for (const u of users) {
      const mealRow    = getMeals.get(u.id, `${targetMonth}-%`);
      const mealsCount = mealRow ? Number(mealRow.total_meals) : 0;
      const mealRate   = Number(settings.meal_rate) || 50.0;
      // FIX: mealCost was hardcoded to 0; now correctly computed
      const mealCost   = mealsCount * mealRate;
      const monthlyFee = Number(settings.monthly_fee) || 700.0;

      const prevDueRow = getPrevDue.get(u.id, prevMonthStr);
      const prevDue    = prevDueRow ? Math.max(0, Number(prevDueRow.due)) : 0;

      const existing   = getExisting.get(u.id, targetMonth);
      const paidAmount = existing ? Number(existing.paid_amount) : 0;
      const masiPaid   = existing ? Number(existing.masi_paid)
                                  : (paidAmount >= Number(settings.masi_fee) ? 1 : 0);

      let fineAmount = 0;
      let fineApplied = 0;
      const basePayableWithoutFine = monthlyFee + prevDue + Number(settings.masi_fee);

      if (isCurrentMonth && currentDay > Number(settings.fine_cutoff_day)) {
        if (paidAmount < basePayableWithoutFine) {
          fineAmount  = Number(settings.fine_amount);
          fineApplied = 1;
        }
      } else if (!isCurrentMonth && new Date(year, month - 1, 1) < new Date(today.getFullYear(), today.getMonth(), 1)) {
        if (paidAmount < basePayableWithoutFine) {
          fineAmount  = Number(settings.fine_amount);
          fineApplied = 1;
        }
      }

      const totalPayable = basePayableWithoutFine + fineAmount;

      let status = 'PENDING';
      if (paidAmount >= totalPayable && totalPayable > 0) {
        status = 'PAID';
      } else if (fineApplied === 1 || (isCurrentMonth && currentDay > Number(settings.fine_cutoff_day))) {
        status = 'OVERDUE';
      }

      upsertBill.run(
        u.id, targetMonth, mealsCount, mealRate, mealCost, monthlyFee,
        prevDue, Number(settings.masi_fee), masiPaid, fineAmount, fineApplied, totalPayable, paidAmount, status
      );
    }
  } catch (err) {
    console.error('Error recalculating bills:', err);
  }
}

/**
 * System-wide Audit Activity Logger
 */
async function logAudit(adminId, adminName, action, targetUserId = null, targetUserName = null, details = null) {
  try {
    sqliteDb.prepare(`
      INSERT INTO audit_logs (admin_id, admin_name, action, target_user_id, target_user_name, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      adminId        || null,
      adminName      || 'System Admin',
      action,
      targetUserId   || null,
      targetUserName || null,
      details        || null
    );
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

// Initialize database schema on startup
initSchema();

module.exports = {
  db,
  recalculateAllBills,
  logAudit
};