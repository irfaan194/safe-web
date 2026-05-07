import { auth, db, storage } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, setDoc, getDoc, collection, addDoc, query, where,
  orderBy, onSnapshot, updateDoc, serverTimestamp, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  ref, uploadBytesResumable, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

/* ───────────────────────────────────────
   UTILITY HELPERS
─────────────────────────────────────── */
function showToast(msg, type = "success") {
  let toast = document.getElementById("cs-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "cs-toast";
    toast.style.cssText = `
      position:fixed;bottom:28px;right:28px;z-index:9999;padding:14px 24px;
      border-radius:10px;font-family:var(--font);font-size:0.9rem;font-weight:500;
      box-shadow:0 8px 32px rgba(0,0,0,0.4);transition:all 0.3s ease;
      display:flex;align-items:center;gap:10px;min-width:260px;
    `;
    document.body.appendChild(toast);
  }
  const colors = {
    success: "background:#0d2a1f;border:1px solid #10b981;color:#10b981;",
    error: "background:#2a0d0d;border:1px solid #ef4444;color:#ef4444;",
    info: "background:#0d1f2a;border:1px solid var(--cyan);color:var(--cyan);"
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
    "Pending": "badge-yellow",
    "Under Review": "badge-cyan",
    "Investigating": "badge-purple",
    "Additional Info Requested": "badge-yellow",
    "Evidence Collected": "badge-cyan",
    "Suspect Identified": "badge-purple",
    "Arrested": "badge-red",
    "Referred to Court": "badge-purple",
    "Resolved": "badge-green",
    "Closed": "badge-green"
  };
  return `<span class="status-badge ${map[status] || 'badge-cyan'}">${status}</span>`;
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

onAuthStateChanged(auth, async (user) => {
  if (user) {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists() && snap.data().role === "citizen") {
      currentUser = user;
      currentUserData = snap.data();
      document.getElementById("auth-view").style.display = "none";
      document.getElementById("dashboard-view").style.display = "block";
      window.scrollTo(0, 0);
      
      // Set max date for report to today
      const dateInput = document.getElementById("incident-date");
      if (dateInput) {
        const today = new Date().toISOString().split("T")[0];
        dateInput.max = today;
      }

      populateDashboardUser();
      listenMyCases();
      listenNotifications();
    } else if (snap.exists()) {
      await signOut(auth);
      showToast("This portal is for citizens only.", "error");
    }
  } else {
    document.getElementById("auth-view").style.display = "block";
    document.getElementById("dashboard-view").style.display = "none";
    currentUser = null;
    currentUserData = null;
  }
});

function populateDashboardUser() {
  const name = `${currentUserData.firstName} ${currentUserData.lastName}`;
  const el = document.getElementById("dash-user-name");
  if (el) el.textContent = name;
  const headerName = document.getElementById("header-user-name");
  if (headerName) headerName.innerHTML = `<span class="pulse-dot" style="width:6px;height:6px;"></span> ${name}`;
}

/* ───────────────────────────────────────
   REGISTER
─────────────────────────────────────── */
document.getElementById("register-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  const origText = btn.textContent;
  setLoading(btn, true, origText);

  const firstName = document.getElementById("reg-fname").value.trim();
  const lastName = document.getElementById("reg-lname").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const phone = document.getElementById("reg-phone").value.trim();
  const password = document.getElementById("reg-pass").value;

  // Phone validation
  if (!/^\d{10}$/.test(phone)) {
    showToast("Please enter a valid 10-digit phone number.", "error");
    setLoading(btn, false, origText);
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "users", cred.user.uid), {
      firstName, lastName, email, phone,
      role: "citizen",
      status: "verified",
      createdAt: serverTimestamp()
    });
    showToast("Account created! Welcome to CyberShield.", "success");
    // auth state change will auto-show dashboard
  } catch (err) {
    showToast(err.message, "error");
    setLoading(btn, false, origText);
  }
});

/* ───────────────────────────────────────
   LOGIN
─────────────────────────────────────── */
document.getElementById("citizen-login-btn")?.addEventListener("click", async () => {
  const btn = document.getElementById("citizen-login-btn");
  const origText = btn.textContent;
  setLoading(btn, true, origText);

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-pass").value;

  if (!email || !password) {
    showToast("Please enter your email and password.", "error");
    setLoading(btn, false, origText);
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // auth state change handles rest
  } catch (err) {
    const msg = err.code === "auth/invalid-credential"
      ? "Invalid email or password." : err.message;
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
    showToast("Logged out successfully.", "info");
  });
});

/* ───────────────────────────────────────
   SUBMIT INCIDENT REPORT
─────────────────────────────────────── */
document.getElementById("incident-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) { showToast("Please login first.", "error"); return; }

  const btn = document.getElementById("submit-report-btn");
  const origText = btn.textContent;
  setLoading(btn, true, origText);

  const crimeType = document.getElementById("crime-type").value;
  const incidentDate = document.getElementById("incident-date").value;
  const incidentTime = document.getElementById("incident-time").value;

  if (new Date(incidentDate) > new Date()) {
    showToast("Incident date cannot be in the future.", "error");
    setLoading(btn, false, origText);
    return;
  }
  const platform = document.getElementById("platform").value.trim();
  const description = document.getElementById("crime-desc").value.trim();
  const suspectInfo = document.getElementById("suspect-info").value.trim();
  const estimatedLoss = document.getElementById("estimated-loss").value.trim();
  const fileInput = document.querySelector("#report-upload input[type=file]");

  try {
    // Generate a unique case number (simplified to avoid permission issues)
    const caseNum = Math.floor(Math.random() * 9000) + 1000;
    const caseId = `CYB-${caseNum}`;

    const caseRef = await addDoc(collection(db, "cases"), {
      caseId,
      crimeType,
      incidentDate,
      incidentTime,
      platform,
      description,
      suspectInfo,
      estimatedLoss,
      status: "Pending",
      priority: "Medium",
      submittedBy: currentUser.uid,
      submitterName: `${currentUserData.firstName} ${currentUserData.lastName}`,
      submitterEmail: currentUserData.email,
      assignedOfficer: null,
      assignedOfficerName: null,
      officerNotes: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    // Upload evidence files if any (wrapped in try-catch to avoid blocking if storage is disabled)
    if (fileInput && fileInput.files.length > 0) {
      const fileCount = fileInput.files.length;
      showToast(`Starting upload of ${fileCount} evidence files...`, "info");
      
      try {
        for (let i = 0; i < fileCount; i++) {
          const file = fileInput.files[i];
          const storageRef = ref(storage, `evidence/${caseRef.id}/${Date.now()}_${file.name}`);
          
          console.log(`Uploading file ${i+1}/${fileCount}: ${file.name}`);
          await uploadBytesResumable(storageRef, file);
          
          const url = await getDownloadURL(storageRef);
          await addDoc(collection(db, "cases", caseRef.id, "evidence"), {
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            storageUrl: url,
            verifiedStatus: "Uploaded",
            uploadedAt: serverTimestamp(),
            uploadedBy: currentUser.uid
          });
          console.log(`File ${i+1} uploaded and recorded.`);
        }
        showToast("All evidence files uploaded successfully!", "success");
      } catch (storageErr) {
        console.error("Storage upload error:", storageErr);
        showToast("Case submitted, but evidence upload failed (check Storage permissions).", "warning");
      }
    }

    // Write audit log
    await addDoc(collection(db, "auditLogs"), {
      userId: currentUser.uid,
      userName: `${currentUserData.firstName} ${currentUserData.lastName}`,
      role: "citizen",
      action: "Case Filed",
      target: `#${caseId}`,
      createdAt: serverTimestamp()
    });

    const msgEl = document.getElementById("success-modal-msg");
    if (msgEl) msgEl.textContent = `Your report #${caseId} has been successfully filed. Our officers will review the evidence shortly.`;
    if (window.openModal) window.openModal("success-modal");

    e.target.reset();
    const fileZone = document.getElementById("report-upload");
    if (fileZone) { const p = fileZone.querySelector("p"); if (p) p.innerHTML = `Drag & drop images here or <strong>click to browse</strong>`; }

    // Switch to overview panel after a short delay
    setTimeout(() => { if (window.switchPanel) switchPanel("panel-overview"); }, 2000);
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    setLoading(btn, false, origText);
  }
});

/* ───────────────────────────────────────
   LIVE CASES TABLE
─────────────────────────────────────── */
let unsubCases = null;

function listenMyCases() {
  if (unsubCases) unsubCases();
  const q = query(
    collection(db, "cases"),
    where("submittedBy", "==", currentUser.uid)
  );

  unsubCases = onSnapshot(q, (snap) => {
    const cases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Sort in memory to avoid index requirements
    cases.sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
    renderCasesTable(cases);
    renderTrackPanel(cases);
    updateStatCards(cases);
  });
}

function renderCasesTable(cases) {
  const tbody = document.getElementById("my-cases-tbody");
  if (!tbody) return;
  if (cases.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:32px;">No cases filed yet. Click "+ New Report" to submit your first report.</td></tr>`;
    return;
  }
  tbody.innerHTML = cases.map(c => `
    <tr>
      <td style="font-family:var(--mono);color:var(--cyan);">#${c.caseId}</td>
      <td>${c.crimeType}</td>
      <td>${formatDate(c.createdAt)}</td>
      <td>${statusBadge(c.status)}</td>
      <td><button class="action-btn" onclick="openCaseModal('${c.id}')">View</button></td>
    </tr>
  `).join("");
}

function renderTrackPanel(cases) {
  const container = document.getElementById("track-cases-container");
  if (!container) return;
  if (cases.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:32px;">No cases to track yet.</p>`;
    return;
  }

  const progressMap = {
    "Pending": 15, "Under Review": 35, "Investigating": 55,
    "Additional Info Requested": 45, "Evidence Collected": 65,
    "Suspect Identified": 75, "Arrested": 85, "Referred to Court": 90,
    "Resolved": 100, "Closed": 100
  };

  container.innerHTML = cases.map(c => {
    const pct = progressMap[c.status] || 15;
    const officer = c.assignedOfficerName || "Unassigned";
    return `
    <div style="background:var(--bg-dark);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
        <div>
          <div style="font-family:var(--mono);color:var(--cyan);font-size:0.9rem;margin-bottom:4px;">#${c.caseId}</div>
          <div style="font-weight:700;font-size:1rem;">${c.crimeType}</div>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px;">
            Submitted ${formatDate(c.createdAt)} · Officer: ${officer}
          </div>
        </div>
        ${statusBadge(c.status)}
      </div>
      <div class="progress-bar" style="margin-bottom:12px;">
        <div class="progress-fill" style="width:${pct}%;${pct===100?'background:linear-gradient(90deg,#10b981,#34d399);':''}"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.78rem;color:var(--text-muted);font-family:var(--mono);">
        <span>Filed</span><span>Assigned</span><span style="${pct>=55?'color:var(--cyan)':''}">Investigating</span><span style="${pct===100?'color:#10b981':''}">Resolved</span>
      </div>
      ${c.officerNotes ? `
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
          <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:8px;">Latest Update from Officer:</div>
          <div style="font-size:0.88rem;color:var(--text-secondary);background:var(--bg-card);padding:12px;border-radius:8px;border-left:2px solid var(--cyan);">"${c.officerNotes}"</div>
        </div>` : ''}
    </div>`;
  }).join("");
}

function updateStatCards(cases) {
  const total = cases.length;
  const underReview = cases.filter(c => ["Under Review","Investigating","Additional Info Requested","Evidence Collected","Suspect Identified","Arrested","Referred to Court"].includes(c.status)).length;
  const resolved = cases.filter(c => ["Resolved","Closed"].includes(c.status)).length;

  const els = {
    "stat-my-cases": total,
    "stat-under-review": underReview,
    "stat-resolved": resolved
  };
  Object.entries(els).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  });
}

/* ───────────────────────────────────────
   CASE DETAIL MODAL (dynamic)
─────────────────────────────────────── */
window.openCaseModal = async function(docId) {
  const snap = await getDoc(doc(db, "cases", docId));
  if (!snap.exists()) return;
  const c = snap.data();

  document.getElementById("modal-case-id").textContent = `Case #${c.caseId} – Detail`;
  document.getElementById("modal-crime-type").textContent = c.crimeType;
  document.getElementById("modal-submitted").textContent = formatDate(c.createdAt);
  document.getElementById("modal-officer").textContent = c.assignedOfficerName || "Not yet assigned";
  document.getElementById("modal-status").innerHTML = statusBadge(c.status);
  document.getElementById("modal-description").textContent = c.description;

  openModal("case-detail-modal");
};

/* ───────────────────────────────────────
   NOTIFICATIONS
─────────────────────────────────────── */
let unsubNotifs = null;

function listenNotifications() {
  if (!currentUser) return;
  if (unsubNotifs) unsubNotifs();

  const q = query(
    collection(db, "notifications", currentUser.uid, "items")
  );

  unsubNotifs = onSnapshot(q, (snap) => {
    const notifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Sort in memory
    notifs.sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
    
    renderNotifications(notifs);
    const unread = notifs.filter(n => !n.read).length;
    const badge = document.getElementById("notif-badge");
    if (badge) badge.textContent = unread;
    const sBadge = document.getElementById("sidebar-notif-badge");
    if (sBadge) {
      sBadge.textContent = unread;
      sBadge.style.display = unread > 0 ? "inline-block" : "none";
    }
  });
}

function renderNotifications(notifs) {
  const container = document.getElementById("notifications-container");
  if (!container) return;
  if (notifs.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:32px;">No notifications yet.</p>`;
    return;
  }
  container.innerHTML = notifs.map(n => `
    <div class="notification-item" style="cursor:pointer; ${!n.read ? 'border-left:2px solid var(--cyan);' : ''}" onclick="window.handleNotifClick('${n.id}', '${n.caseId}', '${n.type}')">
      <div class="notif-icon"></div>
      <div class="notif-body">
        <div class="notif-title">${n.title}</div>
        <div class="notif-sub">${n.body}</div>
      </div>
      <span class="notif-time">${formatDate(n.createdAt)}</span>
    </div>
  `).join("");
}

window.handleNotifClick = async function(notifId, caseDocId, type) {
  if (!currentUser) return;
  
  // Mark as read
  try {
    await updateDoc(doc(db, "notifications", currentUser.uid, "items", notifId), { read: true });
  } catch (err) { console.error("Error marking notif as read:", err); }

  if (caseDocId) {
    if (type === "officer_update") {
      // Switch to evidence upload panel
      switchPanel("panel-evidence");
      // Pre-select the case in the evidence dropdown
      setTimeout(() => {
        const sel = document.getElementById("evidence-case-select");
        if (sel) {
          sel.value = caseDocId;
          // Trigger any listeners
        }
      }, 200);
    } else {
      // Default: show case detail
      showCaseDetail(caseDocId);
    }
  }
};

/* ───────────────────────────────────────
   EVIDENCE UPLOAD (standalone panel)
─────────────────────────────────────── */
document.getElementById("submit-evidence-btn")?.addEventListener("click", async () => {
  if (!currentUser) return;
  const caseSelect = document.getElementById("evidence-case-select");
  const caseDocId = caseSelect?.value;
  if (!caseDocId) { showToast("Please select a case first.", "error"); return; }

  const uploads = [
    document.getElementById("img-upload"),
    document.getElementById("doc-upload"),
    document.getElementById("vid-upload"),
    document.getElementById("ss-upload")
  ];

  let uploaded = 0;
  showToast("Starting evidence upload...", "info");
  
  for (const zone of uploads) {
    const input = zone?.querySelector("input[type=file]");
    if (!input || !input.files.length) continue;
    
    for (const file of input.files) {
      try {
        const storageRef = ref(storage, `evidence/${caseDocId}/${Date.now()}_${file.name}`);
        console.log(`Uploading evidence: ${file.name}`);
        
        await uploadBytesResumable(storageRef, file);
        const url = await getDownloadURL(storageRef);
        
        await addDoc(collection(db, "cases", caseDocId, "evidence"), {
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          storageUrl: url,
          verifiedStatus: "Uploaded",
          uploadedAt: serverTimestamp(),
          uploadedBy: currentUser.uid
        });
        uploaded++;
      } catch (err) {
        console.error("Evidence upload error:", err);
      }
    }
  }
  
  if (uploaded > 0) {
    showToast(`${uploaded} file(s) submitted for review!`, "success");
    loadUploadedEvidence(caseDocId);
    // Clear inputs
    uploads.forEach(zone => {
      const input = zone?.querySelector("input[type=file]");
      if (input) input.value = "";
    });
  } else {
    showToast("No files selected or upload failed.", "error");
  }
});

async function loadUploadedEvidence(caseDocId) {
  const grid = document.getElementById("prev-evidence-grid");
  if (!grid) return;
  const snap = await getDocs(collection(db, "cases", caseDocId, "evidence"));
  if (snap.empty) { grid.innerHTML = `<p style="color:var(--text-muted);">No evidence uploaded yet.</p>`; return; }

  const iconMap = { "image": "", "application": "", "video": "" };
  grid.innerHTML = snap.docs.map(d => {
    const ev = d.data();
    const icon = iconMap[ev.fileType?.split("/")[0]] || "";
    return `
    <div class="evidence-card">
      <div class="ev-icon">${icon}</div>
      <p>${ev.fileName}<br/>
        <a href="${ev.storageUrl}" target="_blank" style="color:var(--cyan);font-size:0.75rem;">View File</a><br/>
        <span class="status-badge badge-cyan" style="margin-top:6px;display:inline-flex;">${ev.verifiedStatus}</span>
      </p>
    </div>`;
  }).join("");
}

/* ───────────────────────────────────────
   POPULATE EVIDENCE CASE SELECT
─────────────────────────────────────── */
async function populateEvidenceCaseSelect() {
  if (!currentUser) return;
  const caseSelect = document.getElementById("evidence-case-select");
  if (!caseSelect) return;

  const q = query(collection(db, "cases"), where("submittedBy", "==", currentUser.uid));
  const snap = await getDocs(q);
  caseSelect.innerHTML = snap.empty
    ? `<option value="">No cases found</option>`
    : snap.docs.map(d => `<option value="${d.id}">Case #${d.data().caseId} – ${d.data().crimeType}</option>`).join("");

  caseSelect.addEventListener("change", () => {
    if (caseSelect.value) loadUploadedEvidence(caseSelect.value);
  });
  if (snap.docs[0]) loadUploadedEvidence(snap.docs[0].id);
}

// Re-populate select when evidence panel is opened
const slEvidence = document.getElementById("sl-evidence");
slEvidence?.addEventListener("click", () => {
  setTimeout(populateEvidenceCaseSelect, 100);
});

/* ───────────────────────────────────────
   PROFILE UPDATE
─────────────────────────────────────── */
document.getElementById("profile-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  const firstName = document.getElementById("profile-fname").value.trim();
  const lastName = document.getElementById("profile-lname").value.trim();
  const phone = document.getElementById("profile-phone").value.trim();

  try {
    await updateDoc(doc(db, "users", currentUser.uid), { firstName, lastName, phone });
    showToast("Profile updated successfully.", "success");
    currentUserData = { ...currentUserData, firstName, lastName, phone };
    populateDashboardUser();
  } catch (err) {
    showToast(err.message, "error");
  }
});

// Populate profile form on load
async function loadProfile() {
  if (!currentUserData) return;
  const fields = { "profile-fname": "firstName", "profile-lname": "lastName", "profile-email": "email", "profile-phone": "phone" };
  Object.entries(fields).forEach(([elId, key]) => {
    const el = document.getElementById(elId);
    if (el) el.value = currentUserData[key] || "";
  });
}

const slProfile = document.getElementById("sl-profile");
slProfile?.addEventListener("click", () => setTimeout(loadProfile, 100));
