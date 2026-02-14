/* ============================================
   ORBITWATCH — Predictions Module
   ISS Pass Prediction · Meteor Shower Alerts
   ============================================ */

(() => {
  'use strict';

  // =============================================
  // ISS PASS PREDICTION (satellite.js + TLE)
  // =============================================
  const TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE';
  const MIN_ELEVATION_DEG = 10; // minimum pass elevation to consider "visible"

  let tleData = null; // { satrec, name }
  let userLocation = null; // { lat, lng, alt }
  let passesComputed = false;

  // Fetch ISS TLE from CelesTrak
  async function fetchTLE() {
    try {
      const res = await fetch(TLE_URL);
      if (!res.ok) throw new Error(`TLE fetch HTTP ${res.status}`);
      const text = await res.text();
      const lines = text.trim().split('\n').map(l => l.trim());

      if (lines.length >= 3) {
        const satrec = satellite.twoline2satrec(lines[1], lines[2]);
        tleData = { satrec, name: lines[0] };
        return true;
      }
      // Try 2-line format
      if (lines.length >= 2) {
        const satrec = satellite.twoline2satrec(lines[0], lines[1]);
        tleData = { satrec, name: 'ISS (ZARYA)' };
        return true;
      }
    } catch (err) {
      console.warn('TLE fetch failed:', err);
    }
    return false;
  }

  // Request geolocation
  function requestLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => {
          userLocation = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            alt: (pos.coords.altitude || 0) / 1000, // km
          };
          resolve(userLocation);
        },
        err => reject(err),
        { enableHighAccuracy: false, timeout: 10000 }
      );
    });
  }

  // Compute ISS passes for the next 48 hours
  function computePasses(observerLat, observerLng, observerAlt) {
    if (!tleData) return [];

    const passes = [];
    const now = new Date();
    const end = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const stepMs = 10000; // 10-second steps
    const observerGd = {
      longitude: satellite.degreesToRadians(observerLng),
      latitude: satellite.degreesToRadians(observerLat),
      height: observerAlt,
    };

    let inPass = false;
    let currentPass = null;
    let maxEl = 0;

    for (let t = now.getTime(); t < end.getTime(); t += stepMs) {
      const date = new Date(t);
      const posVel = satellite.propagate(tleData.satrec, date);
      if (!posVel.position) continue;

      const gmst = satellite.gstime(date);
      const posEcf = satellite.eciToEcf(posVel.position, gmst);
      const lookAngles = satellite.ecfToLookAngles(observerGd, posEcf);
      const elDeg = satellite.radiansToDegrees(lookAngles.elevation);
      const azDeg = satellite.radiansToDegrees(lookAngles.azimuth);

      if (elDeg >= MIN_ELEVATION_DEG) {
        if (!inPass) {
          inPass = true;
          maxEl = elDeg;
          currentPass = {
            start: date,
            startAz: azDeg,
            maxEl: elDeg,
            maxElTime: date,
            end: date,
            endAz: azDeg,
          };
        }
        if (elDeg > maxEl) {
          maxEl = elDeg;
          currentPass.maxEl = elDeg;
          currentPass.maxElTime = date;
        }
        currentPass.end = date;
        currentPass.endAz = azDeg;
      } else if (inPass) {
        inPass = false;
        passes.push({ ...currentPass });
        currentPass = null;
        maxEl = 0;
        if (passes.length >= 5) break;
      }
    }

    return passes;
  }

  // Format pass for display
  function formatPass(pass, index) {
    const now = new Date();
    const diffMs = pass.start - now;
    const isNext = diffMs > 0;

    let timeLabel;
    if (diffMs < 0) {
      timeLabel = 'HAPPENING NOW';
    } else if (diffMs < 3600000) {
      timeLabel = `IN ${Math.ceil(diffMs / 60000)} MIN`;
    } else if (diffMs < 86400000) {
      timeLabel = `IN ${Math.round(diffMs / 3600000)} HRS`;
    } else {
      timeLabel = `IN ${Math.round(diffMs / 86400000)} DAYS`;
    }

    const duration = Math.round((pass.end - pass.start) / 1000);
    const maxElFormatted = Math.round(pass.maxEl);
    const brightness = maxElFormatted > 40 ? 'EXCELLENT' : maxElFormatted > 20 ? 'GOOD' : 'FAIR';

    const startTime = pass.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const endTime = pass.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = pass.start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

    return `
      <div class="pass-card ${index === 0 && isNext ? 'pass-card--next' : ''}">
        <div class="pass-card__header">
          <span class="pass-card__date">${dateStr}</span>
          <span class="pass-card__countdown">${timeLabel}</span>
        </div>
        <div class="pass-card__details">
          <div class="pass-card__time">
            <span class="pass-card__big">${startTime}</span>
            <span class="pass-card__arrow">→</span>
            <span class="pass-card__big">${endTime}</span>
          </div>
          <div class="pass-card__meta">
            <span>⏱ ${duration}s</span>
            <span>📐 ${maxElFormatted}°</span>
            <span>👁 ${brightness}</span>
          </div>
        </div>
      </div>
    `;
  }

  // Render passes into drawer
  async function initPassPrediction() {
    const container = document.getElementById('passes-list');
    const statusEl = document.getElementById('passes-status');
    if (!container) return;

    // Step 1: show loading
    statusEl.textContent = 'Fetching ISS orbital data...';
    container.innerHTML = '';

    // Step 2: fetch TLE
    if (!tleData) {
      const ok = await fetchTLE();
      if (!ok) {
        statusEl.textContent = 'Failed to fetch orbital data. Try again later.';
        return;
      }
    }

    // Step 3: get location
    if (!userLocation) {
      statusEl.textContent = 'Requesting your location...';
      try {
        await requestLocation();
      } catch (err) {
        statusEl.textContent = 'Location access denied. Cannot compute passes.';
        container.innerHTML = `<p class="pass-error">Enable location access and try again.</p>`;
        return;
      }
    }

    statusEl.textContent = `Passes for ${userLocation.lat.toFixed(2)}°, ${userLocation.lng.toFixed(2)}°`;

    // Step 4: compute passes
    const passes = computePasses(userLocation.lat, userLocation.lng, userLocation.alt || 0);
    if (passes.length === 0) {
      container.innerHTML = `<p class="pass-error">No visible passes in the next 48 hours.</p>`;
      return;
    }

    container.innerHTML = passes.map((p, i) => formatPass(p, i)).join('');
  }


  // =============================================
  // METEOR SHOWER CALENDAR
  // =============================================
  // Major annual meteor showers with typical peak dates
  const METEOR_SHOWERS = [
    { name: 'Quadrantids', peak: '01-03', start: '12-28', end: '01-12', rate: 120, parent: '2003 EH1' },
    { name: 'Lyrids', peak: '04-22', start: '04-16', end: '04-25', rate: 18, parent: 'C/1861 G1 (Thatcher)' },
    { name: 'Eta Aquariids', peak: '05-06', start: '04-19', end: '05-28', rate: 50, parent: '1P/Halley' },
    { name: 'Delta Aquariids', peak: '07-30', start: '07-12', end: '08-23', rate: 25, parent: '96P/Machholz' },
    { name: 'Perseids', peak: '08-12', start: '07-17', end: '08-24', rate: 100, parent: '109P/Swift-Tuttle' },
    { name: 'Draconids', peak: '10-08', start: '10-06', end: '10-10', rate: 10, parent: '21P/Giacobini-Zinner' },
    { name: 'Orionids', peak: '10-21', start: '10-02', end: '11-07', rate: 20, parent: '1P/Halley' },
    { name: 'Leonids', peak: '11-17', start: '11-06', end: '11-30', rate: 15, parent: '55P/Tempel-Tuttle' },
    { name: 'Geminids', peak: '12-14', start: '12-04', end: '12-17', rate: 150, parent: '3200 Phaethon' },
    { name: 'Ursids', peak: '12-22', start: '12-17', end: '12-26', rate: 10, parent: '8P/Tuttle' },
  ];

  function parseMMDD(mmdd, year) {
    const [m, d] = mmdd.split('-').map(Number);
    return new Date(year, m - 1, d);
  }

  function getActiveAndUpcomingShowers() {
    const now = new Date();
    const year = now.getFullYear();
    const active = [];
    const upcoming = [];

    METEOR_SHOWERS.forEach(shower => {
      let start = parseMMDD(shower.start, year);
      let end = parseMMDD(shower.end, year);
      let peak = parseMMDD(shower.peak, year);

      // Handle Quadrantids wrapping around year boundary
      if (end < start) {
        if (now.getMonth() < 6) {
          start = parseMMDD(shower.start, year - 1);
        } else {
          end = parseMMDD(shower.end, year + 1);
          peak = parseMMDD(shower.peak, year + 1);
        }
      }

      const isPeak = Math.abs(now - peak) < 24 * 60 * 60 * 1000;
      const isActive = now >= start && now <= end;
      const daysUntilStart = Math.ceil((start - now) / (1000 * 60 * 60 * 24));

      if (isActive) {
        active.push({ ...shower, isPeak, daysUntilPeak: Math.ceil((peak - now) / (1000 * 60 * 60 * 24)) });
      } else if (daysUntilStart > 0 && daysUntilStart <= 60) {
        upcoming.push({ ...shower, daysUntilStart });
      }
    });

    return { active, upcoming };
  }

  function initMeteorShower() {
    const container = document.getElementById('meteor-content');
    if (!container) return;

    const { active, upcoming } = getActiveAndUpcomingShowers();

    let html = '';

    if (active.length > 0) {
      html += `<div class="meteor-section"><span class="meteor-section__label">ACTIVE NOW</span>`;
      active.forEach(s => {
        html += `
          <div class="meteor-card ${s.isPeak ? 'meteor-card--peak' : ''}">
            <div class="meteor-card__header">
              <span class="meteor-card__name">${s.name}</span>
              ${s.isPeak ? '<span class="meteor-card__badge">PEAK!</span>' : ''}
            </div>
            <div class="meteor-card__stats">
              <span>☄️ ~${s.rate}/hr</span>
              <span>🌠 ${s.parent}</span>
              ${s.isPeak ? '<span>🔥 TONIGHT</span>' : `<span>📅 Peak in ${s.daysUntilPeak} days</span>`}
            </div>
          </div>
        `;
      });
      html += `</div>`;
    }

    if (upcoming.length > 0) {
      html += `<div class="meteor-section"><span class="meteor-section__label">COMING SOON</span>`;
      upcoming.forEach(s => {
        html += `
          <div class="meteor-card">
            <div class="meteor-card__header">
              <span class="meteor-card__name">${s.name}</span>
              <span class="meteor-card__countdown">${s.daysUntilStart} DAYS</span>
            </div>
            <div class="meteor-card__stats">
              <span>☄️ ~${s.rate}/hr</span>
              <span>🌠 ${s.parent}</span>
            </div>
          </div>
        `;
      });
      html += `</div>`;
    }

    if (active.length === 0 && upcoming.length === 0) {
      html = `<p class="pass-error">No meteor showers active or upcoming in the next 60 days.</p>`;
    }

    container.innerHTML = html;

    // Update badge
    updateMeteorBadge(active);
  }

  function updateMeteorBadge(activeShowers) {
    const btn = document.getElementById('btn-meteor');
    if (!btn) return;

    const existingBadge = btn.querySelector('.toolbar__badge');
    if (existingBadge) existingBadge.remove();

    if (activeShowers.length > 0) {
      const badge = document.createElement('span');
      badge.className = 'toolbar__badge';
      const hasPeak = activeShowers.some(s => s.isPeak);
      if (hasPeak) badge.classList.add('toolbar__badge--peak');
      btn.appendChild(badge);
    }
  }

  // =============================================
  // INITIALIZE — hook into drawer system from panels.js
  // =============================================
  // Listen for drawer open events from panels.js
  // We hook into the existing drawer button system
  const btnPasses = document.getElementById('btn-passes');
  const btnMeteor = document.getElementById('btn-meteor');

  if (btnPasses) {
    // Intercept the drawer open to trigger pass prediction init
    const origClick = btnPasses.onclick;
    btnPasses.addEventListener('click', () => {
      setTimeout(initPassPrediction, 100);
    });
  }

  if (btnMeteor) {
    btnMeteor.addEventListener('click', () => {
      setTimeout(initMeteorShower, 100);
    });
  }

  // Check for active meteor showers on page load to show badge
  setTimeout(() => {
    const { active } = getActiveAndUpcomingShowers();
    updateMeteorBadge(active);
  }, 1000);

})();
