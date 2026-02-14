/* ============================================
   ORBITWATCH — Panels Module
   Drawer System · Speed · Stats · Telemetry
   ============================================ */

(() => {
  'use strict';

  // =============================================
  // DRAWER SYSTEM
  // =============================================
  const panel = document.querySelector('.panel');
  const drawers = document.querySelectorAll('.drawer');
  const drawerBtns = document.querySelectorAll('[data-drawer]');
  const closeBtns = document.querySelectorAll('[data-close-drawer]');
  let activeDrawer = null;

  function openDrawer(id) {
    const drawer = document.getElementById(id);
    if (!drawer) return;

    // Close any open drawer first
    if (activeDrawer && activeDrawer !== drawer) {
      activeDrawer.classList.remove('open');
    }

    // Toggle
    if (activeDrawer === drawer && drawer.classList.contains('open')) {
      closeDrawer();
      return;
    }

    panel.classList.add('panel--hidden');
    drawer.classList.add('open');
    activeDrawer = drawer;

    // Highlight toolbar button
    drawerBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.drawer === id);
    });

    // Trigger panel-specific init
    if (id === 'drawer-speed') initSpeedBars();
    if (id === 'drawer-stats') initStats();
    if (id === 'drawer-telemetry') initTelemetry();
  }

  function closeDrawer() {
    if (activeDrawer) {
      activeDrawer.classList.remove('open');
      activeDrawer = null;
    }
    panel.classList.remove('panel--hidden');

    // Remove active from drawer buttons
    drawerBtns.forEach(btn => btn.classList.remove('active'));
  }

  // Bind drawer buttons
  drawerBtns.forEach(btn => {
    btn.addEventListener('click', () => openDrawer(btn.dataset.drawer));
  });

  // Bind close buttons
  closeBtns.forEach(btn => {
    btn.addEventListener('click', closeDrawer);
  });

  // =============================================
  // SPEED COMPARISON
  // =============================================
  const ISS_SPEED_KMH = 27600;

  const speedComparisons = [
    { name: 'WALKING', speed: 5, icon: '🚶' },
    { name: 'CAR', speed: 120, icon: '🚗' },
    { name: 'BULLET TRAIN', speed: 320, icon: '🚄' },
    { name: 'AIRPLANE', speed: 900, icon: '✈️' },
    { name: 'SOUND', speed: 1235, icon: '🔊' },
    { name: 'BULLET', speed: 2736, icon: '💨' },
    { name: 'SR-71', speed: 3530, icon: '🛩️' },
    { name: 'ISS', speed: ISS_SPEED_KMH, icon: '🛰️', isISS: true },
  ];

  let speedInitialized = false;

  function initSpeedBars() {
    if (speedInitialized) return;
    speedInitialized = true;

    const container = document.getElementById('speed-bars');
    if (!container) return;

    container.innerHTML = '';

    speedComparisons.forEach((item, i) => {
      const percent = (item.speed / ISS_SPEED_KMH) * 100;
      const multiplier = item.isISS ? '' : `${Math.round(ISS_SPEED_KMH / item.speed)}x slower`;

      const bar = document.createElement('div');
      bar.className = `speed-bar ${item.isISS ? 'speed-bar--iss' : ''}`;
      bar.innerHTML = `
        <div class="speed-bar__header">
          <span class="speed-bar__icon">${item.icon}</span>
          <span class="speed-bar__name">${item.name}</span>
          <span class="speed-bar__speed">${item.speed.toLocaleString()} KM/H</span>
        </div>
        <div class="speed-bar__track">
          <div class="speed-bar__fill" style="--target-width: ${Math.max(percent, 0.5)}%"></div>
        </div>
        ${multiplier ? `<span class="speed-bar__mult">${multiplier}</span>` : ''}
      `;
      container.appendChild(bar);

      // Animate bar fill with stagger
      setTimeout(() => {
        const fill = bar.querySelector('.speed-bar__fill');
        if (fill) fill.classList.add('animate');
      }, i * 80);
    });
  }

  // =============================================
  // ISS STATS DASHBOARD
  // =============================================
  const ISS_LAUNCH = new Date('1998-11-20T06:40:00Z');
  const ORBITAL_PERIOD_MIN = 92.68; // minutes per orbit
  const ISS_SPEED_KM_PER_SEC = ISS_SPEED_KMH / 3600;

  let statsInitialized = false;
  let sunriseInterval = null;
  let pageOpenTime = Date.now();

  function initStats() {
    const container = document.getElementById('stats-grid');
    if (!container) return;

    const now = new Date();
    const msSinceLaunch = now - ISS_LAUNCH;
    const daysSinceLaunch = msSinceLaunch / (1000 * 60 * 60 * 24);
    const totalOrbits = Math.floor((daysSinceLaunch * 24 * 60) / ORBITAL_PERIOD_MIN);
    const totalDistKm = totalOrbits * 2 * Math.PI * (6371 + 408); // Earth radius + altitude
    const totalDistBn = (totalDistKm / 1e9).toFixed(2);
    const sunrisesPerDay = Math.floor((24 * 60) / ORBITAL_PERIOD_MIN);

    const stats = [
      { label: 'DAYS IN ORBIT', value: Math.floor(daysSinceLaunch).toLocaleString(), unit: 'DAYS' },
      { label: 'YEARS IN SPACE', value: (daysSinceLaunch / 365.25).toFixed(1), unit: 'YEARS' },
      { label: 'TOTAL ORBITS', value: totalOrbits.toLocaleString(), unit: 'ORBITS' },
      { label: 'DISTANCE TRAVELED', value: totalDistBn, unit: 'BILLION KM' },
      { label: 'SUNRISES PER DAY', value: sunrisesPerDay.toString(), unit: 'SUNRISES' },
      { label: 'ORBITAL PERIOD', value: ORBITAL_PERIOD_MIN.toFixed(1), unit: 'MINUTES' },
    ];

    container.innerHTML = '';
    stats.forEach(stat => {
      const card = document.createElement('div');
      card.className = 'stat-card';
      card.innerHTML = `
        <span class="stat-card__label">${stat.label}</span>
        <span class="stat-card__value">${stat.value}</span>
        <span class="stat-card__unit">${stat.unit}</span>
      `;
      container.appendChild(card);
    });

    // Sunrise counter (ISS sees a sunrise every ~92.68 minutes ≈ 5560 seconds)
    if (!sunriseInterval) {
      const SUNRISE_INTERVAL_SEC = ORBITAL_PERIOD_MIN * 60;
      const counterEl = document.getElementById('sunrise-counter');

      sunriseInterval = setInterval(() => {
        if (counterEl) {
          const elapsed = (Date.now() - pageOpenTime) / 1000;
          const sunrises = Math.floor(elapsed / SUNRISE_INTERVAL_SEC);
          counterEl.textContent = sunrises.toString();
        }
      }, 1000);
    }
  }

  // =============================================
  // TELEMETRY (Estimated)
  // =============================================
  let telemetryInitialized = false;
  let telemetryInterval = null;

  const TELEMETRY_SPECS = {
    solarArrayOutput: { min: 75, max: 120, unit: 'KW', label: 'SOLAR ARRAY OUTPUT' },
    batteryCharge: { min: 60, max: 100, unit: '%', label: 'BATTERY CHARGE' },
    cabinTemp: { min: 18.3, max: 26.7, decimals: 1, unit: '°C', label: 'CABIN TEMPERATURE' },
    cabinPressure: { min: 979, max: 1027, unit: 'hPa', label: 'CABIN PRESSURE' },
    o2Level: { min: 19.5, max: 23.5, decimals: 1, unit: '%', label: 'O₂ LEVEL' },
    co2Level: { min: 0.1, max: 0.5, decimals: 2, unit: '%', label: 'CO₂ LEVEL' },
    humidity: { min: 25, max: 75, unit: '%', label: 'HUMIDITY' },
    solarAngle: { min: 0, max: 360, unit: '°', label: 'SOLAR ARRAY ANGLE' },
  };

  function generateTelemetryValue(spec) {
    const range = spec.max - spec.min;
    // Use a sine wave with noise to simulate realistic fluctuation
    const t = Date.now() / 60000; // slowly changing
    const base = spec.min + range * (0.5 + 0.4 * Math.sin(t * 0.7));
    const noise = (Math.random() - 0.5) * range * 0.05;
    let value = Math.max(spec.min, Math.min(spec.max, base + noise));
    if (spec.decimals !== undefined) {
      value = value.toFixed(spec.decimals);
    } else {
      value = Math.round(value);
    }
    return value;
  }

  function initTelemetry() {
    renderTelemetry();

    if (!telemetryInterval) {
      telemetryInterval = setInterval(renderTelemetry, 3000);
    }
  }

  function renderTelemetry() {
    const container = document.getElementById('telemetry-grid');
    if (!container) return;

    // Only create cards once, then update values
    if (container.children.length === 0) {
      Object.keys(TELEMETRY_SPECS).forEach(key => {
        const spec = TELEMETRY_SPECS[key];
        const card = document.createElement('div');
        card.className = 'telemetry-card';
        card.id = `telem-${key}`;
        card.innerHTML = `
          <span class="telemetry-card__label">${spec.label}</span>
          <div class="telemetry-card__row">
            <span class="telemetry-card__value">—</span>
            <span class="telemetry-card__unit">${spec.unit}</span>
          </div>
          <div class="telemetry-card__bar">
            <div class="telemetry-card__fill"></div>
          </div>
        `;
        container.appendChild(card);
      });
    }

    // Update values
    Object.keys(TELEMETRY_SPECS).forEach(key => {
      const spec = TELEMETRY_SPECS[key];
      const card = document.getElementById(`telem-${key}`);
      if (!card) return;

      const val = generateTelemetryValue(spec);
      const numVal = parseFloat(val);
      const percent = ((numVal - spec.min) / (spec.max - spec.min)) * 100;

      const valueEl = card.querySelector('.telemetry-card__value');
      const fillEl = card.querySelector('.telemetry-card__fill');

      if (valueEl) {
        valueEl.textContent = typeof val === 'number' ? val.toLocaleString() : val;
        valueEl.classList.add('updating');
        setTimeout(() => valueEl.classList.remove('updating'), 600);
      }
      if (fillEl) {
        fillEl.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        // Color based on how "normal" the value is (green in middle, yellow at edges)
        if (percent > 30 && percent < 70) {
          fillEl.style.background = 'var(--accent)';
        } else if (percent > 15 && percent < 85) {
          fillEl.style.background = '#ffc107';
        } else {
          fillEl.style.background = '#ff5252';
        }
      }
    });
  }

  // =============================================
  // LIVE CAMERA — Source Switching
  // =============================================
  const cameraSrcBtns = document.querySelectorAll('.camera-src-btn');
  const cameraIframe = document.getElementById('camera-iframe');

  cameraSrcBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const src = btn.dataset.src;
      if (cameraIframe && src) {
        cameraIframe.src = src;
        cameraSrcBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
    });
  });

  // =============================================
  // AMBIENT SOUND — Web Audio API Generator
  // =============================================
  let audioCtx = null;
  let audioNodes = [];
  let soundActive = false;
  const btnSound = document.getElementById('btn-sound');

  function createAmbientSound() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Master gain
    const masterGain = audioCtx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(audioCtx.destination);

    // Layer 1: Low drone (deep hum like ISS ventilation)
    const drone = audioCtx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 55; // Low A
    const droneGain = audioCtx.createGain();
    droneGain.gain.value = 0.15;
    drone.connect(droneGain);
    droneGain.connect(masterGain);
    drone.start();

    // Layer 2: Second drone, slightly detuned for richness
    const drone2 = audioCtx.createOscillator();
    drone2.type = 'sine';
    drone2.frequency.value = 55.3;
    const drone2Gain = audioCtx.createGain();
    drone2Gain.gain.value = 0.1;
    drone2.connect(drone2Gain);
    drone2Gain.connect(masterGain);
    drone2.start();

    // Layer 3: Filtered white noise (air circulation / static)
    const noiseSize = audioCtx.sampleRate * 2;
    const noiseBuffer = audioCtx.createBuffer(1, noiseSize, audioCtx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseSize; i++) {
      noiseData[i] = Math.random() * 2 - 1;
    }

    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 400;
    noiseFilter.Q.value = 1;

    const noiseGain = audioCtx.createGain();
    noiseGain.gain.value = 0.06;

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(masterGain);
    noise.start();

    // Layer 4: Very low sub-bass rumble
    const sub = audioCtx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.value = 30;
    const subGain = audioCtx.createGain();
    subGain.gain.value = 0.08;
    sub.connect(subGain);
    subGain.connect(masterGain);
    sub.start();

    // Slow filter sweep on noise for organic motion
    const lfo = audioCtx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.05; // Very slow
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 200;
    lfo.connect(lfoGain);
    lfoGain.connect(noiseFilter.frequency);
    lfo.start();

    // Fade in
    masterGain.gain.setTargetAtTime(0.6, audioCtx.currentTime, 1.5);

    audioNodes = { masterGain, drone, drone2, noise, sub, lfo };
    return audioCtx;
  }

  function toggleSound() {
    if (soundActive) {
      // Fade out and stop
      if (audioNodes.masterGain) {
        audioNodes.masterGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.5);
        setTimeout(() => {
          if (audioCtx) {
            audioCtx.close();
            audioCtx = null;
            audioNodes = [];
          }
        }, 2000);
      }
      soundActive = false;
      if (btnSound) btnSound.classList.remove('active');
    } else {
      // Start
      createAmbientSound();
      soundActive = true;
      if (btnSound) btnSound.classList.add('active');
    }
  }

  if (btnSound) {
    btnSound.addEventListener('click', toggleSound);
  }

})();
