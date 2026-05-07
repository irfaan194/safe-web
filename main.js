// main.js – CyberShield Global Scripts

/* ---- CANVAS GRID ANIMATION ---- */
const canvas = document.getElementById('gridCanvas');
if (canvas) {
  const ctx = canvas.getContext('2d');
  let w, h, points = [], animFrame;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    buildGrid();
  }

  function buildGrid() {
    points = [];
    const cols = Math.ceil(w / 80);
    const rows = Math.ceil(h / 80);
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        points.push({
          ox: c * 80, oy: r * 80,
          x: c * 80, y: r * 80,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3
        });
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    const cols = Math.ceil(w / 80) + 1;

    points.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      const dx = p.x - p.ox, dy = p.y - p.oy;
      if (Math.abs(dx) > 20) p.vx *= -1;
      if (Math.abs(dy) > 20) p.vy *= -1;
    });

    ctx.strokeStyle = 'rgba(0, 245, 212, 0.07)';
    ctx.lineWidth = 0.5;

    for (let i = 0; i < points.length; i++) {
      const right = points[i + 1];
      const below = points[i + cols];
      if (right && Math.floor(i / cols) === Math.floor((i + 1) / cols)) {
        ctx.beginPath();
        ctx.moveTo(points[i].x, points[i].y);
        ctx.lineTo(right.x, right.y);
        ctx.stroke();
      }
      if (below) {
        ctx.beginPath();
        ctx.moveTo(points[i].x, points[i].y);
        ctx.lineTo(below.x, below.y);
        ctx.stroke();
      }
    }

    animFrame = requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();
}

/* ---- NAVBAR SCROLL ---- */
const navbar = document.getElementById('navbar');
if (navbar) {
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 20);
  });
}

/* ---- HAMBURGER ---- */
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobile-menu');
if (hamburger && mobileMenu) {
  hamburger.addEventListener('click', () => {
    mobileMenu.classList.toggle('open');
  });
}

/* ---- SCROLL REVEAL ---- */
const revealEls = document.querySelectorAll('.step-card, .portal-card, .feature-card, .stat-card, .panel');
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.style.opacity = '1';
      e.target.style.transform = 'translateY(0)';
      io.unobserve(e.target);
    }
  });
}, { threshold: 0.1 });

revealEls.forEach((el, i) => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(24px)';
  el.style.transition = `opacity 0.5s ease ${i * 0.07}s, transform 0.5s ease ${i * 0.07}s`;
  io.observe(el);
});

/* ---- TAB SWITCHING ---- */
function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(c => {
        c.style.display = c.id === target ? 'block' : 'none';
      });
    });
  });
}
initTabs();

/* ---- MODAL ---- */
window.openModal = function(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('open');
};
window.closeModal = function(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('open');
};
window.switchPanel = function(id) {
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.portal-panel').forEach(p => p.style.display = 'none');
  const el = document.getElementById(id);
  if (el) el.style.display = 'flex';
  const link = document.querySelector(`[data-panel="${id}"]`);
  if (link) link.classList.add('active');
};
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => {
    if (e.target === m) m.classList.remove('open');
  });
});

/* ---- UPLOAD ZONE ---- */
document.querySelectorAll('.upload-zone').forEach(zone => {
  const input = zone.querySelector('input[type="file"]');
  zone.addEventListener('click', () => input && input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = 'var(--cyan)'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.style.borderColor = '';
    const files = e.dataTransfer.files;
    if (files.length) updateUploadZone(zone, files);
  });
  if (input) input.addEventListener('change', () => updateUploadZone(zone, input.files));
});

function updateUploadZone(zone, files) {
  const p = zone.querySelector('p');
  if (p) p.innerHTML = `<strong>${files.length} file(s) selected:</strong> ${Array.from(files).map(f => f.name).join(', ')}`;
  zone.style.borderColor = 'var(--cyan)';
  zone.style.background = 'var(--cyan-glow)';
}

/* ---- FORM FEEDBACK ---- */
document.querySelectorAll('form').forEach(form => {
  form.addEventListener('submit', e => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = 'Submitted!';
    btn.style.background = '#10b981';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.background = '';
    }, 3000);
  });
});

/* ---- SIDEBAR ACTIVE ---- */
document.querySelectorAll('.sidebar-link[data-panel]').forEach(link => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    document.querySelectorAll('.portal-panel').forEach(p => p.style.display = 'none');
    const panel = document.getElementById(link.dataset.panel);
    if (panel) panel.style.display = 'flex';
  });
});

/* ---- LIVE CLOCK ---- */
const clocks = document.querySelectorAll('.live-clock');
if (clocks.length) {
  function tick() {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false });
    clocks.forEach(c => c.textContent = time);
  }
  tick();
  setInterval(tick, 1000);
}
