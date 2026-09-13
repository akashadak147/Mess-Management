const http = require('http');

function request(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL('http://localhost:3000' + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING COMPREHENSIVE ADMIN CONTROL TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // Test 1: First Admin / Owner Authentication & Seed
    // -------------------------------------------------------------
    console.log('--- Test Group 1: Owner Authentication & Role Enforcement ---');
    const ownerLogin = await request('POST', '/api/auth/login', {
      email: 'akashadak162006@gmail.com',
      password: 'Akash@147'
    });
    assert(ownerLogin.status === 200, 'Owner Akash Adak login succeeds with 200');
    assert(ownerLogin.body.user.role === 'admin', 'Owner user role is admin');
    assert(ownerLogin.body.user.is_owner === 1, 'Owner user is_owner flag is 1');
    const ownerToken = ownerLogin.body.token;

    // Verify Assistant Manager (Bhabani Prasad Ghosh)
    const asstLogin = await request('POST', '/api/auth/login', {
      email: 'adakakash2006@gmail.com',
      password: '1@bpg1947'
    });
    assert(asstLogin.status === 200, 'Assistant Manager Bhabani Prasad Ghosh login succeeds with 200');
    assert(asstLogin.body.user.role === 'admin', 'Assistant Manager role is admin');
    assert(asstLogin.body.user.is_owner === 0, 'Assistant Manager is_owner is 0');

    // -------------------------------------------------------------
    // Test 2: Admin API Protection
    // -------------------------------------------------------------
    console.log('\n--- Test Group 2: API Protection & Role Elevation Prevention ---');
    const unauthReq = await request('GET', '/api/admin/users');
    assert(unauthReq.status === 401, 'Unauthenticated request to admin API blocked with 401');

    // Register a student attempting role elevation
    const fakeAdminReg = await request('POST', '/api/auth/register', {
      name: 'Sneaky User',
      email: `sneaky_${Date.now()}@mess.com`,
      password: 'user123',
      room_no: 'B-101',
      role: 'admin',
      is_owner: 1
    });
    assert(fakeAdminReg.status === 201, 'Student registration created');
    assert(fakeAdminReg.body.user.role === 'user', 'Privilege elevation blocked: student role remains user');

    // Admin approves student
    await request('POST', `/api/admin/users/${fakeAdminReg.body.user.id}/approve`, {}, ownerToken);

    // Login with approved student
    const studentLogin = await request('POST', '/api/auth/login', {
      email: fakeAdminReg.body.user.email,
      password: 'user123'
    });
    assert(studentLogin.status === 200, 'Approved student logged in');
    assert(studentLogin.body.user.role === 'user', 'Student role is confirmed as user');
    assert(!studentLogin.body.user.is_owner, 'Student is_owner is 0 or false');
    const studentToken = studentLogin.body.token;

    // Student attempts to hit admin API
    const studentAdminReq = await request('GET', '/api/admin/users', null, studentToken);
    assert(studentAdminReq.status === 403, 'Student token hitting admin route blocked with 403');

    // -------------------------------------------------------------
    // Test 3: Full Student Control (Add, Edit, Reset Pwd, Dossier, Soft Remove)
    // -------------------------------------------------------------
    console.log('\n--- Test Group 3: Full Student Control Operations ---');
    const newStudentEmail = `teststudent_${Date.now()}@mess.com`;
    const addStudentRes = await request('POST', '/api/admin/users', {
      name: 'Arindam Ghosh',
      email: newStudentEmail,
      room_no: 'A-204',
      phone: '9876543210',
      password: 'initialPassword123'
    }, ownerToken);
    assert(addStudentRes.status === 201, 'Admin can add new student');
    const studentId = addStudentRes.body.user.id;

    // Edit Student Details
    const editStudentRes = await request('PUT', `/api/admin/users/${studentId}`, {
      name: 'Arindam Ghosh (Updated)',
      email: newStudentEmail,
      room_no: 'A-205',
      phone: '9876543211',
      status: 'active'
    }, ownerToken);
    assert(editStudentRes.status === 200, 'Admin can edit student details');

    // View Complete Student Dossier
    const dossierRes = await request('GET', `/api/admin/users/${studentId}/details`, null, ownerToken);
    assert(dossierRes.status === 200, 'Admin can retrieve complete student dossier');
    assert(dossierRes.body.user.room_no === 'A-205', 'Dossier returns updated room number');
    assert(Array.isArray(dossierRes.body.payments), 'Dossier includes payments ledger array');
    assert(Array.isArray(dossierRes.body.meals), 'Dossier includes meals attendance history');

    // Reset Student Password
    const resetPwdRes = await request('POST', `/api/admin/users/${studentId}/reset-password`, {
      password: 'newSecretPassword456'
    }, ownerToken);
    assert(resetPwdRes.status === 200, 'Admin can reset student password');

    // Verify student can log in with new password
    const studentNewLogin = await request('POST', '/api/auth/login', {
      email: newStudentEmail,
      password: 'newSecretPassword456'
    });
    assert(studentNewLogin.status === 200, 'Student successfully logs in using new reset password');

    // Toggle Student Status (Deactivate / Activate)
    const toggleStatusRes = await request('POST', `/api/admin/users/${studentId}/toggle-status`, {}, ownerToken);
    assert(toggleStatusRes.status === 200, 'Admin can toggle student status');
    assert(toggleStatusRes.body.user.status === 'inactive', 'Student status became inactive');

    // Soft-Remove Student
    const removeRes = await request('POST', `/api/admin/users/${studentId}/remove`, {}, ownerToken);
    assert(removeRes.status === 200, 'Admin can soft-remove student from active roster');

    // Verify student records are preserved in DB
    const dossierAfterRemove = await request('GET', `/api/admin/users/${studentId}/details`, null, ownerToken);
    assert(dossierAfterRemove.status === 200, 'Soft-removed student dossier still exists');
    assert(dossierAfterRemove.body.user.status === 'inactive', 'Student status is preserved as inactive');

    // -------------------------------------------------------------
    // Test 4: Admin Management (Owner Permissions & Hierarchy)
    // -------------------------------------------------------------
    console.log('\n--- Test Group 4: Admin Management & Hierarchy Control ---');
    const secAdminEmail = `asst_manager_${Date.now()}@mess.com`;
    const createAdminRes = await request('POST', '/api/admin/admins', {
      name: 'Assistant Manager',
      email: secAdminEmail,
      phone: '9830000000',
      password: 'asstPassword123',
      permissions: 'billing'
    }, ownerToken);
    assert(createAdminRes.status === 201, 'Owner can create secondary admin');
    const secAdminId = createAdminRes.body.admin.id;

    // Login as secondary admin
    const secAdminLogin = await request('POST', '/api/auth/login', {
      email: secAdminEmail,
      password: 'asstPassword123'
    });
    assert(secAdminLogin.status === 200, 'Secondary admin can log in');
    assert(secAdminLogin.body.user.role === 'admin', 'Secondary admin role is admin');
    assert(secAdminLogin.body.user.is_owner === 0, 'Secondary admin is not owner');
    const secAdminToken = secAdminLogin.body.token;

    // Secondary admin attempts to create an admin -> Should be forbidden (Owner only)
    const secAdminCreateAttempt = await request('POST', '/api/admin/admins', {
      name: 'Rogue Admin',
      email: `rogue_${Date.now()}@mess.com`,
      password: 'password123'
    }, secAdminToken);
    assert(secAdminCreateAttempt.status === 403, 'Secondary admin forbidden from creating admins (403)');

    // Secondary admin attempts to deactivate the Owner -> Should be forbidden
    const secAdminDeactivateOwner = await request('POST', `/api/admin/admins/${ownerLogin.body.user.id}/toggle-status`, {}, secAdminToken);
    assert(secAdminDeactivateOwner.status === 403, 'Secondary admin forbidden from deactivating owner');

    // Owner deactivates secondary admin
    const deactivateSecAdmin = await request('POST', `/api/admin/admins/${secAdminId}/toggle-status`, {}, ownerToken);
    assert(deactivateSecAdmin.status === 200, 'Owner can deactivate secondary admin');
    assert(deactivateSecAdmin.body.admin.status === 'inactive', 'Secondary admin status set to inactive');

    // Deactivated secondary admin attempts to access admin API -> Must be blocked in real-time
    const blockedSecAdminReq = await request('GET', '/api/admin/users', null, secAdminToken);
    assert(blockedSecAdminReq.status === 403, 'Real-time check: Deactivated admin is blocked from admin routes (403)');

    // Owner reactivates secondary admin
    const reactivateSecAdmin = await request('POST', `/api/admin/admins/${secAdminId}/toggle-status`, {}, ownerToken);
    assert(reactivateSecAdmin.status === 200, 'Owner can reactivate secondary admin');

    // -------------------------------------------------------------
    // Test 5: Audit Log Verification
    // -------------------------------------------------------------
    console.log('\n--- Test Group 5: Audit Trail Verification ---');
    const auditRes = await request('GET', '/api/admin/audit-logs', null, ownerToken);
    assert(auditRes.status === 200, 'Can retrieve audit log trail');
    const actions = auditRes.body.logs.map(l => l.action);
    console.log('  Recorded Audit Actions:', actions.slice(0, 8).join(', '));
    assert(actions.includes('STUDENT_ADDED'), 'Audit trail logged STUDENT_ADDED');
    assert(actions.includes('STUDENT_EDITED'), 'Audit trail logged STUDENT_EDITED');
    assert(actions.includes('STUDENT_PASSWORD_RESET'), 'Audit trail logged STUDENT_PASSWORD_RESET');
    assert(actions.includes('STUDENT_DEACTIVATED'), 'Audit trail logged STUDENT_DEACTIVATED');
    assert(actions.includes('STUDENT_REMOVED'), 'Audit trail logged STUDENT_REMOVED');
    assert(actions.includes('ADMIN_CREATED'), 'Audit trail logged ADMIN_CREATED');
    assert(actions.includes('ADMIN_DEACTIVATED'), 'Audit trail logged ADMIN_DEACTIVATED');
    assert(actions.includes('ADMIN_ACTIVATED'), 'Audit trail logged ADMIN_ACTIVATED');

    console.log('\n====================================================');
    console.log(`📊 TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================\n');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Unexpected test error:', err);
    process.exit(1);
  }
}

runTests();
