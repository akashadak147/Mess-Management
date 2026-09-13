# 🍛 MessMate - Mess & Food Management Web Portal

A full-featured, production-ready SaaS mess management and student mobile portal built for hostels, PGs, and student messes.

---

## 🚀 Quick Start (Run Locally)

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher
- **NPM**: v9.0.0 or higher

### 2. Installation
Open a terminal inside the project directory:
```bash
npm install
```

### 3. Start the Application
```bash
npm start
```
The server will start at **http://localhost:3000**.

---

## 👑 Configured Administrator Accounts

| Tier | Name | Email Address | Password | Permissions |
| :--- | :--- | :--- | :--- | :--- |
| **👑 Website Owner** | **Akash Adak** | `akashadak162006@gmail.com` | `Akash@147` | Full Owner Control (`is_owner = 1`) |
| **🛡️ Assistant Manager** | **Bhabani Prasad Ghosh** | `adakakash2006@gmail.com` | `1@bpg1947` | Full Operational Manager |

> **Note**: Passwords are encrypted with `bcrypt`. Student registration roster is set to a clean slate (0 students).

---

## 📱 Core Features & Workflows

1. **Student Registration (No OTP Required)**:
   - Students click **Sign Up**, enter their Name, Email, Room/Bed, Mobile Number, and Password.
   - On submission, their account is saved in `pending` status.
   - The Mess Manager approves the student from **Pending Approvals** in the Admin Dashboard before they can log in.

2. **Forgot Password via Admin Request**:
   - Students click **Forgot Password?** on the login screen.
   - Enter their registered Email or Mobile number.
   - The request is submitted directly to the Mess Manager.
   - In the Manager Dashboard under **🔑 Password Resets**, the admin reviews the request, assigns a new password (or generates a random one), and provides it to the student.

3. **Kitchen Headcount & Attendance**:
   - Live breakfast and dinner headcount tracker.
   - Students can mark attendance or skip meals before cutoff times.
   - Default is set to **Eating** for all active students.

4. **Monthly Billing & UPI Payments**:
   - ₹700 monthly mess charge (due by 5th of each month).
   - ₹400 Rannar Masi (cook) charge (due by 7th of each month).
   - ₹1,100 combined payment option.
   - Direct UPI intent integration (GPay, PhonePe, Paytm, BHIM).
   - Screenshot upload with automated verification queue.

5. **Manager Controls & Security**:
   - Student roster management (add, edit, toggle status, view complete financial dossier, reset password).
   - Admin hierarchy (Website Owner can add secondary admins and configure permissions).
   - Comprehensive audit logging (`audit_logs`) tracking every administrative action.

---

## 🌐 Deployment Guide (Uploading Online)

### Option A: Render.com (Free & Recommended)
1. Push this folder to a GitHub repository (or upload via Git).
2. Go to [Render.com](https://render.com) and create a **Web Service**.
3. Connect your GitHub repository.
4. Set:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Click **Deploy**. Your mess management portal will be live with free HTTPS.

### Option B: Railway.app / Koyeb / Fly.io
1. Connect your repository.
2. Railway detects `npm start` automatically.
3. Add a persistent volume for `mess_management.db` and `/uploads` if deploying on ephemeral containers.

### Option C: Ubuntu / Linux VPS (DigitalOcean, AWS, Linode)
1. Upload this project folder to your server:
   ```bash
   scp -r "Mess Food Management" user@your_server_ip:/var/www/messmate
   ```
2. SSH into your server:
   ```bash
   cd /var/www/messmate
   npm install --production
   ```
3. Run with PM2 for 24/7 uptime:
   ```bash
   npm install -g pm2
   pm2 start server.js --name "messmate"
   pm2 save
   pm2 startup
   ```
4. (Optional) Point Nginx with an SSL certificate (Let's Encrypt / Certbot) to port `3000`.

---

## 🧪 Testing

Run all automated test suites:
```bash
# Admin Controls & Security Hierarchy Test (45 Tests)
node tests/test_admin_controls.js

# Password Reset Request Flow Test
node tests/test_password_reset_request.js
```
All tests are configured to verify 100% pass rates.
