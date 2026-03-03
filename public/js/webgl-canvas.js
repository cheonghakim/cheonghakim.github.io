/**
 * 스크롤 기반 카메라 이동이 포함된 3D 매트릭스 레인 배경
 * SOC (보안 운영 센터) 테마의 장식용 배경
 * 3D 공간에 흩어져 떨어지는 문자 열
 */

class MatrixRainBackground {
  constructor(canvas) {
    this.canvas = canvas;
    this.scrollY = 0;
    this.targetScrollY = 0;
    this.mouseX = 0;
    this.mouseY = 0;
    this.columns = [];
    this.frameCount = 0;
    this.clock = new THREE.Clock();

    this.chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<>{}[]|/\\:;.=-+*";

    this.initThreeJS();
    this.createHexGrid();
    this.createBinaryRain();
    this.createMatrixColumns();
    this.createStarfield();
    this.createAmbientParticles();
    this.initEventListeners();
    this.resize();
    this.animate();
  }

  initThreeJS() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0a0e1a, 0.004); // 더 깊은 원경을 위해 안개 밀도 감소

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.camera.position.set(0, 15, 60);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0a0e1a);

    const ambientLight = new THREE.AmbientLight(0x112233, 0.2);
    this.scene.add(ambientLight);
  }

  createHexGrid() {
    const gridGroup = new THREE.Group();
    const hexRadius = 3;
    const rows = 20;
    const cols = 30;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * hexRadius * 1.75 - (cols * hexRadius * 1.75) / 2;
        const z =
          row * hexRadius * 1.52 -
          (rows * hexRadius * 1.52) / 2 +
          (col % 2 ? hexRadius * 0.76 : 0);

        if (Math.random() > 0.4) continue;

        const points = [];
        for (let i = 0; i <= 6; i++) {
          const angle = (Math.PI / 3) * i + Math.PI / 6;
          points.push(
            new THREE.Vector3(
              x + Math.cos(angle) * hexRadius,
              -35,
              z + Math.sin(angle) * hexRadius,
            ),
          );
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const distFromCenter = Math.sqrt(x * x + z * z);
        const opacity = Math.max(0.02, 0.1 - distFromCenter * 0.001);

        const material = new THREE.LineBasicMaterial({
          color: 0x00d4ff,
          transparent: true,
          opacity: opacity,
        });
        gridGroup.add(new THREE.Line(geometry, material));
      }
    }

    this.scene.add(gridGroup);
  }

  createBinaryRain() {
    const columnCount = 40;
    this.binaryColumns = [];

    for (let i = 0; i < columnCount; i++) {
      const charSize = 20 + Math.floor(Math.random() * 8); // 기존 14-18
      const canvasW = charSize + 8;
      const canvasH = 450; // 기존 300
      const numChars = Math.floor(canvasH / charSize);

      const colCanvas = document.createElement("canvas");
      colCanvas.width = canvasW;
      colCanvas.height = canvasH;
      const ctx = colCanvas.getContext("2d");
      // ctx.clearRect(0, 0, canvasW, canvasH); // 기본적으로 이미 투명함

      const colHeight = 30 + Math.random() * 25; // 기존 14-24
      const planeW = colHeight * (canvasW / canvasH);
      const geometry = new THREE.PlaneGeometry(planeW, colHeight);
      const texture = new THREE.CanvasTexture(colCanvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;

      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.4 + Math.random() * 0.2,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        (Math.random() - 0.5) * 250,
        (Math.random() - 0.5) * 100,
        (Math.random() - 0.5) * 400 - 100,
      );

      this.scene.add(mesh);

      const charArray = [];
      for (let j = 0; j < numChars; j++) {
        charArray.push(Math.random() > 0.5 ? "0" : "1");
      }

      this.binaryColumns.push({
        canvas: colCanvas,
        ctx,
        texture,
        mesh,
        charSize,
        numChars,
        headPos: Math.random() * numChars * (0.5 + Math.random()),
        headSpeed: 3 + Math.random() * 8, // 속도를 0.3-1.2에서 3.0-11.0으로 상향
        trailLength: 4 + Math.floor(Math.random() * 10),
        chars: charArray,
        charFlickerTimer: Math.random() * 0.2,
        charFlickerInterval: 0.1 + Math.random() * 0.3,
      });
    }
  }

  createMatrixColumns() {
    const columnCount = 70;

    for (let i = 0; i < columnCount; i++) {
      const charSize = 18 + Math.floor(Math.random() * 10); // 기존 11-15
      const canvasW = charSize + 8;
      const canvasH = 600; // 기존 400
      const numChars = Math.floor(canvasH / charSize);

      // 이 열을 위한 캔버스 생성
      const colCanvas = document.createElement("canvas");
      colCanvas.width = canvasW;
      colCanvas.height = canvasH;
      const ctx = colCanvas.getContext("2d");
      // ctx.clearRect(0, 0, canvasW, canvasH);

      // 길고 얇은 평면 생성
      const colHeight = 40 + Math.random() * 30; // 기존 18-32
      const planeW = colHeight * (canvasW / canvasH);
      const geometry = new THREE.PlaneGeometry(planeW, colHeight);
      const texture = new THREE.CanvasTexture(colCanvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;

      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.5 + Math.random() * 0.45,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        (Math.random() - 0.5) * 200,
        (Math.random() - 0.5) * 80,
        (Math.random() - 0.5) * 300 - 50,
      );

      this.scene.add(mesh);

      // Character array
      const charArray = [];
      for (let j = 0; j < numChars; j++) {
        charArray.push(
          this.chars[Math.floor(Math.random() * this.chars.length)],
        );
      }

      this.columns.push({
        canvas: colCanvas,
        ctx,
        texture,
        mesh,
        charSize,
        numChars,
        // Much more varied starting positions
        headPos: Math.random() * numChars * (0.5 + Math.random()),
        // Significantly faster falling speed with more variation
        headSpeed: 4 + Math.random() * 11,
        // More varied trail lengths
        trailLength: 4 + Math.floor(Math.random() * 18),
        chars: charArray,
        charFlickerTimer: Math.random() * 0.1,
        charFlickerInterval: 0.02 + Math.random() * 0.12,
        // 서지(Surge) 효과용
        surgeTimer: 0,
        surgeActive: false,
      });
    }
  }

  createStarfield() {
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const colors = [];

    for (let i = 0; i < 6000; i++) {
      vertices.push(
        (Math.random() - 0.5) * 1000,
        (Math.random() - 0.5) * 1000,
        (Math.random() - 0.5) * 1000,
      );
      const color = new THREE.Color();
      const r = Math.random();
      if (r < 0.4) color.setHex(0xffffff);
      else if (r < 0.6) color.setHex(0xc8e6ff);
      else if (r < 0.8) color.setHex(0x88ccff);
      else color.setHex(0x55aaee);
      colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      sizeAttenuation: true,
    });

    this.starField = new THREE.Points(geometry, material);
    this.scene.add(this.starField);
  }

  createAmbientParticles() {
    const count = 600;
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const colors = [];

    for (let i = 0; i < count; i++) {
      vertices.push(
        (Math.random() - 0.5) * 200,
        (Math.random() - 0.5) * 120,
        (Math.random() - 0.5) * 200,
      );
      const c = new THREE.Color();
      c.setHex(Math.random() > 0.6 ? 0x00ffcc : 0x00d4ff);
      colors.push(c.r, c.g, c.b);
    }

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.06,
      vertexColors: true,
      transparent: true,
      opacity: 0.3,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });

    this.ambientParticles = new THREE.Points(geometry, material);
    this.scene.add(this.ambientParticles);
  }

  initEventListeners() {
    window.addEventListener("resize", () => this.resize());

    window.addEventListener("scroll", () => {
      this.targetScrollY = window.scrollY;
    });

    window.addEventListener("mousemove", (e) => {
      this.mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      this.mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    });
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // 일부 열에 짧은 밝기 서지 유도
  triggerSurge() {
    const count = 8 + Math.floor(Math.random() * 10);
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * this.columns.length);
      this.columns[idx].surgeActive = true;
      this.columns[idx].surgeTimer = 0.3 + Math.random() * 0.3;
    }
  }

  updateCameraFromScroll() {
    this.scrollY += (this.targetScrollY - this.scrollY) * 0.05;

    const maxScroll =
      document.documentElement.scrollHeight - window.innerHeight;
    const scrollProgress = this.scrollY / Math.max(maxScroll, 1);

    const startPos = { x: 0, y: 15, z: 60 };
    const endPos = { x: -40, y: -10, z: -30 };

    this.camera.position.x =
      startPos.x + (endPos.x - startPos.x) * scrollProgress;
    this.camera.position.y =
      startPos.y + (endPos.y - startPos.y) * scrollProgress;
    this.camera.position.z =
      startPos.z + (endPos.z - startPos.z) * scrollProgress;

    const lookTarget = new THREE.Vector3(
      -20 * scrollProgress,
      -5 * scrollProgress,
      -10 * scrollProgress,
    );

    // 자연스러운 기울기 효과를 위해 lookTarget에 마우스 오프셋 추가
    if (this.mouseX !== undefined) {
      lookTarget.x += this.mouseX * 15;
      lookTarget.y -= this.mouseY * 15;
    }

    this.camera.lookAt(lookTarget);
  }

  updateMatrixColumns(delta) {
    this.frameCount++;

    // 바이너리 레인 업데이트 (배경 레이어)
    if (this.binaryColumns) {
      this.binaryColumns.forEach((col) => {
        const { ctx, canvas, charSize, numChars } = col;

        col.headPos += col.headSpeed * delta;
        if (col.headPos >= numChars) {
          col.headPos -= numChars;
          for (let j = 0; j < numChars; j++) {
            if (Math.random() < 0.15) {
              col.chars[j] = Math.random() > 0.5 ? "0" : "1";
            }
          }
        }

        col.charFlickerTimer += delta;
        if (col.charFlickerTimer > col.charFlickerInterval) {
          col.charFlickerTimer = 0;
          const idx = Math.floor(Math.random() * numChars);
          col.chars[idx] = Math.random() > 0.5 ? "0" : "1";
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.font = charSize + "px 'Cascadia Code', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        const headIdx = Math.floor(col.headPos);

        for (let j = 0; j < numChars; j++) {
          const distBehindHead = (headIdx - j + numChars) % numChars;
          if (distBehindHead > col.trailLength) continue;

          const brightness = (1 - distBehindHead / col.trailLength) * 0.8;
          const y = j * charSize;

          ctx.shadowBlur = 0;
          const g = Math.floor(Math.min(255, 160 * brightness));
          const b = Math.floor(Math.min(255, 220 * brightness));
          const alpha = Math.max(0.1, brightness * 0.7);
          ctx.fillStyle = "rgba(0, " + g + ", " + b + ", " + alpha + ")";

          ctx.fillText(col.chars[j], canvas.width / 2, y);
        }

        col.texture.needsUpdate = true;
        col.mesh.quaternion.copy(this.camera.quaternion);
      });
    }

    this.columns.forEach((col, colIdx) => {
      // 최적화: 먼 열은 덜 자주 업데이트
      const dist = col.mesh.position.z;
      const updateInterval = dist < -100 ? 5 : 3; // 기존 -50

      if ((this.frameCount + colIdx) % updateInterval !== 0) {
        // 프레임을 건너뛰어도 빌보드 유지
        col.mesh.quaternion.copy(this.camera.quaternion);
        return;
      }

      const { ctx, canvas, charSize, numChars } = col;
      const effectiveDelta = delta * updateInterval; // 건너뛴 프레임 보정

      const isDistant = dist < -100 || charSize < 20; // 임계값 상향

      // 헤드 이동
      col.headPos += col.headSpeed * effectiveDelta;
      if (col.headPos >= numChars) {
        col.headPos -= numChars;
        // 일부 문자 갱신
        for (let j = 0; j < numChars; j++) {
          if (Math.random() < 0.25) {
            col.chars[j] =
              this.chars[Math.floor(Math.random() * this.chars.length)];
          }
        }
      }

      // 무작위 문자 깜빡임
      col.charFlickerTimer += effectiveDelta;
      if (col.charFlickerTimer > col.charFlickerInterval) {
        col.charFlickerTimer = 0;
        const idx = Math.floor(Math.random() * numChars);
        col.chars[idx] =
          this.chars[Math.floor(Math.random() * this.chars.length)];
      }

      // 서지 카운트다운
      if (col.surgeActive) {
        col.surgeTimer -= effectiveDelta;
        if (col.surgeTimer <= 0) {
          col.surgeActive = false;
        }
      }

      // 캔버스 클리어
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 문자 그리기
      ctx.font = charSize + "px 'Cascadia Code', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      const headIdx = Math.floor(col.headPos);
      const surgeBoost = col.surgeActive ? 1.5 : 1;

      for (let j = 0; j < numChars; j++) {
        const distBehindHead = (headIdx - j + numChars) % numChars;
        if (distBehindHead > col.trailLength) continue;

        const brightness = (1 - distBehindHead / col.trailLength) * surgeBoost;
        const y = j * charSize;

        if (distBehindHead === 0) {
          // 헤드: 글로우 효과가 있는 밝은 흰색 (멀지 않은 경우에만 글로우 필터 적용)
          if (!isDistant) {
            ctx.shadowColor = "#00ffdd";
            ctx.shadowBlur = 10;
          }
          ctx.fillStyle =
            "rgba(255, 255, 255, " + Math.min(1, brightness) + ")";
        } else if (distBehindHead < 3) {
          // 헤드 근처: 밝은 시안색
          if (!isDistant) {
            ctx.shadowColor = "#00d4ff";
            ctx.shadowBlur = 6;
          }
          var a = Math.min(1, brightness * 0.9);
          ctx.fillStyle = "rgba(0, 255, 220, " + a + ")";
        } else {
          // 트레일: 페이드 아웃
          ctx.shadowBlur = 0;
          var g = Math.floor(Math.min(255, 180 * brightness));
          var b = Math.floor(Math.min(255, 255 * brightness));
          var alpha = Math.max(0.05, brightness * 0.7);
          ctx.fillStyle = "rgba(0, " + g + ", " + b + ", " + alpha + ")";
        }

        ctx.fillText(col.chars[j], canvas.width / 2, y);
      }

      ctx.shadowBlur = 0;
      col.texture.needsUpdate = true;

      // 빌보드
      col.mesh.quaternion.copy(this.camera.quaternion);
    });
  }

  animate() {
    var delta = this.clock.getDelta();

    this.updateCameraFromScroll();
    this.updateMatrixColumns(delta);

    if (this.starField) {
      this.starField.rotation.y += 0.00006;
    }
    if (this.ambientParticles) {
      this.ambientParticles.rotation.y += 0.00015;
    }

    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.animate());
  }
}

// 초기화
function initBackground() {
  if (typeof THREE === "undefined") {
    console.error("Three.js not loaded.");
    return;
  }

  var canvas = document.getElementById("webgl-canvas");
  if (canvas) {
    window.__matrixBg = new MatrixRainBackground(canvas);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initBackground);
} else {
  if (typeof THREE !== "undefined") {
    initBackground();
  } else {
    setTimeout(initBackground, 100);
  }
}
