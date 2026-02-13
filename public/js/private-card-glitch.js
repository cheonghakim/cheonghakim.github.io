/**
 * WebGL Glitch Effect for Private Project Cards
 * Simplified version with stable GLSL shaders and safe uniform names
 */

class CardGlitchEffect {
  constructor(card, previewElement) {
    this.card = card;
    this.previewElement = previewElement;
    this.canvas = null;
    this.renderer = null;
    this.scene = null;
    this.sceneBack = null;
    this.camera = null;
    this.cameraBack = null;
    this.renderTarget = null;
    this.clock = new THREE.Clock();
    this.isActive = false;
    this.animationId = null;

    this.init();
  }

  init() {
    // Create canvas
    this.canvas = document.createElement("canvas");
    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.opacity = "0";
    this.canvas.style.transition = "opacity 0.3s";
    this.canvas.style.pointerEvents = "none";
    this.canvas.style.zIndex = "10";
    this.previewElement.style.position = "relative";
    this.previewElement.appendChild(this.canvas);

    const rect = this.previewElement.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // Setup Three.js
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: false,
    });
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x000000, 0);

    this.renderTarget = new THREE.WebGLRenderTarget(width, height);

    this.scene = new THREE.Scene();
    this.sceneBack = new THREE.Scene();

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.cameraBack = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Create texture from preview element
    this.createTexture();

    // Setup event listeners
    this.card.addEventListener("mouseenter", () => this.start());
    this.card.addEventListener("mouseleave", () => this.stop());
  }

  createTexture() {
    const rect = this.previewElement.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // Create a simple colored texture as source
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    // Fill with dark gradient
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#0a0a0a");
    gradient.addColorStop(0.5, "#1a1a1a");
    gradient.addColorStop(1, "#0a0a0a");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Add some patterns
    ctx.fillStyle = "rgba(0, 255, 200, 0.1)";
    for (let i = 0; i < 20; i++) {
      ctx.fillRect(Math.random() * width, Math.random() * height, 2, height);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;

    // Background plane
    const bgGeometry = new THREE.PlaneGeometry(2, 2);
    const bgMaterial = new THREE.MeshBasicMaterial({
      map: texture,
    });
    const bgMesh = new THREE.Mesh(bgGeometry, bgMaterial);
    this.sceneBack.add(bgMesh);

    // Post effect
    this.postEffect = new PostEffect(
      this.renderTarget.texture,
      rect.width,
      rect.height,
    );
    this.scene.add(this.postEffect.obj);
  }

  start() {
    if (this.isActive) return;
    this.isActive = true;
    this.canvas.style.opacity = "1";
    this.clock.start();
    this.render();
  }

  stop() {
    if (!this.isActive) return;
    this.isActive = false;
    this.canvas.style.opacity = "0";
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  render() {
    if (!this.isActive) return;

    const time = this.clock.getDelta();

    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(this.sceneBack, this.cameraBack);
    this.renderer.setRenderTarget(null);

    this.postEffect.render(time);
    this.renderer.render(this.scene, this.camera);

    this.animationId = requestAnimationFrame(() => this.render());
  }

  resize() {
    const rect = this.previewElement.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    this.renderer.setSize(width, height);
    this.renderTarget.setSize(width, height);
    if (this.postEffect) {
      this.postEffect.resize(width, height);
    }
  }
}

class PostEffect {
  constructor(texture, width, height) {
    this.uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(width, height) },
      uTexture: { value: texture },
    };
    this.obj = this.createObj();
  }

  createObj() {
    return new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        transparent: true,
        vertexShader: `
          varying vec2 vUv;
          
          void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          precision mediump float;
        
          uniform float uTime;
          uniform vec2 uResolution;
          uniform sampler2D uTexture;
          
          varying vec2 vUv;
          
          float random(vec2 c) {
            return fract(sin(dot(c.xy, vec2(12.9898, 78.233))) * 43758.5453);
          }
          
          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = random(i);
            float b = random(i + vec2(1.0, 0.0));
            float c = random(i + vec2(0.0, 1.0));
            float d = random(i + vec2(1.0, 1.0));
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
          }
          
          void main(void) {
            vec2 uv = vUv;
            float t = uTime * 2.0;
            
            // RGB split
            float splitAmount = 0.01 + noise(vec2(t * 5.0, uv.y * 10.0)) * 0.02;
            float r = texture2D(uTexture, uv + vec2(splitAmount, 0.0)).r;
            float g = texture2D(uTexture, uv).g;
            float b = texture2D(uTexture, uv - vec2(splitAmount, 0.0)).b;
            
            // Scan lines
            float scanline = sin(uv.y * uResolution.y * 2.0 + t * 10.0) * 0.04;
            
            // Block noise
            vec2 blockUv = floor(uv * vec2(20.0, 40.0) + vec2(0.0, t * 10.0)) / vec2(20.0, 40.0);
            float blockNoise = step(0.9, random(blockUv + vec2(t)));
            
            // Horizontal glitch
            float glitchLine = step(0.98, random(vec2(floor(uv.y * 50.0 + t * 20.0), 0.0)));
            vec2 glitchOffset = vec2(glitchLine * (random(vec2(t, uv.y)) - 0.5) * 0.1, 0.0);
            
            // Final color with glitch
            vec3 color = vec3(r, g, b);
            if (glitchLine > 0.5) {
              color = texture2D(uTexture, uv + glitchOffset).rgb;
            }
            
            // Add block noise
            color += vec3(blockNoise * 0.3);
            
            // Add scanlines
            color += vec3(scanline);
            
            // White noise
            float whiteNoise = (random(uv + vec2(t * 0.1)) - 0.5) * 0.1;
            color += vec3(whiteNoise);
            
            gl_FragColor = vec4(color, 1.0);
          }
        `,
      }),
    );
  }

  render(time) {
    this.uniforms.uTime.value += time;
  }

  resize(width, height) {
    this.uniforms.uResolution.value.set(width, height);
  }
}

// Initialize glitch effects for all PRIVATE cards
function initPrivateCardGlitches() {
  if (typeof THREE === "undefined") {
    console.error("Three.js is required for glitch effects");
    return;
  }

  console.log("Initializing PRIVATE card glitch effects...");

  const allCards = document.querySelectorAll(".project-card");
  const glitchInstances = [];

  allCards.forEach((card) => {
    // Check if card has a PRIVATE badge
    const privateBadge = card.querySelector(".badge.private");
    if (!privateBadge) return;

    const preview = card.querySelector(".project-preview.private");
    if (preview) {
      console.log("Adding glitch to PRIVATE card:", card);
      const glitch = new CardGlitchEffect(card, preview);
      glitchInstances.push(glitch);
    } else {
      console.warn("PRIVATE card found but no preview element:", card);
    }
  });

  console.log(`Initialized ${glitchInstances.length} glitch effects`);

  // Handle window resize
  let resizeTimeout;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      glitchInstances.forEach((g) => g.resize());
    }, 250);
  });
}

// Initialize when DOM is ready and Three.js is loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPrivateCardGlitches);
} else {
  if (typeof THREE !== "undefined") {
    initPrivateCardGlitches();
  } else {
    setTimeout(initPrivateCardGlitches, 100);
  }
}
