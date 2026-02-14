/* ============================================
   ORBITWATCH — Core Application Logic
   ISS Tracking · 3D Globe · Day/Night · Clouds
   ============================================ */

import * as solar from 'https://esm.sh/solar-calculator';
import { Mesh, MeshPhongMaterial, ShaderMaterial, SphereGeometry, TextureLoader, Vector2 } from 'https://esm.sh/three';

(() => {
  'use strict';

  // --- Config ---
  const CONFIG = {
    ISS_API: 'https://api.wheretheiss.at/v1/satellites/25544',
    ASTROS_API: 'https://corquaid.github.io/international-space-station-APIs/JSON/people-in-space.json',
    GEOCODE_API: 'https://nominatim.openstreetmap.org/reverse',
    UPDATE_INTERVAL: 5000,
    TRAIL_MAX: 60,
    // Textures
    DAY_TEXTURE: 'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-day.jpg',
    NIGHT_TEXTURE: 'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg',
    GLOBE_BUMP: 'https://unpkg.com/three-globe@2.41.2/example/img/earth-topology.png',
    CLOUD_TEXTURE: 'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-clouds.png',
  };

  // --- Day/Night GLSL Shader ---
  const DAY_NIGHT_SHADER = {
    vertexShader: `
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      #define PI 3.141592653589793
      uniform sampler2D dayTexture;
      uniform sampler2D nightTexture;
      uniform vec2 sunPosition;
      uniform vec2 globeRotation;
      uniform float dayNightEnabled;
      varying vec3 vNormal;
      varying vec2 vUv;

      float toRad(in float a) {
        return a * PI / 180.0;
      }

      vec3 Polar2Cartesian(in vec2 c) {
        float theta = toRad(90.0 - c.x);
        float phi = toRad(90.0 - c.y);
        return vec3(
          sin(phi) * cos(theta),
          cos(phi),
          sin(phi) * sin(theta)
        );
      }

      void main() {
        vec4 dayColor = texture2D(dayTexture, vUv);
        vec4 nightColor = texture2D(nightTexture, vUv);

        if (dayNightEnabled < 0.5) {
          gl_FragColor = nightColor;
          return;
        }

        float invLon = toRad(globeRotation.x);
        float invLat = -toRad(globeRotation.y);
        mat3 rotX = mat3(
          1, 0, 0,
          0, cos(invLat), -sin(invLat),
          0, sin(invLat), cos(invLat)
        );
        mat3 rotY = mat3(
          cos(invLon), 0, sin(invLon),
          0, 1, 0,
          -sin(invLon), 0, cos(invLon)
        );
        vec3 rotatedSunDirection = rotX * rotY * Polar2Cartesian(sunPosition);
        float intensity = dot(normalize(vNormal), normalize(rotatedSunDirection));
        float blendFactor = smoothstep(-0.15, 0.15, intensity);
        gl_FragColor = mix(nightColor, dayColor, blendFactor);
      }
    `
  };

  // --- State ---
  const state = {
    globe: null,
    trailPoints: [],
    issData: [{ lat: 0, lng: 0, alt: 0.06 }],
    ringsData: [],
    lastGeocode: 0,
    // Phase 1
    dayNightEnabled: true,
    cloudsEnabled: true,
    cloudMesh: null,
    globeMaterial: null,
  };

  // --- DOM Refs ---
  const DOM = {
    lat: document.getElementById('lat'),
    lng: document.getElementById('lng'),
    altitude: document.getElementById('altitude'),
    velocity: document.getElementById('velocity'),
    crewCount: document.getElementById('crew-count'),
    crewList: document.getElementById('crew-list'),
    location: document.getElementById('location'),
    globeEl: document.getElementById('globe'),
    btnDayNight: document.getElementById('btn-daynight'),
    btnClouds: document.getElementById('btn-clouds'),
  };

  // --- Compute Sun Position ---
  function getSunPosition(dt) {
    const day = new Date(+dt).setUTCHours(0, 0, 0, 0);
    const t = solar.century(dt);
    const longitude = (day - dt) / 864e5 * 360 - 180;
    return [longitude - solar.equationOfTime(t) / 4, solar.declination(t)];
  }

  // --- Initialize 3D Globe ---
  function initGlobe() {
    const width = DOM.globeEl.offsetWidth;
    const height = DOM.globeEl.offsetHeight;
    const loader = new TextureLoader();

    // Load textures
    Promise.all([
      loader.loadAsync(CONFIG.DAY_TEXTURE),
      loader.loadAsync(CONFIG.NIGHT_TEXTURE),
    ]).then(([dayTex, nightTex]) => {
      // Create ShaderMaterial for day/night
      state.globeMaterial = new ShaderMaterial({
        uniforms: {
          dayTexture: { value: dayTex },
          nightTexture: { value: nightTex },
          sunPosition: { value: new Vector2() },
          globeRotation: { value: new Vector2() },
          dayNightEnabled: { value: 1.0 },
        },
        vertexShader: DAY_NIGHT_SHADER.vertexShader,
        fragmentShader: DAY_NIGHT_SHADER.fragmentShader,
      });

      state.globe = Globe()
        .width(width)
        .height(height)
        .backgroundColor('rgba(0,0,0,0)')
        .showAtmosphere(true)
        .atmosphereColor('#00e5ff')
        .atmosphereAltitude(0.15)
        .globeMaterial(state.globeMaterial)
        .bumpImageUrl(CONFIG.GLOBE_BUMP)
        // ISS Point
        .pointsData(state.issData)
        .pointAltitude('alt')
        .pointColor(() => '#00e5ff')
        .pointRadius(0.6)
        .pointsMerge(false)
        // Rings (pulse effect at ISS location)
        .ringsData(state.ringsData)
        .ringLat('lat')
        .ringLng('lng')
        .ringColor(() => t => `rgba(0, 229, 255, ${1 - t})`)
        .ringMaxRadius(3)
        .ringPropagationSpeed(2)
        .ringRepeatPeriod(1200)
        // Orbit trail as path
        .pathsData([])
        .pathPointLat(p => p[0])
        .pathPointLng(p => p[1])
        .pathColor(() => ['rgba(0, 229, 255, 0.05)', 'rgba(0, 229, 255, 0.6)'])
        .pathStroke(1.5)
        .pathDashLength(0.01)
        .pathDashGap(0)
        .pathDashAnimateTime(0)
        // Track globe rotation for shader
        .onZoom(({ lng, lat }) => {
          if (state.globeMaterial) {
            state.globeMaterial.uniforms.globeRotation.value.set(lng, lat);
          }
        })
        (DOM.globeEl);

      // Set initial camera angle
      state.globe.pointOfView({ lat: 20, lng: 0, altitude: 2.5 }, 0);

      // Auto-rotate
      state.globe.controls().autoRotate = true;
      state.globe.controls().autoRotateSpeed = 0.3;
      state.globe.controls().enableDamping = true;
      state.globe.controls().dampingFactor = 0.1;

      // Add cloud layer
      initClouds(loader);

      // Start sun position animation
      animateSun();

      // Start data fetching
      fetchISSPosition();
      fetchAstronauts();
      setInterval(fetchISSPosition, CONFIG.UPDATE_INTERVAL);
      setInterval(fetchAstronauts, 5 * 60 * 1000);
    });

    // Handle resize
    window.addEventListener('resize', () => {
      if (!state.globe) return;
      const w = DOM.globeEl.offsetWidth;
      const h = DOM.globeEl.offsetHeight;
      state.globe.width(w).height(h);
    });
  }

  // --- Cloud Layer ---
  function initClouds(loader) {
    loader.loadAsync(CONFIG.CLOUD_TEXTURE).then(cloudTex => {
      const GLOBE_RADIUS = state.globe.getGlobeRadius();
      const cloudGeo = new SphereGeometry(GLOBE_RADIUS * 1.01, 64, 64);
      const cloudMat = new MeshPhongMaterial({
        map: cloudTex,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      });
      state.cloudMesh = new Mesh(cloudGeo, cloudMat);
      state.globe.scene().add(state.cloudMesh);

      // Slow cloud rotation
      function rotateClouds() {
        if (state.cloudMesh && state.cloudsEnabled) {
          state.cloudMesh.rotation.y += 0.0001;
        }
        requestAnimationFrame(rotateClouds);
      }
      rotateClouds();
    }).catch(err => {
      console.warn('Cloud texture failed to load:', err);
    });
  }

  // --- Sun Position Animation ---
  function animateSun() {
    function update() {
      if (state.globeMaterial && state.dayNightEnabled) {
        const sunPos = getSunPosition(Date.now());
        state.globeMaterial.uniforms.sunPosition.value.set(sunPos[0], sunPos[1]);
      }
      requestAnimationFrame(update);
    }
    update();

    // Also update rotation uniform when globe is interacted with
    if (state.globe) {
      const controls = state.globe.controls();
      controls.addEventListener('change', () => {
        const pov = state.globe.pointOfView();
        if (state.globeMaterial) {
          state.globeMaterial.uniforms.globeRotation.value.set(pov.lng || 0, pov.lat || 0);
        }
      });
    }
  }

  // --- Toolbar Toggle Handlers ---
  function setupToolbar() {
    if (DOM.btnDayNight) {
      DOM.btnDayNight.addEventListener('click', () => {
        state.dayNightEnabled = !state.dayNightEnabled;
        DOM.btnDayNight.classList.toggle('active', state.dayNightEnabled);
        if (state.globeMaterial) {
          state.globeMaterial.uniforms.dayNightEnabled.value = state.dayNightEnabled ? 1.0 : 0.0;
        }
      });
      // Set initial active state
      DOM.btnDayNight.classList.add('active');
    }

    if (DOM.btnClouds) {
      DOM.btnClouds.addEventListener('click', () => {
        state.cloudsEnabled = !state.cloudsEnabled;
        DOM.btnClouds.classList.toggle('active', state.cloudsEnabled);
        if (state.cloudMesh) {
          state.cloudMesh.visible = state.cloudsEnabled;
        }
      });
      // Set initial active state
      DOM.btnClouds.classList.add('active');
    }
  }

  // --- Fetch ISS Position ---
  async function fetchISSPosition() {
    try {
      const res = await fetch(CONFIG.ISS_API);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const lat = parseFloat(data.latitude);
      const lng = parseFloat(data.longitude);
      const alt = Math.round(parseFloat(data.altitude));
      const vel = Math.round(parseFloat(data.velocity));

      updateCoordinates(lat, lng);
      updateMetrics(alt, vel);
      updateGlobe(lat, lng);
      addTrailPoint(lat, lng);
      throttledGeocode(lat, lng);
    } catch (err) {
      console.warn('ISS API fetch failed, trying fallback...', err);
      fetchISSFallback();
    }
  }

  // --- Fallback: Open Notify API ---
  async function fetchISSFallback() {
    try {
      const res = await fetch('https://api.open-notify.org/iss-now.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const lat = parseFloat(data.iss_position.latitude);
      const lng = parseFloat(data.iss_position.longitude);

      updateCoordinates(lat, lng);
      updateGlobe(lat, lng);
      addTrailPoint(lat, lng);
      throttledGeocode(lat, lng);
    } catch (err) {
      console.error('All ISS APIs failed:', err);
    }
  }

  // --- Update Coordinate Display ---
  function updateCoordinates(lat, lng) {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lngDir = lng >= 0 ? 'E' : 'W';

    const latStr = `${Math.abs(lat).toFixed(4)}° ${latDir}`;
    const lngStr = `${Math.abs(lng).toFixed(4)}° ${lngDir}`;

    animateValue(DOM.lat, latStr);
    animateValue(DOM.lng, lngStr);
  }

  // --- Animate Value Change ---
  function animateValue(el, newValue) {
    if (!el || el.textContent === newValue) return;
    el.classList.add('updating');
    el.textContent = newValue;
    setTimeout(() => el.classList.remove('updating'), 600);
  }

  // --- Update Metric Cards ---
  function updateMetrics(alt, vel) {
    const altStr = alt.toLocaleString();
    const velStr = vel.toLocaleString();
    if (DOM.altitude && DOM.altitude.textContent !== altStr) DOM.altitude.textContent = altStr;
    if (DOM.velocity && DOM.velocity.textContent !== velStr) DOM.velocity.textContent = velStr;
  }

  // --- Update 3D Globe ---
  function updateGlobe(lat, lng) {
    if (!state.globe) return;

    // Update ISS point
    state.issData[0] = { lat, lng, alt: 0.06 };
    state.globe.pointsData([...state.issData]);

    // Update ring pulse
    state.ringsData[0] = { lat, lng };
    state.globe.ringsData([...state.ringsData]);

    // Stop auto-rotate and move camera to ISS on first load
    if (state.trailPoints.length <= 1) {
      state.globe.pointOfView({ lat, lng, altitude: 2.2 }, 1500);
    }
  }

  // --- Orbit Trail ---
  function addTrailPoint(lat, lng) {
    state.trailPoints.push([lat, lng]);

    if (state.trailPoints.length > CONFIG.TRAIL_MAX) {
      state.trailPoints.shift();
    }

    // Update path on globe
    if (state.globe && state.trailPoints.length >= 2) {
      state.globe.pathsData([{
        coords: [...state.trailPoints]
      }])
        .pathPoints('coords');
    }
  }

  // --- Reverse Geocode (throttled) ---
  function throttledGeocode(lat, lng) {
    const now = Date.now();
    if (now - state.lastGeocode < 15000) return;
    state.lastGeocode = now;
    reverseGeocode(lat, lng);
  }

  async function reverseGeocode(lat, lng) {
    try {
      const res = await fetch(
        `${CONFIG.GEOCODE_API}?format=json&lat=${lat}&lon=${lng}&zoom=5&accept-language=en`,
        { headers: { 'User-Agent': 'OrbitWatch/1.0' } }
      );
      if (!res.ok) throw new Error(`Geocode HTTP ${res.status}`);
      const data = await res.json();

      const parts = [];
      if (data.address) {
        if (data.address.country) parts.push(data.address.country);
        else if (data.address.ocean) parts.push(data.address.ocean);
        else if (data.address.sea) parts.push(data.address.sea);
      }

      if (DOM.location) {
        DOM.location.textContent = parts.length > 0
          ? parts.join(', ')
          : data.display_name || 'Over the Ocean';
      }
    } catch (err) {
      if (DOM.location) DOM.location.textContent = getApproxLocation(lat, lng);
    }
  }

  // --- Approximate location when geocode fails ---
  function getApproxLocation(lat, lng) {
    if (lat > 60) return 'Arctic Region';
    if (lat < -60) return 'Antarctic Region';
    if (lng > -30 && lng < 60 && lat > 0 && lat < 60) return 'Europe / Africa';
    if (lng > 60 && lng < 150) return 'Asia / Pacific';
    if (lng > -170 && lng < -30 && lat > 0) return 'North America / Atlantic';
    if (lng > -90 && lng < -30 && lat < 0) return 'South America';
    return 'Over the Ocean';
  }

  // --- Fetch Astronaut Data ---
  async function fetchAstronauts() {
    try {
      const res = await fetch(CONFIG.ASTROS_API);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const issAstronauts = data.people.filter(
        p => p.iss === true || (p.station && p.station.toLowerCase().includes('iss'))
      );

      const count = issAstronauts.length || data.number || '—';
      if (DOM.crewCount) DOM.crewCount.textContent = count;

      if (DOM.crewList) {
        DOM.crewList.innerHTML = '';
        const crewToShow = issAstronauts.length > 0 ? issAstronauts : data.people;
        crewToShow.forEach(person => {
          const li = document.createElement('li');
          li.textContent = person.name;
          DOM.crewList.appendChild(li);
        });
      }
    } catch (err) {
      console.warn('Astronaut API failed, trying fallback...', err);
      fetchAstronautsFallback();
    }
  }

  // --- Fallback astronaut fetch ---
  async function fetchAstronautsFallback() {
    try {
      const res = await fetch('https://api.open-notify.org/astros.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (DOM.crewCount) DOM.crewCount.textContent = data.number || '—';
      if (DOM.crewList) {
        DOM.crewList.innerHTML = '';
        if (data.people) {
          const issCrew = data.people.filter(p => p.craft === 'ISS');
          const list = issCrew.length > 0 ? issCrew : data.people;
          list.forEach(person => {
            const li = document.createElement('li');
            li.textContent = person.name;
            DOM.crewList.appendChild(li);
          });
        }
      }
    } catch (err) {
      console.error('All astronaut APIs failed:', err);
      if (DOM.crewCount) DOM.crewCount.textContent = '—';
    }
  }

  // --- Boot ---
  function init() {
    setupToolbar();
    initGlobe();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
