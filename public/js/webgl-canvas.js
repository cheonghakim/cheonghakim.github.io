/**
 * 스크롤 기반 카메라 이동이 포함된 3D 매트릭스 레인 배경
 * SOC (보안 운영 센터) 테마의 장식용 배경
 *
 * 레인은 회로 기판 위로 떨어진다. 컬럼이 기판에 닿으면
 *  - 착지 지점의 패드가 짧게 번쩍이고
 *  - 트레일의 글자가 닿는 순서대로 디지털 파편으로 흩어지며
 *  - 착지 지점 주변 트레이스가 잠깐 달아오른다.
 *  - 버스 끝에 떨어진 컬럼은 패킷을 칩 쪽으로 흘려보낸다.
 *
 * 레인/파티클/플래시는 전부 같은 낙하 공식(time * speed + phase)을 셰이더에서 계산하므로
 * 프레임마다 CPU에서 캔버스를 다시 그리거나 텍스처를 업로드하지 않는다.
 *
 * 팔레트 비교: URL에 ?bg=muted 를 붙이거나 콘솔에서 __matrixBg.setPalette("muted" | "classic")
 */

// 기판 높이와 레인이 시작되는 높이
const FLOOR = -35;
const TOP = 55;
// 머리가 TOP에서 FLOOR까지 내려오는 거리
const LAND = TOP - FLOOR;
// 글리프 쿼드 크기 / 글자 간격. 아틀라스 셀에서 글자가 차지하는 비율 보정
const QUAD = 1.45;
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<>{}[]|/\\:;.=-+*";
const MATRIX_COLUMNS = 70;
const BINARY_COLUMNS = 40;
// 착지 시 컬럼당 흩어지는 파편 수 (트레일 행에 고르게 매핑)
const SPARKS_PER_COLUMN = 8;
const SPARK_LIFE = 0.6;
const SPLASH_LIFE = 0.5;
// 트레이스 발광: 동시에 표시하는 최대 개수와 수명
const MAX_RIPPLES = 12;
const RIPPLE_LIFE = 0.8;
// 기판 범위. 이 안에 착지하는 컬럼만 플래시/파편/발광을 만든다.
const BOARD = { minX: -108, maxX: 108, minZ: -148, maxZ: 48 };
// 버스 트레이스 간격, 패킷 꼬리 길이
const BUS_PITCH = 0.85;
const PACKET_TRAIL = 5;
// 매트릭스 컬럼 중 버스 끝에 떨어져 패킷을 보내는 비율, 레인과 무관하게 순환하는 패킷 수
const FEED_RATIO = 0.4;
const MAX_FREE_PACKETS = 12;
// 첫 화면의 기판 밝기(기존 헥스 그리드 수준)와, 완전히 드러나는 스크롤 진행도
const BOARD_REVEAL_MIN = 0.4;
const BOARD_REVEAL_AT = 0.25;
// 잔배선: 격자 간격, 밝기(강조 없는 버스보다 조금 어둡게), 카메라 거리에 따른 페이드 구간.
// 멀리 있는 가는 선이 촘촘하면 스크롤 중 반짝이므로 가까운 영역에만 보이게 한다.
const DENSE_CELL = 1.1;
const DENSE_BASE = 0.07;
const DENSE_NEAR = 70;
const DENSE_FAR = 170;
const FOG_DENSITY = 0.004;
// 60Hz는 매 프레임, 120/144Hz는 한 프레임씩 건너뛴다(60~72fps).
const MIN_FRAME_MS = 1000 / 72;
// rAF 타임스탬프 지터 때문에 75Hz(13.3ms)가 매번 걸러지지 않도록 여유를 둔다.
const FRAME_SLACK_MS = 2;
// 셰이더 시간은 float32. 오래 열어두면 낙하가 계단처럼 끊기므로 주기적으로 감는다.
const TIME_WRAP = 60 * 60;
// 느린 기기에서 단계적으로 해상도를 낮춘다: 1 = 픽셀비 1, 2 = 픽셀비 0.75
const QUALITY_PIXEL_RATIOS = [null, 1, 0.75];
const WARMUP_FRAMES = 30;

const PALETTES = {
  // 기존 시안 톤
  classic: {
    head: 0xffffff,
    near: 0x00ffdc,
    glowHead: 0x00ffdd,
    glowNear: 0x00d4ff,
    trail: [0x00b4ff],
    binary: 0x00a0dc,
    board: 0x00d4ff,
    ripple: 0x99fff2,
    ambient: [0x00ffcc, 0x00d4ff],
  },
  // center-frontend 로그인 화면의 저채도 스틸 블루 + 로즈
  muted: {
    head: 0xeaf2ff,
    near: 0xa9c3e0,
    glowHead: 0x8fb0d6,
    glowNear: 0x6f93bd,
    trail: [0x6f93bd, 0x6f93bd, 0x6f93bd, 0xa77a8e],
    binary: 0x8796ab,
    board: 0x8796ab,
    ripple: 0xb8cde6,
    ambient: [0x6f93bd, 0xa77a8e],
  },
};

const FOG_GLSL = `
  float fogFactor(vec3 viewPos) {
    float d = ${FOG_DENSITY.toFixed(4)} * length(viewPos);
    return exp(-d * d);
  }
`;

// 모든 레이어가 공유하는 낙하 공식: 머리가 기판에 닿은 뒤 흐른 시간(초)
const SINCE_GLSL = `
  float landedSince(vec4 column, float cycle, float extra) {
    return (mod(uTime * column.z + column.w, cycle) - ${LAND.toFixed(1)} - extra) / column.z;
  }
`;

// rgb 그대로 더하는 가산 혼합 (셰이더에서 미리 알파를 곱해 둔다)
function additive(material) {
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneFactor;
  return material;
}

function positiveMod(a, b) {
  return ((a % b) + b) % b;
}

// 새로고침해도 같은 기판 배치가 나오도록 시드 난수를 쓴다
function randomSource(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// XZ 평면 폴리라인의 평행 복사본. 꺾이는 지점을 마이터로 맞춰 45도 꺾임에서도
// 버스 간격이 일정하게 유지된다.
function offsetPolyline(points, offset) {
  const normals = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dz = points[i].y - points[i - 1].y;
    const length = Math.hypot(dx, dz) || 1;
    normals.push(new THREE.Vector2(-dz / length, dx / length));
  }
  return points.map((point, i) => {
    const before = normals[Math.max(0, i - 1)];
    const after = normals[Math.min(normals.length - 1, i)];
    const miter = before.clone().add(after);
    miter.multiplyScalar(offset / (1 + before.dot(after)));
    return point.clone().add(miter);
  });
}

class MatrixRainBackground {
  constructor(canvas) {
    this.canvas = canvas;
    this.scrollY = window.scrollY;
    this.targetScrollY = window.scrollY;
    this.mouseX = 0;
    this.mouseY = 0;
    this.smoothMouseX = 0;
    this.smoothMouseY = 0;
    this.time = 0;
    this.lastFrame = null;
    this.qualityStep = 0;
    this.warmup = 0;
    this.frameSamples = 0;
    this.frameTime = 0;
    this.rippleScratch = [];
    this.packets = [];
    this.reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    this.paletteName = /[?&]bg=muted\b/.test(window.location.search)
      ? "muted"
      : "classic";
    this._tick = (now) => this.animate(now);

    this.initThreeJS();
    this.createBoard();
    this.createColumns();
    this.createPackets();
    this.createRain();
    this.createSplashes();
    this.createSparks();
    this.createStarfield();
    this.createAmbientParticles();
    this.setPalette(this.paletteName);
    this.initEventListeners();
    this.resize();

    if (this.reducedMotion) {
      // 모션 감소 설정 사용자: 정적인 한 프레임만 그린다
      this.renderFrame(0);
    } else {
      this._rafId = requestAnimationFrame(this._tick);
    }
  }

  initThreeJS() {
    this.scene = new THREE.Scene();

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
    this.renderer.setClearColor(0x0a0e1a);
    this.lookTarget = new THREE.Vector3();
  }

  pixelRatio() {
    return (
      QUALITY_PIXEL_RATIOS[this.qualityStep] ||
      Math.min(window.devicePixelRatio, 2)
    );
  }

  // 레인 컬럼 정의. 레인, 착지 플래시, 파편, 트레이스 발광, 패킷이 모두 이 값을 공유한다.
  createColumns() {
    this.columns = [];
    // 일부 컬럼은 버스의 바깥 끝(비아) 위에 세워, 착지할 때마다 패킷을 보낸다
    const onBoard = (x, z) =>
      x > BOARD.minX && x < BOARD.maxX && z > BOARD.minZ && z < BOARD.maxZ;
    const feeds = this.packets.filter(({ outer }) => onBoard(outer.x, outer.z));
    for (let i = feeds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [feeds[i], feeds[j]] = [feeds[j], feeds[i]];
    }
    feeds.length = Math.min(
      feeds.length,
      Math.round(MATRIX_COLUMNS * FEED_RATIO),
    );
    const add = (binary, feed) => {
      const r = Math.random;
      const scale = binary ? 1.8 + r() * 0.8 : 1.6 + r() * 1.0;
      const trail = binary
        ? 4 + Math.floor(r() * 10)
        : 4 + Math.floor(r() * 18);
      const speed = (binary ? 3 + r() * 8 : 4 + r() * 11) * scale;
      // 트레일이 기판 아래로 완전히 사라진 뒤, 잠깐 쉬었다가 다시 떨어진다
      const cycle = LAND + trail * scale + r() * 40;
      const x = feed
        ? feed.outer.x
        : binary
          ? (r() - 0.5) * 260
          : (r() - 0.5) * 200;
      const z = feed
        ? feed.outer.z
        : binary
          ? -100 - r() * 250
          : 45 - r() * 195;
      const col = {
        binary,
        x,
        z,
        scale,
        trail,
        speed,
        cycle,
        phase: r() * cycle,
        strength: binary ? 0.4 + r() * 0.2 : 0.5 + r() * 0.45,
        flicker: binary ? 0.8 + r() * 2 : 0.4 + r() * 1.6,
        seed: r(),
        hue: r(),
        onBoard: onBoard(x, z),
      };
      this.columns.push(col);
      if (feed) {
        feed.feed = col;
        // 다음 착지 전에 칩에 도착하도록
        feed.speed = Math.max(
          feed.speed,
          (feed.length * col.speed) / (col.cycle * 0.7),
        );
      }
    };
    for (let i = 0; i < MATRIX_COLUMNS; i++) add(false, feeds[i]);
    for (let i = 0; i < BINARY_COLUMNS; i++) add(true, null);
    this.boardColumns = this.columns.filter((col) => col.onBoard);
    this.activePackets = feeds.concat(
      this.packets.filter((packet) => !packet.feed).slice(0, MAX_FREE_PACKETS),
    );
  }

  // 회로 기판: IC 패키지, 핀, 45도로 꺾이는 버스 트레이스, 비아.
  // 모든 선을 한 번의 드로우콜로 그리고, 착지 발광은 정점 셰이더에서 더한다.
  createBoard() {
    const random = randomSource(8127);
    const positions = [];
    const bases = [];
    const denseFlags = [];
    // 잔배선이 피해 갈 영역: 칩(핀 포함)과 버스 트레이스
    const chipRects = [];
    const busRuns = [];
    const TRACE_Y = FLOOR + 0.02;
    const at = (x, z, y = TRACE_Y) => new THREE.Vector3(x, y, z);
    const segment = (a, b, base, dense = 0) => {
      // 발광이 정점 단위로 계산되므로 긴 선분은 잘게 나눈다
      const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 2.5));
      for (let i = 0; i < steps; i++) {
        const p = a.clone().lerp(b, i / steps);
        const q = a.clone().lerp(b, (i + 1) / steps);
        positions.push(p.x, p.y, p.z, q.x, q.y, q.z);
        bases.push(base, base);
        denseFlags.push(dense, dense);
      }
    };
    const polyline = (points, base, dense = 0) => {
      for (let i = 1; i < points.length; i++) {
        segment(points[i - 1], points[i], base, dense);
      }
    };
    const ring = (x, z, radius, base, dense = 0) => {
      const points = [];
      for (let i = 0; i <= 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        points.push(
          at(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius),
        );
      }
      polyline(points, base);
    };
    const rect = (x, z, w, d, y, base) => {
      const corners = [
        at(x - w / 2, z - d / 2, y),
        at(x + w / 2, z - d / 2, y),
        at(x + w / 2, z + d / 2, y),
        at(x - w / 2, z + d / 2, y),
      ];
      polyline(corners.concat([corners[0]]), base);
      return corners;
    };

    // 평행 트레이스 묶음(버스). origin에서 dir 방향으로 나가며 한두 번 45도로 꺾이고
    // 비아에서 끝난다. offsets는 lateral 방향 간격.
    const routeBus = (origin, dir, lateral, offsets, reach, tier) => {
      const turn = random() < 0.5 ? -1 : 1;
      const jog = 1.2 + random() * 3.2;
      const centre = [origin.clone()];
      let p = origin.clone().addScaledVector(dir, 1 + random() * reach[0]);
      centre.push(p.clone());
      p.addScaledVector(dir, jog).addScaledVector(lateral, turn * jog);
      centre.push(p.clone());
      p = p.clone().addScaledVector(dir, 1.5 + random() * reach[1]);
      centre.push(p.clone());
      if (random() < 0.45) {
        const back = 1 + random() * 2.2;
        p.addScaledVector(dir, back).addScaledVector(lateral, -turn * back);
        centre.push(p.clone());
        p = p.clone().addScaledVector(dir, 1.2 + random() * reach[1] * 0.6);
        centre.push(p.clone());
      }
      // 첫 구간의 왼쪽 법선 기준으로 양수 offset이 놓일 쪽을 정한다
      const side = lateral.dot(new THREE.Vector2(-dir.y, dir.x));
      const base = 0.05 + 0.13 * tier;
      offsets.forEach((offset) => {
        const run = offsetPolyline(centre, offset * side).map((q) =>
          at(q.x, q.y),
        );
        polyline(run, base);
        busRuns.push(run);
        const end = run[run.length - 1];
        ring(end.x, end.z, 0.45, base * 1.4);
        // 패킷은 강조 버스 위주로, 바깥 끝(비아)에서 칩 쪽으로 달린다
        if (random() < (tier > 0.6 ? 0.45 : 0.06)) {
          this.packets.push(this.createPath(run.slice().reverse(), random));
        }
      });
    };
    const pitchOffsets = (count) => {
      const offsets = [];
      for (let j = 0; j < count; j++) {
        offsets.push((j - (count - 1) / 2) * BUS_PITCH);
      }
      return offsets;
    };

    // 사방 핀에서 버스가 뻗어 나가는 IC 패키지 (와이어프레임 박스)
    const chip = (x, z, w, d, h, busChance, reach, tierOf) => {
      const y1 = FLOOR + h;
      chipRects.push([
        x - w / 2 - 2,
        x + w / 2 + 2,
        z - d / 2 - 2,
        z + d / 2 + 2,
      ]);
      const bottom = rect(x, z, w, d, TRACE_Y, 0.12);
      const top = rect(x, z, w, d, y1, 0.2);
      rect(x, z, w * 0.82, d * 0.82, y1, 0.1);
      for (let k = 0; k < 4; k++) segment(bottom[k], top[k], 0.12);

      for (let s = 0; s < 4; s++) {
        const sign = s % 2 ? 1 : -1;
        const horizontal = s < 2;
        const span = horizontal ? d : w;
        const half = (horizontal ? w : d) / 2;
        const along = (j) => ((j - 3.5) / 9) * span;
        const edge = (j, out) =>
          horizontal
            ? at(x + sign * (half + out), z + along(j))
            : at(x + along(j), z + sign * (half + out));
        for (let j = 0; j < 8; j++) segment(edge(j, 0), edge(j, 1.3), 0.16);

        if (random() < busChance[horizontal ? 0 : 1]) {
          const count = 3 + Math.floor(random() * 4);
          const start = Math.floor(random() * (9 - count));
          const offsets = [];
          for (let j = start; j < start + count; j++) offsets.push(along(j));
          const mid = (offsets[0] + offsets[offsets.length - 1]) / 2;
          const origin = horizontal
            ? new THREE.Vector2(x + sign * (half + 1.3), z + mid)
            : new THREE.Vector2(x + mid, z + sign * (half + 1.3));
          routeBus(
            origin,
            horizontal
              ? new THREE.Vector2(sign, 0)
              : new THREE.Vector2(0, sign),
            horizontal ? new THREE.Vector2(0, 1) : new THREE.Vector2(1, 0),
            offsets.map((o) => o - mid),
            horizontal ? reach[0] : reach[1],
            tierOf(),
          );
        }
      }
    };

    // 중앙 코어 칩: 네 변과 네 모서리 모두에서 강조 버스가 뻗는다
    const CORE = { x: 0, z: -55, size: 18 };
    chip(
      CORE.x,
      CORE.z,
      CORE.size,
      CORE.size,
      1.8,
      [1, 1],
      [
        [10, 25],
        [10, 25],
      ],
      () => 1,
    );
    for (let k = 0; k < 4; k++) {
      const dir = new THREE.Vector2(k % 2 ? 1 : -1, k < 2 ? 1 : -1).normalize();
      const origin = new THREE.Vector2(CORE.x, CORE.z).addScaledVector(
        dir,
        CORE.size * 0.72,
      );
      routeBus(
        origin,
        dir,
        new THREE.Vector2(-dir.y, dir.x),
        pitchOffsets(4),
        [8, 20],
        0.9,
      );
    }

    // 느슨한 격자 배치의 주변 칩
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 7; col++) {
        const x = (col - 3) * 30 + (random() - 0.5) * 8;
        const z = 35 - row * 30 + (random() - 0.5) * 8;
        const skip = random() < 0.25;
        const w = 6 + random() * 4;
        const d = 6 + random() * 4;
        const h = 0.8 + random() * 0.6;
        // 코어 주변은 비워 둔다
        if (skip || (Math.abs(x - CORE.x) < 26 && Math.abs(z - CORE.z) < 26)) {
          continue;
        }
        chip(
          x,
          z,
          w,
          d,
          h,
          [0.85, 0.6],
          [
            [3, 4],
            [4.5, 8.5],
          ],
          () => (random() < 0.2 ? 0.75 : 0.32),
        );
      }
    }

    // 칩 행 사이를 가로지르는 긴 백본 버스
    for (let row = 0; row < 6; row++) {
      if (random() < 0.3) continue;
      const z = 35 - row * 30 - 15 + (random() - 0.5) * 4;
      const fromLeft = random() < 0.5;
      routeBus(
        new THREE.Vector2(fromLeft ? -115 : 115, z),
        new THREE.Vector2(fromLeft ? 1 : -1, 0),
        new THREE.Vector2(0, 1),
        pitchOffsets(3 + Math.floor(random() * 3)),
        [40, 70],
        0.7,
      );
    }

    // 칩과 버스 사이 빈 공간을 채우는 희미한 잔배선. 실제 PCB처럼 직각으로 출발해
    // 45도로만 꺾이고, 칩·버스·다른 잔배선과 겹치지 않는다.
    const W = Math.ceil((BOARD.maxX - BOARD.minX) / DENSE_CELL);
    const H = Math.ceil((BOARD.maxZ - BOARD.minZ) / DENSE_CELL);
    const grid = new Uint8Array(W * H);
    const free = (i, j) =>
      i >= 0 && j >= 0 && i < W && j < H && !grid[j * W + i];
    const mark = (x, z) => {
      const i = Math.floor((x - BOARD.minX) / DENSE_CELL);
      const j = Math.floor((z - BOARD.minZ) / DENSE_CELL);
      if (i >= 0 && j >= 0 && i < W && j < H) grid[j * W + i] = 1;
    };
    const step = DENSE_CELL / 2;
    chipRects.forEach(([x0, x1, z0, z1]) => {
      for (let x = x0; x <= x1; x += step) {
        for (let z = z0; z <= z1; z += step) mark(x, z);
      }
    });
    busRuns.forEach((run) => {
      for (let k = 1; k < run.length; k++) {
        const a = run[k - 1];
        const b = run[k];
        const steps = Math.ceil(a.distanceTo(b) / step);
        for (let t = 0; t <= steps; t++) {
          mark(
            a.x + ((b.x - a.x) * t) / steps,
            a.z + ((b.z - a.z) * t) / steps,
          );
        }
      }
    });
    const DIRS = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ];
    const cellPoint = (i, j) =>
      at(
        BOARD.minX + (i + 0.5) * DENSE_CELL,
        BOARD.minZ + (j + 0.5) * DENSE_CELL,
        FLOOR + 0.01,
      );
    // (i, j)에서 출발하는 잔배선 하나. 3칸 미만이면 되돌리고 false
    const route = (i, j) => {
      const cells = [[i, j]];
      grid[j * W + i] = 1;
      const corners = [[i, j]];
      let d = Math.floor(random() * 4) * 2;
      const turns = 1 + Math.floor(random() * 4);
      for (let t = 0; t < turns; t++) {
        const length = 2 + Math.floor(random() * 10);
        let moved = 0;
        while (moved < length && free(i + DIRS[d][0], j + DIRS[d][1])) {
          i += DIRS[d][0];
          j += DIRS[d][1];
          grid[j * W + i] = 1;
          cells.push([i, j]);
          moved++;
        }
        if (moved) corners.push([i, j]);
        if (moved < length) break;
        d = (d + (random() < 0.5 ? 1 : 7)) % 8;
      }
      if (cells.length < 3) {
        cells.forEach(([ci, cj]) => (grid[cj * W + ci] = 0));
        return false;
      }
      const base = DENSE_BASE * (random() < 0.05 ? 2 : 0.8 + random() * 0.4);
      const run = corners.map(([ci, cj]) => cellPoint(ci, cj));
      polyline(run, base, 1);
      const end = run[run.length - 1];
      if (random() < 0.25) ring(end.x, end.z, 0.3, base * 1.5, 1);
      return true;
    };
    // 무작위 시작점으로 먼저 깔고, 남은 빈 칸을 전부 시작점으로 다시 훑어 빈틈을 채운다
    for (let attempt = 0; attempt < W * H * 0.6; attempt++) {
      const i = Math.floor(random() * W);
      const j = Math.floor(random() * H);
      if (free(i, j)) route(i, j);
    }
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        for (let tries = 0; tries < 4 && free(i, j); tries++) {
          if (route(i, j)) break;
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute("aBase", new THREE.Float32BufferAttribute(bases, 1));
    geometry.setAttribute(
      "aDense",
      new THREE.Float32BufferAttribute(denseFlags, 1),
    );

    const ripples = [];
    for (let i = 0; i < MAX_RIPPLES; i++) ripples.push(new THREE.Vector4());
    // 기판 표면(점 격자)과 트레이스가 같은 색 객체를 공유한다
    this.boardColor = new THREE.Color();
    // 첫 화면에서는 기판을 은은하게 두고, 스크롤로 카메라가 내려갈수록 드러낸다.
    // (첫 구도에서 기판이 밝으면 그 위를 지나는 메뉴바가 띠처럼 도드라진다)
    this.boardReveal = { value: BOARD_REVEAL_MIN };

    this.boardMaterial = additive(
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: this.boardColor },
          uRippleColor: { value: new THREE.Color() },
          uRipples: { value: ripples },
          uReveal: this.boardReveal,
        },
        vertexShader: `
          attribute float aBase, aDense;
          uniform vec3 uColor, uRippleColor;
          uniform float uReveal;
          uniform vec4 uRipples[${MAX_RIPPLES}];
          varying vec3 vColor;
          ${FOG_GLSL}
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            // 각 착지: xy = 착지 지점, z = 착지 후 경과 시간, w = 세기
            // 퍼져 나가는 파동 대신 그 자리에서만 달아올랐다 식는다.
            // 잔배선은 더 넓게 달아올라, 착지 순간에만 주변의 촘촘한 회로가 드러난다.
            float spread = mix(0.12, 0.04, aDense);
            float glow = 0.0;
            for (int i = 0; i < ${MAX_RIPPLES}; i++) {
              vec4 r = uRipples[i];
              float d = distance(position.xz, r.xy);
              glow += r.w * exp(-d * d * spread) * exp(-r.z * 4.0);
            }
            float near = mix(1.0, 1.0 - smoothstep(${DENSE_NEAR.toFixed(1)}, ${DENSE_FAR.toFixed(1)}, length(mv.xyz)), aDense);
            vColor = (uColor * aBase * uReveal + uRippleColor * min(glow, 1.5) * 0.35) * near * fogFactor(mv.xyz);
          }`,
        fragmentShader: `
          varying vec3 vColor;
          void main() {
            gl_FragColor = vec4(vColor, 1.0);
          }`,
      }),
    );
    this.scene.add(new THREE.LineSegments(geometry, this.boardMaterial));
    this.createBoardSurface();
  }

  // 기판 표면의 희미한 점 격자. 레이아웃이 허공에 뜨지 않고 판 위에 놓이게 한다.
  createBoardSurface() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (let x = 8; x < 256; x += 16) {
      for (let y = 8; y < 256; y += 16) ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.moveTo(0.5, 0);
    ctx.lineTo(0.5, 256);
    ctx.moveTo(0, 0.5);
    ctx.lineTo(256, 0.5);
    ctx.stroke();
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(
      4,
      this.renderer.capabilities.getMaxAnisotropy(),
    );

    const width = BOARD.maxX - BOARD.minX + 20;
    const depth = BOARD.maxZ - BOARD.minZ + 20;
    const material = additive(
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: this.boardColor },
          uMap: { value: texture },
          // 점 간격 2.5 (타일 하나 = 40)
          uRepeat: { value: new THREE.Vector2(width / 40, depth / 40) },
          uReveal: this.boardReveal,
        },
        vertexShader: `
          uniform vec2 uRepeat;
          varying vec2 vUv;
          varying float vFade;
          ${FOG_GLSL}
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            vUv = uv * uRepeat;
            // 가장자리를 부드럽게 지워 판의 경계가 보이지 않게 한다
            vec2 edge = min(uv, 1.0 - uv);
            vFade = smoothstep(0.0, 0.12, min(edge.x, edge.y)) * fogFactor(mv.xyz);
          }`,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uReveal;
          uniform sampler2D uMap;
          varying vec2 vUv;
          varying float vFade;
          void main() {
            gl_FragColor = vec4(uColor * texture2D(uMap, vUv).r * 0.07 * uReveal * vFade, 1.0);
          }`,
      }),
    );
    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      material,
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.set(
      (BOARD.minX + BOARD.maxX) / 2,
      FLOOR - 0.02,
      (BOARD.minZ + BOARD.maxZ) / 2,
    );
    this.scene.add(surface);
  }

  // 패킷이 달릴 경로: 바깥 끝(points[0])에서 칩 쪽 끝까지
  createPath(points, random) {
    const lengths = [0];
    for (let i = 1; i < points.length; i++) {
      lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
    }
    return {
      points,
      lengths,
      length: lengths[lengths.length - 1],
      outer: points[0],
      speed: 18 + random() * 20,
      phase: random(),
      feed: null,
    };
  }

  pathPoint(path, t, target) {
    const distance = t * path.length;
    const { points, lengths } = path;
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < distance) i++;
    const span = lengths[i] - lengths[i - 1] || 1;
    return target
      .copy(points[i - 1])
      .lerp(points[i], (distance - lengths[i - 1]) / span);
  }

  // 레인이 버스 끝에 떨어지면 출발하는 패킷 (밝은 머리 + 흐려지는 꼬리)
  createPackets() {
    const count = this.activePackets.length * PACKET_TRAIL;
    const fades = [];
    for (let i = 0; i < this.activePackets.length; i++) {
      for (let k = 0; k < PACKET_TRAIL; k++) fades.push(Math.pow(0.55, k));
    }
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.Float32BufferAttribute(
      new Float32Array(count * 3),
      3,
    );
    position.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", position);
    geometry.setAttribute("aFade", new THREE.Float32BufferAttribute(fades, 1));

    this.packetMaterial = additive(
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color() },
          uPixelRatio: { value: 1 },
        },
        vertexShader: `
          attribute float aFade;
          uniform vec3 uColor;
          uniform float uPixelRatio;
          varying vec3 vColor;
          ${FOG_GLSL}
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp(160.0 / -mv.z, 2.0, 9.0) * uPixelRatio;
            vColor = uColor * aFade * fogFactor(mv.xyz);
          }`,
        fragmentShader: `
          varying vec3 vColor;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            gl_FragColor = vec4(vColor * exp(-d * d * 4.0) * (1.0 - step(1.0, d)), 1.0);
          }`,
      }),
    );
    this.packetPoints = new THREE.Points(geometry, this.packetMaterial);
    this.packetPoints.frustumCulled = false;
    this.scene.add(this.packetPoints);
    this.packetPosition = new THREE.Vector3();
  }

  updatePackets(time) {
    const positions = this.packetPoints.geometry.attributes.position;
    this.activePackets.forEach((packet, i) => {
      const { feed } = packet;
      // 연결된 레인 컬럼이 기판에 닿는 순간 출발 (레인 셰이더와 같은 낙하 공식)
      const head = feed
        ? (((positiveMod(time * feed.speed + feed.phase, feed.cycle) - LAND) /
            feed.speed) *
            packet.speed) /
          packet.length
        : (time * packet.speed) / packet.length + packet.phase;
      for (let k = 0; k < PACKET_TRAIL; k++) {
        let t = head - (k * 0.9) / packet.length;
        const index = i * PACKET_TRAIL + k;
        if (feed && (t < 0 || t > 1)) {
          // 다음 착지 전까지는 화면 밖에 둔다
          positions.setXYZ(index, 0, -1000, 0);
          continue;
        }
        if (!feed) t = positiveMod(t, 1);
        const p = this.pathPoint(packet, t, this.packetPosition);
        positions.setXYZ(index, p.x, FLOOR + 0.1, p.z);
      }
    });
    positions.needsUpdate = true;
  }

  // R = 글자, G = 글자 + 번짐(글로우). 한 장의 텍스처로 헤드 글로우까지 처리한다.
  createGlyphAtlas() {
    const cell = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = cell * 8;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = "44px 'Cascadia Code', 'Cascadia Mono', Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let i = 0; i < CHARS.length; i++) {
      const cx = (i % 8) * cell + cell / 2;
      const cy = Math.floor(i / 8) * cell + cell / 2;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = ctx.shadowColor = "rgb(0,255,0)";
      ctx.shadowBlur = 12;
      ctx.fillText(CHARS[i], cx, cy);
      ctx.globalCompositeOperation = "lighter";
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgb(255,0,0)";
      ctx.fillText(CHARS[i], cx, cy);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.min(
      4,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    return texture;
  }

  // 컬럼 하나의 공통 인스턴스 속성: (x, z, speed, phase)
  columnAttribute(col) {
    return [col.x, col.z, col.speed, col.phase];
  }

  createRain() {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute("position", quad.attributes.position);
    geometry.setAttribute("uv", quad.attributes.uv);

    const column = [];
    const shape = [];
    const look = [];
    this.columns.forEach((col) => {
      for (let row = 0; row < col.trail; row++) {
        column.push(...this.columnAttribute(col));
        shape.push(row, col.trail, col.scale, col.cycle);
        look.push(col.strength, col.flicker, col.seed, col.binary ? 1 : 0);
      }
    });
    const count = column.length / 4;
    geometry.setAttribute(
      "aColumn",
      new THREE.InstancedBufferAttribute(new Float32Array(column), 4),
    );
    geometry.setAttribute(
      "aShape",
      new THREE.InstancedBufferAttribute(new Float32Array(shape), 4),
    );
    geometry.setAttribute(
      "aLook",
      new THREE.InstancedBufferAttribute(new Float32Array(look), 4),
    );
    geometry.setAttribute(
      "aTint",
      new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3),
    );
    geometry.instanceCount = count;

    this.rainMaterial = additive(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uAtlas: { value: this.createGlyphAtlas() },
          uHead: { value: new THREE.Color() },
          uNear: { value: new THREE.Color() },
          uGlowHead: { value: new THREE.Color() },
          uGlowNear: { value: new THREE.Color() },
          uSurgeAt: { value: -100 },
          uSurgeKey: { value: 0 },
        },
        vertexShader: `
          attribute vec4 aColumn; // x, z, speed, phase
          attribute vec4 aShape;  // row, trail, scale, cycle
          attribute vec4 aLook;   // strength, flicker, seed, binary
          attribute vec3 aTint;
          uniform float uTime, uSurgeAt, uSurgeKey;
          uniform vec3 uHead, uNear, uGlowHead, uGlowNear;
          varying vec2 vUv;
          varying vec3 vColor, vGlow;
          ${FOG_GLSL}
          float hash(float n) { return fract(sin(n) * 43758.5453); }
          void main() {
            float row = aShape.x, trail = aShape.y, scale = aShape.z;
            float seed = aLook.z, binary = aLook.w;
            // 글자는 칸(slot)에 고정, 빛(머리)만 내려간다. row 0 = 머리
            float head = ${TOP.toFixed(1)} - mod(uTime * aColumn.z + aColumn.w, aShape.w);
            float slot = floor((head - ${FLOOR.toFixed(1)}) / scale) + row;
            float y = ${FLOOR.toFixed(1)} + (slot + 0.5) * scale;
            vec4 mv = modelViewMatrix * vec4(aColumn.x, y, aColumn.y, 1.0);
            mv.xy += position.xy * scale * ${QUAD.toFixed(2)};
            gl_Position = projectionMatrix * mv;

            // 칸마다 제각각의 타이밍으로 글자가 바뀐다
            float tick = mod(floor(uTime * aLook.y + hash(slot * 1.7 + seed * 53.0) * 8.0), 4096.0);
            float h = hash(slot * 13.7 + seed * 97.0 + tick * 1.618);
            float idx = binary > 0.5 ? step(0.5, h) : floor(h * ${CHARS.length.toFixed(1)});
            vUv = (vec2(mod(idx, 8.0), 7.0 - floor(idx / 8.0)) + uv) / 8.0;

            float since = uTime - uSurgeAt;
            float surge = step(hash(seed * 31.7 + uSurgeKey), 0.22)
              * step(0.0, since) * step(since, 0.3 + 0.3 * hash(seed * 7.1 + uSurgeKey));
            float b = (1.0 - row / trail) * (1.0 + surge * 0.5 * (1.0 - binary));

            vec3 color;
            vec3 glow = vec3(0.0);
            float a;
            if (binary > 0.5) {
              b *= 0.8;
              color = aTint * b;
              a = max(0.1, 0.7 * b);
            } else if (row < 0.5) {
              color = uHead;
              a = min(1.0, b);
              glow = uGlowHead;
            } else if (row < 2.5) {
              color = uNear;
              a = min(1.0, 0.9 * b);
              glow = uGlowNear * 0.5;
            } else {
              color = aTint * b;
              a = max(0.05, 0.7 * b);
            }
            // 기판 아래로 내려간 칸은 사라진다 (그 순간 파편으로 바뀐다)
            float vis = aLook.x * fogFactor(mv.xyz) * step(0.0, slot)
              * (1.0 - smoothstep(${(TOP - 20).toFixed(1)}, ${TOP.toFixed(1)}, y));
            vColor = min(color, vec3(1.0)) * a * vis;
            vGlow = glow * a * vis * 0.6;
          }`,
        fragmentShader: `
          uniform sampler2D uAtlas;
          varying vec2 vUv;
          varying vec3 vColor, vGlow;
          void main() {
            vec4 t = texture2D(uAtlas, vUv);
            gl_FragColor = vec4(vColor * t.r + vGlow * max(t.g - t.r, 0.0), 1.0);
          }`,
      }),
    );
    this.rain = new THREE.Mesh(geometry, this.rainMaterial);
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  // 머리가 기판에 닿는 순간 바닥의 사각 패드가 짧게 번쩍인다 (퍼지지 않는다)
  createSplashes() {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute("position", quad.attributes.position);
    geometry.setAttribute("uv", quad.attributes.uv);

    const column = [];
    const shape = [];
    this.boardColumns.forEach((col) => {
      column.push(...this.columnAttribute(col));
      shape.push(
        col.scale,
        col.cycle,
        col.strength * (col.binary ? 0.5 : 1),
        0,
      );
    });
    const count = this.boardColumns.length;
    geometry.setAttribute(
      "aColumn",
      new THREE.InstancedBufferAttribute(new Float32Array(column), 4),
    );
    geometry.setAttribute(
      "aShape",
      new THREE.InstancedBufferAttribute(new Float32Array(shape), 4),
    );
    geometry.setAttribute(
      "aTint",
      new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3),
    );
    geometry.instanceCount = count;

    this.splashMaterial = additive(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uNear: { value: new THREE.Color() },
        },
        vertexShader: `
          attribute vec4 aColumn;
          attribute vec4 aShape; // scale, cycle, strength
          attribute vec3 aTint;
          uniform float uTime;
          uniform vec3 uNear;
          varying vec2 vUv;
          varying vec3 vColor;
          varying float vSince;
          ${FOG_GLSL}
          ${SINCE_GLSL}
          void main() {
            float since = landedSince(aColumn, aShape.y, 0.0);
            if (since < 0.0 || since > ${SPLASH_LIFE.toFixed(2)}) {
              gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
              return;
            }
            float size = aShape.x * 1.1 * (1.0 + 0.25 * exp(-since * 20.0));
            vec3 world = vec3(aColumn.x + position.x * size, ${(FLOOR + 0.04).toFixed(2)}, aColumn.y - position.y * size);
            vec4 mv = modelViewMatrix * vec4(world, 1.0);
            gl_Position = projectionMatrix * mv;
            vUv = uv;
            vSince = since;
            vColor = mix(aTint, uNear, 0.6) * aShape.z * exp(-since * 7.0) * fogFactor(mv.xyz);
          }`,
        fragmentShader: `
          varying vec2 vUv;
          varying vec3 vColor;
          varying float vSince;
          void main() {
            vec2 q = abs(vUv - 0.5) * 2.0;
            float d = max(q.x, q.y);
            float edge = (d - 0.8) * 12.0;
            float light = exp(-edge * edge) * 0.8 + exp(-d * d * 6.0) * exp(-vSince * 12.0) * 1.2;
            gl_FragColor = vec4(vColor * light * (1.0 - step(1.0, d)), 1.0);
          }`,
      }),
    );
    this.splashMaterial.side = THREE.DoubleSide;
    this.splashes = new THREE.Mesh(geometry, this.splashMaterial);
    this.splashes.frustumCulled = false;
    this.scene.add(this.splashes);
  }

  // 트레일의 각 행이 기판에 닿는 순간 그 글자가 디지털 파편으로 흩어진다.
  // 기판 배선처럼 0/45/90도 방향으로만, 바닥을 따라 직선으로 튄다.
  createSparks() {
    const column = [];
    const shape = [];
    const spark = [];
    const owners = [];
    this.boardColumns.forEach((col) => {
      const n = Math.min(col.trail, SPARKS_PER_COLUMN);
      for (let k = 0; k < n; k++) {
        const row = n > 1 ? Math.round((k * (col.trail - 1)) / (n - 1)) : 0;
        const brightness =
          Math.pow(1 - row / col.trail, 1.4) *
          col.strength *
          (col.binary ? 0.5 : 1);
        const angle = Math.floor(Math.random() * 8) * (Math.PI / 4);
        column.push(...this.columnAttribute(col));
        shape.push(row, brightness, col.scale, col.cycle);
        spark.push(
          Math.cos(angle),
          Math.sin(angle),
          4 + Math.random() * 5,
          Math.random(),
        );
        owners.push(col);
      }
    });
    this.sparkOwners = owners;

    const geometry = new THREE.BufferGeometry();
    const attr = (name, values, size) =>
      geometry.setAttribute(
        name,
        new THREE.Float32BufferAttribute(values, size),
      );
    // position은 셰이더에서 계산하지만 드로우 개수를 정하기 위해 필요하다
    attr("position", new Float32Array(owners.length * 3), 3);
    attr("aColumn", column, 4);
    attr("aShape", shape, 4);
    attr("aSpark", spark, 4);
    attr("aTint", new Float32Array(owners.length * 3), 3);

    this.sparkMaterial = additive(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
          uNear: { value: new THREE.Color() },
        },
        vertexShader: `
          attribute vec4 aColumn;
          attribute vec4 aShape; // row, brightness, scale, cycle
          attribute vec4 aSpark; // dirX, dirZ, 속도, seed
          attribute vec3 aTint;
          uniform float uTime, uPixelRatio;
          uniform vec3 uNear;
          varying vec3 vColor;
          ${FOG_GLSL}
          ${SINCE_GLSL}
          void main() {
            float scale = aShape.z;
            // row 번째 칸은 머리보다 row * scale 만큼 늦게 기판에 닿는다
            float since = landedSince(aColumn, aShape.w, aShape.x * scale);
            if (since < 0.0 || since > ${SPARK_LIFE.toFixed(2)}) {
              gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
              gl_PointSize = 0.0;
              vColor = vec3(0.0);
              return;
            }
            float spread = aSpark.z * (1.0 - exp(-since * 7.0)) * 0.18 * scale;
            vec4 mv = modelViewMatrix * vec4(aColumn.x + aSpark.x * spread, ${(FLOOR + 0.12).toFixed(2)}, aColumn.y + aSpark.y * spread, 1.0);
            gl_Position = projectionMatrix * mv;
            float flash = exp(-since * 8.0);
            gl_PointSize = clamp(90.0 * scale / -mv.z, 1.0, 7.0) * (1.0 + 1.5 * flash) * uPixelRatio;
            float life = 1.0 - since / ${SPARK_LIFE.toFixed(2)};
            vec3 color = mix(mix(aTint, uNear, 0.6), vec3(1.0), flash * 0.7);
            // 신호가 끊기듯 깜빡인다
            float flicker = step(0.35, fract(sin(floor(since * 24.0) + aSpark.w * 91.0) * 43758.5453));
            vColor = color * aShape.y * life * life * mix(0.25, 1.0, flicker) * fogFactor(mv.xyz);
          }`,
        fragmentShader: `
          varying vec3 vColor;
          void main() {
            // 둥근 물방울 대신 각진 픽셀
            vec2 q = abs(gl_PointCoord - 0.5) * 2.0;
            float d = max(q.x, q.y);
            gl_FragColor = vec4(vColor * (1.0 - smoothstep(0.55, 0.9, d)), 1.0);
          }`,
      }),
    );
    this.sparks = new THREE.Points(geometry, this.sparkMaterial);
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);
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
    this.ambientPicks = [];

    for (let i = 0; i < count; i++) {
      vertices.push(
        (Math.random() - 0.5) * 200,
        (Math.random() - 0.5) * 120,
        (Math.random() - 0.5) * 200,
      );
      this.ambientPicks.push(Math.random() > 0.6 ? 0 : 1);
    }

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3),
    );

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

  // 팔레트 전환: 유니폼과 컬럼별 색상 속성만 다시 채운다
  setPalette(name) {
    const palette = PALETTES[name];
    if (!palette) return;
    this.paletteName = name;
    const color = new THREE.Color();
    const tintOf = (col) => {
      if (col.binary) return color.setHex(palette.binary);
      const trail = palette.trail;
      return color.setHex(trail[Math.floor(col.hue * trail.length)]);
    };

    const rainTint = this.rain.geometry.attributes.aTint;
    let i = 0;
    this.columns.forEach((col) => {
      tintOf(col);
      for (let row = 0; row < col.trail; row++, i++) {
        rainTint.setXYZ(i, color.r, color.g, color.b);
      }
    });
    rainTint.needsUpdate = true;

    const splashTint = this.splashes.geometry.attributes.aTint;
    this.boardColumns.forEach((col, k) => {
      tintOf(col);
      splashTint.setXYZ(k, color.r, color.g, color.b);
    });
    splashTint.needsUpdate = true;

    const sparkTint = this.sparks.geometry.attributes.aTint;
    this.sparkOwners.forEach((col, k) => {
      tintOf(col);
      sparkTint.setXYZ(k, color.r, color.g, color.b);
    });
    sparkTint.needsUpdate = true;

    const rain = this.rainMaterial.uniforms;
    rain.uHead.value.setHex(palette.head);
    rain.uNear.value.setHex(palette.near);
    rain.uGlowHead.value.setHex(palette.glowHead);
    rain.uGlowNear.value.setHex(palette.glowNear);
    this.splashMaterial.uniforms.uNear.value.setHex(palette.near);
    this.sparkMaterial.uniforms.uNear.value.setHex(palette.near);
    this.boardColor.setHex(palette.board);
    this.boardMaterial.uniforms.uRippleColor.value.setHex(palette.ripple);
    this.packetMaterial.uniforms.uColor.value.setHex(palette.near);

    const ambient = this.ambientParticles.geometry.attributes.color;
    this.ambientPicks.forEach((pick, k) => {
      color.setHex(palette.ambient[pick]);
      ambient.setXYZ(k, color.r, color.g, color.b);
    });
    ambient.needsUpdate = true;

    if (this.reducedMotion) this.renderFrame(0);
  }

  initEventListeners() {
    window.addEventListener("resize", () => this.resize());

    window.addEventListener(
      "scroll",
      () => {
        this.targetScrollY = window.scrollY;
      },
      { passive: true },
    );

    window.addEventListener("mousemove", (e) => {
      this.mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      this.mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    });

    // 탭이 숨겨진 동안의 프레임은 측정하지 않는다
    document.addEventListener("visibilitychange", () => {
      this.lastFrame = null;
      this.warmup = 0;
      this.frameSamples = 0;
      this.frameTime = 0;
    });
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    const ratio = this.pixelRatio();
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.sparkMaterial.uniforms.uPixelRatio.value = ratio;
    this.packetMaterial.uniforms.uPixelRatio.value = ratio;
    if (this.reducedMotion) this.renderFrame(0);
  }

  // 일부 열에 짧은 밝기 서지 유도
  triggerSurge() {
    const rain = this.rainMaterial.uniforms;
    rain.uSurgeAt.value = this.time;
    rain.uSurgeKey.value = Math.random() * 100;
  }

  updateCameraFromScroll(delta) {
    // 프레임레이트와 무관하게 기존(60fps 기준 0.05 / 0.03)과 같은 감속
    const scrollEase = this.reducedMotion ? 1 : 1 - Math.exp(-delta * 3.1);
    const mouseEase = 1 - Math.exp(-delta * 1.8);
    this.scrollY += (this.targetScrollY - this.scrollY) * scrollEase;

    const maxScroll =
      document.documentElement.scrollHeight - window.innerHeight;
    const scrollProgress = this.scrollY / Math.max(maxScroll, 1);
    this.boardReveal.value = THREE.MathUtils.lerp(
      BOARD_REVEAL_MIN,
      1,
      THREE.MathUtils.smoothstep(scrollProgress, 0, BOARD_REVEAL_AT),
    );

    const startPos = { x: 0, y: 15, z: 60 };
    const endPos = { x: -40, y: -10, z: -30 };

    this.camera.position.x =
      startPos.x + (endPos.x - startPos.x) * scrollProgress;
    this.camera.position.y =
      startPos.y + (endPos.y - startPos.y) * scrollProgress;
    this.camera.position.z =
      startPos.z + (endPos.z - startPos.z) * scrollProgress;

    const lookTarget = this.lookTarget.set(
      -20 * scrollProgress,
      -5 * scrollProgress,
      -10 * scrollProgress,
    );

    // 마우스 위치를 부드럽게 보간 (lerp)
    this.smoothMouseX += (this.mouseX - this.smoothMouseX) * mouseEase;
    this.smoothMouseY += (this.mouseY - this.smoothMouseY) * mouseEase;

    // 자연스러운 기울기 효과를 위해 lookTarget에 마우스 오프셋 추가
    lookTarget.x += this.smoothMouseX * 5;
    lookTarget.y -= this.smoothMouseY * 5;

    this.camera.lookAt(lookTarget);
  }

  // 최근 착지한 컬럼을 골라 트레이스 발광으로 넘긴다 (셰이더와 같은 낙하 공식)
  updateRipples(time) {
    const active = this.rippleScratch;
    active.length = 0;
    this.boardColumns.forEach((col) => {
      const since =
        (positiveMod(time * col.speed + col.phase, col.cycle) - LAND) /
        col.speed;
      if (since >= 0 && since < RIPPLE_LIFE) active.push({ col, since });
    });
    active.sort((a, b) => a.since - b.since);
    const ripples = this.boardMaterial.uniforms.uRipples.value;
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const hit = active[i];
      if (hit) {
        ripples[i].set(
          hit.col.x,
          hit.col.z,
          hit.since,
          hit.col.strength * (hit.col.binary ? 0.5 : 1),
        );
      } else {
        ripples[i].w = 0;
      }
    }
  }

  renderFrame(delta) {
    this.time += delta;
    if (this.time > TIME_WRAP) {
      this.time -= TIME_WRAP;
      this.rainMaterial.uniforms.uSurgeAt.value -= TIME_WRAP;
    }
    const time = this.reducedMotion ? 9 : this.time;

    this.updateCameraFromScroll(delta);
    this.updateRipples(time);
    this.updatePackets(time);
    this.rainMaterial.uniforms.uTime.value = time;
    this.splashMaterial.uniforms.uTime.value = time;
    this.sparkMaterial.uniforms.uTime.value = time;

    this.starField.rotation.y += 0.0036 * delta;
    this.ambientParticles.rotation.y += 0.009 * delta;

    this.renderer.render(this.scene, this.camera);
  }

  animate(now) {
    this._rafId = requestAnimationFrame(this._tick);
    if (
      this.lastFrame != null &&
      now - this.lastFrame < MIN_FRAME_MS - FRAME_SLACK_MS
    ) {
      return;
    }
    const delta =
      this.lastFrame == null
        ? 0
        : Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    this.watchFrameRate(delta);
    this.renderFrame(delta);
  }

  // 약 2초 평균이 40fps 아래면 해상도를 한 단계 낮춘다
  watchFrameRate(delta) {
    if (this.qualityStep >= QUALITY_PIXEL_RATIOS.length - 1 || delta === 0) {
      return;
    }
    this.warmup++;
    if (this.warmup <= WARMUP_FRAMES) return;
    this.frameSamples++;
    this.frameTime += delta;
    if (this.frameSamples < 120) return;
    const average = this.frameTime / this.frameSamples;
    this.frameSamples = 0;
    this.frameTime = 0;
    if (average > 1 / 40) {
      this.qualityStep++;
      this.warmup = 0;
      this.resize();
    }
  }
}

// 초기화
function initBackground() {
  if (typeof THREE === "undefined") {
    console.error("Three.js not loaded.");
    return;
  }

  var canvas = document.getElementById("webgl-canvas");
  if (!canvas) return;
  try {
    window.__matrixBg = new MatrixRainBackground(canvas);
  } catch (error) {
    // WebGL을 쓸 수 없는 환경: 배경 없이 페이지만 보여준다
    console.warn("Background unavailable", error);
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
