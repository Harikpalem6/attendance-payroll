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
    sickTotal: balance.sick_total,
    casualTotal: balance.casual_total,
    paidTotal: balance.paid_total,

    sickUsed,
    casualUsed,
    paidUsed,

    sickRemaining: balance.sick_total - sickUsed,
    casualRemaining: balance.casual_total - casualUsed,
    paidRemaining: balance.paid_total - paidUsed,
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
    fileSize: 2 * 1024 * 1024,
  },
  fileFilter: function (req, file, cb) {
    if (
      file.mimetype === "image/jpeg" ||
      file.mimetype === "image/png" ||
      file.mimetype === "image/webp"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG, PNG, and WEBP images are allowed"));
    }
  },
});


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

function requireSuperAdmin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/");
  }

  if (req.session.user.role !== "Super Admin") {
    return res.send("Access denied: Super Admin only");
  }

  next();
}

function requireHRorSuperAdmin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/");
  }

  if (
    req.session.user.role !== "Super Admin" &&
    req.session.user.role !== "HR"
  ) {
    return res.send("Access denied: HR or Super Admin only");
  }

  next();
}

function requireManagerHRorSuperAdmin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/");
  }

  if (
    req.session.user.role !== "Super Admin" &&
    req.session.user.role !== "HR" &&
    req.session.user.role !== "Manager"
  ) {
    return res.send("Access denied");
  }

  next();
}

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

  res.render("dashboard", {
    totalEmployees: employees.rows[0].count,
    presentToday: present.rows[0].count,
    absentToday: absent.rows[0].count,
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
} = req.body;

  const username = name.toLowerCase().replace(/\s+/g, "");
  const hashedPassword = await bcrypt.hash("employee123", 10);

  await db.query(
    `INSERT INTO employees
(name, department, salary, basic_salary, hra, allowances, bonus, pf_deduction, esi_deduction, professional_tax, other_deduction, username, password, phone, email, designation, joining_date, address)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
  [
  name,
  department,
  salary,
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
]
  );

  res.redirect("/employees");
});

app.get("/employees/edit/:id", requireHRorSuperAdmin, async (req, res) => {
  const result = await db.query(
    "SELECT * FROM employees WHERE id = $1",
    [req.params.id]
  );

  res.render("edit-employee", {
    employee: result.rows[0],
  });
});

app.post("/employees/update/:id", requireHRorSuperAdmin, async (req, res) => {
  const {
    name,
    department,
    salary,
    phone,
    email,
    designation,
    joining_date,
    address,
  } = req.body;

  await db.query(
    `UPDATE employees
     SET name = $1,
         department = $2,
         salary = $3,
         phone = $4,
         email = $5,
         designation = $6,
         joining_date = $7,
         address = $8
     WHERE id = $9`,
    [
      name,
      department,
      salary,
      phone,
      email,
      designation,
      joining_date || null,
      address,
      req.params.id,
    ]
  );

  res.redirect("/employees");
});

app.post("/employees/delete/:id", requireHRorSuperAdmin, async (req, res) => {
  await db.query("DELETE FROM employees WHERE id = $1", [req.params.id]);
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

  res.redirect("/leaves");
});

app.post("/leaves/approve/:id", requireManagerHRorSuperAdmin, async (req, res) => {
  await db.query(
    "UPDATE leaves SET status = 'Approved' WHERE id = $1",
    [req.params.id]
  );

  res.redirect("/leaves");
});

app.post("/leaves/reject/:id", requireManagerHRorSuperAdmin, async (req, res) => {
  await db.query(
    "UPDATE leaves SET status = 'Rejected' WHERE id = $1",
    [req.params.id]
  );

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

  const dailySalary = Number(employee.salary) / 30;
  const deduction = absent * dailySalary + (halfday * dailySalary) / 2;
  const finalSalary = Number(employee.salary) - deduction;

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
    present_days,
    absent_days,
    half_days,
    deduction,
    final_salary,
  } = req.body;

  await db.query(
    `INSERT INTO payroll_records
    (employee_id, month, base_salary, present_days, absent_days, half_days, deduction, final_salary)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (employee_id, month)
    DO UPDATE SET
      base_salary = EXCLUDED.base_salary,
      present_days = EXCLUDED.present_days,
      absent_days = EXCLUDED.absent_days,
      half_days = EXCLUDED.half_days,
      deduction = EXCLUDED.deduction,
      final_salary = EXCLUDED.final_salary,
      created_at = CURRENT_TIMESTAMP`,
    [
      employee_id,
      month,
      base_salary,
      present_days,
      absent_days,
      half_days,
      deduction,
      final_salary,
    ]
  );

  res.redirect("/payroll");
});
/* =========================
   EMPLOYEE DOCUMENTS
   Super Admin + HR only
========================= */

/* =========================
   EMPLOYEE PHOTO
   Super Admin + HR only
========================= */

app.post(
  "/employees/photo/upload/:id",
  requireHRorSuperAdmin,
  uploadPhoto.single("employee_photo"),
  async (req, res) => {
    const employeeId = req.params.id;

    if (!req.file) {
      return res.redirect("/employees");
    }

    const employeeResult = await db.query(
      "SELECT * FROM employees WHERE id = $1",
      [employeeId]
    );

    const employee = employeeResult.rows[0];

    if (!employee) {
      return res.redirect("/employees");
    }

    // Delete old photo from Supabase if exists
    if (employee.photo_path) {
      await supabase.storage
        .from(SUPABASE_PHOTO_BUCKET)
        .remove([employee.photo_path]);
    }

    const fileExt = req.file.originalname.split(".").pop();
    const safeName = employee.name.replace(/[^a-zA-Z0-9]/g, "_");
    const storagePath = `${employeeId}/${Date.now()}-${safeName}.${fileExt}`;

    const { error } = await supabase.storage
      .from(SUPABASE_PHOTO_BUCKET)
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (error) {
      console.log("PHOTO UPLOAD ERROR:", error.message);

      return res.send(`
        <h2>Photo upload failed</h2>
        <p>${error.message}</p>
        <a href="/employees">Back to Employees</a>
      `);
    }

    await db.query(
      "UPDATE employees SET photo_path = $1 WHERE id = $2",
      [storagePath, employeeId]
    );

    res.redirect("/employees");
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

  res.redirect("/company-settings");
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

res.render("employee-dashboard", {
  employee,
  attendance: attendance.rows,
  leaves: leaves.rows,
  settings,
  photoUrl,
});
});

app.post("/employee/check-in", requireEmployeeLogin, async (req, res) => {
  const employeeId = req.session.employee.id;

  try {
    await db.query(
      `
      INSERT INTO attendance (employee_id, date, status, check_in)
      VALUES ($1, CURRENT_DATE, 'Present', NOW())
      ON CONFLICT (employee_id, date)
      DO UPDATE SET
        status = 'Present',
        check_in = COALESCE(attendance.check_in, NOW())
      `,
      [employeeId]
    );
  } catch (err) {
    console.log(err.message);
  }

  res.redirect("/employee/dashboard");
});

app.post("/employee/check-out", requireEmployeeLogin, async (req, res) => {
  const employeeId = req.session.employee.id;

  try {
    await db.query(
      `
      UPDATE attendance
      SET check_out = NOW()
      WHERE employee_id = $1
      AND date = CURRENT_DATE
      AND check_in IS NOT NULL
      AND check_out IS NULL
      `,
      [employeeId]
    );
  } catch (err) {
    console.log(err.message);
  }

  res.redirect("/employee/dashboard");
});

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

async function drawPayslipPdf(doc, data) {
  const settings = await getCompanySettings();
  const logoPath = path.join(__dirname, settings.logo_path);

  const pageWidth = doc.page.width;
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;

  // Outer border
  doc
    .rect(margin, 30, contentWidth, 720)
    .lineWidth(1)
    .stroke();

  // Logo
  try {
    doc.image(logoPath, margin + 15, 45, {
      width: 75,
    });
  } catch (err) {
    console.log("Logo not found or could not be loaded");
  }

  // Company header
  doc
    .fontSize(22)
    .text(settings.company_name, margin, 45, {
      align: "center",
      width: contentWidth,
    });

  doc
    .fontSize(10)
    .text(settings.company_address, margin, 75, {
      align: "center",
      width: contentWidth,
    });

  doc
    .fontSize(10)
    .text(
      `Phone: ${settings.company_phone} | Email: ${settings.company_email}`,
      margin,
      92,
      {
        align: "center",
        width: contentWidth,
      }
    );

  // Header divider
  doc
    .moveTo(margin, 125)
    .lineTo(pageWidth - margin, 125)
    .stroke();

  // Payslip title box
  doc
    .rect(margin, 125, contentWidth, 38)
    .fillAndStroke("#f2f2f2", "#000000");

  doc
    .fillColor("#000000")
    .fontSize(16)
    .text("SALARY PAYSLIP", margin, 138, {
      align: "center",
      width: contentWidth,
    });

  // Employee details box
  const empBoxY = 185;
  doc
    .rect(margin + 20, empBoxY, contentWidth - 40, 95)
    .lineWidth(1)
    .stroke();

    

   doc.text("Employee Details", margin + 35, empBoxY + 12, {
    underline: true,
    });
      // Employee photo
  if (data.photo_path) {
    try {
      const { data: signedPhoto, error } = await supabase.storage
        .from(SUPABASE_PHOTO_BUCKET)
        .createSignedUrl(data.photo_path, 300);

      if (!error && signedPhoto && signedPhoto.signedUrl) {
        const photoResponse = await fetch(signedPhoto.signedUrl);
        const photoBuffer = Buffer.from(await photoResponse.arrayBuffer());

        doc.image(photoBuffer, 430, 190, {
          width: 70,
          height: 70,
        });
      }
    } catch (err) {
      console.log("Payslip photo could not be loaded");
    }
  }

  doc.fontSize(12);
  doc.text(`Employee Name: ${data.employeeName}`);
  doc.text(`Department: ${data.department || "-"}`);
  doc.text(`Payroll Month: ${data.month}`);

  // Salary table
  const tableX = margin + 20;
  const tableY = 315;
  const tableWidth = contentWidth - 40;
  const rowHeight = 32;
  const col1Width = tableWidth * 0.6;
  const col2Width = tableWidth * 0.4;

  doc
    .fontSize(14)
    .text("Salary Details", tableX, tableY - 30, {
      underline: true,
    });

  // Table border
  doc
    .rect(tableX, tableY, tableWidth, rowHeight * 7)
    .lineWidth(1)
    .stroke();

  // Header row
  doc
    .rect(tableX, tableY, tableWidth, rowHeight)
    .fillAndStroke("#f2f2f2", "#000000");

  doc.fillColor("#000000").fontSize(12);
  doc.text("Particulars", tableX + 12, tableY + 10);
  doc.text("Value", tableX + col1Width + 12, tableY + 10);

  // Vertical line
  doc
    .moveTo(tableX + col1Width, tableY)
    .lineTo(tableX + col1Width, tableY + rowHeight * 7)
    .stroke();

  const rows = [
    ["Base Salary", `Rs. ${data.salary}`],
    ["Present Days", data.present],
    ["Absent Days", data.absent],
    ["Half Days", data.halfday],
    ["Deductions", `Rs. ${data.deduction}`],
    ["Final Salary", `Rs. ${data.finalSalary}`],
  ];

  rows.forEach((row, index) => {
    const y = tableY + rowHeight * (index + 1);

    doc
      .moveTo(tableX, y)
      .lineTo(tableX + tableWidth, y)
      .stroke();

    if (row[0] === "Final Salary") {
      doc
        .rect(tableX, y, tableWidth, rowHeight)
        .fillAndStroke("#f7f7f7", "#000000")
        .fillColor("#000000")
        .font("Helvetica-Bold");
    } else {
      doc.font("Helvetica");
    }

    doc.text(row[0], tableX + 12, y + 10);
    doc.text(String(row[1]), tableX + col1Width + 12, y + 10);
  });

  doc.font("Helvetica");

  // Footer / signature section
  const footerY = 610;

  doc
    .moveTo(margin + 40, footerY)
    .lineTo(margin + 200, footerY)
    .stroke();

  doc
    .fontSize(10)
    .text("Employee Signature", margin + 65, footerY + 8);

  doc
    .moveTo(pageWidth - margin - 220, footerY)
    .lineTo(pageWidth - margin - 60, footerY)
    .stroke();

  doc
    .fontSize(10)
    .text("Authorized Signature", pageWidth - margin - 200, footerY + 8);

  doc
    .fontSize(9)
    .text("This is a computer-generated payslip.", margin, 710, {
      align: "center",
      width: contentWidth,
    });
}

app.post("/payroll/payslip", async (req, res) => {
  const data = req.body;
  const doc = new PDFDocument({ margin: 50 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=payslip-${data.employeeName}.pdf`
  );

  doc.pipe(res);
  await drawPayslipPdf(doc, data);
  doc.end();
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
    const pdfBuffer = await new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
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
            name: data.employeeName,
          },
        ],
        subject: `Payslip - ${data.month}`,
        textContent: `Dear ${data.employeeName},

Please find attached your payslip for ${data.month}.

Regards,
VLCG`,
        attachment: [
          {
            name: `payslip-${data.employeeName}-${data.month}.pdf`,
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
