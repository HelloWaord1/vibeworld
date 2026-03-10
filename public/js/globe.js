// VibeTheWorld — WebGL Binary Globe
// Single-pass ray-sphere intersection with binary digit grid rendering

(function () {
  'use strict';

  const canvas = document.getElementById('globe-canvas');
  if (!canvas) return;

  const gl = canvas.getContext('webgl', { alpha: true, antialias: false });
  if (!gl) {
    canvas.style.display = 'none';
    return;
  }

  // --- Shaders ---

  const VERT = `
    attribute vec2 a_pos;
    void main() {
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  const FRAG = `
    precision highp float;

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec2 u_mouse;

    // Hash function for pseudo-random digits
    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    // 5x7 bitmap font for digits 0-1
    // Each row is 5 bits wide, 7 rows tall
    float digit0(vec2 p) {
      // 0: 01110 / 10001 / 10011 / 10101 / 11001 / 10001 / 01110
      int row = int(p.y);
      int col = int(p.x);
      if (row == 0) { if (col>=1 && col<=3) return 1.0; }
      if (row == 1) { if (col==0 || col==4) return 1.0; }
      if (row == 2) { if (col==0 || col==3 || col==4) return 1.0; }
      if (row == 3) { if (col==0 || col==2 || col==4) return 1.0; }
      if (row == 4) { if (col==0 || col==1 || col==4) return 1.0; }
      if (row == 5) { if (col==0 || col==4) return 1.0; }
      if (row == 6) { if (col>=1 && col<=3) return 1.0; }
      return 0.0;
    }

    float digit1(vec2 p) {
      // 1: 00100 / 01100 / 00100 / 00100 / 00100 / 00100 / 01110
      int row = int(p.y);
      int col = int(p.x);
      if (row == 0) { if (col==2) return 1.0; }
      if (row == 1) { if (col==1 || col==2) return 1.0; }
      if (row == 2) { if (col==2) return 1.0; }
      if (row == 3) { if (col==2) return 1.0; }
      if (row == 4) { if (col==2) return 1.0; }
      if (row == 5) { if (col==2) return 1.0; }
      if (row == 6) { if (col>=1 && col<=3) return 1.0; }
      return 0.0;
    }

    float renderDigit(vec2 cellUV, float which) {
      // Scale UV to 5x7 grid within cell
      vec2 p = cellUV * vec2(5.0, 7.0);
      if (p.x < 0.0 || p.x >= 5.0 || p.y < 0.0 || p.y >= 7.0) return 0.0;
      if (which < 0.5) return digit0(floor(p));
      return digit1(floor(p));
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution;
      vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

      // Mouse-based tilt (subtle)
      vec2 tilt = (u_mouse - 0.5) * 0.3;

      // Ray origin and direction (orthographic-ish, camera at z=3)
      vec3 ro = vec3(0.0, 0.0, 3.0);
      vec3 rd = normalize(vec3(p.x + tilt.x, p.y + tilt.y, -1.5));

      // Sphere at origin, radius 0.85
      float r = 0.85;
      float b = dot(ro, rd);
      float c = dot(ro, ro) - r * r;
      float disc = b * b - c;

      vec3 col = vec3(0.0);

      if (disc > 0.0) {
        float t = -b - sqrt(disc);
        vec3 hit = ro + t * rd;
        vec3 normal = normalize(hit);

        // Sphere UV with rotation
        float rot = u_time * 0.15;
        float theta = atan(normal.x, normal.z) + rot;
        float phi = asin(clamp(normal.y, -1.0, 1.0));

        // Grid cells: 60 columns x 30 rows
        float cols = 60.0;
        float rows = 30.0;
        vec2 gridUV = vec2(
          fract(theta / 6.28318 * cols),
          fract((phi / 3.14159 + 0.5) * rows)
        );

        // Determine which digit (0 or 1) — changes every 2 seconds
        vec2 cellID = vec2(
          floor(theta / 6.28318 * cols),
          floor((phi / 3.14159 + 0.5) * rows)
        );
        float morphTime = floor(u_time * 0.5);
        float digitSeed = hash(cellID + morphTime * 0.1);
        float which = step(0.5, digitSeed);

        // Render the digit bitmap
        float d = renderDigit(gridUV, which);

        // Lighting
        vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0));
        float diffuse = max(dot(normal, lightDir), 0.0);
        float ambient = 0.15;
        float light = ambient + diffuse * 0.85;

        // Fresnel rim glow
        float fresnel = pow(1.0 - max(dot(normal, -rd), 0.0), 3.0);

        // Base color: matrix green
        vec3 green = vec3(0.0, 1.0, 0.255);

        // Digit color with brightness variation
        float brightness = 0.3 + d * 0.7;
        col = green * brightness * light;

        // Add subtle cell grid lines
        vec2 gridEdge = abs(gridUV - 0.5) * 2.0;
        float gridLine = smoothstep(0.9, 1.0, max(gridEdge.x, gridEdge.y));
        col = mix(col, green * 0.05, gridLine * 0.5);

        // Add rim glow
        col += green * fresnel * 0.4;

        // Scanline effect
        float scanline = sin(gl_FragCoord.y * 1.5) * 0.5 + 0.5;
        col *= 0.92 + 0.08 * scanline;

        // Slight vignette on sphere edges
        col *= smoothstep(0.0, 0.15, 1.0 - fresnel * 0.5);
      }

      // Ambient glow around sphere
      float dist = length(p);
      float glow = exp(-dist * 3.0) * 0.06;
      col += vec3(0.0, glow, glow * 0.255);

      // Vignette
      float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * 1.2;
      col *= vig;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  // --- WebGL Setup ---

  function createShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vs = createShader(gl.VERTEX_SHADER, VERT);
  const fs = createShader(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { canvas.style.display = 'none'; return; }

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    canvas.style.display = 'none';
    return;
  }

  gl.useProgram(program);

  // Full-screen quad
  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uResolution = gl.getUniformLocation(program, 'u_resolution');
  const uTime = gl.getUniformLocation(program, 'u_time');
  const uMouse = gl.getUniformLocation(program, 'u_mouse');

  // Mouse tracking
  let mouseX = 0.5;
  let mouseY = 0.5;
  document.addEventListener('mousemove', function (e) {
    mouseX = e.clientX / window.innerWidth;
    mouseY = 1.0 - e.clientY / window.innerHeight;
  });

  // Resize
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  window.addEventListener('resize', resize);
  resize();

  // Render loop
  let startTime = performance.now();
  let animId;

  function render() {
    const elapsed = (performance.now() - startTime) / 1000.0;
    gl.uniform2f(uResolution, canvas.width, canvas.height);
    gl.uniform1f(uTime, elapsed);
    gl.uniform2f(uMouse, mouseX, mouseY);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    animId = requestAnimationFrame(render);
  }

  // Only animate when hero section is visible
  const hero = document.getElementById('hero');
  const observer = new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting) {
      if (!animId) {
        startTime = performance.now() - (startTime ? performance.now() - startTime : 0);
        render();
      }
    } else {
      if (animId) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    }
  }, { threshold: 0.1 });

  if (hero) {
    observer.observe(hero);
  }

  // Start immediately
  render();
})();
