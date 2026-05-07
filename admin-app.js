import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, collection, query, orderBy, onSnapshot,
  updateDoc, addDoc, serverTimestamp, getDocs, where, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ───────────────────────────────────────
   UTILITY
─────────────────────────────────────── */
function showToast(msg, type = "success") {
  let toast = document.getElementById("cs-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "cs-toast";
    toast.style.cssText = `position:fixed;bottom:28px;right:28px;z-index:9999;padding:14px 24px;
      border-radius:10px;font-family:var(--font);font-size:0.9rem;font-weight:500;
      box-shadow:0 8px 32px rgba(0,0,0,0.4);transition:all 0.3s ease;
      display:flex;align-items:center;gap:10px;min-width:260px;`;
    document.body.appendChild(toast);
  }
  const colors = {
    success: "background:#0d2a1f;border:1px solid #10b981;color:#10b981;",
    error: "background:#2a0d0d;border:1px solid #ef4444;color:#ef4444;",
    info: "background:#2a1f0d;border:1px solid #f59e0b;color:#f59e0b;"
  };
  toast.style.cssText += colors[type] || colors.info;
  toast.innerHTML = `<span></span> ${msg}`;
  toast.style.opacity = "1";
  setTimeout(() => { toast.style.opacity = "0"; }, 4000);
}

function setLoading(btn, loading, text) {
  btn.disabled = loading;
  btn.textContent = loading ? "Please wait…" : text;
  btn.style.opacity = loading ? "0.65" : "1";
}

function statusBadge(status) {
  const map = {
    "Pending": "badge-yellow", "Under Review": "badge-cyan",
    "Investigating": "badge-purple", "Resolved": "badge-green",
    "Closed": "badge-green", "Critical": "badge-red",
    "High": "badge-red", "Medium": "badge-yellow", "Low": "badge-cyan",
    "Active": "badge-green", "Suspended": "badge-red", "Pending Verify": "badge-yellow"
  };
  return `<span class="status-badge ${map[status] || 'badge-cyan'}">${status}</span>`;
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function timeAgo(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return formatDate(ts);
}

/* ───────────────────────────────────────
   AUTH STATE
─────────────────────────────────────── */
let currentUser = null;
let currentUserData = null;

onAuthStateChanged(auth, async (user) => {
  if (user) {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists() && snap.data().role === "admin") {
      currentUser = user;
      currentUserData = snap.data();
      const adminDisp = document.getElementById("admin-name-display");
      if (adminDisp) adminDisp.textContent = `Super Admin · ${currentUserData.firstName} ${currentUserData.lastName}`;
      document.getElementById("auth-view").style.display = "none";
      document.getElementById("dashboard-view").style.display = "block";
      window.scrollTo(0, 0);
      listenAllCases();
      listenAllUsers();
      listenAuditLogs();
      listenActivityFeed();
    } else {
      await signOut(auth);
      showToast("This portal is for administrators only.", "error");
    }
  } else {
    document.getElementById("auth-view").style.display = "block";
    document.getElementById("dashboard-view").style.display = "none";
    currentUser = null; currentUserData = null;
  }
});

/* ───────────────────────────────────────
   ADMIN LOGIN
─────────────────────────────────────── */
document.getElementById("admin-login-btn")?.addEventListener("click", async () => {
  const btn = document.getElementById("admin-login-btn");
  const origText = btn.textContent;
  setLoading(btn, true, origText);

  const adminId = document.querySelector("#admin-login-form input[type=text]").value.trim();
  const password = document.querySelector("#admin-login-form input[type=password]").value;

  try {
    await signInWithEmailAndPassword(auth, adminId, password);
  } catch (err) {
    const msg = err.code === "auth/invalid-credential" ? "Invalid admin credentials." : err.message;
    showToast(msg, "error");
    setLoading(btn, false, origText);
  }
});

/* ───────────────────────────────────────
   LOGOUT
─────────────────────────────────────── */
document.querySelectorAll("[data-logout]").forEach(btn => {
  btn.addEventListener("click", async () => {
    await signOut(auth);
    showToast("Logged out.", "info");
  });
});

/* ───────────────────────────────────────
   ALL CASES LISTENER
─────────────────────────────────────── */
let allCasesCache = [];
let allUsersCache = [];

function listenAllCases() {
  const q = query(collection(db, "cases"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    allCasesCache = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
    renderOverviewStats();
    renderAssignCasesTable();
  });
}

function renderOverviewStats() {
  const cases = allCasesCache;
  const elMap = {
    "stat-total-cases": cases.length,
    "stat-citizens": "—",
    "stat-resolution": cases.length
      ? `${Math.round((cases.filter(c => ["Resolved", "Closed"].includes(c.status)).length / cases.length) * 100)}%`
      : "0%"
  };
  Object.entries(elMap).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  });
}

/* ───────────────────────────────────────
   ASSIGN CASES TABLE
─────────────────────────────────────── */
function renderAssignCasesTable() {
  const tbody = document.getElementById("assign-cases-tbody");
  if (!tbody) return;

  const unassigned = allCasesCache.filter(c => !c.assignedOfficer || c.status === "Pending");
  const badge = document.getElementById("unassigned-badge");
  if (badge) badge.textContent = `${unassigned.length} Unassigned`;
  const alertBox = document.getElementById("unassigned-count-alert");
  if (alertBox) alertBox.textContent = `${unassigned.length} cases awaiting officer assignment`;

  if (unassigned.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:28px;">All cases are assigned.</td></tr>`;
    return;
  }

  tbody.innerHTML = unassigned.slice(0, 10).map(c => `
    <tr id="case-row-${c.docId}">
      <td style="font-family:var(--mono);">#${c.caseId}</td>
      <td>${c.crimeType}</td>
      <td>${statusBadge(c.priority || "Medium")}</td>
      <td>${formatDate(c.createdAt)}</td>
      <td>
        <select id="officer-select-${c.docId}" style="background:var(--bg-dark);border:1px solid var(--border);color:var(--text-primary);padding:6px 10px;border-radius:7px;font-family:var(--font);font-size:0.82rem;outline:none;">
          <option value="">Select Officer…</option>
          ${allUsersCache.filter(u => u.role === "officer").map(u =>
    `<option value="${u.uid}|${u.firstName} ${u.lastName}">${u.firstName} ${u.lastName}</option>`
  ).join("")}
        </select>
      </td>
      <td>
        <button class="btn btn-primary" style="font-size:0.78rem;padding:7px 14px;"
          onclick="assignCase('${c.docId}', '${c.caseId}', '${c.submittedBy}')">Set Case →</button>
      </td>
    </tr>`).join("");
}

window.assignCase = async function (caseDocId, caseId, victimUid) {
  const sel = document.getElementById(`officer-select-${caseDocId}`);
  if (!sel || !sel.value) { showToast("Please select an officer.", "error"); return; }
  const [officerUid, officerName] = sel.value.split("|");

  try {
    await updateDoc(doc(db, "cases", caseDocId), {
      assignedOfficer: officerUid,
      assignedOfficerName: officerName,
      status: "Under Review",
      updatedAt: serverTimestamp()
    });

    // Notify victim
    if (victimUid) {
      await addDoc(collection(db, "notifications", victimUid, "items"), {
        title: `Case #${caseId} – Assigned to Officer`,
        body: `Your case has been assigned to ${officerName} for investigation.`,
        type: "assigned",
        caseId: caseDocId,
        read: false,
        createdAt: serverTimestamp()
      });
    }

    // Audit
    await addDoc(collection(db, "auditLogs"), {
      userId: currentUser.uid,
      userName: "Admin",
      role: "admin", action: `Assigned to ${officerName}`,
      target: `#${caseId}`, createdAt: serverTimestamp()
    });

    showToast(`Case #${caseId} assigned to ${officerName}!`, "success");
  } catch (err) { showToast(err.message, "error"); }
};

/* ───────────────────────────────────────
   USERS LISTENER
─────────────────────────────────────── */
function listenAllUsers() {
  const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    allUsersCache = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    renderUsersTable(allUsersCache);
    updateActiveOfficersCount();
    updateCitizensCount();
    renderAssignCasesTable(); // re-render with fresh officers list
  });
}

function updateActiveOfficersCount() {
  const officers = allUsersCache.filter(u => u.role === "officer" && u.status !== "Suspended");
  const el = document.getElementById("stat-active-officers");
  if (el) el.textContent = officers.length;
}

function updateCitizensCount() {
  const citizens = allUsersCache.filter(u => u.role === "citizen");
  const el = document.getElementById("stat-citizens");
  if (el) el.textContent = citizens.length.toLocaleString();
}

function renderUsersTable(users) {
  const tbody = document.getElementById("users-tbody");
  if (!tbody) return;
  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:28px;">No users found.</td></tr>`;
    return;
  }
  tbody.innerHTML = users.map(u => `
    <tr>
      <td style="color:var(--text-primary);font-weight:600;">${u.firstName} ${u.lastName}</td>
      <td>${u.email}</td>
      <td>${statusBadge(u.role === "officer" ? "Officer" : u.role === "admin" ? "Admin" : "Citizen")}</td>
      <td>${statusBadge(u.status === "Suspended" ? "Suspended" : u.status === "Pending Verify" ? "Pending Verify" : "Active")}</td>
      <td style="font-family:var(--mono);font-size:0.8rem;">${formatDate(u.createdAt)}</td>
      <td style="display:flex;gap:6px;">
        ${u.status === "Suspended"
      ? `<button class="action-btn" onclick="setUserStatus('${u.uid}','Active')">Restore</button>`
      : `<button class="action-btn" style="color:#ef4444;border-color:rgba(239,68,68,0.25);" onclick="setUserStatus('${u.uid}','Suspended')">Suspend</button>`
    }
        ${u.role !== "admin" && u.role !== "officer"
      ? `<button class="action-btn" onclick="promoteToOfficer('${u.uid}','${u.firstName} ${u.lastName}')">→ Officer</button>`
      : ""
    }
      </td>
    </tr>`).join("");
}

window.setUserStatus = async function (uid, status) {
  try {
    await updateDoc(doc(db, "users", uid), { status });
    await addDoc(collection(db, "auditLogs"), {
      userId: currentUser.uid, userName: "Admin", role: "admin",
      action: `User ${status}`, target: uid, createdAt: serverTimestamp()
    });
    showToast(`User ${status.toLowerCase()} successfully.`, "success");
  } catch (err) { showToast(err.message, "error"); }
};

window.promoteToOfficer = async function (uid, name) {
  try {
    const dept = prompt(`Enter department for ${name}:`, "Cybercrime Division");
    if (!dept) return;
    await updateDoc(doc(db, "users", uid), { role: "officer", department: dept });
    await addDoc(collection(db, "auditLogs"), {
      userId: currentUser.uid, userName: "Admin", role: "admin",
      action: "Promoted to Officer", target: uid, createdAt: serverTimestamp()
    });
    showToast(`${name} promoted to Officer!`, "success");
  } catch (err) { showToast(err.message, "error"); }
};

/* ───────────────────────────────────────
   ADD OFFICER (from Add Role modal)
─────────────────────────────────────── */
document.getElementById("add-officer-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const firstName = document.getElementById("new-officer-fname").value.trim();
  const lastName = document.getElementById("new-officer-lname").value.trim();
  const email = document.getElementById("new-officer-email").value.trim();
  const password = document.getElementById("new-officer-pass").value;
  const department = document.getElementById("new-officer-dept").value.trim();
  const badgeId = document.getElementById("new-officer-badge").value.trim();

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "users", cred.user.uid), {
      firstName, lastName, email, department, badgeId,
      role: "officer", status: "Active", createdAt: serverTimestamp()
    });
    // Re-sign in as admin (Firebase auth switches to new user on creation)
    showToast(`Officer ${firstName} ${lastName} created!`, "success");
    closeModal("add-role-modal");
    e.target.reset();
    await addDoc(collection(db, "auditLogs"), {
      userId: currentUser?.uid || "admin", userName: "Admin", role: "admin",
      action: "Created Officer Account", target: email, createdAt: serverTimestamp()
    });
  } catch (err) { showToast(err.message, "error"); }
});

/* ───────────────────────────────────────
   AUDIT LOGS LISTENER
─────────────────────────────────────── */
function listenAuditLogs() {
  const q = query(collection(db, "auditLogs"));
  onSnapshot(q, (snap) => {
    const logs = snap.docs.map(d => d.data());
    logs.sort((a, b) => (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0) - (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0));
    renderAuditTable(logs);
  });
}

function renderAuditTable(logs) {
  const tbody = document.getElementById("audit-tbody");
  if (!tbody) return;
  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:28px;">No audit logs yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = logs.slice(0, 50).map(l => {
    const roleBadge = statusBadge(l.role === "admin" ? "Admin" : l.role === "officer" ? "Officer" : "Citizen");
    return `
    <tr>
      <td style="font-family:var(--mono);font-size:0.8rem;color:var(--text-muted);">${formatDate(l.createdAt)} ${l.createdAt?.toDate?.().toLocaleTimeString('en-US', { hour12: false }) || ""}</td>
      <td style="color:var(--text-primary);">${l.userName || "—"}</td>
      <td>${roleBadge}</td>
      <td>${l.action}</td>
      <td style="font-family:var(--mono);">${l.target || "—"}</td>
      <td style="font-family:var(--mono);font-size:0.78rem;color:var(--text-muted);">Internal</td>
    </tr>`;
  }).join("");
}

/* ───────────────────────────────────────
   LIVE ACTIVITY FEED
─────────────────────────────────────── */
function listenActivityFeed() {
  const q = query(collection(db, "auditLogs"));
  onSnapshot(q, (snap) => {
    const logs = snap.docs.map(d => d.data());
    logs.sort((a, b) => (b.createdAt?.toMillis ? b.createdAt.toMillis() : 0) - (a.createdAt?.toMillis ? a.createdAt.toMillis() : 0));
    renderActivityFeed(logs.slice(0, 8));
  });
}

function renderActivityFeed(logs) {
  const container = document.getElementById("activity-feed-container");
  if (!container) return;
  if (logs.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:24px;">No activity yet.</p>`;
    return;
  }
  const colors = { admin: "#f59e0b", officer: "#818cf8", citizen: "var(--cyan)" };
  container.innerHTML = logs.map(l => `
    <div class="activity-item">
      <div class="activity-dot" style="background:${colors[l.role] || 'var(--cyan)'};"></div>
      <div class="activity-text">
        <strong>${l.userName || "User"}</strong> — ${l.action}
        ${l.target ? `on <strong>${l.target}</strong>` : ""}
      </div>
      <span class="activity-time">${timeAgo(l.createdAt)}</span>
    </div>`).join("");
}



/* ───────────────────────────────────────
   USERS SEARCH FILTER
─────────────────────────────────────── */
document.getElementById("users-search")?.addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = allUsersCache.filter(u =>
    `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
    u.email?.toLowerCase().includes(q)
  );
  renderUsersTable(filtered);
});

document.getElementById("users-role-filter")?.addEventListener("change", (e) => {
  const role = e.target.value.toLowerCase();
  const filtered = role ? allUsersCache.filter(u => u.role === role) : allUsersCache;
  renderUsersTable(filtered);
});



/* ───────────────────────────────────────
   MONITOR STATS (simulated live update)
─────────────────────────────────────── */
function simulateMonitorStats() {
  setInterval(() => {
    const sessions = document.getElementById("monitor-sessions");
    if (sessions) sessions.textContent = Math.floor(200 + Math.random() * 100);
  }, 5000);
}
simulateMonitorStats();


