const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcrypt");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");
const QRCode = require("qrcode");
const db = require("./database/db");

async function getCompanySettings() {
  const result = await db.query(
    "SELECT * FROM company_settings ORDER BY id ASC LIMIT 1"
  );

  return result.rows[0] || {
    company_name: "VLCG",
    company_address: "Main Road, Navipet, Telangana, 503245",
    company_phone: "6302084794",
    company_email: "harikpalem@gmail.com",
    office_start_time: "09:30",
    office_end_time: "18:00",
    logo_path: "public/images/logo.jpg",
  };
}

async function logActivity(req, action, details) {
  try {
    const user = req.session.user;

    if (!user) {
      return;
    }

    await db.query(
      `INSERT INTO activity_logs
       (user_id, username, role, action, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, user.username, user.role, action, details]
    );
  } catch (err) {
    console.log("Activity log error:", err.message);
  }
}

async function createAdminNotification(title, message) {
  try {
    await db.query(
      `INSERT INTO notifications
       (user_type, title, message)
       VALUES ('admin', $1, $2)`,
      [title, message]
    );
  } catch (err) {
    console.log("Admin notification error:", err.message);
  }
}

async function createAdminNotification(title, message) {
  try {
    await db.query(
      `INSERT INTO notifications
       (user_type, title, message)
       VALUES ('admin', $1, $2)`,
      [title, message]
    );
  } catch (err) {
    console.log("Admin notification error:", err.message);
  }
}

async function createEmployeeNotification(employeeId, title, message) {
  try {
    await db.query(
      `INSERT INTO notifications
       (user_type, employee_id, title, message)
       VALUES ('employee', $1, $2, $3)`,
      [employeeId, title, message]
    );
  } catch (err) {
    console.log("Employee notification error:", err.message);
  }
}

async function getAdminNotifications() {
  const result = await db.query(`
    SELECT *
    FROM notifications
    WHERE user_type = 'admin'
    ORDER BY created_at DESC
    LIMIT 10
  `);

  return result.rows;
}

async function getEmployeeNotifications(employeeId) {
  const result = await db.query(
    `
    SELECT *
    FROM notifications
    WHERE user_type = 'employee'
    AND employee_id = $1
    ORDER BY created_at DESC
    LIMIT 10
    `,
    [employeeId]
  );

  return result.rows;
}

async function createEmployeeNotification(employeeId, title, message) {
  try {
    await db.query(
      `INSERT INTO notifications
       (user_type, employee_id, title, message)
       VALUES ('employee', $1, $2, $3)`,
      [employeeId, title, message]
    );
  } catch (err) {
    console.log("Employee notification error:", err.message);
  }
}

async function getAdminNotifications() {
  const result = await db.query(`
    SELECT *
    FROM notifications
    WHERE user_type = 'admin'
    ORDER BY created_at DESC
    LIMIT 10
  `);

  return result.rows;
}

async function getEmployeeNotifications(employeeId) {
  const result = await db.query(
    `
    SELECT *
    FROM notifications
    WHERE user_type = 'employee'
    AND employee_id = $1
    ORDER BY created_at DESC
    LIMIT 10
    `,
    [employeeId]
  );

  return result.rows;
}
async function ensureLeaveBalance(employeeId, year) {
  const existing = await db.query(
    "SELECT * FROM leave_balances WHERE employee_id = $1 AND year = $2",
    [employeeId, year]
  );

  if (existing.rows.length === 0) {
    await db.query(
      `INSERT INTO leave_balances
       (employee_id, year, sick_total, casual_total, paid_total)
       VALUES ($1, $2, 6, 12, 12)`,
      [employeeId, year]
    );
  }
}

function calculateLeaveDays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const diffTime = end - start;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;

  return diffDays > 0 ? diffDays : 0;
}

async function getLeaveBalance(employeeId, year) {
  await ensureLeaveBalance(employeeId, year);

  const balanceResult = await db.query(
    "SELECT * FROM leave_balances WHERE employee_id = $1 AND year = $2",
    [employeeId, year]
  );

  const balance = balanceResult.rows[0];

  const usedResult = await db.query(
    `
    SELECT leave_type, start_date, end_date
    FROM leaves
    WHERE employee_id = $1
    AND status = 'Approved'
    AND EXTRACT(YEAR FROM start_date) = $2
    `,
    [employeeId, year]
  );

  let sickUsed = 0;
  let casualUsed = 0;
  let paidUsed = 0;

  usedResult.rows.forEach((leave) => {
    const days = calculateLeaveDays(leave.start_date, leave.end_date);

    if (leave.leave_type === "Sick Leave") sickUsed += days;
    if (leave.leave_type === "Casual Leave") casualUsed += days;
    if (leave.leave_type === "Paid Leave") paidUsed += days;
  });

  return {
    year,
    sickTotal: Number(balance.sick_total),
    casualTotal: Number(balance.casual_total),
    paidTotal: Number(balance.paid_total),

    sickUsed,
    casualUsed,
    paidUsed,

    sickRemaining: Number(balance.sick_total) - sickUsed,
    casualRemaining: Number(balance.casual_total) - casualUsed,
    paidRemaining: Number(balance.paid_total) - paidUsed,
  };
}

function n(value) {
  return Number(value || 0);
}

function getSalaryParts(employee) {
  const basicSalary = n(employee.basic_salary);
  const hra = n(employee.hra);
  const allowances = n(employee.allowances);
  const bonus = n(employee.bonus);

  const pfDeduction = n(employee.pf_deduction);
  const esiDeduction = n(employee.esi_deduction);
  const professionalTax = n(employee.professional_tax);
  const otherDeduction = n(employee.other_deduction);

  let grossSalary = basicSalary + hra + allowances + bonus;

  if (grossSalary <= 0) {
    grossSalary = n(employee.salary);
  }

  const fixedDeductions =
    pfDeduction + esiDeduction + professionalTax + otherDeduction;

  return {
    basicSalary,
    hra,
    allowances,
    bonus,
    grossSalary,
    pfDeduction,
    esiDeduction,
    professionalTax,
    otherDeduction,
    fixedDeductions,
  };
}

const app = express();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "employee-documents";
const SUPABASE_PHOTO_BUCKET =
  process.env.SUPABASE_PHOTO_BUCKET || "employee-photos";
const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});
const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }

    cb(null, true);
  }
});

async function uploadAttendanceProofPhoto(employeeId, file, type) {
  if (!file) {
    return null;
  }

  const fileExt = file.originalname.split(".").pop() || "jpg";
  const safeType = type === "check_out" ? "check-out" : "check-in";
  const storagePath = `attendance-proofs/${employeeId}/${safeType}-${Date.now()}.${fileExt}`;

  const { error } = await supabase.storage
    .from(SUPABASE_PHOTO_BUCKET)
    .upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (error) {
    throw new Error(error.message);
  }

  return storagePath;
}


app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(
  session({
    secret: "attendance_secret_key",
    resave: false,
    saveUninitialized: false,
  })
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

/* =========================
   LOGIN MIDDLEWARE
========================= */

function requireAdminLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/");
  }

  next();
}

function requireEmployeeLogin(req, res, next) {
  if (!req.session.employee) {
    return res.redirect("/employee/login");
  }

  next();
}

function requireRole(allowedRoles) {
  return function (req, res, next) {
    if (!req.session.user) {
      return res.redirect("/");
    }

    const userRole = req.session.user.role;

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).send(`
        <h2>Access Denied</h2>
        <p>You do not have permission to access this page.</p>
        <a href="/dashboard">Back to Dashboard</a>
      `);
    }

    next();
  };
}

const requireSuperAdmin = requireRole(["Super Admin"]);


const requireHRorSuperAdmin = requireRole([
  "Super Admin",
  "HR",
]);

const requireManagerHRorSuperAdmin = requireRole([
  "Super Admin",
  "HR",
  "Manager",
]);

/* =========================
   FORGOT PASSWORD REQUESTS
========================= */

app.get("/forgot-password", (req, res) => {
  res.render("forgot-password", {
    error: null,
    success: null,
  });
});

app.post("/forgot-password", async (req, res) => {
  const { username, email, message } = req.body;

  if (!username && !email) {
    return res.render("forgot-password", {
      error: "Please enter username or email.",
      success: null,
    });
  }

  await db.query(
    `INSERT INTO password_reset_requests
     (user_type, username, email, message)
     VALUES ('admin', $1, $2, $3)`,
    [username || "", email || "", message || ""]
  );

  await createAdminNotification(
    "Password Reset Request",
    `Admin/HR/Manager password reset requested for: ${username || email}`
  );

  res.render("forgot-password", {
    error: null,
    success:
      "Password reset request submitted. Please contact Super Admin to reset your password.",
  });
});

app.get("/employee/forgot-password", (req, res) => {
  res.render("employee-forgot-password", {
    error: null,
    success: null,
  });
});

app.post("/employee/forgot-password", async (req, res) => {
  const { username, email, message } = req.body;

  if (!username && !email) {
    return res.render("employee-forgot-password", {
      error: "Please enter username or email.",
      success: null,
    });
  }

  await db.query(
    `INSERT INTO password_reset_requests
     (user_type, username, email, message)
     VALUES ('employee', $1, $2, $3)`,
    [username || "", email || "", message || ""]
  );

  await createAdminNotification(
    "Employee Password Reset Request",
    `Employee password reset requested for: ${username || email}`
  );

  res.render("employee-forgot-password", {
    error: null,
    success:
      "Password reset request submitted. Please contact HR or Super Admin to reset your password.",
  });
});

app.get("/password-reset-requests", requireHRorSuperAdmin, async (req, res) => {
  const requests = await db.query(`
    SELECT *
    FROM password_reset_requests
    ORDER BY created_at DESC
  `);

  res.render("password-reset-requests", {
    requests: requests.rows,
  });
});

app.post("/password-reset-requests/mark-handled/:id", requireHRorSuperAdmin, async (req, res) => {
  await db.query(
    `
    UPDATE password_reset_requests
    SET status = 'Handled',
        handled_by = $1,
        handled_at = CURRENT_TIMESTAMP
    WHERE id = $2
    `,
    [req.session.user.username, req.params.id]
  );

  await logActivity(
    req,
    "Password Reset Request Handled",
    `Marked password reset request ID ${req.params.id} as handled`
  );

  res.redirect("/password-reset-requests");
});

/* =========================
   CHANGE PASSWORD
========================= */

app.get("/change-password", requireAdminLogin, (req, res) => {
  res.render("change-password", {
    error: null,
    success: null,
  });
});

app.post("/change-password", requireAdminLogin, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    return res.render("change-password", {
      error: "All fields are required.",
      success: null,
    });
  }

  if (new_password !== confirm_password) {
    return res.render("change-password", {
      error: "New password and confirm password do not match.",
      success: null,
    });
  }

  if (new_password.length < 6) {
    return res.render("change-password", {
      error: "New password must be at least 6 characters.",
      success: null,
    });
  }

  const userResult = await db.query(
    "SELECT * FROM users WHERE id = $1",
    [req.session.user.id]
  );

  const user = userResult.rows[0];

  if (!user) {
    return res.redirect("/");
  }

  const match = await bcrypt.compare(current_password, user.password);

  if (!match) {
    return res.render("change-password", {
      error: "Current password is incorrect.",
      success: null,
    });
  }

  const hashedPassword = await bcrypt.hash(new_password, 10);

  await db.query(
    "UPDATE users SET password = $1 WHERE id = $2",
    [hashedPassword, user.id]
  );

  await logActivity(
    req,
    "Password Changed",
    `Password changed for user: ${user.username}`
  );

  req.session.destroy(() => {
    res.render("change-password-success", {
      loginUrl: "/",
      userType: "Admin",
    });
  });
});

app.get("/employee/change-password", requireEmployeeLogin, (req, res) => {
  res.render("employee-change-password", {
    error: null,
    success: null,
  });
});

app.post("/employee/change-password", requireEmployeeLogin, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password || !confirm_password) {
    return res.render("employee-change-password", {
      error: "All fields are required.",
      success: null,
    });
  }

  if (new_password !== confirm_password) {
    return res.render("employee-change-password", {
      error: "New password and confirm password do not match.",
      success: null,
    });
  }

  if (new_password.length < 6) {
    return res.render("employee-change-password", {
      error: "New password must be at least 6 characters.",
      success: null,
    });
  }

  const employeeResult = await db.query(
    "SELECT * FROM employees WHERE id = $1",
    [req.session.employee.id]
  );

  const employee = employeeResult.rows[0];

  if (!employee) {
    return res.redirect("/employee/login");
  }

  const match = await bcrypt.compare(current_password, employee.password);

  if (!match) {
    return res.render("employee-change-password", {
      error: "Current password is incorrect.",
      success: null,
    });
  }

  const hashedPassword = await bcrypt.hash(new_password, 10);

  await db.query(
    "UPDATE employees SET password = $1 WHERE id = $2",
    [hashedPassword, employee.id]
  );

  await createEmployeeNotification(
    employee.id,
    "Password Changed",
    "Your employee portal password was changed successfully."
  );

  req.session.destroy(() => {
    res.render("change-password-success", {
      loginUrl: "/employee/login",
      userType: "Employee",
    });
  });
});

/* =========================
   ADMIN LOGIN
========================= */

app.get("/", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const result = await db.query(
    "SELECT * FROM users WHERE username = $1",
    [username]
  );

  if (result.rows.length === 0) {
    return res.render("login", {
      error: "Invalid username or password",
    });
  }

  const user = result.rows[0];
  const match = await bcrypt.compare(password, user.password);

  if (!match) {
    return res.render("login", {
      error: "Invalid username or password",
    });
  }

  req.session.user = user;
  res.redirect("/dashboard");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

/* =========================
   EMPLOYEE LOGIN
========================= */

app.get("/employee/login", (req, res) => {
  res.render("employee-login");
});

app.post("/employee/login", async (req, res) => {
  const { username, password } = req.body;

  const result = await db.query(
    "SELECT * FROM employees WHERE username = $1",
    [username]
  );

  if (result.rows.length === 0) {
    return res.render("employee-login", {
      error: "Invalid employee login",
    });
  }

  const employee = result.rows[0];

  if (!employee.password) {
    return res.render("employee-login", {
      error: "Employee account not activated",
    });
  }

  const match = await bcrypt.compare(password, employee.password);

  if (!match) {
    return res.render("employee-login", {
      error: "Invalid employee login",
    });
  }

  req.session.employee = employee;
  res.redirect("/employee/dashboard");
});

app.get("/employee/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/employee/login");
  });
});

/* =========================
   ADMIN DASHBOARD
========================= */

app.get("/dashboard", requireAdminLogin, async (req, res) => {
  const employees = await db.query("SELECT COUNT(*) FROM employees");

  const present = await db.query(
    "SELECT COUNT(*) FROM attendance WHERE date = CURRENT_DATE AND status = 'Present'"
  );

  const absent = await db.query(
    "SELECT COUNT(*) FROM attendance WHERE date = CURRENT_DATE AND status = 'Absent'"
  );

  const halfDay = await db.query(
    "SELECT COUNT(*) FROM attendance WHERE date = CURRENT_DATE AND status = 'Half Day'"
  );

  const leaveSummary = await db.query(`
    SELECT status, COUNT(*) AS count
    FROM leaves
    GROUP BY status
  `);

  const departmentSummary = await db.query(`
    SELECT COALESCE(NULLIF(department, ''), 'Not Assigned') AS department,
           COUNT(*) AS count
    FROM employees
    GROUP BY COALESCE(NULLIF(department, ''), 'Not Assigned')
    ORDER BY count DESC
  `);

  const notifications = await getAdminNotifications();

  let pendingLeaves = 0;
  let approvedLeaves = 0;
  let rejectedLeaves = 0;

  leaveSummary.rows.forEach((row) => {
    if (row.status === "Pending") pendingLeaves = Number(row.count);
    if (row.status === "Approved") approvedLeaves = Number(row.count);
    if (row.status === "Rejected") rejectedLeaves = Number(row.count);
  });

  res.render("dashboard", {
    totalEmployees: Number(employees.rows[0].count),
    presentToday: Number(present.rows[0].count),
    absentToday: Number(absent.rows[0].count),
    halfDayToday: Number(halfDay.rows[0].count),

    pendingLeaves,
    approvedLeaves,
    rejectedLeaves,

    departmentSummary: departmentSummary.rows,
    notifications,
  });
});

app.get("/employees/profile/:id", requireHRorSuperAdmin, async (req, res) => {
  const employeeResult = await db.query(
    "SELECT * FROM employees WHERE id = $1",
    [req.params.id]
  );

  const employee = employeeResult.rows[0];

  if (!employee) {
    return res.redirect("/employees");
  }

  const documentsResult = await db.query(
    "SELECT * FROM employee_documents WHERE employee_id = $1 ORDER BY uploaded_at DESC",
    [req.params.id]
  );

  let photoUrl = "/images/default-user.png";

  if (employee.photo_path) {
    try {
      const { data, error } = await supabase.storage
        .from(SUPABASE_PHOTO_BUCKET)
        .createSignedUrl(employee.photo_path, 300);

      if (!error && data && data.signedUrl) {
        photoUrl = data.signedUrl;
      }
    } catch (err) {
      console.log("Profile photo could not be loaded");
    }
  }

  res.render("employee-profile", {
    employee,
    documents: documentsResult.rows,
    photoUrl,
  });
});

/* =========================
   EMPLOYEE MANAGEMENT
========================= */

app.get("/employees", requireHRorSuperAdmin, async (req, res) => {
  const search = req.query.search || "";
  let result;

  if (search) {
    result = await db.query(
      "SELECT * FROM employees WHERE name ILIKE $1 ORDER BY id DESC",
      [`%${search}%`]
    );
  } else {
    result = await db.query("SELECT * FROM employees ORDER BY id DESC");
  }

  res.render("employees", {
    employees: result.rows,
    search,
  });
});

app.post("/employees/add", requireHRorSuperAdmin, async (req, res) => {
  const {
    name,
    department,
    salary,
    basic_salary,
    hra,
    allowances,
    bonus,
    pf_deduction,
    esi_deduction,
    professional_tax,
    other_deduction,
    phone,
    email,
    designation,
    joining_date,
    address,
    bank_name,
    account_holder_name,
    account_number,
    ifsc_code,
    upi_id,
    pan_number,
    aadhaar_number,
  } = req.body;

  const username = name.toLowerCase().replace(/\s+/g, "");
  const hashedPassword = await bcrypt.hash("employee123", 10);

  const canManageSensitiveDetails =
    req.session.user && req.session.user.role === "Super Admin";

  await db.query(
    `INSERT INTO employees
    (
      name,
      department,
      salary,
      basic_salary,
      hra,
      allowances,
      bonus,
      pf_deduction,
      esi_deduction,
      professional_tax,
      other_deduction,
      username,
      password,
      phone,
      email,
      designation,
      joining_date,
      address,
      bank_name,
      account_holder_name,
      account_number,
      ifsc_code,
      upi_id,
      pan_number,
      aadhaar_number
    )
    VALUES
    (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20,
      $21, $22, $23, $24, $25
    )`,
    [
      name,
      department,
      salary || 0,
      basic_salary || 0,
      hra || 0,
      allowances || 0,
      bonus || 0,
      pf_deduction || 0,
      esi_deduction || 0,
      professional_tax || 0,
      other_deduction || 0,
      username,
      hashedPassword,
      phone,
      email,
      designation,
      joining_date || null,
      address,

      canManageSensitiveDetails ? bank_name : null,
      canManageSensitiveDetails ? account_holder_name : null,
      canManageSensitiveDetails ? account_number : null,
      canManageSensitiveDetails ? ifsc_code : null,
      canManageSensitiveDetails ? upi_id : null,
      canManageSensitiveDetails ? pan_number : null,
      canManageSensitiveDetails ? aadhaar_number : null,
    ]
  );

  await logActivity(
    req,
    "Employee Added",
    `Added employee: ${name}`
  );

  await createAdminNotification(
    "Employee Added",
    `New employee added: ${name}`
  );

  res.redirect("/employees");
});

app.get("/employees/edit/:id", requireHRorSuperAdmin, async (req, res) => {
  const result = await db.query(
    "SELECT * FROM employees WHERE id = $1",
    [req.params.id]
  );

  const canManageSensitiveDetails =
    req.session.user && req.session.user.role === "Super Admin";

  res.render("edit-employee", {
    employee: result.rows[0],
    canManageSensitiveDetails,
  });
});

app.post("/employees/update/:id", requireHRorSuperAdmin, async (req, res) => {
  const {
    name,
    department,
    salary,
    basic_salary,
    hra,
    allowances,
    bonus,
    pf_deduction,
    esi_deduction,
    professional_tax,
    other_deduction,
    phone,
    email,
    designation,
    joining_date,
    address,
    bank_name,
    account_holder_name,
    account_number,
    ifsc_code,
    upi_id,
    pan_number,
    aadhaar_number,
  } = req.body;

  const canManageSensitiveDetails =
    req.session.user && req.session.user.role === "Super Admin";

  if (canManageSensitiveDetails) {
    await db.query(
      `UPDATE employees
       SET name = $1,
           department = $2,
           salary = $3,
           basic_salary = $4,
           hra = $5,
           allowances = $6,
           bonus = $7,
           pf_deduction = $8,
           esi_deduction = $9,
           professional_tax = $10,
           other_deduction = $11,
           phone = $12,
           email = $13,
           designation = $14,
           joining_date = $15,
           address = $16,
           bank_name = $17,
           account_holder_name = $18,
           account_number = $19,
           ifsc_code = $20,
           upi_id = $21,
           pan_number = $22,
           aadhaar_number = $23
       WHERE id = $24`,
      [
        name,
        department,
        salary || 0,
        basic_salary || 0,
        hra || 0,
        allowances || 0,
        bonus || 0,
        pf_deduction || 0,
        esi_deduction || 0,
        professional_tax || 0,
        other_deduction || 0,
        phone,
        email,
        designation,
        joining_date || null,
        address,
        bank_name,
        account_holder_name,
        account_number,
        ifsc_code,
        upi_id,
        pan_number,
        aadhaar_number,
        req.params.id,
      ]
    );
  } else {
    await db.query(
      `UPDATE employees
       SET name = $1,
           department = $2,
           salary = $3,
           basic_salary = $4,
           hra = $5,
           allowances = $6,
           bonus = $7,
           pf_deduction = $8,
           esi_deduction = $9,
           professional_tax = $10,
           other_deduction = $11,
           phone = $12,
           email = $13,
           designation = $14,
           joining_date = $15,
           address = $16
       WHERE id = $17`,
      [
        name,
        department,
        salary || 0,
        basic_salary || 0,
        hra || 0,
        allowances || 0,
        bonus || 0,
        pf_deduction || 0,
        esi_deduction || 0,
        professional_tax || 0,
        other_deduction || 0,
        phone,
        email,
        designation,
        joining_date || null,
        address,
        req.params.id,
      ]
    );
  }

  await logActivity(
    req,
    "Employee Updated",
    `Updated employee ID: ${req.params.id}`
  );

  await createAdminNotification(
    "Employee Updated",
    `Employee updated: ${name}`
  );

  res.redirect("/employees");
});

app.post("/employees/delete/:id", requireHRorSuperAdmin, async (req, res) => {
  await db.query("DELETE FROM employees WHERE id = $1", [req.params.id]);

  await logActivity(
    req,
    "Employee Deleted",
    `Deleted employee ID: ${req.params.id}`
  );

  res.redirect("/employees");
});

app.post("/employees/reset-login/:id", requireHRorSuperAdmin, async (req, res) => {
  const employeeResult = await db.query(
    "SELECT * FROM employees WHERE id = $1",
    [req.params.id]
  );

  const employee = employeeResult.rows[0];

  if (!employee) {
    return res.redirect("/employees");
  }

  const username = employee.name.toLowerCase().replace(/\s+/g, "");
  const hashedPassword = await bcrypt.hash("employee123", 10);

  await db.query(
    "UPDATE employees SET username = $1, password = $2 WHERE id = $3",
    [username, hashedPassword, req.params.id]
  );

  res.redirect("/employees");
});

/* =========================
   ADMIN ATTENDANCE
========================= */

app.get("/attendance", requireManagerHRorSuperAdmin, async (req, res) => {
  const filterDate = req.query.date || "";

  const employees = await db.query("SELECT * FROM employees ORDER BY name ASC");

  let records;

  if (filterDate) {
    records = await db.query(
      `SELECT attendance.*, employees.name
       FROM attendance
       JOIN employees ON attendance.employee_id = employees.id
       WHERE attendance.date = $1
       ORDER BY attendance.id DESC`,
      [filterDate]
    );
  } else {
    records = await db.query(
      `SELECT attendance.*, employees.name
       FROM attendance
       JOIN employees ON attendance.employee_id = employees.id
       ORDER BY attendance.id DESC`
    );
  }

  const settings = await getCompanySettings();

  res.render("attendance", {
    employees: employees.rows,
    records: records.rows,
    filterDate,
    settings,
  });
});

app.post("/attendance/add", requireManagerHRorSuperAdmin, async (req, res) => {
  const { employee_id, date, status } = req.body;

  try {
    await db.query(
      "INSERT INTO attendance (employee_id, date, status) VALUES ($1, $2, $3)",
      [employee_id, date, status]
    );
  } catch (err) {
    console.log(err.message);
  }

  res.redirect("/attendance");
});

app.get("/attendance/edit/:id", requireManagerHRorSuperAdmin, async (req, res) => {
  const attendance = await db.query(
    "SELECT * FROM attendance WHERE id = $1",
    [req.params.id]
  );

  const employees = await db.query("SELECT * FROM employees ORDER BY name ASC");

  res.render("edit-attendance", {
    attendance: attendance.rows[0],
    employees: employees.rows,
  });
});

app.post("/attendance/update/:id", requireManagerHRorSuperAdmin, async (req, res) => {
  const { employee_id, date, status } = req.body;

  try {
    await db.query(
      "UPDATE attendance SET employee_id = $1, date = $2, status = $3 WHERE id = $4",
      [employee_id, date, status, req.params.id]
    );
  } catch (err) {
    console.log(err.message);
  }

  res.redirect("/attendance");
});

app.post("/attendance/delete/:id", requireManagerHRorSuperAdmin, async (req, res) => {
  await db.query("DELETE FROM attendance WHERE id = $1", [req.params.id]);
  res.redirect("/attendance");
});

/* =========================
   ADMIN LEAVES
========================= */
app.get("/leaves/balances", requireManagerHRorSuperAdmin, async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();

  const employees = await db.query(
    "SELECT * FROM employees ORDER BY name ASC"
  );

  const balances = [];

  for (const employee of employees.rows) {
    const balance = await getLeaveBalance(employee.id, year);

    balances.push({
      employee,
      balance,
    });
  }

  res.render("leave-balances", {
    balances,
    year,
  });
});

app.get("/leaves", requireManagerHRorSuperAdmin, async (req, res) => {
  const employees = await db.query("SELECT * FROM employees ORDER BY name ASC");

  const leaves = await db.query(`
    SELECT leaves.*, employees.name
    FROM leaves
    JOIN employees ON leaves.employee_id = employees.id
    ORDER BY leaves.id DESC
  `);

  res.render("leaves", {
    employees: employees.rows,
    leaves: leaves.rows,
  });
});

app.post("/leaves/add", requireHRorSuperAdmin, async (req, res) => {
  const { employee_id, leave_type, start_date, end_date, reason } = req.body;

  const overlap = await db.query(
    `
    SELECT * FROM leaves
    WHERE employee_id = $1
    AND status != 'Rejected'
    AND start_date <= $3
    AND end_date >= $2
    `,
    [employee_id, start_date, end_date]
  );

  if (overlap.rows.length > 0) {
    return res.send(`
      <h2>Leave date overlap found</h2>
      <p>This employee already has leave during these dates.</p>
      <a href="/leaves">Back to Leaves</a>
    `);
  }

  await db.query(
    `INSERT INTO leaves
    (employee_id, leave_type, start_date, end_date, reason)
    VALUES ($1, $2, $3, $4, $5)`,
    [employee_id, leave_type, start_date, end_date, reason]
  );
await logActivity(
  req,
  "Leave Added",
  `Added leave for employee ID: ${employee_id}`
);
  res.redirect("/leaves");
});

app.post("/leaves/approve/:id", requireManagerHRorSuperAdmin, async (req, res) => {
  const leaveResult = await db.query(
    "SELECT * FROM leaves WHERE id = $1",
    [req.params.id]
  );

  const leave = leaveResult.rows[0];

  await db.query(
    "UPDATE leaves SET status = 'Approved' WHERE id = $1",
    [req.params.id]
  );

  await logActivity(
    req,
    "Leave Approved",
    `Approved leave ID: ${req.params.id}`
  );

  if (leave) {
    await createEmployeeNotification(
      leave.employee_id,
      "Leave Approved",
      `Your ${leave.leave_type} from ${new Date(leave.start_date).toLocaleDateString()} to ${new Date(leave.end_date).toLocaleDateString()} was approved.`
    );

    await createAdminNotification(
      "Leave Approved",
      `Leave ID ${req.params.id} was approved.`
    );
  }

  res.redirect("/leaves");
});

app.post("/leaves/reject/:id", requireManagerHRorSuperAdmin, async (req, res) => {
  const leaveResult = await db.query(
    "SELECT * FROM leaves WHERE id = $1",
    [req.params.id]
  );

  const leave = leaveResult.rows[0];

  await db.query(
    "UPDATE leaves SET status = 'Rejected' WHERE id = $1",
    [req.params.id]
  );

  await logActivity(
    req,
    "Leave Rejected",
    `Rejected leave ID: ${req.params.id}`
  );

  if (leave) {
    await createEmployeeNotification(
      leave.employee_id,
      "Leave Rejected",
      `Your ${leave.leave_type} from ${new Date(leave.start_date).toLocaleDateString()} to ${new Date(leave.end_date).toLocaleDateString()} was rejected.`
    );

    await createAdminNotification(
      "Leave Rejected",
      `Leave ID ${req.params.id} was rejected.`
    );
  }

  res.redirect("/leaves");
});

app.post("/leaves/reject/:id", requireManagerHRorSuperAdmin, async (req, res) => {
  const leaveResult = await db.query(
    "SELECT * FROM leaves WHERE id = $1",
    [req.params.id]
  );

  const leave = leaveResult.rows[0];

  await db.query(
    "UPDATE leaves SET status = 'Rejected' WHERE id = $1",
    [req.params.id]
  );

  await logActivity(
    req,
    "Leave Rejected",
    `Rejected leave ID: ${req.params.id}`
  );

  if (leave) {
    await createEmployeeNotification(
      leave.employee_id,
      "Leave Rejected",
      `Your ${leave.leave_type} from ${new Date(leave.start_date).toLocaleDateString()} to ${new Date(leave.end_date).toLocaleDateString()} was rejected.`
    );

    await createAdminNotification(
      "Leave Rejected",
      `Leave ID ${req.params.id} was rejected.`
    );
  }

  res.redirect("/leaves");
});

/* =========================
   ADMIN PAYROLL + HISTORY
========================= */

app.get("/payroll", requireSuperAdmin, async (req, res) => {
  const employees = await db.query("SELECT * FROM employees ORDER BY name ASC");

  const history = await db.query(`
    SELECT payroll_records.*, employees.name
    FROM payroll_records
    JOIN employees ON payroll_records.employee_id = employees.id
    ORDER BY payroll_records.created_at DESC
  `);

  res.render("payroll", {
    employees: employees.rows,
    payroll: null,
    history: history.rows,
  });
});

app.post("/payroll/calculate", requireSuperAdmin, async (req, res) => {
  const { employee_id, month } = req.body;

  const employeeResult = await db.query(
    "SELECT * FROM employees WHERE id = $1",
    [employee_id]
  );

  const employee = employeeResult.rows[0];

  if (!employee) {
    return res.redirect("/payroll");
  }

  const salaryParts = getSalaryParts(employee);

  const attendance = await db.query(
    `SELECT * FROM attendance
     WHERE employee_id = $1
     AND TO_CHAR(date, 'YYYY-MM') = $2`,
    [employee_id, month]
  );

  let present = 0;
  let absent = 0;
  let halfday = 0;

  attendance.rows.forEach((row) => {
    if (row.status === "Present") present++;
    if (row.status === "Absent") absent++;
    if (row.status === "Half Day") halfday++;
  });

  const dailySalary = salaryParts.grossSalary / 30;

  const attendanceDeduction =
    absent * dailySalary + (halfday * dailySalary) / 2;

  const deduction = attendanceDeduction + salaryParts.fixedDeductions;

  const finalSalary = salaryParts.grossSalary - deduction;

  const employees = await db.query("SELECT * FROM employees ORDER BY name ASC");

  const history = await db.query(`
    SELECT payroll_records.*, employees.name
    FROM payroll_records
    JOIN employees ON payroll_records.employee_id = employees.id
    ORDER BY payroll_records.created_at DESC
  `);

  res.render("payroll", {
    employees: employees.rows,
    history: history.rows,
    payroll: {
      employee,
      month,
      present,
      absent,
      halfday,

      basicSalary: salaryParts.basicSalary,
      hra: salaryParts.hra,
      allowances: salaryParts.allowances,
      bonus: salaryParts.bonus,
      grossSalary: salaryParts.grossSalary,

      attendanceDeduction,
      pfDeduction: salaryParts.pfDeduction,
      esiDeduction: salaryParts.esiDeduction,
      professionalTax: salaryParts.professionalTax,
      otherDeduction: salaryParts.otherDeduction,

      fixedDeductions: salaryParts.fixedDeductions,
      deduction,
      finalSalary,
    },
  });
});

app.post("/payroll/save", requireSuperAdmin, async (req, res) => {
  const {
    employee_id,
    month,
    base_salary,
    basic_salary,
    hra,
    allowances,
    bonus,
    pf_deduction,
    esi_deduction,
    professional_tax,
    other_deduction,
    present_days,
    absent_days,
    half_days,
    deduction,
    final_salary,
  } = req.body;

  await db.query(
    `INSERT INTO payroll_records
    (employee_id, month, base_salary, basic_salary, hra, allowances, bonus, pf_deduction, esi_deduction, professional_tax, other_deduction, present_days, absent_days, half_days, deduction, final_salary)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    ON CONFLICT (employee_id, month)
    DO UPDATE SET
      base_salary = EXCLUDED.base_salary,
      basic_salary = EXCLUDED.basic_salary,
      hra = EXCLUDED.hra,
      allowances = EXCLUDED.allowances,
      bonus = EXCLUDED.bonus,
      pf_deduction = EXCLUDED.pf_deduction,
      esi_deduction = EXCLUDED.esi_deduction,
      professional_tax = EXCLUDED.professional_tax,
      other_deduction = EXCLUDED.other_deduction,
      present_days = EXCLUDED.present_days,
      absent_days = EXCLUDED.absent_days,
      half_days = EXCLUDED.half_days,
      deduction = EXCLUDED.deduction,
      final_salary = EXCLUDED.final_salary,
      created_at = CURRENT_TIMESTAMP`,
    [
      employee_id,
      month,
      base_salary || 0,
      basic_salary || 0,
      hra || 0,
      allowances || 0,
      bonus || 0,
      pf_deduction || 0,
      esi_deduction || 0,
      professional_tax || 0,
      other_deduction || 0,
      present_days,
      absent_days,
      half_days,
      deduction,
      final_salary,
    ]
  );

  await logActivity(
    req,
    "Payroll Saved",
    `Saved payroll for employee ID: ${employee_id}, month: ${month}`
  );

  await createAdminNotification(
    "Payroll Saved",
    `Payroll saved for employee ID: ${employee_id}, month: ${month}`
  );

  await createEmployeeNotification(
    employee_id,
    "Payroll Generated",
    `Your payroll for ${month} has been generated.`
  );

  res.redirect("/payroll");
});

app.post("/payroll/payment/update/:id", requireSuperAdmin, async (req, res) => {
  try {
    const {
      payment_status,
      payment_date,
      payment_mode,
      payment_reference,
      payment_remarks,
    } = req.body;

    const payrollId = req.params.id;
    const status = payment_status === "Paid" ? "Paid" : "Pending";

    const payrollResult = await db.query(
      `
      SELECT payroll_records.*, employees.name, employees.id AS employee_id
      FROM payroll_records
      JOIN employees ON payroll_records.employee_id = employees.id
      WHERE payroll_records.id = $1
      `,
      [payrollId]
    );

    const payroll = payrollResult.rows[0];

    if (!payroll) {
      return res.redirect("/payroll");
    }

    const paidBy = status === "Paid" ? req.session.user.username : null;
    const paidAt = status === "Paid" ? new Date() : null;

    await db.query(
      `
      UPDATE payroll_records
      SET payment_status = $1,
          payment_date = $2,
          payment_mode = $3,
          payment_reference = $4,
          payment_remarks = $5,
          paid_by = $6,
          paid_at = $7
      WHERE id = $8
      `,
      [
        status,
        payment_date || null,
        payment_mode || "",
        payment_reference || "",
        payment_remarks || "",
        paidBy,
        paidAt,
        payrollId,
      ]
    );

    await logActivity(
      req,
      "Salary Payment Updated",
      `Updated salary payment for ${payroll.name}, month: ${payroll.month}, status: ${status}`
    );

    if (status === "Paid") {
      await createEmployeeNotification(
        payroll.employee_id,
        "Salary Payment Updated",
        `Your salary for ${payroll.month} has been marked as paid.`
      );
    }

    res.redirect("/payroll");
  } catch (error) {
    console.log("PAYMENT UPDATE ERROR:", error.message);

    res.status(500).send(`
      <h2>Payment update failed</h2>
      <p>${error.message}</p>
      <a href="/payroll">Back to Payroll</a>
    `);
  }
});

/* =========================
   EMPLOYEE DOCUMENTS
   Super Admin + HR only
========================= */

/* =========================
   PUBLIC EMPLOYEE VERIFICATION
========================= */

app.get("/employees/verify/:id", async (req, res) => {
  const employeeResult = await db.query(
    `SELECT id, name, department, designation, photo_path
     FROM employees
     WHERE id = $1`,
    [req.params.id]
  );

  const employee = employeeResult.rows[0];

  if (!employee) {
    return res.send(`
      <h2>Employee Not Found</h2>
      <p>This employee ID could not be verified.</p>
    `);
  }

  const settings = await getCompanySettings();

  let photoUrl = "/images/default-user.png";

  if (employee.photo_path) {
    try {
      const { data, error } = await supabase.storage
        .from(SUPABASE_PHOTO_BUCKET)
        .createSignedUrl(employee.photo_path, 300);

      if (!error && data && data.signedUrl) {
        photoUrl = data.signedUrl;
      }
    } catch (err) {
      console.log("Verification photo could not be loaded");
    }
  }

  res.render("employee-verify", {
    employee,
    settings,
    photoUrl,
  });
});
/* =========================
   EMPLOYEE ID CARD PDF
   Super Admin + HR only
========================= */

app.get("/employees/id-card/:id", requireHRorSuperAdmin, async (req, res) => {
  const employeeResult = await db.query(
    "SELECT * FROM employees WHERE id = $1",
    [req.params.id]
  );

  const employee = employeeResult.rows[0];

  if (!employee) {
    return res.redirect("/employees");
  }

  const settings = await getCompanySettings();

  const baseUrl =
    process.env.APP_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    "https://vlcghrms.in";

  const verifyUrl = `${baseUrl}/employees/verify/${employee.id}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
    margin: 1,
    width: 90,
  });

  const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, "");
  const qrBuffer = Buffer.from(qrBase64, "base64");

  const doc = new PDFDocument({
    size: [350, 540],
    margin: 0,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=id-card-${employee.name}.pdf`
  );

  doc.pipe(res);

  // Outer card border
  doc
    .rect(12, 12, 326, 516)
    .lineWidth(2)
    .stroke();

  // Inner border
  doc
    .rect(20, 20, 310, 500)
    .lineWidth(0.8)
    .stroke();

  // Header background
  doc
    .rect(20, 20, 310, 90)
    .fillAndStroke("#f2f2f2", "#000000");

  // Company logo
  try {
    const logoPath = path.join(__dirname, settings.logo_path);

    doc.image(logoPath, 32, 32, {
      width: 52,
      height: 52,
    });
  } catch (err) {
    console.log("ID card logo could not be loaded");
  }

  // Company name and address
  doc
    .fillColor("#000000")
    .font("Helvetica-Bold")
    .fontSize(17)
    .text(settings.company_name || "Company", 90, 34, {
      width: 220,
      align: "center",
    });

  doc
    .font("Helvetica")
    .fontSize(8)
    .text(settings.company_address || "", 90, 60, {
      width: 220,
      align: "center",
    });

  doc
    .fontSize(8)
    .text(`Phone: ${settings.company_phone || "-"}`, 90, 78, {
      width: 220,
      align: "center",
    });

  // Title strip
  doc
    .rect(20, 110, 310, 32)
    .fillAndStroke("#000000", "#000000");

  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(14)
    .text("EMPLOYEE ID CARD", 20, 120, {
      width: 310,
      align: "center",
    });

  // Photo frame
  doc
    .fillColor("#000000")
    .rect(108, 155, 134, 134)
    .lineWidth(1)
    .stroke();

  let photoLoaded = false;

  if (employee.photo_path) {
    try {
      const { data: signedPhoto, error } = await supabase.storage
        .from(SUPABASE_PHOTO_BUCKET)
        .createSignedUrl(employee.photo_path, 300);

      if (!error && signedPhoto && signedPhoto.signedUrl) {
        const photoResponse = await fetch(signedPhoto.signedUrl);
        const photoBuffer = Buffer.from(await photoResponse.arrayBuffer());

        doc.image(photoBuffer, 115, 162, {
          width: 120,
          height: 120,
        });

        photoLoaded = true;
      }
    } catch (err) {
      console.log("ID card photo could not be loaded");
    }
  }

  if (!photoLoaded) {
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor("#000000")
      .text("PHOTO", 115, 215, {
        width: 120,
        align: "center",
      });
  }

  // Employee name and designation
  doc
    .fillColor("#000000")
    .font("Helvetica-Bold")
    .fontSize(17)
    .text(employee.name || "-", 30, 300, {
      width: 290,
      align: "center",
    });

  doc
    .font("Helvetica")
    .fontSize(10)
    .text(employee.designation || "-", 30, 323, {
      width: 290,
      align: "center",
    });

  // Details box
  const detailsX = 35;
  const detailsY = 350;
  const detailsWidth = 190;
  const rowHeight = 22;

  doc
    .rect(detailsX, detailsY, detailsWidth, rowHeight * 4)
    .lineWidth(0.8)
    .stroke();

  for (let i = 1; i < 4; i++) {
    doc
      .moveTo(detailsX, detailsY + rowHeight * i)
      .lineTo(detailsX + detailsWidth, detailsY + rowHeight * i)
      .stroke();
  }

  doc
    .moveTo(detailsX + 75, detailsY)
    .lineTo(detailsX + 75, detailsY + rowHeight * 4)
    .stroke();

  function detailRow(index, label, value) {
    const y = detailsY + rowHeight * index + 6;

    doc
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .fillColor("#000000")
      .text(label, detailsX + 6, y, {
        width: 65,
      });

    doc
      .font("Helvetica")
      .fontSize(8.5)
      .text(value || "-", detailsX + 82, y, {
        width: 100,
      });
  }

  detailRow(0, "Emp ID", String(employee.id));
  detailRow(1, "Dept", employee.department || "-");
  detailRow(2, "Phone", employee.phone || "-");
  detailRow(3, "Email", employee.email || "-");

  // QR code
  doc.image(qrBuffer, 238, 350, {
    width: 72,
    height: 72,
  });

  doc
    .font("Helvetica-Bold")
    .fontSize(7)
    .text("SCAN TO VERIFY", 225, 426, {
      width: 100,
      align: "center",
    });

  // Signature
  doc
    .moveTo(110, 485)
    .lineTo(240, 485)
    .stroke();

  doc
    .font("Helvetica")
    .fontSize(8.5)
    .text("Authorized Signature", 110, 492, {
      width: 130,
      align: "center",
    });

  // Footer strip
  doc
    .rect(20, 510, 310, 10)
    .fill("#000000");

  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(7)
    .text("VALID EMPLOYEE CARD", 20, 512, {
      width: 310,
      align: "center",
    });

  doc.end();

  await logActivity(
    req,
    "Employee ID Card Downloaded",
    `Downloaded ID card for employee ID: ${employee.id}`
  );
});
/* =========================
   EMPLOYEE PHOTO
   Super Admin + HR only
========================= */

app.post(
  "/employees/photo/upload/:id",
  requireHRorSuperAdmin,
  (req, res, next) => {
    uploadPhoto.single("employee_photo")(req, res, (err) => {
      if (err) {
        console.log("PHOTO MULTER ERROR:", err.message);

        return res.status(400).send(`
          <h2>Photo upload failed</h2>
          <p>${err.message}</p>
          <a href="/employees">Back to Employees</a>
        `);
      }

      next();
    });
  },
  async (req, res) => {
    try {
      const employeeId = req.params.id;

      if (!req.file) {
        return res.redirect("/employees");
      }

      if (!req.file.buffer) {
        console.log("PHOTO UPLOAD ERROR: req.file.buffer missing");

        return res.status(500).send(`
          <h2>Photo upload failed</h2>
          <p>Upload buffer missing. Please check multer memoryStorage setup.</p>
          <a href="/employees">Back to Employees</a>
        `);
      }

      const employeeResult = await db.query(
        "SELECT * FROM employees WHERE id = $1",
        [employeeId]
      );

      const employee = employeeResult.rows[0];

      if (!employee) {
        return res.redirect("/employees");
      }

      if (employee.photo_path) {
        const { error: removeError } = await supabase.storage
          .from(SUPABASE_PHOTO_BUCKET)
          .remove([employee.photo_path]);

        if (removeError) {
          console.log("OLD PHOTO DELETE ERROR:", removeError.message);
        }
      }

      const fileExt = req.file.originalname.split(".").pop();
      const safeName = employee.name.replace(/[^a-zA-Z0-9]/g, "_");
      const storagePath = `${employeeId}/${Date.now()}-${safeName}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_PHOTO_BUCKET)
        .upload(storagePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false
        });

      if (uploadError) {
        console.log("PHOTO UPLOAD ERROR:", uploadError.message);

        return res.status(500).send(`
          <h2>Photo upload failed</h2>
          <p>${uploadError.message}</p>
          <a href="/employees">Back to Employees</a>
        `);
      }

      await db.query(
        "UPDATE employees SET photo_path = $1 WHERE id = $2",
        [storagePath, employeeId]
      );

      await logActivity(
        req,
        "Employee Photo Uploaded",
        `Uploaded photo for employee ID: ${employeeId}`
      );

      res.redirect("/employees");
    } catch (error) {
      console.log("PHOTO UPLOAD SERVER ERROR:", error);

      res.status(500).send(`
        <h2>Internal Server Error</h2>
        <p>${error.message}</p>
        <a href="/employees">Back to Employees</a>
      `);
    }
  }
);

app.get("/employees/photo/:id", requireAdminLogin, async (req, res) => {
  const result = await db.query(
    "SELECT photo_path FROM employees WHERE id = $1",
    [req.params.id]
  );

  const employee = result.rows[0];

  if (!employee || !employee.photo_path) {
    return res.redirect("/images/default-user.png");
  }

  const { data, error } = await supabase.storage
    .from(SUPABASE_PHOTO_BUCKET)
    .createSignedUrl(employee.photo_path, 60);

  if (error) {
    console.log("PHOTO SIGNED URL ERROR:", error.message);
    return res.redirect("/images/default-user.png");
  }

  res.redirect(data.signedUrl);
});

app.post("/employees/photo/delete/:id", requireHRorSuperAdmin, async (req, res) => {
  const result = await db.query(
    "SELECT photo_path FROM employees WHERE id = $1",
    [req.params.id]
  );

  const employee = result.rows[0];

  if (employee && employee.photo_path) {
    await supabase.storage
      .from(SUPABASE_PHOTO_BUCKET)
      .remove([employee.photo_path]);

    await db.query(
      "UPDATE employees SET photo_path = NULL WHERE id = $1",
      [req.params.id]
    );
  }

  res.redirect("/employees");
});

app.get("/employees/documents/:id", requireHRorSuperAdmin, async (req, res) => {
  const employeeResult = await db.query(
    "SELECT * FROM employees WHERE id = $1",
    [req.params.id]
  );

  const documents = await db.query(
    "SELECT * FROM employee_documents WHERE employee_id = $1 ORDER BY uploaded_at DESC",
    [req.params.id]
  );

  res.render("employee-documents", {
    employee: employeeResult.rows[0],
    documents: documents.rows,
  });
});

app.post(
  "/employees/documents/upload/:id",
  requireHRorSuperAdmin,
  uploadDocument.single("document_file"),
  async (req, res) => {
    const { document_type } = req.body;
    const employeeId = req.params.id;

    if (!req.file) {
      return res.redirect(`/employees/documents/${employeeId}`);
    }

    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const storagePath = `${employeeId}/${Date.now()}-${safeName}`;

    const { error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (error) {
      console.log("SUPABASE UPLOAD ERROR:", error.message);

      return res.send(`
        <h2>Document upload failed</h2>
        <p>${error.message}</p>
        <a href="/employees/documents/${employeeId}">Back to Documents</a>
      `);
    }

    await db.query(
      `INSERT INTO employee_documents
       (employee_id, document_type, file_name, file_path)
       VALUES ($1, $2, $3, $4)`,
      [employeeId, document_type, req.file.originalname, storagePath]
    );
await logActivity(
  req,
  "Employee Document Uploaded",
  `Uploaded ${document_type} document for employee ID: ${employeeId}`
);
    res.redirect(`/employees/documents/${employeeId}`);
  }
);

app.get("/employees/documents/open/:id", requireHRorSuperAdmin, async (req, res) => {
  const result = await db.query(
    "SELECT * FROM employee_documents WHERE id = $1",
    [req.params.id]
  );

  const document = result.rows[0];

  if (!document) {
    return res.redirect("/employees");
  }

  const { data, error } = await supabase.storage
    .from(SUPABASE_BUCKET)
    .createSignedUrl(document.file_path, 60);

  if (error) {
    console.log("SUPABASE SIGNED URL ERROR:", error.message);

    return res.send(`
      <h2>Could not open document</h2>
      <p>${error.message}</p>
      <a href="/employees/documents/${document.employee_id}">Back to Documents</a>
    `);
  }

  res.redirect(data.signedUrl);
});

app.post("/employees/documents/delete/:id", requireHRorSuperAdmin, async (req, res) => {
  const result = await db.query(
    "SELECT * FROM employee_documents WHERE id = $1",
    [req.params.id]
  );

  const document = result.rows[0];

  if (document) {
    const { error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .remove([document.file_path]);

    if (error) {
      console.log("SUPABASE DELETE ERROR:", error.message);
    }

    await db.query(
      "DELETE FROM employee_documents WHERE id = $1",
      [req.params.id]
    );

    return res.redirect(`/employees/documents/${document.employee_id}`);
  }

  res.redirect("/employees");
});

/* =========================
   COMPANY SETTINGS
========================= */

app.get("/company-settings", requireSuperAdmin, async (req, res) => {
  const settings = await getCompanySettings();

  res.render("company-settings", {
    settings,
  });
});

app.post("/company-settings/update", requireSuperAdmin, async (req, res) => {
  const {
    company_name,
    company_address,
    company_phone,
    company_email,
    office_start_time,
    office_end_time,
    logo_path,
  } = req.body;

  await db.query(
    `UPDATE company_settings
     SET company_name = $1,
         company_address = $2,
         company_phone = $3,
         company_email = $4,
         office_start_time = $5,
         office_end_time = $6,
         logo_path = $7
     WHERE id = (
       SELECT id FROM company_settings ORDER BY id ASC LIMIT 1
     )`,
    [
      company_name,
      company_address,
      company_phone,
      company_email,
      office_start_time,
      office_end_time,
      logo_path,
    ]
  );
await logActivity(
  req,
  "Company Settings Updated",
  "Updated company settings"
);
  res.redirect("/company-settings");
});
/* =========================
   ACTIVITY LOGS
   Super Admin only
========================= */

app.get("/activity-logs", requireSuperAdmin, async (req, res) => {
  const { username, role, action, date } = req.query;

  let query = `
    SELECT *
    FROM activity_logs
    WHERE 1 = 1
  `;

  const params = [];

  if (username && username.trim() !== "") {
    params.push(`%${username.trim()}%`);
    query += ` AND username ILIKE $${params.length}`;
  }

  if (role && role.trim() !== "") {
    params.push(role.trim());
    query += ` AND role = $${params.length}`;
  }

  if (action && action.trim() !== "") {
    params.push(`%${action.trim()}%`);
    query += ` AND action ILIKE $${params.length}`;
  }

  if (date && date.trim() !== "") {
    params.push(date.trim());
    query += ` AND DATE(created_at) = $${params.length}`;
  }

  query += `
    ORDER BY created_at DESC
    LIMIT 300
  `;

  const logs = await db.query(query, params);

  res.render("activity-logs", {
    logs: logs.rows,
    filters: {
      username: username || "",
      role: role || "",
      action: action || "",
      date: date || "",
    },
  });
});
app.get("/export/activity-logs", requireSuperAdmin, async (req, res) => {
  try {
    const { username, role, action, date } = req.query;

    let query = `
      SELECT id, username, role, action, details, created_at
      FROM activity_logs
      WHERE 1 = 1
    `;

    const params = [];

    if (username && username.trim() !== "") {
      params.push(`%${username.trim()}%`);
      query += ` AND username ILIKE $${params.length}`;
    }

    if (role && role.trim() !== "") {
      params.push(role.trim());
      query += ` AND role = $${params.length}`;
    }

    if (action && action.trim() !== "") {
      params.push(`%${action.trim()}%`);
      query += ` AND action ILIKE $${params.length}`;
    }

    if (date && date.trim() !== "") {
      params.push(date.trim());
      query += ` AND DATE(created_at) = $${params.length}`;
    }

    query += `
      ORDER BY created_at DESC
    `;

    const result = await db.query(query, params);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Activity Logs");

    sheet.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Username", key: "username", width: 20 },
      { header: "Role", key: "role", width: 20 },
      { header: "Action", key: "action", width: 30 },
      { header: "Details", key: "details", width: 50 },
      { header: "Date / Time", key: "created_at", width: 25 },
    ];

    result.rows.forEach((row) => {
      sheet.addRow({
        id: row.id || "",
        username: row.username || "-",
        role: row.role || "-",
        action: row.action || "-",
        details: row.details || "-",
        created_at: row.created_at
          ? new Date(row.created_at).toLocaleString("en-IN")
          : "",
      });
    });

    sheet.getRow(1).font = { bold: true };

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=activity-logs.xlsx"
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.log("ACTIVITY LOG EXPORT ERROR:", err.message);

    res.send(`
      <h2>Activity Log Export Failed</h2>
      <p>${err.message}</p>
      <a href="/activity-logs">Back to Activity Logs</a>
    `);
  }
});

/* =========================
   ADMIN USER MANAGEMENT
========================= */

app.get("/admin-users", requireSuperAdmin, async (req, res) => {
  const users = await db.query(
    "SELECT id, username, role FROM users ORDER BY id DESC"
  );

  res.render("admin-users", {
    users: users.rows,
  });
});

app.post("/admin-users/add", requireSuperAdmin, async (req, res) => {
  const { username, password, role } = req.body;

  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    await db.query(
      "INSERT INTO users (username, password, role) VALUES ($1, $2, $3)",
      [username, hashedPassword, role]
    );
  } catch (err) {
    console.log(err.message);
  }

  res.redirect("/admin-users");
});

app.post("/admin-users/delete/:id", requireSuperAdmin, async (req, res) => {
  await db.query(
    "DELETE FROM users WHERE id = $1 AND username != 'admin'",
    [req.params.id]
  );

  res.redirect("/admin-users");
});

app.post("/admin-users/reset-password/:id", requireSuperAdmin, async (req, res) => {
  const hashedPassword = await bcrypt.hash("admin123", 10);

  await db.query(
    "UPDATE users SET password = $1 WHERE id = $2",
    [hashedPassword, req.params.id]
  );

  res.redirect("/admin-users");
});

/* =========================
   NOTIFICATION READ / UNREAD
========================= */

app.post("/notifications/read/:id", requireAdminLogin, async (req, res) => {
  await db.query(
    "UPDATE notifications SET is_read = true WHERE id = $1",
    [req.params.id]
  );

  res.redirect(req.get("Referrer") || "/dashboard");
});

app.post("/notifications/unread/:id", requireAdminLogin, async (req, res) => {
  await db.query(
    "UPDATE notifications SET is_read = false WHERE id = $1",
    [req.params.id]
  );

  res.redirect(req.get("Referrer") || "/dashboard");
});

app.post("/notifications/read-all", requireAdminLogin, async (req, res) => {
  await db.query(
    "UPDATE notifications SET is_read = true WHERE user_type = 'admin'"
  );

  res.redirect(req.get("Referrer") || "/dashboard");
});

app.post("/employee/notifications/read/:id", requireEmployeeLogin, async (req, res) => {
  await db.query(
    `UPDATE notifications
     SET is_read = true
     WHERE id = $1
     AND user_type = 'employee'
     AND employee_id = $2`,
    [req.params.id, req.session.employee.id]
  );

  res.redirect(req.get("Referrer") || "/employee/dashboard");
});

app.post("/employee/notifications/unread/:id", requireEmployeeLogin, async (req, res) => {
  await db.query(
    `UPDATE notifications
     SET is_read = false
     WHERE id = $1
     AND user_type = 'employee'
     AND employee_id = $2`,
    [req.params.id, req.session.employee.id]
  );

  res.redirect(req.get("Referrer") || "/employee/dashboard");
});

app.post("/employee/notifications/read-all", requireEmployeeLogin, async (req, res) => {
  await db.query(
    `UPDATE notifications
     SET is_read = true
     WHERE user_type = 'employee'
     AND employee_id = $1`,
    [req.session.employee.id]
  );

  res.redirect(req.get("Referrer") || "/employee/dashboard");
});

app.get("/employee/notifications", requireEmployeeLogin, async (req, res) => {
  try {
    const employeeId = req.session.employee.id;

    const employeeResult = await db.query(
      "SELECT * FROM employees WHERE id = $1",
      [employeeId]
    );

    const employee = employeeResult.rows[0];

    if (!employee) {
      return res.redirect("/employee/login");
    }

    const notificationsResult = await db.query(
      `
      SELECT *
      FROM notifications
      WHERE user_type = 'employee'
      AND employee_id = $1
      ORDER BY created_at DESC
      LIMIT 100
      `,
      [employeeId]
    );

    const unreadResult = await db.query(
      `
      SELECT COUNT(*) AS count
      FROM notifications
      WHERE user_type = 'employee'
      AND employee_id = $1
      AND is_read = false
      `,
      [employeeId]
    );

    res.render("employee-notifications", {
      employee,
      notifications: notificationsResult.rows,
      unreadCount: Number(unreadResult.rows[0].count || 0),
    });
  } catch (error) {
    console.log("EMPLOYEE NOTIFICATIONS ERROR:", error.message);

    res.status(500).send(`
      <h2>Notifications Error</h2>
      <p>${error.message}</p>
      <a href="/employee/dashboard">Back to Dashboard</a>
    `);
  }
});
/* =========================
   ATTENDANCE REGULARIZATION
========================= */

app.get("/attendance/regularizations", requireManagerHRorSuperAdmin, async (req, res) => {
  const requests = await db.query(`
    SELECT attendance_regularizations.*, employees.name, employees.department
    FROM attendance_regularizations
    JOIN employees ON attendance_regularizations.employee_id = employees.id
    ORDER BY attendance_regularizations.created_at DESC
  `);

  res.render("attendance-regularizations", {
    requests: requests.rows,
  });
});

app.post("/attendance/regularizations/approve/:id", requireManagerHRorSuperAdmin, async (req, res) => {
  const { admin_remarks } = req.body;

  const requestResult = await db.query(
    `
    SELECT attendance_regularizations.*, employees.name
    FROM attendance_regularizations
    JOIN employees ON attendance_regularizations.employee_id = employees.id
    WHERE attendance_regularizations.id = $1
    `,
    [req.params.id]
  );

  const request = requestResult.rows[0];

  if (!request) {
    return res.redirect("/attendance/regularizations");
  }

  const attendanceDate = new Date(request.attendance_date)
    .toISOString()
    .split("T")[0];

  const checkInDateTime = request.requested_check_in
    ? `${attendanceDate} ${request.requested_check_in}`
    : null;

  const checkOutDateTime = request.requested_check_out
    ? `${attendanceDate} ${request.requested_check_out}`
    : null;

  const existingAttendance = await db.query(
    `
    SELECT *
    FROM attendance
    WHERE employee_id = $1
    AND date = $2
    `,
    [request.employee_id, attendanceDate]
  );

  if (existingAttendance.rows.length > 0) {
    await db.query(
      `
      UPDATE attendance
      SET status = $1,
          check_in = $2,
          check_out = $3
      WHERE employee_id = $4
      AND date = $5
      `,
      [
        request.requested_status || "Present",
        checkInDateTime,
        checkOutDateTime,
        request.employee_id,
        attendanceDate,
      ]
    );
  } else {
    await db.query(
      `
      INSERT INTO attendance
        (employee_id, date, status, check_in, check_out)
      VALUES
        ($1, $2, $3, $4, $5)
      `,
      [
        request.employee_id,
        attendanceDate,
        request.requested_status || "Present",
        checkInDateTime,
        checkOutDateTime,
      ]
    );
  }

  await db.query(
    `
    UPDATE attendance_regularizations
    SET status = 'Approved',
        admin_remarks = $1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    `,
    [admin_remarks || "", req.params.id]
  );

  await logActivity(
    req,
    "Attendance Regularization Approved",
    `Approved regularization request ID: ${req.params.id}`
  );

  await createEmployeeNotification(
    request.employee_id,
    "Attendance Regularization Approved",
    `Your attendance regularization request for ${new Date(request.attendance_date).toLocaleDateString()} was approved.`
  );

  await createAdminNotification(
    "Attendance Regularization Approved",
    `Regularization request ID ${req.params.id} was approved.`
  );

  res.redirect("/attendance/regularizations");
});

app.post("/attendance/regularizations/reject/:id", requireManagerHRorSuperAdmin, async (req, res) => {
  const { admin_remarks } = req.body;

  const requestResult = await db.query(
    "SELECT * FROM attendance_regularizations WHERE id = $1",
    [req.params.id]
  );

  const request = requestResult.rows[0];

  if (!request) {
    return res.redirect("/attendance/regularizations");
  }

  await db.query(
    `
    UPDATE attendance_regularizations
    SET status = 'Rejected',
        admin_remarks = $1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    `,
    [admin_remarks || "", req.params.id]
  );

  await logActivity(
    req,
    "Attendance Regularization Rejected",
    `Rejected regularization request ID: ${req.params.id}`
  );

  await createEmployeeNotification(
    request.employee_id,
    "Attendance Regularization Rejected",
    `Your attendance regularization request for ${new Date(request.attendance_date).toLocaleDateString()} was rejected.`
  );

  await createAdminNotification(
    "Attendance Regularization Rejected",
    `Regularization request ID ${req.params.id} was rejected.`
  );

  res.redirect("/attendance/regularizations");
});

app.get("/employee/regularizations", requireEmployeeLogin, async (req, res) => {
  const requests = await db.query(
    `
    SELECT *
    FROM attendance_regularizations
    WHERE employee_id = $1
    ORDER BY created_at DESC
    `,
    [req.session.employee.id]
  );

  res.render("employee-regularizations", {
    employee: req.session.employee,
    requests: requests.rows,
  });
});

app.post("/employee/regularizations/apply", requireEmployeeLogin, async (req, res) => {
  const {
    attendance_date,
    requested_status,
    requested_check_in,
    requested_check_out,
    reason,
  } = req.body;

  await db.query(
    `
    INSERT INTO attendance_regularizations
      (employee_id, attendance_date, requested_status, requested_check_in, requested_check_out, reason)
    VALUES
      ($1, $2, $3, $4, $5, $6)
    `,
    [
      req.session.employee.id,
      attendance_date,
      requested_status,
      requested_check_in || null,
      requested_check_out || null,
      reason,
    ]
  );

  await createAdminNotification(
    "Attendance Regularization Request",
    `${req.session.employee.name} requested attendance regularization for ${attendance_date}`
  );

  res.redirect("/employee/regularizations");
});
/* =========================
   EMPLOYEE PORTAL
========================= */

app.get("/employee/dashboard", requireEmployeeLogin, async (req, res) => {
  const attendance = await db.query(
    "SELECT * FROM attendance WHERE employee_id = $1 ORDER BY date DESC",
    [req.session.employee.id]
  );

  const leaves = await db.query(
    "SELECT * FROM leaves WHERE employee_id = $1 ORDER BY id DESC",
    [req.session.employee.id]
  );

  const settings = await getCompanySettings();

  const employeeResult = await db.query(
    "SELECT * FROM employees WHERE id = $1",
    [req.session.employee.id]
  );

  const employee = employeeResult.rows[0];

  let photoUrl = "/images/default-user.png";

  if (employee.photo_path) {
    const { data, error } = await supabase.storage
      .from(SUPABASE_PHOTO_BUCKET)
      .createSignedUrl(employee.photo_path, 300);

    if (!error) {
      photoUrl = data.signedUrl;
    }
  }

  const notifications = await getEmployeeNotifications(employee.id);

  res.render("employee-dashboard", {
    employee,
    attendance: attendance.rows,
    leaves: leaves.rows,
    settings,
    photoUrl,
    notifications,
  });
});

app.post(
  "/employee/check-in",
  requireEmployeeLogin,
  (req, res, next) => {
    uploadPhoto.single("proof_photo")(req, res, (err) => {
      if (err) {
        console.log("CHECK-IN PHOTO ERROR:", err.message);

        return res.status(400).send(`
          <h2>Check-in failed</h2>
          <p>${err.message}</p>
          <a href="/employee/dashboard">Back to Dashboard</a>
        `);
      }

      next();
    });
  },
  async (req, res) => {
    try {
      const employeeId = req.session.employee.id;
      const { latitude, longitude } = req.body;

      if (!latitude || !longitude) {
        return res.status(400).send(`
          <h2>Check-in failed</h2>
          <p>Location permission is required for check-in.</p>
          <a href="/employee/dashboard">Back to Dashboard</a>
        `);
      }

      if (!req.file) {
        return res.status(400).send(`
          <h2>Check-in failed</h2>
          <p>Photo proof is required for check-in.</p>
          <a href="/employee/dashboard">Back to Dashboard</a>
        `);
      }

      const proofPhotoPath = await uploadAttendanceProofPhoto(
        employeeId,
        req.file,
        "check_in"
      );

      await db.query(
        `
        INSERT INTO attendance
          (
            employee_id,
            date,
            status,
            check_in,
            check_in_latitude,
            check_in_longitude,
            check_in_photo_path
          )
        VALUES
          ($1, CURRENT_DATE, 'Present', NOW(), $2, $3, $4)
        ON CONFLICT (employee_id, date)
        DO UPDATE SET
  status = 'Present',
  check_in = NOW(),
  check_in_latitude = EXCLUDED.check_in_latitude,
  check_in_longitude = EXCLUDED.check_in_longitude,
  check_in_photo_path = EXCLUDED.check_in_photo_path
        `,
        [employeeId, latitude, longitude, proofPhotoPath]
      );

      await createAdminNotification(
        "Employee Checked In",
        `${req.session.employee.name} checked in with location/photo proof.`
      );

      res.redirect("/employee/dashboard");
    } catch (error) {
      console.log("CHECK-IN ERROR:", error.message);

      res.status(500).send(`
        <h2>Check-in failed</h2>
        <p>${error.message}</p>
        <a href="/employee/dashboard">Back to Dashboard</a>
      `);
    }
  }
);

app.post(
  "/employee/check-out",
  requireEmployeeLogin,
  (req, res, next) => {
    uploadPhoto.single("proof_photo")(req, res, (err) => {
      if (err) {
        console.log("CHECK-OUT PHOTO ERROR:", err.message);

        return res.status(400).send(`
          <h2>Check-out failed</h2>
          <p>${err.message}</p>
          <a href="/employee/dashboard">Back to Dashboard</a>
        `);
      }

      next();
    });
  },
  async (req, res) => {
    try {
      const employeeId = req.session.employee.id;
      const { latitude, longitude } = req.body;

      if (!latitude || !longitude) {
        return res.status(400).send(`
          <h2>Check-out failed</h2>
          <p>Location permission is required for check-out.</p>
          <a href="/employee/dashboard">Back to Dashboard</a>
        `);
      }

      if (!req.file) {
        return res.status(400).send(`
          <h2>Check-out failed</h2>
          <p>Photo proof is required for check-out.</p>
          <a href="/employee/dashboard">Back to Dashboard</a>
        `);
      }

      const proofPhotoPath = await uploadAttendanceProofPhoto(
        employeeId,
        req.file,
        "check_out"
      );

      await db.query(
        `
        UPDATE attendance
        SET check_out = NOW(),
            check_out_latitude = $2,
            check_out_longitude = $3,
            check_out_photo_path = $4
        WHERE employee_id = $1
AND date = CURRENT_DATE
AND check_in IS NOT NULL
        `,
        [employeeId, latitude, longitude, proofPhotoPath]
      );

      await createAdminNotification(
        "Employee Checked Out",
        `${req.session.employee.name} checked out with location/photo proof.`
      );

      res.redirect("/employee/dashboard");
    } catch (error) {
      console.log("CHECK-OUT ERROR:", error.message);

      res.status(500).send(`
        <h2>Check-out failed</h2>
        <p>${error.message}</p>
        <a href="/employee/dashboard">Back to Dashboard</a>
      `);
    }
  }
);

app.get("/employee/leaves", requireEmployeeLogin, async (req, res) => {
  const leaves = await db.query(
    "SELECT * FROM leaves WHERE employee_id = $1 ORDER BY id DESC",
    [req.session.employee.id]
  );

  const currentYear = new Date().getFullYear();
  const leaveBalance = await getLeaveBalance(
    req.session.employee.id,
    currentYear
  );

  res.render("employee-leaves", {
    employee: req.session.employee,
    leaves: leaves.rows,
    leaveBalance,
  });
});

app.post("/employee/leaves/apply", requireEmployeeLogin, async (req, res) => {
  const { leave_type, start_date, end_date, reason } = req.body;
  const employeeId = req.session.employee.id;

  const currentYear = new Date(start_date).getFullYear();
  const leaveBalance = await getLeaveBalance(employeeId, currentYear);
  const requestedDays = calculateLeaveDays(start_date, end_date);

  let remainingBalance = 0;

  if (leave_type === "Sick Leave") {
    remainingBalance = leaveBalance.sickRemaining;
  }

  if (leave_type === "Casual Leave") {
    remainingBalance = leaveBalance.casualRemaining;
  }

  if (leave_type === "Paid Leave") {
    remainingBalance = leaveBalance.paidRemaining;
  }

  if (requestedDays > remainingBalance) {
    return res.send(`
      <h2>Insufficient Leave Balance</h2>
      <p>You requested ${requestedDays} day(s) of ${leave_type}, but only ${remainingBalance} day(s) are remaining.</p>
      <a href="/employee/leaves">Back to Leaves</a>
    `);
  }

  const overlap = await db.query(
    `
    SELECT * FROM leaves
    WHERE employee_id = $1
    AND status != 'Rejected'
    AND start_date <= $3
    AND end_date >= $2
    `,
    [employeeId, start_date, end_date]
  );

  if (overlap.rows.length > 0) {
    return res.send(`
      <h2>Leave date overlap found</h2>
      <p>You already have a leave request during these dates.</p>
      <a href="/employee/leaves">Back to Leaves</a>
    `);
  }

  await db.query(
    `INSERT INTO leaves
    (employee_id, leave_type, start_date, end_date, reason)
    VALUES ($1, $2, $3, $4, $5)`,
    [employeeId, leave_type, start_date, end_date, reason]
  );

  await createAdminNotification(
    "New Leave Request",
    `${req.session.employee.name} requested ${leave_type} from ${start_date} to ${end_date}`
  );

  res.redirect("/employee/leaves");
});

app.get("/employee/payroll", requireEmployeeLogin, async (req, res) => {
  const records = await db.query(
    "SELECT * FROM payroll_records WHERE employee_id = $1 ORDER BY created_at DESC",
    [req.session.employee.id]
  );

 const employeeResult = await db.query(
  "SELECT * FROM employees WHERE id = $1",
  [req.session.employee.id]
);

const employee = employeeResult.rows[0];

let photoUrl = "/images/default-user.png";

if (employee.photo_path) {
  const { data, error } = await supabase.storage
    .from(SUPABASE_PHOTO_BUCKET)
    .createSignedUrl(employee.photo_path, 300);

  if (!error) {
    photoUrl = data.signedUrl;
  }
}

res.render("employee-payroll", {
  employee,
  payroll: null,
  records: records.rows,
  photoUrl,
});
});

app.post("/employee/payroll/calculate", requireEmployeeLogin, async (req, res) => {
  const { month } = req.body;
  const employee = req.session.employee;

  const attendance = await db.query(
    `SELECT * FROM attendance
     WHERE employee_id = $1
     AND TO_CHAR(date, 'YYYY-MM') = $2`,
    [employee.id, month]
  );

  let present = 0;
  let absent = 0;
  let halfday = 0;

  attendance.rows.forEach((row) => {
    if (row.status === "Present") present++;
    if (row.status === "Absent") absent++;
    if (row.status === "Half Day") halfday++;
  });

  const dailySalary = Number(employee.salary) / 30;
  const deduction = absent * dailySalary + (halfday * dailySalary) / 2;
  const finalSalary = Number(employee.salary) - deduction;

  const records = await db.query(
    "SELECT * FROM payroll_records WHERE employee_id = $1 ORDER BY created_at DESC",
    [employee.id]
  );

  let photoUrl = "/images/default-user.png";

if (employee.photo_path) {
  const { data, error } = await supabase.storage
    .from(SUPABASE_PHOTO_BUCKET)
    .createSignedUrl(employee.photo_path, 300);

  if (!error) {
    photoUrl = data.signedUrl;
  }
}

res.render("employee-payroll", {
  employee,
  records: records.rows,
  photoUrl,
  payroll: {
    month,
    present,
    absent,
    halfday,
    deduction,
    finalSalary,
  },
});
  
});

/* =========================
   PDF PAYSLIP + EMAIL
========================= */

function formatCurrency(value) {
  const amount = Number(value || 0);

  return `Rs. ${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function safePdfFileName(value) {
  return String(value || "payslip")
    .replace(/[^a-zA-Z0-9-_]/g, "_")
    .replace(/_+/g, "_");
}

function maskAccountNumber(accountNumber) {
  if (!accountNumber) {
    return "-";
  }

  const value = String(accountNumber).replace(/\s+/g, "");

  if (value.length <= 4) {
    return value;
  }

  return "XXXX XXXX " + value.slice(-4);
}

function cleanPdfText(value) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  return String(value);
}

async function drawPayslipPdf(doc, data) {
  const settings = await getCompanySettings();

  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const margin = 36;
  const contentWidth = pageWidth - margin * 2;

  const grossSalary = Number(data.grossSalary || data.salary || 0);
  const basicSalary = Number(data.basicSalary || data.basic_salary || 0);
  const hra = Number(data.hra || 0);
  const allowances = Number(data.allowances || 0);
  const bonus = Number(data.bonus || 0);

  const attendanceDeduction = Number(data.attendanceDeduction || 0);
  const pfDeduction = Number(data.pfDeduction || data.pf_deduction || 0);
  const esiDeduction = Number(data.esiDeduction || data.esi_deduction || 0);
  const professionalTax = Number(data.professionalTax || data.professional_tax || 0);
  const otherDeduction = Number(data.otherDeduction || data.other_deduction || 0);

  const totalDeduction = Number(
    data.deduction ||
      attendanceDeduction +
        pfDeduction +
        esiDeduction +
        professionalTax +
        otherDeduction ||
      0
  );

  const finalSalary = Number(data.finalSalary || data.final_salary || 0);

  const primaryColor = "#0f172a";
  const accentColor = "#2563eb";
  const lightBlue = "#eff6ff";
  const lightGray = "#f8fafc";
  const borderColor = "#d1d5db";
  const successColor = "#dcfce7";
  const dangerColor = "#fee2e2";

  function drawLabelValue(label, value, x, y, width) {
    doc
      .font("Helvetica-Bold")
      .fontSize(8.6)
      .fillColor("#6b7280")
      .text(label, x, y, { width });

    doc
      .font("Helvetica")
      .fontSize(9.2)
      .fillColor("#111827")
      .text(cleanPdfText(value), x, y + 12, { width });
  }

  function drawTable(x, y, width, title, rows, options = {}) {
    const rowHeight = 18;
    const titleHeight = 22;
    const labelWidth = width * 0.58;
    const tableHeight = titleHeight + rows.length * rowHeight;

    doc
      .roundedRect(x, y, width, tableHeight, 8)
      .fillAndStroke("#ffffff", borderColor);

    doc
      .roundedRect(x, y, width, titleHeight, 8)
      .fill(options.titleColor || lightBlue);

    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(options.titleTextColor || primaryColor)
      .text(title, x + 10, y + 6, { width: width - 20 }); 

    rows.forEach((row, index) => {
      const rowY = y + titleHeight + index * rowHeight;

      if (index % 2 === 1) {
        doc
          .rect(x, rowY, width, rowHeight)
          .fill(lightGray);
      }

      doc
        .moveTo(x, rowY)
        .lineTo(x + width, rowY)
        .strokeColor("#e5e7eb")
        .stroke();

      doc
        .font(row.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(8.8)
        .fillColor("#374151")
        .text(row.label, x + 10, rowY + 5, {
          width: labelWidth - 15,
        });

      doc
        .font(row.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(8.8)
        .fillColor(row.color || "#111827")
        .text(row.value, x + labelWidth, rowY + 5, {
          width: width - labelWidth - 10,
          align: "right",
        });
    });

    return tableHeight;
  }

  // Page border
  doc
    .roundedRect(margin - 8, 24, contentWidth + 16, pageHeight - 48, 12)
    .strokeColor(borderColor)
    .lineWidth(1)
    .stroke();

  // Header strip
  doc
    .roundedRect(margin, 34, contentWidth, 86, 10)
    .fill(primaryColor);

  try {
    const logoPath = path.join(__dirname, settings.logo_path);

    doc.image(logoPath, margin + 16, 48, {
      width: 52,
      height: 52,
    });
  } catch (err) {
    console.log("Payslip logo could not be loaded");
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor("#ffffff")
    .text(settings.company_name || "Company", margin + 80, 47, {
      width: contentWidth - 100,
      align: "left",
    });

  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor("#cbd5e1")
    .text(settings.company_address || "-", margin + 80, 72, {
      width: contentWidth - 100,
      align: "left",
    });

  doc
    .fontSize(8.5)
    .text(
      `Phone: ${settings.company_phone || "-"}   |   Email: ${settings.company_email || "-"}`,
      margin + 80,
      91,
      {
        width: contentWidth - 100,
        align: "left",
      }
    );

  // Payslip title row
  doc
    .roundedRect(margin, 132, contentWidth, 38, 8)
    .fillAndStroke(lightBlue, "#bfdbfe");

  doc
    .font("Helvetica-Bold")
    .fontSize(15)
    .fillColor(primaryColor)
    .text("SALARY PAYSLIP", margin + 14, 144, {
      width: contentWidth / 2,
    });

  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(accentColor)
    .text(`Month: ${cleanPdfText(data.month)}`, margin, 145, {
      width: contentWidth - 14,
      align: "right",
    });

  // Employee details card
  const empY = 186;
  const empCardHeight = 132;

  doc
    .roundedRect(margin, empY, contentWidth, empCardHeight, 10)
    .fillAndStroke("#ffffff", borderColor);

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(primaryColor)
    .text("Employee Details", margin + 14, empY + 13);

  drawLabelValue("Employee Name", data.employeeName, margin + 14, empY + 40, 155);
  drawLabelValue("Department", data.department, margin + 184, empY + 40, 120);
  drawLabelValue("Email", data.email, margin + 14, empY + 80, 205);
  drawLabelValue("Payroll Month", data.month, margin + 234, empY + 80, 100);

  // Employee photo
  let photoLoaded = false;

  if (data.photo_path) {
    try {
      const { data: signedPhoto, error } = await supabase.storage
        .from(SUPABASE_PHOTO_BUCKET)
        .createSignedUrl(data.photo_path, 300);

      if (!error && signedPhoto && signedPhoto.signedUrl) {
        const photoResponse = await fetch(signedPhoto.signedUrl);
        const photoBuffer = Buffer.from(await photoResponse.arrayBuffer());

        doc
          .roundedRect(pageWidth - margin - 92, empY + 24, 68, 68, 8)
          .strokeColor(borderColor)
          .stroke();

        doc.image(photoBuffer, pageWidth - margin - 88, empY + 28, {
          width: 60,
          height: 60,
        });

        photoLoaded = true;
      }
    } catch (err) {
      console.log("Payslip photo could not be loaded");
    }
  }

  if (!photoLoaded) {
    doc
      .roundedRect(pageWidth - margin - 92, empY + 24, 68, 68, 8)
      .fillAndStroke(lightGray, borderColor);

    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor("#6b7280")
      .text("PHOTO", pageWidth - margin - 92, empY + 53, {
        width: 68,
        align: "center",
      });
  }

  // Bank details card
  const bankY = 334;

  doc
    .roundedRect(margin, bankY, contentWidth, 82, 10)
    .fillAndStroke("#ffffff", borderColor);

  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(primaryColor)
    .text("Bank / Identity Details", margin + 14, bankY + 13);

  drawLabelValue(
    "Bank Name",
    data.bank_name,
    margin + 14,
    bankY + 40,
    120
  );

  drawLabelValue(
    "Account Holder",
    data.account_holder_name,
    margin + 148,
    bankY + 40,
    135
  );

  drawLabelValue(
    "Account Number",
    maskAccountNumber(data.account_number),
    margin + 298,
    bankY + 40,
    105
  );

  drawLabelValue(
    "IFSC / UPI / PAN",
    `${cleanPdfText(data.ifsc_code)} / ${cleanPdfText(data.upi_id)} / ${cleanPdfText(data.pan_number)}`,
    margin + 418,
    bankY + 40,
    92
  );

  // Summary cards
  const summaryY = 432;
  const summaryGap = 12;
  const summaryWidth = (contentWidth - summaryGap * 2) / 3;

  function drawSummaryCard(x, title, value, fillColor, textColor) {
    doc
      .roundedRect(x, summaryY, summaryWidth, 58, 10)
      .fillAndStroke(fillColor, borderColor);

    doc
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .fillColor("#374151")
      .text(title, x + 10, summaryY + 12, {
        width: summaryWidth - 20,
      });

    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .fillColor(textColor)
      .text(value, x + 10, summaryY + 31, {
        width: summaryWidth - 20,
      });
  }

  drawSummaryCard(
    margin,
    "Gross Salary",
    formatCurrency(grossSalary),
    lightBlue,
    accentColor
  );

  drawSummaryCard(
    margin + summaryWidth + summaryGap,
    "Total Deductions",
    formatCurrency(totalDeduction),
    dangerColor,
    "#991b1b"
  );

  drawSummaryCard(
    margin + (summaryWidth + summaryGap) * 2,
    "Net Salary",
    formatCurrency(finalSalary),
    successColor,
    "#166534"
  );

  // Earnings, attendance, deductions
  const tableTop = 500;
  const tableGap = 14;
  const halfWidth = (contentWidth - tableGap) / 2;

  drawTable(margin, tableTop, halfWidth, "Earnings", [
    { label: "Basic Salary", value: formatCurrency(basicSalary) },
    { label: "HRA", value: formatCurrency(hra) },
    { label: "Allowances", value: formatCurrency(allowances) },
    { label: "Bonus", value: formatCurrency(bonus) },
    {
      label: "Gross Salary",
      value: formatCurrency(grossSalary),
      bold: true,
      color: accentColor,
    },
  ]);

  drawTable(margin + halfWidth + tableGap, tableTop, halfWidth, "Attendance", [
    { label: "Present Days", value: cleanPdfText(data.present || 0) },
    { label: "Absent Days", value: cleanPdfText(data.absent || 0) },
    { label: "Half Days", value: cleanPdfText(data.halfday || 0) },
    {
      label: "Attendance Deduction",
      value: formatCurrency(attendanceDeduction),
      bold: true,
      color: "#991b1b",
    },
  ]);

  const deductionTableY = 628;

  drawTable(margin, deductionTableY, contentWidth, "Deductions", [
    { label: "PF Deduction", value: formatCurrency(pfDeduction) },
    { label: "ESI Deduction", value: formatCurrency(esiDeduction) },
    { label: "Professional Tax", value: formatCurrency(professionalTax) },
    { label: "Other Deduction", value: formatCurrency(otherDeduction) },
    {
      label: "Total Deductions",
      value: formatCurrency(totalDeduction),
      bold: true,
      color: "#991b1b",
    },
    {
      label: "Final Net Salary",
      value: formatCurrency(finalSalary),
      bold: true,
      color: "#166534",
    },
  ]);

  // Footer
const footerY = 790;

  doc
    .strokeColor(borderColor)
    .moveTo(margin, footerY - 18)
    .lineTo(pageWidth - margin, footerY - 18)
    .stroke();

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#6b7280")
    .text("This is a computer-generated payslip and does not require a physical signature.", margin, footerY - 8, {
      width: contentWidth,
      align: "center",
    });
}

app.post("/payroll/payslip", async (req, res) => {
  try {
    const data = req.body;

    const safeEmployeeName = safePdfFileName(data.employeeName || "employee");
    const safeMonth = safePdfFileName(data.month || "month");

    const doc = new PDFDocument({
      margin: 36,
      size: "A4",
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=payslip-${safeEmployeeName}-${safeMonth}.pdf`
    );

    doc.pipe(res);
    await drawPayslipPdf(doc, data);
    doc.end();
  } catch (error) {
    console.log("PAYSLIP PDF ERROR:", error);

    res.status(500).send(`
      <h2>Payslip generation failed</h2>
      <p>${error.message}</p>
      <a href="/payroll">Back to Payroll</a>
    `);
  }
});

app.post("/payroll/email-payslip", requireSuperAdmin, async (req, res) => {
  const data = req.body;

  if (!data.email) {
    return res.send(`
      <h2>Email missing</h2>
      <p>This employee does not have an email address saved.</p>
      <a href="/payroll">Back to Payroll</a>
    `);
  }

  try {
    const safeEmployeeName = safePdfFileName(data.employeeName || "employee");
    const safeMonth = safePdfFileName(data.month || "month");

    const pdfBuffer = await new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({
          margin: 36,
          size: "A4",
        });

        const chunks = [];

        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        await drawPayslipPdf(doc, data);
        doc.end();
      } catch (err) {
        reject(err);
      }
    });

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": process.env.BREVO_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          name: "VLCG HRMS",
          email: process.env.EMAIL_FROM || "harikpalem@gmail.com",
        },
        to: [
          {
            email: data.email,
            name: data.employeeName || "Employee",
          },
        ],
        subject: `Payslip - ${data.month || ""}`,
        textContent: `Dear ${data.employeeName || "Employee"},

Please find attached your payslip for ${data.month || ""}.

Regards,
VLCG HRMS`,
        attachment: [
          {
            name: `payslip-${safeEmployeeName}-${safeMonth}.pdf`,
            content: pdfBuffer.toString("base64"),
          },
        ],
      }),
    });

    const resultText = await response.text();

    if (!response.ok) {
      console.log("BREVO API ERROR:", resultText);

      return res.send(`
        <h2>Email sending failed</h2>
        <p>${resultText}</p>
        <a href="/payroll">Back to Payroll</a>
      `);
    }

    await logActivity(
      req,
      "Payslip Emailed",
      `Payslip emailed to ${data.employeeName || "employee"} for ${data.month || "-"}`
    );

    res.send(`
      <h2>Payslip emailed successfully</h2>
      <p>Payslip sent to ${data.email}</p>
      <a href="/payroll">Back to Payroll</a>
    `);
  } catch (err) {
    console.log("EMAIL API ERROR:", err);

    res.send(`
      <h2>Email payslip error</h2>
      <p>${err.message}</p>
      <a href="/payroll">Back to Payroll</a>
    `);
  }
});

/* =========================
   EXCEL EXPORTS
========================= */

async function exportQuery(res, filename, sheet, columns, query) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheet);

  worksheet.columns = columns;

  const result = await db.query(query);

  result.rows.forEach((row) => {
    worksheet.addRow(row);
  });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);

  await workbook.xlsx.write(res);
  res.end();
}

app.get("/export/employees", requireHRorSuperAdmin, async (req, res) => {
  await exportQuery(
    res,
    "employees.xlsx",
    "Employees",
    [
      { header: "ID", key: "id", width: 10 },
      { header: "Name", key: "name", width: 25 },
      { header: "Department", key: "department", width: 20 },
      { header: "Salary", key: "salary", width: 15 },
      { header: "Phone", key: "phone", width: 18 },
      { header: "Email", key: "email", width: 25 },
      { header: "Designation", key: "designation", width: 20 },
      { header: "Joining Date", key: "joining_date", width: 20 },
      { header: "Address", key: "address", width: 35 },
      { header: "Username", key: "username", width: 20 },
    ],
    `SELECT id, name, department, salary, phone, email, designation, joining_date, address, username
     FROM employees
     ORDER BY id DESC`
  );
});

app.get("/export/attendance", requireManagerHRorSuperAdmin, async (req, res) => {
  await exportQuery(
    res,
    "attendance.xlsx",
    "Attendance",
    [
      { header: "ID", key: "id", width: 10 },
      { header: "Employee", key: "name", width: 25 },
      { header: "Date", key: "date", width: 20 },
      { header: "Status", key: "status", width: 20 },
      { header: "Check In", key: "check_in", width: 25 },
      { header: "Check Out", key: "check_out", width: 25 },
    ],
    `SELECT attendance.id, employees.name, attendance.date, attendance.status,
            attendance.check_in, attendance.check_out
     FROM attendance
     JOIN employees ON attendance.employee_id = employees.id
     ORDER BY attendance.id DESC`
  );
});

app.get("/export/leaves", requireManagerHRorSuperAdmin, async (req, res) => {
  await exportQuery(
    res,
    "leaves.xlsx",
    "Leaves",
    [
      { header: "ID", key: "id", width: 10 },
      { header: "Employee", key: "name", width: 25 },
      { header: "Type", key: "leave_type", width: 20 },
      { header: "Start", key: "start_date", width: 15 },
      { header: "End", key: "end_date", width: 15 },
      { header: "Reason", key: "reason", width: 30 },
      { header: "Status", key: "status", width: 15 },
    ],
    `SELECT leaves.id, employees.name, leaves.leave_type, leaves.start_date,
            leaves.end_date, leaves.reason, leaves.status
     FROM leaves
     JOIN employees ON leaves.employee_id = employees.id
     ORDER BY leaves.id DESC`
  );
});

/* =========================
   DATABASE BACKUP EXPORT
========================= */

app.get("/export/backup", requireSuperAdmin, async (req, res) => {
  const workbook = new ExcelJS.Workbook();

  const employees = await db.query(`
    SELECT id, name, department, salary, phone, email, designation, joining_date, address, username
    FROM employees
    ORDER BY id DESC
  `);

  const attendance = await db.query(`
    SELECT attendance.id, employees.name, attendance.date, attendance.status,
           attendance.check_in, attendance.check_out
    FROM attendance
    JOIN employees ON attendance.employee_id = employees.id
    ORDER BY attendance.date DESC
  `);

  const leaves = await db.query(`
    SELECT leaves.id, employees.name, leaves.leave_type, leaves.start_date,
           leaves.end_date, leaves.reason, leaves.status
    FROM leaves
    JOIN employees ON leaves.employee_id = employees.id
    ORDER BY leaves.id DESC
  `);

  const payroll = await db.query(`
    SELECT payroll_records.id, employees.name, payroll_records.month,
           payroll_records.base_salary, payroll_records.present_days,
           payroll_records.absent_days, payroll_records.half_days,
           payroll_records.deduction, payroll_records.final_salary,
           payroll_records.created_at
    FROM payroll_records
    JOIN employees ON payroll_records.employee_id = employees.id
    ORDER BY payroll_records.created_at DESC
  `);

  const adminUsers = await db.query(`
    SELECT id, username, role
    FROM users
    ORDER BY id DESC
  `);

  function addSheet(sheetName, rows) {
    const sheet = workbook.addWorksheet(sheetName);

    if (rows.length === 0) {
      sheet.addRow(["No data"]);
      return;
    }

    const columns = Object.keys(rows[0]).map((key) => ({
      header: key,
      key,
      width: 22,
    }));

    sheet.columns = columns;
    rows.forEach((row) => sheet.addRow(row));
  }

  addSheet("Employees", employees.rows);
  addSheet("Attendance", attendance.rows);
  addSheet("Leaves", leaves.rows);
  addSheet("Payroll", payroll.rows);
  addSheet("Admin Users", adminUsers.rows);

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  res.setHeader("Content-Disposition", "attachment; filename=hrms-backup.xlsx");

  await workbook.xlsx.write(res);
  res.end();
});

/* =========================
   ATTENDANCE MONTHLY REPORT
========================= */

app.get("/attendance/monthly-report", requireManagerHRorSuperAdmin, async (req, res) => {
  res.render("attendance-report", {
    report: null,
    month: "",
  });
});

app.post("/attendance/monthly-report", requireManagerHRorSuperAdmin, async (req, res) => {
  const { month } = req.body;

  const report = await db.query(
    `
    SELECT employees.name,
           employees.department,
           attendance.date,
           attendance.status,
           attendance.check_in,
           attendance.check_out
    FROM attendance
    JOIN employees ON attendance.employee_id = employees.id
    WHERE TO_CHAR(attendance.date, 'YYYY-MM') = $1
    ORDER BY employees.name ASC, attendance.date ASC
    `,
    [month]
  );

  res.render("attendance-report", {
    report: report.rows,
    month,
  });
});

app.post("/export/attendance-monthly", requireManagerHRorSuperAdmin, async (req, res) => {
  const { month } = req.body;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Monthly Attendance");

  sheet.columns = [
    { header: "Employee", key: "name", width: 25 },
    { header: "Department", key: "department", width: 20 },
    { header: "Date", key: "date", width: 18 },
    { header: "Status", key: "status", width: 15 },
    { header: "Check In", key: "check_in", width: 25 },
    { header: "Check Out", key: "check_out", width: 25 },
    { header: "Working Hours", key: "working_hours", width: 18 },
  ];

  const result = await db.query(
    `
    SELECT employees.name,
           employees.department,
           attendance.date,
           attendance.status,
           attendance.check_in,
           attendance.check_out
    FROM attendance
    JOIN employees ON attendance.employee_id = employees.id
    WHERE TO_CHAR(attendance.date, 'YYYY-MM') = $1
    ORDER BY employees.name ASC, attendance.date ASC
    `,
    [month]
  );

  result.rows.forEach((row) => {
    let workingHours = "-";

    if (row.check_in && row.check_out) {
      const diffMs = new Date(row.check_out) - new Date(row.check_in);
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs / (1000 * 60)) % 60);
      workingHours = `${hours}h ${minutes}m`;
    }

    sheet.addRow({
      name: row.name,
      department: row.department,
      date: row.date,
      status: row.status,
      check_in: row.check_in,
      check_out: row.check_out,
      working_hours: workingHours,
    });
  });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  res.setHeader(
    "Content-Disposition",
    `attachment; filename=attendance-report-${month}.xlsx`
  );

  await workbook.xlsx.write(res);
  res.end();
});

/* =========================
   SERVER START
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
