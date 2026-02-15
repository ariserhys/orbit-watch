/* ============================================
   ORBITWATCH — Core Application Logic
   ISS Tracking · 3D Globe · Day/Night · Clouds
   Starfield · Fresnel Glow · Custom ISS Marker
   ============================================ */

import * as solar from 'https://esm.sh/solar-calculator';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Mesh,
  MeshPhongMaterial,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TextureLoader,
  Vector2,
} from 'https://esm.sh/three';

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
    // Starfield
    STAR_COUNT: 15000,
    STAR_FIELD_RADIUS: 1500,
    // Camera follow
    CAMERA_FOLLOW_TRANSITION: 3000,
    CAMERA_IDLE_THRESHOLD: 3,
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

  // --- Fresnel Atmospheric Glow Shader ---
  const FRESNEL_SHADER = {
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform float glowIntensity;
      uniform float glowPower;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float fresnel = 1.0 - dot(vNormal, viewDir);
        fresnel = pow(fresnel, glowPower) * glowIntensity;
        // Soft edge falloff
        fresnel = clamp(fresnel, 0.0, 1.0);
        gl_FragColor = vec4(glowColor, fresnel * 0.65);
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
    // Enhancements
    starField: null,
    fresnelMesh: null,
    issSprite: null,
    issLabel: null,
    currentLocation: '',
    // Camera follow
    updateCount: 0,
    userInteracted: false,
    lastInteractionTime: 0,
    idleUpdates: 0,
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

  // ============================================
  //  ENHANCEMENT 1: Animated Particle Starfield
  // ============================================
  function createStarField(scene) {
    const positions = new Float32Array(CONFIG.STAR_COUNT * 3);
    const sizes = new Float32Array(CONFIG.STAR_COUNT);
    const colors = new Float32Array(CONFIG.STAR_COUNT * 3);

    for (let i = 0; i < CONFIG.STAR_COUNT; i++) {
      // Random position on a sphere shell
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = CONFIG.STAR_FIELD_RADIUS + (Math.random() - 0.5) * 300;

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      // Vary sizes for depth
      sizes[i] = 0.3 + Math.random() * 1.8;

      // Slight color variation: warm white, cool white, blue-ish
      const colorVariant = Math.random();
      if (colorVariant < 0.7) {
        // White
        colors[i * 3] = 0.9 + Math.random() * 0.1;
        colors[i * 3 + 1] = 0.9 + Math.random() * 0.1;
        colors[i * 3 + 2] = 0.95 + Math.random() * 0.05;
      } else if (colorVariant < 0.85) {
        // Warm (slightly yellow/orange)
        colors[i * 3] = 1.0;
        colors[i * 3 + 1] = 0.85 + Math.random() * 0.1;
        colors[i * 3 + 2] = 0.7 + Math.random() * 0.15;
      } else {
        // Cool (blue-ish)
        colors[i * 3] = 0.7 + Math.random() * 0.15;
        colors[i * 3 + 1] = 0.8 + Math.random() * 0.1;
        colors[i * 3 + 2] = 1.0;
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('size', new BufferAttribute(sizes, 1));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));

    const material = new PointsMaterial({
      size: 1.2,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });

    state.starField = new Points(geometry, material);
    scene.add(state.starField);

    // Slow drift animation
    function animateStars() {
      if (state.starField) {
        state.starField.rotation.y += 0.00003;
        state.starField.rotation.x += 0.00001;
      }
      requestAnimationFrame(animateStars);
    }
    animateStars();
  }

  // ============================================
  //  ENHANCEMENT 2: Fresnel Atmospheric Rim Glow
  // ============================================
  function createFresnelGlow(scene, globeRadius) {
    const glowGeo = new SphereGeometry(globeRadius * 1.018, 64, 64);
    const glowMat = new ShaderMaterial({
      uniforms: {
        glowColor: { value: new Color(0x00e5ff) },
        glowIntensity: { value: 1.4 },
        glowPower: { value: 3.5 },
      },
      vertexShader: FRESNEL_SHADER.vertexShader,
      fragmentShader: FRESNEL_SHADER.fragmentShader,
      transparent: true,
      blending: AdditiveBlending,
      side: BackSide,
      depthWrite: false,
    });

    state.fresnelMesh = new Mesh(glowGeo, glowMat);
    scene.add(state.fresnelMesh);
  }

  // ============================================
  //  ENHANCEMENT 3: Custom ISS Marker Sprite
  // ============================================
  function createISSMarkerTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;

    // Outer glow
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
    gradient.addColorStop(0, 'rgba(0, 229, 255, 0.9)');
    gradient.addColorStop(0.15, 'rgba(0, 229, 255, 0.6)');
    gradient.addColorStop(0.35, 'rgba(0, 229, 255, 0.15)');
    gradient.addColorStop(0.6, 'rgba(0, 229, 255, 0.05)');
    gradient.addColorStop(1, 'rgba(0, 229, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    // Crosshair lines
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.7)';
    ctx.lineWidth = 1.5;
    // Top
    ctx.beginPath();
    ctx.moveTo(cx, cy - 30);
    ctx.lineTo(cx, cy - 12);
    ctx.stroke();
    // Bottom
    ctx.beginPath();
    ctx.moveTo(cx, cy + 12);
    ctx.lineTo(cx, cy + 30);
    ctx.stroke();
    // Left
    ctx.beginPath();
    ctx.moveTo(cx - 30, cy);
    ctx.lineTo(cx - 12, cy);
    ctx.stroke();
    // Right
    ctx.beginPath();
    ctx.moveTo(cx + 12, cy);
    ctx.lineTo(cx + 30, cy);
    ctx.stroke();

    // Outer ring
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.stroke();

    // Inner bright core
    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 6);
    coreGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    coreGrad.addColorStop(0.4, 'rgba(0, 229, 255, 0.9)');
    coreGrad.addColorStop(1, 'rgba(0, 229, 255, 0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();

    // Corner brackets (targeting reticle style)
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
    ctx.lineWidth = 1.5;
    const bracketSize = 8;
    const bracketOffset = 26;

    // Top-left
    ctx.beginPath();
    ctx.moveTo(cx - bracketOffset, cy - bracketOffset + bracketSize);
    ctx.lineTo(cx - bracketOffset, cy - bracketOffset);
    ctx.lineTo(cx - bracketOffset + bracketSize, cy - bracketOffset);
    ctx.stroke();
    // Top-right
    ctx.beginPath();
    ctx.moveTo(cx + bracketOffset - bracketSize, cy - bracketOffset);
    ctx.lineTo(cx + bracketOffset, cy - bracketOffset);
    ctx.lineTo(cx + bracketOffset, cy - bracketOffset + bracketSize);
    ctx.stroke();
    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(cx - bracketOffset, cy + bracketOffset - bracketSize);
    ctx.lineTo(cx - bracketOffset, cy + bracketOffset);
    ctx.lineTo(cx - bracketOffset + bracketSize, cy + bracketOffset);
    ctx.stroke();
    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(cx + bracketOffset - bracketSize, cy + bracketOffset);
    ctx.lineTo(cx + bracketOffset, cy + bracketOffset);
    ctx.lineTo(cx + bracketOffset, cy + bracketOffset - bracketSize);
    ctx.stroke();

    return new CanvasTexture(canvas);
  }

  function createISSSprite(scene) {
    const texture = createISSMarkerTexture();
    const material = new SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    state.issSprite = new Sprite(material);
    state.issSprite.scale.set(22, 22, 1);
    scene.add(state.issSprite);

    // Breathing animation
    let breathPhase = 0;
    function breathe() {
      breathPhase += 0.02;
      const scale = 22 + Math.sin(breathPhase) * 2;
      if (state.issSprite) {
        state.issSprite.scale.set(scale, scale, 1);
        state.issSprite.material.opacity = 0.75 + Math.sin(breathPhase * 0.7) * 0.25;
      }
      requestAnimationFrame(breathe);
    }
    breathe();
  }

  function updateISSSpritePosition(lat, lng) {
    if (!state.issSprite || !state.globe) return;
    const globeRadius = state.globe.getGlobeRadius();
    const altitude = 0.06; // Same as point altitude
    const r = globeRadius * (1 + altitude);

    // Convert lat/lng to 3D position
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lng + 180) * (Math.PI / 180);

    state.issSprite.position.set(
      -r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta)
    );
  }

  // --- ISS HTML Label ---
  function createISSLabel() {
    // We'll use globe.gl's htmlElementsData to attach an HTML label
    const labelEl = document.createElement('div');
    labelEl.className = 'iss-label';
    labelEl.innerHTML = `
      <div class="iss-label__tag">ISS</div>
      <div class="iss-label__location" id="iss-label-location">Tracking...</div>
    `;
    state.issLabel = labelEl;
    return labelEl;
  }

  // --- Initialize 3D Globe ---
  function initGlobe() {
    const width = DOM.globeEl.offsetWidth;
    const height = DOM.globeEl.offsetHeight;
    const loader = new TextureLoader();

    // Create ISS label
    const issLabelEl = createISSLabel();

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
        .atmosphereAltitude(0.18)
        .globeMaterial(state.globeMaterial)
        .bumpImageUrl(CONFIG.GLOBE_BUMP)
        // ISS Point (kept as fallback, small)
        .pointsData(state.issData)
        .pointAltitude('alt')
        .pointColor(() => '#00e5ff')
        .pointRadius(0.3)
        .pointsMerge(false)
        // ENHANCEMENT 5: Enhanced Rings
        .ringsData(state.ringsData)
        .ringLat('lat')
        .ringLng('lng')
        .ringColor(() => t => `rgba(0, 229, 255, ${Math.pow(1 - t, 1.5)})`)
        .ringMaxRadius(5)
        .ringPropagationSpeed(1.5)
        .ringRepeatPeriod(800)
        // ENHANCEMENT 4: Glowing orbit trail
        .pathsData([])
        .pathPointLat(p => p[0])
        .pathPointLng(p => p[1])
        .pathColor(() => ['rgba(0, 229, 255, 0)', 'rgba(0, 229, 255, 0.85)'])
        .pathStroke(2.5)
        .pathDashLength(0.01)
        .pathDashGap(0)
        .pathDashAnimateTime(0)
        // ISS HTML Label
        .htmlElementsData([{ lat: 0, lng: 0, alt: 0.08, labelEl: issLabelEl }])
        .htmlLat('lat')
        .htmlLng('lng')
        .htmlAltitude('alt')
        .htmlElement(d => d.labelEl)
        // Track globe rotation for shader
        .onZoom(({ lng, lat }) => {
          if (state.globeMaterial) {
            state.globeMaterial.uniforms.globeRotation.value.set(lng, lat);
          }
        })
        (DOM.globeEl);

      // Set initial camera angle
      state.globe.pointOfView({ lat: 20, lng: 0, altitude: 2.5 }, 0);

      // Auto-rotate (slower, more cinematic)
      state.globe.controls().autoRotate = true;
      state.globe.controls().autoRotateSpeed = 0.2;
      state.globe.controls().enableDamping = true;
      state.globe.controls().dampingFactor = 0.08;

      // Detect user interaction
      const controls = state.globe.controls();
      controls.addEventListener('start', () => {
        state.userInteracted = true;
        state.lastInteractionTime = Date.now();
        state.idleUpdates = 0;
      });

      // ENHANCEMENT 1: Add starfield
      createStarField(state.globe.scene());

      // ENHANCEMENT 2: Add Fresnel glow
      const globeRadius = state.globe.getGlobeRadius();
      createFresnelGlow(state.globe.scene(), globeRadius);

      // ENHANCEMENT 3: Add ISS sprite marker
      createISSSprite(state.globe.scene());

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

    state.updateCount++;

    // Update ISS point (kept small as fallback)
    state.issData[0] = { lat, lng, alt: 0.06 };
    state.globe.pointsData([...state.issData]);

    // Update ring pulse
    state.ringsData[0] = { lat, lng };
    state.globe.ringsData([...state.ringsData]);

    // ENHANCEMENT 3: Update sprite position
    updateISSSpritePosition(lat, lng);

    // Update HTML label position
    state.globe.htmlElementsData([{
      lat, lng,
      alt: 0.1,
      labelEl: state.issLabel,
    }]);

    // Update label location text
    const labelLoc = document.getElementById('iss-label-location');
    if (labelLoc && state.currentLocation) {
      labelLoc.textContent = state.currentLocation;
    }

    // ENHANCEMENT 6: Smart camera follow
    const timeSinceInteraction = Date.now() - state.lastInteractionTime;
    const userIdle = timeSinceInteraction > 15000; // 15 seconds of no interaction

    if (state.updateCount <= 2) {
      // First loads: always follow
      state.globe.pointOfView({ lat, lng, altitude: 2.2 }, CONFIG.CAMERA_FOLLOW_TRANSITION);
    } else if (!state.userInteracted || userIdle) {
      // User hasn't touched globe, or has been idle — gently follow
      state.idleUpdates++;
      if (state.idleUpdates >= CONFIG.CAMERA_IDLE_THRESHOLD) {
        state.globe.pointOfView({ lat, lng, altitude: 2.2 }, CONFIG.CAMERA_FOLLOW_TRANSITION);
        state.idleUpdates = 0;
      }
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

      const locationText = parts.length > 0
        ? parts.join(', ')
        : data.display_name || 'Over the Ocean';

      if (DOM.location) {
        DOM.location.textContent = locationText;
      }

      // Update state for label
      state.currentLocation = locationText;
    } catch (err) {
      const approx = getApproxLocation(lat, lng);
      if (DOM.location) DOM.location.textContent = approx;
      state.currentLocation = approx;
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
