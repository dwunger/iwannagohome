/* ================================================================
   CBA Time-Off Bank Health Calculator — Engine
   "WellSpan Hates This 1 Simple Website"
   Pure client-side. No backend. All state in browser.
   ================================================================ */
(function () {
  'use strict';

  /* ── STATE ────────────────────────────────────────────────── */
  const S = {
    hireDate: null,
    fte: 1.0,
    unit: 2,
    system: null,           // 'A' | 'B'
    bal: { HPT: 0, VAC: 0, SICK: 0, PTO: 0 },
    balDate: null,          // Date
    rate: null,             // hourly rate (optional)
    entries: [],            // { date, type, hours, status, id }
    calMonth: new Date().getMonth(),
    calYear: new Date().getFullYear(),
    selDate: null,
  };

  /* ── ACCRUAL TABLES ──────────────────────────────────────── */

  const VAC_U2 = [
    { lo: 0,  hi: 4,  r: 0.0384, cap: 120 },
    { lo: 5,  hi: 12, r: 0.0576, cap: 180 },
    { lo: 13, hi: 14, r: 0.0653, cap: 204 },
    { lo: 15, hi: 25, r: 0.0769, cap: 240 },
    { lo: 26, hi: 26, r: 0.0807, cap: 252 },
    { lo: 27, hi: 27, r: 0.0846, cap: 264 },
    { lo: 28, hi: 28, r: 0.0884, cap: 276 },
    { lo: 29, hi: 29, r: 0.0923, cap: 288 },
    { lo: 30, hi: 99, r: 0.0961, cap: 300 },
  ];

  const VAC_U1 = [
    { lo: 0,  hi: 12, r: 0.0576, cap: 180 },
    { lo: 13, hi: 14, r: 0.0653, cap: 204 },
    { lo: 15, hi: 25, r: 0.0769, cap: 240 },
    { lo: 26, hi: 26, r: 0.0807, cap: 252 },
    { lo: 27, hi: 27, r: 0.0846, cap: 264 },
    { lo: 28, hi: 28, r: 0.0884, cap: 276 },
    { lo: 29, hi: 29, r: 0.0923, cap: 288 },
    { lo: 30, hi: 99, r: 0.0961, cap: 300 },
  ];

  const PTO_FT = [
    { lo: 0,  hi: 5,  r: 0.0731, cap: 180 },
    { lo: 6,  hi: 10, r: 0.0924, cap: 240 },
    { lo: 11, hi: 25, r: 0.1116, cap: 300 },
    { lo: 26, hi: 99, r: 0.1308, cap: 360 },
  ];

  const PTO_PT = [
    { lo: 0,  hi: 10, r: 0.0731, cap: 180 },
    { lo: 11, hi: 20, r: 0.0924, cap: 240 },
    { lo: 21, hi: 99, r: 0.1116, cap: 300 },
  ];

  const HPT_R   = 0.0462;
  const HPT_CAP = 72;
  const SICK_R  = 0.0462;
  const SICK_CAP = 1200;

  const SICK_TIERS = [
    { lo: 8,   hi: 400,  pct: 0.25 },
    { lo: 401, hi: 800,  pct: 0.375 },
    { lo: 801, hi: 1200, pct: 0.50 },
  ];

  // 3 holidays/year assumed for HPT
  const HPT_HOLIDAY_HRS = 24;

  /* ── HELPERS ──────────────────────────────────────────────── */

  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  function ds(d) {
    if (!d) return '';
    return d.toISOString().split('T')[0];
  }
  function pld(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function fmtDate(d) {
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const D = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return `${D[d.getDay()]} ${M[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }
  function sDate(d) { return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`; }

  function yos(hire, at) {
    let y = at.getFullYear() - hire.getFullYear();
    const m = at.getMonth() - hire.getMonth();
    if (m < 0 || (m === 0 && at.getDate() < hire.getDate())) y--;
    return Math.max(0, y);
  }

  function isWD(d) { const w = d.getDay(); return w > 0 && w < 6; }
  function aph() { return S.fte * 2080; }
  function hpw() { return S.fte >= 1 ? 40 : S.fte >= 0.7 ? 28 : 20; }
  function uid() { return Math.random().toString(36).slice(2, 11); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ── TIER LOOKUPS ────────────────────────────────────────── */

  function vacTiers() { return S.unit === 1 ? VAC_U1 : VAC_U2; }
  function vacTier(y) { const t = vacTiers(); for (const x of t) if (y >= x.lo && y <= x.hi) return x; return t[t.length-1]; }
  function ptoTiers() { return S.fte < 1 ? PTO_PT : PTO_FT; }
  function ptoTier(y) { const t = ptoTiers(); for (const x of t) if (y >= x.lo && y <= x.hi) return x; return t[t.length-1]; }

  function sickCashoutHrs(hrs) {
    let tot = 0;
    for (const t of SICK_TIERS) {
      if (hrs < t.lo) break;
      const span = Math.min(hrs, t.hi) - t.lo + 1;
      if (span > 0) tot += span * t.pct;
    }
    return tot;
  }
  function sickTierLabel(hrs) {
    if (hrs >= 801) return { pct: '50%', label: '801 - 1,200' };
    if (hrs >= 401) return { pct: '37.5%', label: '401 - 800' };
    if (hrs >= 8)   return { pct: '25%', label: '8 - 400' };
    return { pct: '0%', label: 'Under 8' };
  }

  /* ── DMLS01 PARSER ───────────────────────────────────────── */
function parseDmls(raw) {
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const out = [];
    const unk = new Set();
    const known = ['VAC','HPT','PTO','SICK','OV'];

    for (const ln of lines) {
      // Skip header lines and Request ID lines
      if (/^Request ID/i.test(ln)) continue;
      if (/Leave Type/i.test(ln) && /Day ID/i.test(ln)) continue;
      if (/Sort ascending/i.test(ln)) continue;

      // Skip denied rows early
      if (/\bDenied\b/i.test(ln)) continue;

      // Split on tabs, but also handle spaces that replaced tabs
      const p = ln.split(/\t+/);

      // Pattern-based extraction instead of positional
      // Find leave type: known code as a standalone field
      let leaveRaw = null;
      for (const f of p) {
        const ft = f.trim().toUpperCase();
        if (known.includes(ft)) { leaveRaw = ft; break; }
      }
      if (!leaveRaw) continue;

      // Find date: MM/DD/YYYY pattern anywhere in the line
      const dateMatches = ln.match(/(\d{2})\/(\d{2})\/(\d{4})/g);
      if (!dateMatches || dateMatches.length === 0) continue;
      // First date match is the time-off date, second (if present) is requested date
      const dm = dateMatches[0].match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const date = new Date(+dm[3], +dm[1] - 1, +dm[2]);

      // Find hours: decimal number (look for X.XX pattern)
      let hrs = 0;
      const hrsMatch = ln.match(/\b(\d+\.\d{2})\b/g);
      if (hrsMatch) {
        // Take the last decimal match — hours field comes after dates
        for (const h of hrsMatch) {
          const v = parseFloat(h);
          // Filter out things that look like dates parsed as decimals
          if (v > 0 && v <= 24) { hrs = v; break; }
        }
      }
      if (hrs === 0) continue;

      // Check for denied status (redundant safety check)
      let status = 'Approved';
      for (const f of p) {
        if (f.trim().toLowerCase() === 'denied') { status = 'Denied'; break; }
      }
      if (status === 'Denied') continue;

      let type = leaveRaw;
      if (leaveRaw === 'OV') type = 'VAC';
      if (!known.includes(leaveRaw)) unk.add(leaveRaw);

      out.push({ date, type, hours: hrs, status: 'Approved', id: uid() });
    }
    return { entries: out, unknownTypes: [...unk] };
  }

  /* ── PROJECTION ENGINE ───────────────────────────────────── */

  function weekStart(d) {
    const r = new Date(d);
    r.setDate(r.getDate() - r.getDay());
    return r;
  }

  function project(bank, startBal, from, to) {
    if (!S.hireDate || !from) return [];
    let bal = startBal;
    const snaps = [];
    const cur = new Date(from);
    const end = new Date(to);

    // Build usage map
    const umap = {};
    for (const e of S.entries) {
      const t = e.type === 'OV' ? 'VAC' : e.type;
      if (t !== bank) continue;
      const k = ds(e.date);
      umap[k] = (umap[k] || 0) + e.hours;
    }

    let wkHrs = 0;
    let wkS = weekStart(cur);
    const hpd = 8;
    const wpw = hpw();

    while (cur <= end) {
      const k = ds(cur);
      const y = yos(S.hireDate, cur);

      // HPT anniversary reset
      if (bank === 'HPT' && cur > from) {
        const ann = new Date(cur.getFullYear(), S.hireDate.getMonth(), S.hireDate.getDate());
        if (cur.getTime() === ann.getTime()) {
          if (bal > HPT_CAP) bal = HPT_CAP;
        }
      }

      // Week boundary reset
      const ws = weekStart(cur);
      if (ws.getTime() !== wkS.getTime()) { wkHrs = 0; wkS = ws; }

      // Work hours today
      let hToday = 0;
      if (isWD(cur) && wkHrs + hpd <= wpw) { hToday = hpd; wkHrs += hpd; }

      // Accrue
      if (hToday > 0) {
        let a = 0;
        if (bank === 'HPT') {
          a = hToday * HPT_R;
          if (bal + a > HPT_CAP) a = Math.max(0, HPT_CAP - bal);
        } else if (bank === 'VAC') {
          const t = vacTier(y);
          a = hToday * t.r;
          if (bal + a > t.cap) a = Math.max(0, t.cap - bal);
        } else if (bank === 'SICK') {
          a = hToday * SICK_R;
          if (bal + a > SICK_CAP) a = Math.max(0, SICK_CAP - bal);
        } else if (bank === 'PTO') {
          const t = ptoTier(y);
          a = hToday * t.r;
          if (bal + a > t.cap) a = Math.max(0, t.cap - bal);
        }
        bal += a;
      }

      // Deduct
      if (umap[k]) { bal -= umap[k]; if (bal < 0) bal = 0; }

      snaps.push({ date: new Date(cur), bal });
      cur.setDate(cur.getDate() + 1);
    }
    return snaps;
  }

  /* ── METER MATH ──────────────────────────────────────────── */

  function calcMeter(bank) {
    if (!S.hireDate || !S.balDate) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    const y = yos(S.hireDate, today);
    const a = aph();

    let annAcc, cap;
    if (bank === 'HPT')      { annAcc = a * HPT_R;  cap = HPT_CAP; }
    else if (bank === 'VAC') { const t = vacTier(y); annAcc = a * t.r; cap = t.cap; }
    else if (bank === 'SICK'){ annAcc = a * SICK_R;  cap = SICK_CAP; }
    else                     { const t = ptoTier(y); annAcc = a * t.r; cap = t.cap; }

    // Project 1 year out
    const projEnd = new Date(today); projEnd.setFullYear(projEnd.getFullYear() + 1);
    const sb = S.bal[bank] || 0;
    const snaps = project(bank, sb, S.balDate, projEnd);

    // Today's projected balance
    const tk = ds(today);
    let curBal = sb;
    for (const s of snaps) {
      if (ds(s.date) === tk) { curBal = s.bal; break; }
      if (s.date > today) break;
      curBal = s.bal;
    }

    // Rolling 12-month usage
    const wStart = new Date(today); wStart.setMonth(wStart.getMonth() - 6);
    const wEnd   = new Date(today); wEnd.setMonth(wEnd.getMonth() + 6);
    let actual = 0;
    for (const e of S.entries) {
      const t = e.type === 'OV' ? 'VAC' : e.type;
      if (t !== bank) continue;
      if (e.date >= wStart && e.date <= wEnd) actual += e.hours;
    }

    // Sick is special
    if (bank === 'SICK') return sickMeter(curBal, annAcc, actual);

    // Ideal usage
    let ideal = annAcc;
    if (bank === 'HPT') ideal = annAcc + HPT_HOLIDAY_HRS;
    if (curBal > cap * 0.6) ideal += (curBal - cap * 0.6);

    const ratio = ideal > 0 ? actual / ideal : 0;
    const dRatio = clamp(ratio, 0, 2.5);
    const msg = meterMsg(bank, ratio, curBal, cap, annAcc, actual, snaps);

    return { bank, curBal, cap, annAcc, ideal, actual, ratio, dRatio, msg };
  }

  function sickMeter(bal, annAcc, usage) {
    const fill = clamp(bal / SICK_CAP, 0, 1);
    let msg;
    if (bal >= 801)
      msg = `${bal.toFixed(1)} hrs banked at 50% cashout tier. Maximum banking achievement unlocked! Try playing in a kids' ball pit.`;
    else if (bal >= 401)
      msg = `${bal.toFixed(1)} hrs banked at 37.5% cashout tier. ${(801 - bal).toFixed(0)} hrs to reach 50%.`;
    else if (bal >= 8)
      msg = `${bal.toFixed(1)} hrs banked at 25% cashout tier. ${(401 - bal).toFixed(0)} hrs to reach 37.5%.`;
    else
      msg = `${bal.toFixed(1)} hrs — below minimum cashout threshold. Need ${(8 - bal).toFixed(0)} more.`;

    if (usage > annAcc * 0.5) msg += ' You\'re using sick leave faster than typical — try being sick less.';

    return { bank: 'SICK', curBal: bal, cap: SICK_CAP, annAcc, ideal: 0, actual: usage, ratio: null, dRatio: fill, msg, isSick: true };
  }

  function meterMsg(bank, ratio, bal, cap, annAcc, actual, snaps) {
    const lbl = bank === 'HPT' ? 'HPT' : bank === 'VAC' ? 'vacation' : 'PTO';
    if (ratio < 0.3) {
      const wk = annAcc > 0 ? ((cap - bal) / (annAcc / 52)).toFixed(0) : '?';
      return `You're barely using ${lbl}. You'll hit the ${cap}-hour cap in ~${wk} weeks and start losing accrual.`;
    }
    if (ratio < 0.7) {
      const d = Math.ceil((annAcc - actual) / 8);
      const dt = new Date(); dt.setMonth(dt.getMonth() + 6);
      return `You're under-using ${lbl}. Consider scheduling ~${d} more days by ${sDate(dt)}.`;
    }
    if (ratio <= 1.3) return `You're on track. Current ${lbl} usage keeps your bank healthy.`;
    if (ratio <= 1.8) {
      const ed = findEmpty(snaps);
      return `You're using ${lbl} faster than you earn it. Bank will run out by ${ed ? sDate(ed) : 'soon'} at this rate.`;
    }
    const ed = findEmpty(snaps);
    return `Slow down — at this rate you'll have 0 ${lbl} hours by ${ed ? sDate(ed) : 'very soon'}.`;
  }

  function findEmpty(snaps) {
    for (const s of snaps) if (s.bal <= 0) return s.date;
    return null;
  }

  /* ── UI: SYSTEM ──────────────────────────────────────────── */

  function updSystem() {
    const v = $('#hire-date').value;
    if (!v) {
      S.system = null; S.hireDate = null;
      $('#system-badge').textContent = 'Enter hire date above';
      $('#system-badge').className = 'system-badge';
      hide('system-a-inputs'); hide('system-b-inputs'); hide('balance-date-row');
      return;
    }
    S.hireDate = pld(v);
    const cut = new Date(2022, 11, 31);

    if (S.hireDate <= cut) {
      S.system = 'A';
      $('#system-badge').textContent = 'System A — HPT + Vacation + Sick Leave';
      $('#system-badge').className = 'system-badge sys-a';
      show('system-a-inputs'); hide('system-b-inputs');
    } else {
      S.system = 'B';
      $('#system-badge').textContent = 'System B — PTO';
      $('#system-badge').className = 'system-badge sys-b';
      hide('system-a-inputs'); show('system-b-inputs');
    }
    show('balance-date-row');
    updYOS();
    updLeaveOpts();
    recalc();
  }

  function updYOS() {
    const el = $('#yos-display');
    if (!S.hireDate) { el.textContent = ''; return; }
    const y = yos(S.hireDate, new Date());
    el.textContent = `${y} year${y !== 1 ? 's' : ''} of service`;
  }

  function show(id) { document.getElementById(id).classList.remove('hidden'); }
  function hide(id) { document.getElementById(id).classList.add('hidden'); }

  /* ── UI: CALENDAR ────────────────────────────────────────── */

  function renderCal() {
    const yr = S.calYear, mo = S.calMonth;
    const MN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    $('#cal-month-label').textContent = `${MN[mo]} ${yr}`;

    const grid = $('#calendar-grid');
    grid.innerHTML = '';

    ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d => {
      const el = document.createElement('div');
      el.className = 'cal-hdr';
      el.textContent = d;
      grid.appendChild(el);
    });

    const first = new Date(yr, mo, 1).getDay();
    const days = new Date(yr, mo + 1, 0).getDate();
    const today = new Date(); today.setHours(0,0,0,0);

    // Entries this month
    const me = {};
    for (const e of S.entries) {
      if (e.date.getFullYear() === yr && e.date.getMonth() === mo) {
        const d = e.date.getDate();
        if (!me[d]) me[d] = [];
        me[d].push(e);
      }
    }

    for (let i = 0; i < first; i++) {
      const el = document.createElement('div');
      el.className = 'cal-day empty';
      grid.appendChild(el);
    }

    for (let d = 1; d <= days; d++) {
      const el = document.createElement('div');
      el.className = 'cal-day';
      el.textContent = d;

      const dt = new Date(yr, mo, d);
      if (dt.getTime() === today.getTime()) el.classList.add('today');

      if (me[d]) {
        const hasApp = me[d].some(e => e.status === 'Approved');
        el.classList.add(hasApp ? 'has-approved' : 'has-planned');
      }

      el.addEventListener('click', () => { S.selDate = new Date(yr, mo, d); showPlanned(); });
      grid.appendChild(el);
    }
  }

  function showPlanned() {
    if (!S.selDate || !S.system) return;
    $('#add-planned').classList.remove('hidden');
    $('#planned-date-label').textContent = fmtDate(S.selDate);
    updLeaveOpts();
  }

  function updLeaveOpts() {
    const sel = $('#planned-type');
    sel.innerHTML = '';
    const opts = S.system === 'A' ? ['VAC','HPT','SICK'] : ['PTO'];
    opts.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; sel.appendChild(o); });
  }

  function addPlanned() {
    if (!S.selDate || !S.system) return;
    S.entries.push({
      date: new Date(S.selDate),
      type: $('#planned-type').value,
      hours: parseFloat($('#planned-hours').value) || 8,
      status: 'Planned',
      id: uid(),
    });
    $('#add-planned').classList.add('hidden');
    renderCal(); renderTable(); recalc(); save();
  }

  /* ── UI: TABLE ───────────────────────────────────────────── */

  function renderTable() {
    const tb = $('#timeoff-tbody');
    const sp = $('#show-past').checked, sf = $('#show-future').checked;
    const today = new Date(); today.setHours(0,0,0,0);
    const sorted = [...S.entries].sort((a, b) => a.date - b.date);

    tb.innerHTML = '';
    let totH = 0, cnt = 0;

    for (const e of sorted) {
      const past = e.date < today;
      if (past && !sp) continue;
      if (!past && !sf) continue;
      totH += e.hours; cnt++;

      const tr = document.createElement('tr');
      const tc = `tag-${e.type.toLowerCase()}`;
      tr.innerHTML = `
        <td>${sDate(e.date)}</td>
        <td><span class="tag ${tc}">${e.type}</span></td>
        <td>${e.hours.toFixed(2)}</td>
        <td><span class="tag ${e.status === 'Approved' ? 'tag-approved' : 'tag-planned'}">${e.status}</span></td>
        <td>
          <select class="edit-type" data-id="${e.id}">
            ${(S.system === 'A' ? ['VAC','HPT','SICK'] : ['PTO']).map(t =>
              `<option value="${t}" ${e.type === t ? 'selected' : ''}>${t}</option>`
            ).join('')}
          </select>
          ${e.status === 'Planned' ? `<button class="btn-danger" data-id="${e.id}">DEL</button>` : ''}
        </td>`;
      tb.appendChild(tr);
    }

    $('#table-summary').textContent = `${cnt} entries — ${totH.toFixed(1)} hrs (${(totH / 8).toFixed(1)} days)`;

   tb.querySelectorAll('.edit-type').forEach(sel => {
      sel.addEventListener('change', () => {
        const entry = S.entries.find(e => e.id === sel.dataset.id);
        if (entry) { entry.type = sel.value; renderCal(); recalc(); save(); }
      });
    });

    tb.querySelectorAll('.btn-danger').forEach(b => {
      b.addEventListener('click', () => {
        S.entries = S.entries.filter(e => e.id !== b.dataset.id);
        renderTable(); renderCal(); recalc(); save();
      });
    });

  /* ── UI: METERS ──────────────────────────────────────────── */

  function renderMeters() {
    const c = $('#meters-container');
    c.innerHTML = '';

    if (!S.system || !S.hireDate || !S.balDate) {
      c.innerHTML = '<p class="hint">Fill in employee info and balances above to see bank health meters.</p>';
      $('#sick-widget').classList.add('hidden');
      return;
    }

    const banks = S.system === 'A' ? ['HPT','VAC','SICK'] : ['PTO'];

    for (const b of banks) {
      const d = calcMeter(b);
      if (!d) continue;
      const card = document.createElement('div');
      card.className = 'meter-card';
      card.innerHTML = d.isSick ? sickMeterHTML(d) : stdMeterHTML(d);
      c.appendChild(card);
    }

    requestAnimationFrame(drawCanvases);

    if (S.system === 'A') renderSickWidget(); else $('#sick-widget').classList.add('hidden');
  }

  function stdMeterHTML(d) {
    const pos = clamp(d.dRatio / 2.5, 0, 1) * 100;
    const col = meterColor(d.dRatio / 2.5);
    const names = { HPT: 'HPT (Holiday / Personal)', VAC: 'Vacation', PTO: 'PTO' };
    return `
      <div class="meter-top">
        <span class="meter-name">${names[d.bank] || d.bank}</span>
        <span class="meter-bal">${d.curBal.toFixed(1)} / ${d.cap} hrs</span>
      </div>
      <div class="meter-axis"><span>Not using enough</span><span>Balanced</span><span>Using too much</span></div>
      <div class="meter-track">
        <canvas class="meter-canvas" data-kind="std"></canvas>
        <div class="meter-midline"></div>
        <div class="meter-needle" style="left:${pos}%"></div>
      </div>
      <div class="meter-msg" style="border-left-color:${col}">${d.msg}</div>`;
  }

  function sickMeterHTML(d) {
    const pos = clamp(d.dRatio, 0, 1) * 100;
    const col = sickColor(d.dRatio);
    return `
      <div class="meter-top">
        <span class="meter-name">Sick Leave</span>
        <span class="meter-bal">${d.curBal.toFixed(1)} / ${d.cap} hrs</span>
      </div>
      <div class="meter-axis"><span>Low — use less</span><span>Banking well</span></div>
      <div class="meter-track">
        <canvas class="meter-canvas" data-kind="sick"></canvas>
        <div class="meter-needle" style="left:${pos}%"></div>
      </div>
      <div class="meter-msg" style="border-left-color:${col}">${d.msg}</div>`;
  }

  function drawCanvases() {
    $$('.meter-canvas').forEach(cv => {
      const kind = cv.dataset.kind;
      const rect = cv.parentElement.getBoundingClientRect();
      cv.width = rect.width;
      cv.height = rect.height;
      const ctx = cv.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, cv.width, 0);

      if (kind === 'sick') {
        g.addColorStop(0, '#cc0000');
        g.addColorStop(0.3, '#cc6600');
        g.addColorStop(0.55, '#cccc00');
        g.addColorStop(0.8, '#66aa00');
        g.addColorStop(1, '#00aa00');
      } else {
        g.addColorStop(0, '#cc0000');
        g.addColorStop(0.18, '#cc6600');
        g.addColorStop(0.33, '#cccc00');
        g.addColorStop(0.5, '#00aa00');
        g.addColorStop(0.67, '#cccc00');
        g.addColorStop(0.82, '#cc6600');
        g.addColorStop(1, '#cc0000');
      }

      ctx.fillStyle = g;
      const r = cv.height / 2;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(cv.width - r, 0);
      ctx.arcTo(cv.width, 0, cv.width, r, r);
      ctx.arcTo(cv.width, cv.height, cv.width - r, cv.height, r);
      ctx.lineTo(r, cv.height);
      ctx.arcTo(0, cv.height, 0, r, r);
      ctx.arcTo(0, 0, r, 0, r);
      ctx.closePath();
      ctx.fill();
    });
  }

  // Color interpolation for meter message border
  function meterColor(pos) {
    return interp([
      [0,.80,0,0],[.18,.80,.40,0],[.33,.80,.80,0],[.5,0,.67,0],[.67,.80,.80,0],[.82,.80,.40,0],[1,.80,0,0]
    ], clamp(pos, 0, 1));
  }
  function sickColor(pos) {
    return interp([
      [0,.80,0,0],[.3,.80,.40,0],[.55,.80,.80,0],[.8,.40,.67,0],[1,0,.67,0]
    ], clamp(pos, 0, 1));
  }
  function interp(stops, p) {
    for (let i = 0; i < stops.length - 1; i++) {
      if (p >= stops[i][0] && p <= stops[i+1][0]) {
        const t = (p - stops[i][0]) / (stops[i+1][0] - stops[i][0]);
        const r = Math.round((stops[i][1] + t * (stops[i+1][1] - stops[i][1])) * 255);
        const g = Math.round((stops[i][2] + t * (stops[i+1][2] - stops[i][2])) * 255);
        const b = Math.round((stops[i][3] + t * (stops[i+1][3] - stops[i][3])) * 255);
        return `rgb(${r},${g},${b})`;
      }
    }
    const l = stops[stops.length - 1];
    return `rgb(${Math.round(l[1]*255)},${Math.round(l[2]*255)},${Math.round(l[3]*255)})`;
  }

  /* ── SICK WIDGET ─────────────────────────────────────────── */

  function renderSickWidget() {
    if (S.system !== 'A') { $('#sick-widget').classList.add('hidden'); return; }
    $('#sick-widget').classList.remove('hidden');

    const bal = S.bal.SICK || 0;
    const tier = sickTierLabel(bal);
    const coHrs = sickCashoutHrs(bal);
    const annAcc = aph() * SICK_R;
    const yToMax = annAcc > 0 ? ((SICK_CAP - bal) / annAcc).toFixed(1) : '?';

    let hToNext = 0, nextLbl = '';
    if (bal < 8) { hToNext = 8 - bal; nextLbl = '25% (8 hrs)'; }
    else if (bal < 401) { hToNext = 401 - bal; nextLbl = '37.5% (401 hrs)'; }
    else if (bal < 801) { hToNext = 801 - bal; nextLbl = '50% (801 hrs)'; }
    else { nextLbl = 'Max tier reached'; }

    let html = `
      <div class="ws"><span class="ws-val">${bal.toFixed(1)} hrs</span><span class="ws-label">Current Sick Bank</span></div>
      <div class="ws"><span class="ws-val">${tier.pct}</span><span class="ws-label">Cashout Tier (${tier.label})</span></div>`;

    if (S.rate) {
      const val = coHrs * S.rate;
      const maxVal = sickCashoutHrs(SICK_CAP) * S.rate;
      html += `<div class="ws glow"><span class="ws-val">$${fmtK(val)}</span><span class="ws-label">Est. Cashout Value</span></div>`;
      html += `<div class="ws"><span class="ws-val">$${fmtK(maxVal)}</span><span class="ws-label">Max Cashout (1,200 hrs)</span></div>`;
    } else {
      html += `<div class="ws"><span class="ws-val">${coHrs.toFixed(1)} hrs</span><span class="ws-label">Est. Cashout Hours</span></div>`;
    }

    html += `<div class="ws"><span class="ws-val">${hToNext > 0 ? hToNext.toFixed(0) + ' hrs' : nextLbl}</span><span class="ws-label">${hToNext > 0 ? 'To Next Tier (' + nextLbl + ')' : 'Tier Status'}</span></div>`;
    html += `<div class="ws"><span class="ws-val">~${yToMax} yrs</span><span class="ws-label">Years to Max (1,200)</span></div>`;

    $('#sick-widget-content').innerHTML = html;
  }

  function fmtK(n) { return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  /* ── RECALCULATE ─────────────────────────────────────────── */
  function recalc() { renderMeters(); }

  /* ── LOCALSTORAGE ────────────────────────────────────────── */

  function save() {
    try {
      localStorage.setItem('cba-to', JSON.stringify({
        hireDate: S.hireDate ? ds(S.hireDate) : null,
        fte: S.fte, unit: S.unit,
        bal: S.bal,
        balDate: S.balDate ? ds(S.balDate) : null,
        rate: S.rate,
        entries: S.entries.map(e => ({ date: ds(e.date), type: e.type, hours: e.hours, status: e.status, id: e.id })),
      }));
    } catch (_) {}
  }

  function load() {
    try {
      const raw = localStorage.getItem('cba-to');
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.hireDate) { $('#hire-date').value = d.hireDate; S.hireDate = pld(d.hireDate); }
      if (d.fte != null) { S.fte = d.fte; $('#fte').value = String(d.fte); }
      if (d.unit != null) { S.unit = d.unit; $('#unit').value = String(d.unit); }
      if (d.bal) {
        S.bal = d.bal;
        if (d.bal.HPT) $('#hpt-balance').value = d.bal.HPT;
        if (d.bal.VAC) $('#vac-balance').value = d.bal.VAC;
        if (d.bal.SICK) $('#sick-balance').value = d.bal.SICK;
        if (d.bal.PTO) $('#pto-balance').value = d.bal.PTO;
      }
      if (d.balDate) { S.balDate = pld(d.balDate); $('#balance-date').value = d.balDate; }
      if (d.rate) { S.rate = d.rate; $('#hourly-rate').value = d.rate; }
      if (d.entries) S.entries = d.entries.map(e => ({ ...e, date: pld(e.date) }));
      updSystem();
    } catch (_) {}
  }

  /* ── INIT ────────────────────────────────────────────────── */

  function init() {
    load();

    // Employee info
    $('#hire-date').addEventListener('change', () => { updSystem(); save(); });
    $('#fte').addEventListener('change', () => { S.fte = parseFloat($('#fte').value); recalc(); save(); });
    $('#unit').addEventListener('change', () => { S.unit = parseInt($('#unit').value); updLeaveOpts(); recalc(); save(); });

    // Balances
    ['hpt','vac','sick','pto'].forEach(k => {
      $(`#${k}-balance`).addEventListener('input', function () {
        S.bal[k.toUpperCase()] = parseFloat(this.value) || 0;
        recalc(); save();
      });
    });

    $('#balance-date').addEventListener('change', () => {
      S.balDate = $('#balance-date').value ? pld($('#balance-date').value) : null;
      recalc(); save();
    });

    $('#hourly-rate').addEventListener('input', () => {
      S.rate = parseFloat($('#hourly-rate').value) || null;
      recalc(); save();
    });

    // Parse
    $('#parse-btn').addEventListener('click', () => {
      const raw = $('#paste-area').value;
      if (!raw.trim()) {
        $('#parse-status').textContent = 'Nothing to parse.';
        $('#parse-status').className = 'status-msg err';
        return;
      }
      const { entries, unknownTypes } = parseDmls(raw);
      const keys = new Set(S.entries.map(e => `${ds(e.date)}_${e.type}_${e.hours}`));
      let added = 0;
      for (const e of entries) {
        const k = `${ds(e.date)}_${e.type}_${e.hours}`;
        if (!keys.has(k)) { S.entries.push(e); keys.add(k); added++; }
      }
      let msg = `Parsed ${entries.length} entries, added ${added} new.`;
      if (unknownTypes.length) msg += ` Unknown types: ${unknownTypes.join(', ')}`;
      $('#parse-status').textContent = msg;
      $('#parse-status').className = 'status-msg';
      renderCal(); renderTable(); recalc(); save();
    });

    $('#clear-paste-btn').addEventListener('click', () => {
      $('#paste-area').value = '';
      $('#parse-status').textContent = '';
    });

    // Calendar
    $('#cal-prev').addEventListener('click', () => {
      S.calMonth--;
      if (S.calMonth < 0) { S.calMonth = 11; S.calYear--; }
      renderCal();
    });
    $('#cal-next').addEventListener('click', () => {
      S.calMonth++;
      if (S.calMonth > 11) { S.calMonth = 0; S.calYear++; }
      renderCal();
    });

    $('#add-planned-btn').addEventListener('click', addPlanned);
    $('#cancel-planned-btn').addEventListener('click', () => $('#add-planned').classList.add('hidden'));

    // Table filters
    $('#show-past').addEventListener('change', renderTable);
    $('#show-future').addEventListener('change', renderTable);

    // Resize
    window.addEventListener('resize', () => requestAnimationFrame(drawCanvases));

    // Initial render
    renderCal();
    renderTable();
    updSystem();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
