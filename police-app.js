import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, collection, query, where, orderBy,
  onSnapshot, updateDoc, addDoc, serverTimestamp, getDocs
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
    info: "background:#1a1040;border:1px solid #818cf8;color:#818cf8;"
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
    "Investigating": "badge-purple", "Additional Info Requested": "badge-yellow",
    "Evidence Collected": "badge-cyan", "Suspect Identified": "badge-purple",
    "Arrested": "badge-red", "Referred to Court": "badge-purple",
    "Resolved": "badge-green", "Closed": "badge-green"
  };
  return `<span class="status-badge ${map[status]||'badge-cyan'}">${status}</span>`;
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* ───────────────────────────────────────
   AUTH STATE
─────────────────────────────────────── */
let currentUser = null;
let currentUserData = null;
let unsubCases = null;
let allCasesCached = []; // For client-side filtering

onAuthStateChanged(auth, async (user) => {
  try {
    if (user) {
      console.log("Auth state change: User detected", user.uid);
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        const data = snap.data();
        console.log("User data role:", data.role);
        if (data.role === "officer") {
          currentUser = user;
          currentUserData = data;
          document.getElementById("auth-view").style.display = "none";
          document.getElementById("dashboard-view").style.display = "block";
          window.scrollTo(0, 0);
          populateDashboardUser();
          listenAllCases();
          listenMyAlerts();
        } else {
          console.warn("Access denied: Not an officer. Role is:", data.role);
          await signOut(auth);
          showToast(`Access Denied: This account has role "${data.role}". Police portal requires "officer" role.`, "error");
        }
      } else {
        console.warn("User document not found in Firestore.");
        await signOut(auth);
        showToast("Access Denied: Your user profile was not found. Please contact admin.", "error");
      }
    } else {
      console.log("Auth state change: No user");
      document.getElementById("auth-view").style.display = "block";
      document.getElementById("dashboard-view").style.display = "none";
      currentUser = null; currentUserData = null;
      if (unsubCases) unsubCases();
    }
  } catch (err) {
    console.error("Auth Listener Error:", err);
    showToast("Login error: " + err.message, "error");
  }
});

function populateDashboardUser() {
  const name = `${currentUserData.firstName} ${currentUserData.lastName}`;
  const el = document.getElementById("officer-name-display");
  if (el) el.textContent = `${currentUserData.department || "Cybercrime Division"} · ${name} · Badge #${currentUserData.badgeId || "N/A"}`;
}

/* ───────────────────────────────────────
   LOGIN
─────────────────────────────────────── */
document.getElementById("police-login-btn")?.addEventListener("click", async () => {
  const btn = document.getElementById("police-login-btn");
  const origText = btn.textContent;
  setLoading(btn, true, origText);

  const email = document.getElementById("badge-id").value.trim();
  const password = document.getElementById("police-pass").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    const msg = err.code === "auth/invalid-credential" ? "Invalid credentials." : err.message;
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
   LIVE CASES FEED
─────────────────────────────────────── */
function listenAllCases() {
  if (unsubCases) unsubCases();
  // Fetch without orderBy to avoid index requirements; sort in memory instead
  const q = query(collection(db, "cases"));
  unsubCases = onSnapshot(q, (snap) => {
    const cases = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
    
    // Sort by createdAt desc in memory
    cases.sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });

    allCasesCached = cases;
    
    renderOverviewStats(cases);
    renderOverviewTable(cases);
    renderAllCasesTable(cases);
    populateUpdateCaseSelect(cases);
    populateRequestInfoSelect(cases);
    updateSidebarCaseload(cases);
    populateEvidenceReviewSelect(cases);
  });
}

function renderOverviewStats(cases) {
  const total = cases.length;
  const active = cases.filter(c => ["Investigating","Under Review","Additional Info Requested","Evidence Collected"].includes(c.status)).length;
  const resolved = cases.filter(c => ["Resolved","Closed"].includes(c.status)).length;
  const pending = cases.filter(c => c.status === "Pending").length;

  const elMap = {
    "stat-total-cases": total, "stat-active": active,
    "stat-resolved": resolved, "stat-pending": pending
  };
  Object.entries(elMap).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  });
}

function updateSidebarCaseload(cases) {
  const mine = cases.filter(c => c.assignedOfficer === currentUser?.uid);
  const elMap = {
    "sidebar-assigned": mine.length,
    "sidebar-pending": mine.filter(c => c.status === "Pending" || c.status === "Under Review").length,
    "sidebar-resolved": mine.filter(c => ["Resolved","Closed"].includes(c.status)).length
  };
  Object.entries(elMap).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  });
}

function renderOverviewTable(cases) {
  const tbody = document.getElementById("overview-cases-tbody");
  if (!tbody) return;
  const mine = cases.filter(c => c.assignedOfficer === currentUser?.uid).slice(0, 5);
  if (mine.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:28px;">No cases assigned to you yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = mine.map(c => `
    <tr>
      <td style="font-family:var(--mono);color:#818cf8;">#${c.caseId}</td>
      <td>${c.crimeType}</td>
      <td>${c.submitterName || "—"}</td>
      <td>${statusBadge(c.priority || "Medium")}</td>
      <td>${statusBadge(c.status)}</td>
      <td><button class="action-btn" onclick="openCaseActionModal('${c.docId}')">Review</button></td>
    </tr>`).join("");
}

function renderAllCasesTable(cases) {
  const tbody = document.getElementById("all-cases-tbody");
  if (!tbody) return;
  if (cases.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:28px;">No cases found matching filters.</td></tr>`;
    return;
  }
  tbody.innerHTML = cases.map(c => `
    <tr>
      <td style="font-family:var(--mono);color:#818cf8;">#${c.caseId}</td>
      <td>${c.crimeType}</td>
      <td>${c.submitterName || "—"}</td>
      <td>${formatDate(c.createdAt)}</td>
      <td>${statusBadge(c.priority || "Medium")}</td>
      <td>${statusBadge(c.status)}</td>
      <td>${c.assignedOfficerName || "<span style='color:var(--text-muted)'>Unassigned</span>"}</td>
      <td><button class="action-btn" onclick="openCaseActionModal('${c.docId}')">Review</button></td>
    </tr>`).join("");
}

// FILTER LOGIC
document.getElementById("filter-apply-btn")?.addEventListener("click", () => {
  const search = document.getElementById("filter-search").value.toLowerCase().trim();
  const status = document.getElementById("filter-status").value;
  const type = document.getElementById("filter-type").value;
  const priority = document.getElementById("filter-priority").value;

  console.log("Applying filters:", { search, status, type, priority });

  const filtered = allCasesCached.filter(c => {
    // Search match
    const sMatch = !search || 
      c.caseId.toLowerCase().includes(search) || 
      (c.submitterName && c.submitterName.toLowerCase().includes(search)) ||
      c.crimeType.toLowerCase().includes(search);

    // Status match
    const stMatch = !status || c.status === status;

    // Type match
    const tMatch = !type || c.crimeType === type;

    // Priority match
    const pMatch = !priority || (c.priority || "Medium") === priority;

    return sMatch && stMatch && tMatch && pMatch;
  });

  renderAllCasesTable(filtered);
});

/* ───────────────────────────────────────
   CASE ACTION MODAL
─────────────────────────────────────── */
let activeCaseDocId = null;

window.openCaseActionModal = async function(docId) {
  activeCaseDocId = docId;
  const snap = await getDoc(doc(db, "cases", docId));
  if (!snap.exists()) return;
  const c = snap.data();

  const title = document.getElementById("case-action-modal-title");
  if (title) title.textContent = `Case #${c.caseId} – Quick Actions`;
  openModal("case-action-modal");
};

window.goToReviewEvidence = function() {
  if (!activeCaseDocId) return;
  closeModal("case-action-modal");
  switchPanel("panel-evidence-review");
  const sel = document.getElementById("evidence-review-case-select");
  if (sel) {
    sel.value = activeCaseDocId;
    sel.dispatchEvent(new Event("change"));
  }
};

// "Assign to Me" button
document.getElementById("assign-to-me-btn")?.addEventListener("click", async () => {
  if (!activeCaseDocId || !currentUser) return;
  try {
    await updateDoc(doc(db, "cases", activeCaseDocId), {
      assignedOfficer: currentUser.uid,
      assignedOfficerName: `${currentUserData.firstName} ${currentUserData.lastName}`,
      status: "Under Review",
      updatedAt: serverTimestamp()
    });
    await addDoc(collection(db, "auditLogs"), {
      userId: currentUser.uid,
      userName: `${currentUserData.firstName} ${currentUserData.lastName}`,
      role: "officer", action: "Self-Assigned Case",
      target: activeCaseDocId, createdAt: serverTimestamp()
    });
    showToast("Case assigned to you!", "success");
    closeModal("case-action-modal");
  } catch (err) { showToast(err.message, "error"); }
});

/* ───────────────────────────────────────
   UPDATE CASE STATUS
─────────────────────────────────────── */
function populateUpdateCaseSelect(cases) {
  const sel = document.getElementById("update-case-select");
  if (!sel) return;
  const mine = cases.filter(c => c.assignedOfficer === currentUser?.uid);
  sel.innerHTML = mine.length === 0
    ? `<option value="">No cases assigned to you</option>`
    : mine.map(c => `<option value="${c.docId}|${c.status}">Case #${c.caseId} – ${c.submitterName} (${c.crimeType})</option>`).join("");

  sel.addEventListener("change", () => {
    const parts = sel.value.split("|");
    const curStatusEl = document.getElementById("current-status-display");
    if (curStatusEl) curStatusEl.value = parts[1] || "";
  });
  if (mine[0]) {
    const curStatusEl = document.getElementById("current-status-display");
    if (curStatusEl) curStatusEl.value = mine[0].status;
  }
}

document.getElementById("update-status-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  const btn = document.getElementById("update-status-btn");
  const origText = btn.textContent;
  setLoading(btn, true, origText);

  const sel = document.getElementById("update-case-select");
  const caseDocId = sel.value.split("|")[0];
  const newStatus = document.getElementById("new-status").value;
  const message = document.querySelector("#update-status-form textarea").value.trim();
  const sendEmail = document.getElementById("notify-email").checked;
  const sendPortal = document.getElementById("notify-portal").checked;

  if (!caseDocId || !newStatus) {
    showToast("Please select a case and a new status.", "error");
    setLoading(btn, false, origText);
    return;
  }

  try {
    const caseSnap = await getDoc(doc(db, "cases", caseDocId));
    const caseData = caseSnap.data();

    await updateDoc(doc(db, "cases", caseDocId), {
      status: newStatus,
      officerNotes: message || caseData.officerNotes,
      updatedAt: serverTimestamp()
    });

    // Notify victim via Portal
    if (sendPortal && caseData.submittedBy) {
      await addDoc(collection(db, "notifications", caseData.submittedBy, "items"), {
        title: `Case #${caseData.caseId} – Status Update`,
        body: message || `Your case status has been updated to "${newStatus}".`,
        type: newStatus === "Resolved" ? "resolved" : "officer_update",
        caseId: caseDocId,
        read: false,
        createdAt: serverTimestamp()
      });
    }

    // Mock Email
    if (sendEmail && caseData.submitterEmail) {
      showToast(`Email dispatch successful to ${caseData.submitterEmail}`, "info");
    }

    // Audit log
    await addDoc(collection(db, "auditLogs"), {
      userId: currentUser.uid,
      userName: `${currentUserData.firstName} ${currentUserData.lastName}`,
      role: "officer", action: `Status → ${newStatus}`,
      target: `#${caseData.caseId}`, createdAt: serverTimestamp()
    });

    document.getElementById("status-success-msg").textContent = `Case #${caseData.caseId} is now "${newStatus}". Dispatch notifications completed.`;
    openModal("status-success-modal");
    e.target.reset();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    setLoading(btn, false, origText);
  }
});

/* ───────────────────────────────────────
   REQUEST INFORMATION
─────────────────────────────────────── */
function populateRequestInfoSelect(cases) {
  const sel = document.getElementById("request-case-select");
  if (!sel) return;
  
  if (cases.length === 0) {
    sel.innerHTML = `<option value="">No cases available</option>`;
    return;
  }
  
  sel.innerHTML = `<option value="">Select a case…</option>` + 
    cases.map(c => {
      const victimId = c.submittedBy || "";
      if (!victimId) return ""; // Skip if no victim UID
      return `<option value="${c.docId}|${victimId}|${c.caseId}">Case #${c.caseId} – ${c.submitterName || "Unknown"} (${c.crimeType})</option>`;
    }).join("");
}

document.getElementById("request-info-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  const btn = document.getElementById("send-request-btn");
  const origText = btn.textContent;
  setLoading(btn, true, origText);

  const sel = document.getElementById("request-case-select");
  const val = sel.value;
  if (!val) {
    showToast("Please select a case first.", "error");
    setLoading(btn, false, origText);
    return;
  }
  
  const parts = val.split("|");
  const [caseDocId, victimUid, caseId] = parts;
  const message = document.querySelector("#request-info-form textarea").value.trim();
  
  // Safely get the second select in the form
  const selects = document.querySelectorAll("#request-info-form select");
  const infoType = selects.length >= 2 ? selects[1].value : "Information Request";

  console.log(`Preparing info request for case: ${caseId} (Doc: ${caseDocId})`);

  try {
    // Fetch latest case data to ensure we have the correct victim UID
    const caseSnap = await getDoc(doc(db, "cases", caseDocId));
    if (!caseSnap.exists()) {
      showToast("Case not found.", "error");
      setLoading(btn, false, origText);
      return;
    }
    const cData = caseSnap.data();
    const targetUid = cData.submittedBy;

    if (!targetUid) {
      showToast("No victim linked to this case record.", "error");
      setLoading(btn, false, origText);
      return;
    }

    console.log("Sending notification to UID:", targetUid);

    // Notify victim
    await addDoc(collection(db, "notifications", targetUid, "items"), {
      title: `Case #${caseId} – Officer Requested Info`,
      body: `${infoType}: ${message}`,
      type: "officer_update",
      caseId: caseDocId,
      read: false,
      createdAt: serverTimestamp()
    });

    await updateDoc(doc(db, "cases", caseDocId), {
      status: "Additional Info Requested",
      officerNotes: message,
      updatedAt: serverTimestamp()
    });

    // Audit
    await addDoc(collection(db, "auditLogs"), {
      userId: currentUser.uid,
      userName: `${currentUserData.firstName} ${currentUserData.lastName}`,
      role: "officer", action: "Requested Additional Info",
      target: `#${caseId}`, createdAt: serverTimestamp()
    });

    e.target.reset();
    openModal("request-success-modal");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    setLoading(btn, false, origText);
  }
});

/* ───────────────────────────────────────
   OVERVIEW ALERTS (officer notifications)
─────────────────────────────────────── */
function listenMyAlerts() {
  if (!currentUser) return;
  const q = query(
    collection(db, "notifications", currentUser.uid, "items")
  );
  onSnapshot(q, (snap) => {
    const notifs = snap.docs.map(d => d.data());
    // Sort in memory
    notifs.sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
    renderAlerts(notifs.slice(0, 5));
  });
}

function renderAlerts(notifs) {
  const container = document.getElementById("alerts-container");
  if (!container) return;
  if (notifs.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:24px;">No alerts.</p>`;
    return;
  }
  container.innerHTML = notifs.map(n => `
    <div class="notification-item">
      <div class="notif-icon" style="background:rgba(129,140,248,0.1);color:#818cf8;"></div>
      <div class="notif-body">
        <div class="notif-title">${n.title}</div>
        <div class="notif-sub">${n.body}</div>
      </div>
      <span class="notif-time">${formatDate(n.createdAt)}</span>
    </div>`).join("");
}

/* ───────────────────────────────────────
   REVIEW EVIDENCE PANEL
─────────────────────────────────────── */
async function loadEvidenceForCase(caseDocId) {
  const snap = await getDocs(collection(db, "cases", caseDocId, "evidence"));
  const grid = document.getElementById("evidence-review-grid");
  // Update evidence count label if exists
  const countLabel = document.querySelector("#panel-evidence-review h4");
  if (countLabel) countLabel.textContent = `Evidence Files (${snap.size} items)`;
  
  if (!grid) return;
  if (snap.empty) {
    grid.innerHTML = `<p style="color:var(--text-muted);text-align:center;width:100%;padding:24px;">No evidence uploaded for this case yet.</p>`;
    return;
  }
  grid.innerHTML = snap.docs.map(d => {
    const ev = d.data();
    const kb = ev.fileSize ? `${(ev.fileSize/1024).toFixed(0)} KB` : "0 KB";
    return `
    <div class="evidence-card" style="cursor:pointer;" onclick="window.open('${ev.storageUrl}','_blank')">
      <div class="ev-icon"></div>
      <p style="word-break:break-all;">${ev.fileName}<br/><span style="font-size:0.75rem;color:var(--text-muted);">${kb} · ${formatDate(ev.uploadedAt)}</span><br/>
        <span class="status-badge badge-cyan" style="margin-top:6px;display:inline-flex;">${ev.verifiedStatus}</span></p>
    </div>`;
  }).join("");
}

function populateEvidenceReviewSelect(cases) {
  const sel = document.getElementById("evidence-review-case-select");
  if (!sel) return;
  // Show cases assigned to me first, or all cases if preferred
  const mine = cases.filter(c => c.assignedOfficer === currentUser?.uid);
  const targetCases = mine.length > 0 ? mine : cases;
  
  sel.innerHTML = `<option value="">Select a case to review…</option>` + 
    targetCases.map(c => `<option value="${c.docId}">Case #${c.caseId} – ${c.submitterName} (${c.crimeType})</option>`).join("");
}

const evidenceCaseSelect = document.getElementById("evidence-review-case-select");
evidenceCaseSelect?.addEventListener("change", async () => {
  const docId = evidenceCaseSelect.value;
  if (docId) {
    activeCaseDocId = docId;
    await loadEvidenceForCase(docId);
    const snap = await getDoc(doc(db, "cases", docId));
    if (snap.exists()) {
      const c = snap.data();
      const summary = document.getElementById("evidence-case-summary");
      if (summary) summary.innerHTML = `
        <div style="font-size:0.82rem;font-family:var(--mono);color:var(--text-muted);margin-bottom:8px;">CASE SUMMARY – #${c.caseId}</div>
        <div style="font-size:0.88rem;color:var(--text-secondary);">
          <strong style="color:var(--text-primary);">Victim:</strong> ${c.submitterName} &nbsp;·&nbsp;
          <strong style="color:var(--text-primary);">Type:</strong> ${c.crimeType} &nbsp;·&nbsp;
          <strong style="color:var(--text-primary);">Submitted:</strong> ${formatDate(c.createdAt)} &nbsp;·&nbsp;
          <strong style="color:var(--text-primary);">Loss:</strong> ${c.estimatedLoss || "Not specified"}
        </div>`;
      
      const notesArea = document.getElementById("officer-notes-area");
      if (notesArea) notesArea.value = c.officerNotes || "";
    }
  }
});

document.getElementById("save-notes-btn")?.addEventListener("click", async () => {
  if (!activeCaseDocId) { showToast("Select a case first.", "error"); return; }
  const notes = document.getElementById("officer-notes-area").value.trim();
  await updateDoc(doc(db, "cases", activeCaseDocId), { officerNotes: notes, updatedAt: serverTimestamp() });
  showToast("Investigation notes saved!", "success");
});
