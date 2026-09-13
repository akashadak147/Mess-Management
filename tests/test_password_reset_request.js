const http = require('http');
const assert = require('assert');
const { db } = require('../server/database');

function apiCall(endpoint, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: endpoint,
      method,
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runResetRequestTests() {
  console.log('====================================================');
  console.log('🧪 TESTING ADMIN-MANAGED PASSWORD RESET REQUEST FLOW');
  console.log('====================================================\n');

  const randomSuffix = Math.floor(10000 + Math.random() * 90000);
  const testEmail = `student_reset_${randomSuffix}@mess.com`;
  const testPhone = '98765' + randomSuffix;
  const initialPassword = 'InitialPass@123';
  const newAdminAssignedPassword = 'AdminAssignedPass@456';

  // 1. Direct Student Registration without OTP
  console.log('--- Step 1: Direct Registration (No OTP required) ---');
  const regRes = await apiCall('/api/auth/register', 'POST', {
    name: 'Reset Test Student',
    email: testEmail,
    room_no: 'Room 303',
    phone: testPhone,
    password: initialPassword
  });
  assert.strictEqual(regRes.status, 201, 'Direct registration without OTP should return 201');
  assert.strictEqual(regRes.data.success, true, 'Registration succeeds');
  assert.strictEqual(regRes.data.pendingApproval, true, 'Student account created pending admin approval');
  console.log('  ✅ PASS: Direct student registration succeeded without any OTP requirement.');

  // Approve student so they are an active user
  db.prepare("UPDATE users SET status = 'active' WHERE email = ?").run(testEmail);
  const studentUser = db.prepare('SELECT * FROM users WHERE email = ?').get(testEmail);

  // 2. Student Submits Password Reset Request
  console.log('\n--- Step 2: Student Submits Password Reset Request to Admin ---');
  
  // Non-existent email check
  const badReq = await apiCall('/api/auth/request-password-reset', 'POST', {
    identifier: 'nonexistent_user_999@mess.com'
  });
  assert.strictEqual(badReq.status, 404, 'Non-existent account should return 404');
  console.log('  ✅ PASS: Non-existent account returns 404');

  // Valid reset request using registered mobile number
  const resetReq = await apiCall('/api/auth/request-password-reset', 'POST', {
    identifier: testPhone,
    message: 'I forgot my password, please set a new one'
  });
  assert.strictEqual(resetReq.status, 200, 'Valid reset request should return 200');
  assert.strictEqual(resetReq.data.success, true, 'Reset request marked success');
  console.log('  ✅ PASS: Password reset request submitted successfully using mobile number.');

  // Check request in database
  const dbReq = db.prepare("SELECT * FROM password_reset_requests WHERE user_id = ? AND status = 'pending'").get(studentUser.id);
  assert(dbReq, 'Pending reset request must exist in database');
  assert.strictEqual(dbReq.email, testEmail);
  console.log(`  ✅ PASS: Reset request verified in database (Request ID: #${dbReq.id})`);

  // Duplicate request check
  const duplicateReq = await apiCall('/api/auth/request-password-reset', 'POST', {
    identifier: testEmail
  });
  assert.strictEqual(duplicateReq.status, 200);
  assert.strictEqual(duplicateReq.data.alreadyPending, true, 'Duplicate request is gracefully detected');
  console.log('  ✅ PASS: Duplicate reset request gracefully detected as already pending.');

  // 3. Admin Authentication & Queue Inspection
  console.log('\n--- Step 3: Admin Reviews Password Reset Requests ---');
  const adminLogin = await apiCall('/api/auth/login', 'POST', {
    email: 'akashadak162006@gmail.com',
    password: 'Akash@147'
  });
  assert.strictEqual(adminLogin.status, 200, 'Admin login succeeds');
  const adminToken = adminLogin.data.token;

  const queueRes = await apiCall('/api/admin/password-resets', 'GET', null, adminToken);
  assert.strictEqual(queueRes.status, 200, 'Admin can fetch reset requests');
  assert(queueRes.data.pending_count >= 1, 'Pending count is at least 1');
  const targetRequest = queueRes.data.requests.find(r => r.id === dbReq.id);
  assert(targetRequest, 'Target request found in admin list');
  assert.strictEqual(targetRequest.status, 'pending');
  console.log(`  ✅ PASS: Admin retrieved queue with ${queueRes.data.pending_count} pending request(s).`);

  // 4. Admin Resolves Request with New Password
  console.log('\n--- Step 4: Admin Assigns New Password to Student ---');
  const resolveRes = await apiCall(`/api/admin/password-resets/${dbReq.id}/resolve`, 'POST', {
    newPassword: newAdminAssignedPassword
  }, adminToken);
  assert.strictEqual(resolveRes.status, 200, 'Resolve reset returns 200');
  assert.strictEqual(resolveRes.data.success, true);
  assert.strictEqual(resolveRes.data.newPassword, newAdminAssignedPassword);
  console.log('  ✅ PASS: Admin successfully set new password for student.');

  // Check request in database is now resolved
  const resolvedDbReq = db.prepare('SELECT * FROM password_reset_requests WHERE id = ?').get(dbReq.id);
  assert.strictEqual(resolvedDbReq.status, 'resolved', 'Request status must be resolved');
  assert(resolvedDbReq.resolved_at, 'resolved_at timestamp must be populated');
  console.log('  ✅ PASS: Database request record status transitioned to "resolved".');

  // Check Audit Trail
  const auditLog = db.prepare("SELECT * FROM audit_logs WHERE action = 'PASSWORD_RESET_RESOLVED' ORDER BY id DESC LIMIT 1").get();
  assert(auditLog, 'Audit log entry must be created');
  assert.strictEqual(auditLog.target_user_id, studentUser.id);
  console.log('  ✅ PASS: Audit log entry verified (Action: PASSWORD_RESET_RESOLVED).');

  // 5. Student Logs In with the Admin-Assigned New Password
  console.log('\n--- Step 5: Student Sign In Verification with New Password ---');
  // Old password should fail
  const oldLogin = await apiCall('/api/auth/login', 'POST', {
    email: testEmail,
    password: initialPassword
  });
  assert.strictEqual(oldLogin.status, 401, 'Old password must be rejected');
  console.log('  ✅ PASS: Old password rejected with 401');

  // New password should succeed
  const newLogin = await apiCall('/api/auth/login', 'POST', {
    email: testEmail,
    password: newAdminAssignedPassword
  });
  assert.strictEqual(newLogin.status, 200, 'Student login with new password succeeds with 200');
  assert.strictEqual(newLogin.data.success, true);
  assert.strictEqual(newLogin.data.user.email, testEmail);
  console.log('  ✅ PASS: Student successfully logged in with new Admin-assigned password!');

  console.log('\n====================================================');
  console.log('🎉 ALL ADMIN-MANAGED PASSWORD RESET TESTS PASSED (100%)');
  console.log('====================================================\n');
}

runResetRequestTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
