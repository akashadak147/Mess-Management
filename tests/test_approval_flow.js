const http = require('http');

function apiCall(endpoint, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: endpoint,
      method: method,
      headers: {
        ...(postData ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        } : {}),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
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

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ ${message}`);
  }
}

(async () => {
  console.log('================================================================');
  console.log('🧪 RUNNING STUDENT REGISTRATION, APPROVAL & LOGIN SYNC TESTS');
  console.log('================================================================\n');

  const testEmail = `sync_student_${Date.now()}@mess.com`;
  const testPhone = '98765' + Math.floor(10000 + Math.random() * 90000);
  const testPassword = 'SecurePass@123';
  const testName = 'Sync Student Automated Test';

  // 1. Register student
  console.log(`Step 1: Registering student (${testEmail}, phone: ${testPhone})...`);
  const regRes = await apiCall('/api/auth/register', 'POST', {
    name: testName,
    email: testEmail,
    phone: testPhone,
    room_no: 'B-302',
    password: testPassword
  });
  assert(regRes.status === 201, `Registration returned status 201 (got ${regRes.status})`);
  assert(regRes.body.pendingApproval === true, 'Response confirms pending approval');
  const studentId = regRes.body.user.id;

  // 2. Check status via check-status endpoint with email
  console.log('\nStep 2: Checking live approval status with email...');
  const statusEmailRes = await apiCall(`/api/auth/check-status?identifier=${encodeURIComponent(testEmail)}`);
  assert(statusEmailRes.status === 200, 'Check status with email returned 200');
  assert(statusEmailRes.body.exists === true, 'Student exists in database');
  assert(statusEmailRes.body.status === 'pending', 'Student status is pending');
  assert(statusEmailRes.body.isApproved === false, 'isApproved is false');

  // 3. Check status via check-status endpoint with phone
  console.log('\nStep 3: Checking live approval status with 10-digit mobile number...');
  const statusPhoneRes = await apiCall(`/api/auth/check-status?identifier=${encodeURIComponent(testPhone)}`);
  assert(statusPhoneRes.status === 200, 'Check status with phone returned 200');
  assert(statusPhoneRes.body.exists === true, 'Student found by mobile number');
  assert(statusPhoneRes.body.status === 'pending', 'Status is pending when checked by phone');
  assert(statusPhoneRes.body.isApproved === false, 'isApproved is false by phone');

  // 4. Student tries to login before approval using Email
  console.log('\nStep 4: Attempting student login using Email before approval...');
  const preLoginEmail = await apiCall('/api/auth/login', 'POST', {
    email: testEmail,
    password: testPassword
  });
  assert(preLoginEmail.status === 403, `Pre-approval login by email returned 403 (got ${preLoginEmail.status})`);
  assert(preLoginEmail.body.isPending === true, 'Response contains isPending: true');

  // 5. Student tries to login before approval using Mobile Number
  console.log('\nStep 5: Attempting student login using 10-Digit Mobile Number before approval...');
  const preLoginPhone = await apiCall('/api/auth/login', 'POST', {
    email: testPhone,
    password: testPassword
  });
  assert(preLoginPhone.status === 403, `Pre-approval login by phone returned 403 (got ${preLoginPhone.status})`);
  assert(preLoginPhone.body.isPending === true, 'Response contains isPending: true when using phone');

  // 6. Admin logs in
  console.log('\nStep 6: Admin login...');
  const adminLogin = await apiCall('/api/auth/login', 'POST', {
    email: 'akashadak162006@gmail.com',
    password: 'Akash@147'
  });
  assert(adminLogin.status === 200, 'Admin login successful (200)');
  const adminToken = adminLogin.body.token;

  // 7. Admin checks dashboard stats for pending users count
  console.log('\nStep 7: Admin polls dashboard stats...');
  const statsRes = await apiCall('/api/admin/dashboard-stats', 'GET', null, adminToken);
  assert(statsRes.status === 200, 'Dashboard stats returned 200');
  assert(statsRes.body.stats.pending_users_count >= 1, `Pending users count >= 1 (got ${statsRes.body.stats.pending_users_count})`);

  // 8. Admin fetches pending users list
  console.log('\nStep 8: Admin fetches pending users queue...');
  const pendingUsersRes = await apiCall('/api/admin/pending-users', 'GET', null, adminToken);
  assert(pendingUsersRes.status === 200, 'Pending users queue returned 200');
  const foundUser = pendingUsersRes.body.users.find(u => u.id === studentId);
  assert(!!foundUser, `Student ID ${studentId} found in pending users queue`);

  // 9. Admin approves student
  console.log(`\nStep 9: Admin approves student ID ${studentId}...`);
  const approveRes = await apiCall(`/api/admin/users/${studentId}/approve`, 'POST', {}, adminToken);
  assert(approveRes.status === 200, `Approve returned 200 (got ${approveRes.status})`);
  assert(approveRes.body.success === true, 'Approval succeeded');

  // 10. Check status after approval via email
  console.log('\nStep 10: Live polling check after approval (email)...');
  const postStatusEmail = await apiCall(`/api/auth/check-status?identifier=${encodeURIComponent(testEmail)}`);
  assert(postStatusEmail.status === 200, 'Status check returned 200');
  assert(postStatusEmail.body.isApproved === true, 'isApproved is now TRUE');
  assert(postStatusEmail.body.status === 'active', 'Student status is now ACTIVE');

  // 11. Check status after approval via phone
  console.log('\nStep 11: Live polling check after approval (phone)...');
  const postStatusPhone = await apiCall(`/api/auth/check-status?identifier=${encodeURIComponent(testPhone)}`);
  assert(postStatusPhone.status === 200, 'Status check by phone returned 200');
  assert(postStatusPhone.body.isApproved === true, 'isApproved by phone is now TRUE');
  assert(postStatusPhone.body.status === 'active', 'Student status is now ACTIVE');

  // 12. Student logs in with Email
  console.log('\nStep 12: Student logs in with Email after approval...');
  const postLoginEmail = await apiCall('/api/auth/login', 'POST', {
    email: testEmail,
    password: testPassword
  });
  assert(postLoginEmail.status === 200, `Post-approval login by email returned 200 (got ${postLoginEmail.status})`);
  assert(postLoginEmail.body.success === true, 'Login successful');
  assert(!!postLoginEmail.body.token, 'JWT Token issued');
  assert(postLoginEmail.body.user.role === 'user', 'User role is student user');

  // 13. Student logs in with 10-Digit Mobile Number
  console.log('\nStep 13: Student logs in with 10-Digit Mobile Number after approval...');
  const postLoginPhone = await apiCall('/api/auth/login', 'POST', {
    email: testPhone,
    password: testPassword
  });
  assert(postLoginPhone.status === 200, `Post-approval login by mobile number returned 200 (got ${postLoginPhone.status})`);
  assert(postLoginPhone.body.success === true, 'Login by phone successful');
  assert(!!postLoginPhone.body.token, 'JWT Token issued for phone login');

  // 14. Student logs in with trailing space in password (mobile keyboard autofill simulation)
  console.log('\nStep 14: Student logs in with trailing space in password (mobile autofill simulation)...');
  const postLoginSpace = await apiCall('/api/auth/login', 'POST', {
    email: testEmail,
    password: testPassword + ' '
  });
  assert(postLoginSpace.status === 200, `Login with trailing space returned 200 (got ${postLoginSpace.status})`);
  assert(postLoginSpace.body.success === true, 'Autofill whitespace tolerance verified');

  // 15. Clean up test student
  console.log('\nStep 15: Cleaning up test data from database...');
  const { db } = require('../server/database');
  db.prepare('DELETE FROM users WHERE id = ?').run(studentId);
  db.prepare('DELETE FROM billing WHERE user_id = ?').run(studentId);
  console.log('✅ Cleaned up test student.');

  console.log('\n================================================================');
  console.log('🎉 ALL 20 ASSERTIONS PASSED! STUDENT APPROVAL & SYNC 100% WORKING');
  console.log('================================================================');
})();
