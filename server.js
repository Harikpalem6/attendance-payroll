const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcrypt");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const db = require("./database/db");

const app = express();

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
    (name, department, salary, username, password, phone, email, designation, joining_date, address)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      name,
      department,
      salary,
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

  res.render("attendance", {
    employees: employees.rows,
    records: records.rows,
    filterDate,
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
   ADMIN LEAVES WITH OVERLAP PROTECTION
========================= */

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

  res.render("employee-dashboard", {
    employee: req.session.employee,
    attendance: attendance.rows,
    leaves: leaves.rows,
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

  res.render("employee-leaves", {
    employee: req.session.employee,
    leaves: leaves.rows,
  });
});

app.post("/employee/leaves/apply", requireEmployeeLogin, async (req, res) => {
  const { leave_type, start_date, end_date, reason } = req.body;
  const employeeId = req.session.employee.id;

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

  res.render("employee-payroll", {
    employee: req.session.employee,
    payroll: null,
    records: records.rows,
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

  res.render("employee-payroll", {
    employee,
    records: records.rows,
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
   PDF PAYSLIP
========================= */

app.post("/payroll/payslip", (req, res) => {
  const data = req.body;
  const doc = new PDFDocument({ margin: 50 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=payslip-${data.employeeName}.pdf`
  );

  doc.pipe(res);

  const logoPath = path.join(__dirname, "public", "images", "logo.jpg");
  try {
    doc.image(logoPath, 50, 40, {
      width: 80,
    });
  } catch (err) {
    console.log("Logo not found or could not be loaded");
  }

  doc
    .fontSize(22)
    .text("VLCG", 0, 45, { align: "center" });

  doc
    .fontSize(10)
    .text("Main Road, Navipet, Telangana, 503245", { align: "center" });

  doc
    .fontSize(10)
    .text("Phone: 6302084794 | Email: harikpalem@gmail.com", {
      align: "center",
    });

  doc.moveDown(2);

  doc
    .fontSize(18)
    .text("SALARY PAYSLIP", { align: "center", underline: true });

  doc.moveDown(2);

  doc.fontSize(12);

  doc.text(`Employee Name: ${data.employeeName}`);
  doc.text(`Department: ${data.department || "-"}`);
  doc.text(`Payroll Month: ${data.month}`);

  doc.moveDown();

  doc.text("Salary Details", { underline: true });

  doc.moveDown(0.5);

  doc.text(`Base Salary: Rs. ${data.salary}`);
  doc.text(`Present Days: ${data.present}`);
  doc.text(`Absent Days: ${data.absent}`);
  doc.text(`Half Days: ${data.halfday}`);
  doc.text(`Deductions: Rs. ${data.deduction}`);
  doc.text(`Final Salary: Rs. ${data.finalSalary}`);

  doc.moveDown(2);

  doc
    .fontSize(10)
    .text("This is a computer-generated payslip.", { align: "center" });

  doc.end();
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
   Super Admin only
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

  res.setHeader(
    "Content-Disposition",
    "attachment; filename=hrms-backup.xlsx"
  );

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