/**
 * Solar System Background with Scroll-Based Camera Movement
 * Using Three.js for 3D rendering
 */

// Import Three.js from CDN (will be added to HTML)
// This script assumes Three.js is loaded globally

class SolarSystemBackground {
    constructor(canvas) {
        this.canvas = canvas;
        this.scrollY = 0;
        this.targetScrollY = 0;

        // Initialize Three.js
        this.initThreeJS();
        this.createSolarSystem();
        this.initEventListeners();
        this.resize();
        this.animate();
    }

    initThreeJS() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x000000, 50, 200);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 30, 80);
        this.camera.lookAt(0, 0, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: false
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000);

        // Lighting
        const ambientLight = new THREE.AmbientLight(0x333333, 0.5);
        this.scene.add(ambientLight);

        const sunLight = new THREE.PointLight(0xffffff, 2, 300);
        sunLight.position.set(0, 0, 0);
        this.scene.add(sunLight);
    }

    createSolarSystem() {
        this.planets = [];
        this.stars = [];

        // Create starfield background
        this.createStarfield();

        // Create milky way galaxy
        this.createMilkyWay();

        // Enhanced Sun with realistic glow
        const sunGeometry = new THREE.SphereGeometry(5, 64, 64);
        const sunMaterial = new THREE.MeshBasicMaterial({
            color: 0xfdb813,
            emissive: 0xff8800,
            emissiveIntensity: 1.5
        });
        this.sun = new THREE.Mesh(sunGeometry, sunMaterial);
        this.scene.add(this.sun);

        // Multi-layer glow effect for realism
        // Inner glow (orange)
        const innerGlowGeometry = new THREE.SphereGeometry(5.8, 32, 32);
        const innerGlowMaterial = new THREE.MeshBasicMaterial({
            color: 0xff6600,
            transparent: true,
            opacity: 0.5,
            side: THREE.BackSide
        });
        const innerGlow = new THREE.Mesh(innerGlowGeometry, innerGlowMaterial);
        this.sun.add(innerGlow);

        // Middle glow (yellow-orange)
        const middleGlowGeometry = new THREE.SphereGeometry(7, 32, 32);
        const middleGlowMaterial = new THREE.MeshBasicMaterial({
            color: 0xffaa00,
            transparent: true,
            opacity: 0.25,
            side: THREE.BackSide
        });
        const middleGlow = new THREE.Mesh(middleGlowGeometry, middleGlowMaterial);
        this.sun.add(middleGlow);

        // Outer corona (yellow-white)
        const coronaGeometry = new THREE.SphereGeometry(9, 32, 32);
        const coronaMaterial = new THREE.MeshBasicMaterial({
            color: 0xffdd88,
            transparent: true,
            opacity: 0.15,
            side: THREE.BackSide
        });
        const corona = new THREE.Mesh(coronaGeometry, coronaMaterial);
        this.sun.add(corona);

        // Planet data: [radius, orbitRadius, color, speed, tilt, name]
        const planetData = [
            [0.8, 12, 0x8c7853, 0.015, 0.1, 'mercury'],    // Mercury
            [1.2, 18, 0xffc649, 0.012, 0.05, 'venus'],     // Venus
            [1.3, 25, 0x4a90e2, 0.010, 0.15, 'earth'],     // Earth
            [0.9, 32, 0xcd5c5c, 0.008, 0.12, 'mars'],      // Mars
            [3.5, 45, 0xc88b3a, 0.005, 0.08, 'jupiter'],   // Jupiter
            [3.0, 60, 0xe1c16e, 0.004, 0.1, 'saturn'],     // Saturn
            [2.0, 75, 0x4fd0e7, 0.003, 0.2, 'uranus'],     // Uranus
            [1.9, 88, 0x4166f5, 0.002, 0.18, 'neptune']    // Neptune
        ];

        planetData.forEach(([radius, orbitRadius, color, speed, tilt, name]) => {
            this.createPlanet(radius, orbitRadius, color, speed, tilt, name);
        });

        // Create asteroid belt
        this.createAsteroidBelt();
    }

    createPlanet(radius, orbitRadius, color, speed, tilt, name) {
        // Create procedural texture for the planet
        const texture = this.createPlanetTexture(color, name);

        // Planet mesh with texture
        const geometry = new THREE.SphereGeometry(radius, 64, 64);
        const material = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.7,
            metalness: 0.3
        });
        const planet = new THREE.Mesh(geometry, material);

        // Orbit line
        const orbitGeometry = new THREE.BufferGeometry();
        const orbitPoints = [];
        for (let i = 0; i <= 64; i++) {
            const angle = (i / 64) * Math.PI * 2;
            orbitPoints.push(
                Math.cos(angle) * orbitRadius,
                0,
                Math.sin(angle) * orbitRadius
            );
        }
        orbitGeometry.setAttribute('position', new THREE.Float32BufferAttribute(orbitPoints, 3));
        const orbitMaterial = new THREE.LineBasicMaterial({
            color: 0x444444,
            transparent: true,
            opacity: 0.3
        });
        const orbitLine = new THREE.Line(orbitGeometry, orbitMaterial);
        orbitLine.rotation.x = Math.PI / 2;
        this.scene.add(orbitLine);

        // Store planet data
        this.planets.push({
            mesh: planet,
            orbitRadius: orbitRadius,
            speed: speed,
            angle: Math.random() * Math.PI * 2,
            tilt: tilt,
            rotationSpeed: 0.01 + Math.random() * 0.02
        });

        this.scene.add(planet);
    }

    createPlanetTexture(baseColor, planetName) {
        // Create canvas for texture
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Convert hex color to RGB
        const r = (baseColor >> 16) & 255;
        const g = (baseColor >> 8) & 255;
        const b = baseColor & 255;

        // Fill base color
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(0, 0, size, size);

        // Add surface features based on planet type
        if (planetName === 'earth') {
            // Earth: continents and oceans
            this.addEarthFeatures(ctx, size, r, g, b);
        } else if (planetName === 'jupiter' || planetName === 'saturn') {
            // Gas giants: bands
            this.addGasGiantBands(ctx, size, r, g, b);
        } else if (planetName === 'mars') {
            // Mars: craters and terrain
            this.addRockyFeatures(ctx, size, r, g, b, 30);
        } else {
            // Other planets: general surface features
            this.addRockyFeatures(ctx, size, r, g, b, 20);
        }

        // Create Three.js texture from canvas
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }

    addEarthFeatures(ctx, size, r, g, b) {
        // Add green landmasses
        for (let i = 0; i < 15; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const radius = 20 + Math.random() * 60;

            ctx.fillStyle = `rgba(34, 139, 34, ${0.6 + Math.random() * 0.4})`;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }

        // Add white clouds
        for (let i = 0; i < 30; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const radius = 10 + Math.random() * 25;

            ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + Math.random() * 0.3})`;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    addGasGiantBands(ctx, size, r, g, b) {
        // Add horizontal bands
        const bandCount = 15 + Math.floor(Math.random() * 10);
        for (let i = 0; i < bandCount; i++) {
            const y = (i / bandCount) * size;
            const bandHeight = size / bandCount;
            const darkness = Math.random() * 0.3;

            ctx.fillStyle = `rgba(${Math.floor(r * (1 - darkness))}, ${Math.floor(g * (1 - darkness))}, ${Math.floor(b * (1 - darkness))}, ${0.3 + Math.random() * 0.5})`;
            ctx.fillRect(0, y, size, bandHeight);
        }

        // Add some swirl patterns
        for (let i = 0; i < 5; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const radius = 20 + Math.random() * 40;

            ctx.fillStyle = `rgba(${Math.floor(r * 0.8)}, ${Math.floor(g * 0.8)}, ${Math.floor(b * 0.8)}, 0.5)`;
            ctx.beginPath();
            ctx.ellipse(x, y, radius, radius * 0.6, Math.random() * Math.PI, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    addRockyFeatures(ctx, size, r, g, b, craterCount) {
        // Add craters and surface variations
        for (let i = 0; i < craterCount; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const radius = 5 + Math.random() * 30;
            const darkness = 0.2 + Math.random() * 0.4;

            // Crater shadow
            ctx.fillStyle = `rgba(${Math.floor(r * (1 - darkness))}, ${Math.floor(g * (1 - darkness))}, ${Math.floor(b * (1 - darkness))}, 0.7)`;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();

            // Crater rim highlight
            ctx.strokeStyle = `rgba(${Math.min(255, r + 30)}, ${Math.min(255, g + 30)}, ${Math.min(255, b + 30)}, 0.4)`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Add some color variation patches
        for (let i = 0; i < 15; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const radius = 20 + Math.random() * 50;
            const variation = (Math.random() - 0.5) * 0.2;

            ctx.fillStyle = `rgba(${Math.floor(r * (1 + variation))}, ${Math.floor(g * (1 + variation))}, ${Math.floor(b * (1 + variation))}, 0.3)`;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    createAsteroidBelt() {
        const asteroidCount = 300;
        const asteroidGeometry = new THREE.SphereGeometry(0.1, 8, 8);
        const asteroidMaterial = new THREE.MeshStandardMaterial({
            color: 0x888888,
            roughness: 0.9
        });

        for (let i = 0; i < asteroidCount; i++) {
            const asteroid = new THREE.Mesh(asteroidGeometry, asteroidMaterial);
            const angle = Math.random() * Math.PI * 2;
            const radius = 35 + Math.random() * 8;
            const height = (Math.random() - 0.5) * 3;

            asteroid.position.set(
                Math.cos(angle) * radius,
                height,
                Math.sin(angle) * radius
            );
            asteroid.scale.setScalar(0.5 + Math.random() * 1.5);

            this.scene.add(asteroid);
        }
    }

    createStarfield() {
        const starGeometry = new THREE.BufferGeometry();
        const starVertices = [];
        const starColors = [];
        const starSizes = [];

        for (let i = 0; i < 5000; i++) {
            const x = (Math.random() - 0.5) * 500;
            const y = (Math.random() - 0.5) * 500;
            const z = (Math.random() - 0.5) * 500;
            starVertices.push(x, y, z);

            // Random star colors (white, blue-white, yellow-white)
            const color = new THREE.Color();
            const colorChoice = Math.random();
            if (colorChoice < 0.7) {
                color.setHex(0xffffff); // White
            } else if (colorChoice < 0.85) {
                color.setHex(0xaaccff); // Blue-white
            } else {
                color.setHex(0xffffaa); // Yellow-white
            }
            starColors.push(color.r, color.g, color.b);

            // Vary star sizes - most small, few large
            const size = Math.random() < 0.9 ? 0.2 + Math.random() * 0.3 : 0.5 + Math.random() * 0.5;
            starSizes.push(size);
        }

        starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
        starGeometry.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
        starGeometry.setAttribute('size', new THREE.Float32BufferAttribute(starSizes, 1));

        const starMaterial = new THREE.PointsMaterial({
            size: 0.4,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            sizeAttenuation: true
        });

        this.starField = new THREE.Points(starGeometry, starMaterial);
        this.scene.add(this.starField);
    }

    createMilkyWay() {
        // Create milky way galaxy band
        const milkyWayGeometry = new THREE.BufferGeometry();
        const milkyWayVertices = [];
        const milkyWayColors = [];

        // Create a band of stars representing the milky way
        for (let i = 0; i < 8000; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 100 + Math.random() * 200;

            // Gaussian distribution for thickness
            const thickness = (Math.random() + Math.random() + Math.random() - 1.5) * 20;

            const x = Math.cos(angle) * radius;
            const y = thickness;
            const z = Math.sin(angle) * radius;

            milkyWayVertices.push(x, y, z);

            // Milky way colors - subtle blues and whites
            const color = new THREE.Color();
            const colorChoice = Math.random();
            if (colorChoice < 0.6) {
                color.setHex(0xccddff); // Pale blue
            } else if (colorChoice < 0.85) {
                color.setHex(0xffffff); // White
            } else {
                color.setHex(0xffddcc); // Pale orange
            }

            milkyWayColors.push(color.r, color.g, color.b);
        }

        milkyWayGeometry.setAttribute('position', new THREE.Float32BufferAttribute(milkyWayVertices, 3));
        milkyWayGeometry.setAttribute('color', new THREE.Float32BufferAttribute(milkyWayColors, 3));

        const milkyWayMaterial = new THREE.PointsMaterial({
            size: 0.3,
            vertexColors: true,
            transparent: true,
            opacity: 0.4,
            sizeAttenuation: true,
            blending: THREE.AdditiveBlending
        });

        this.milkyWay = new THREE.Points(milkyWayGeometry, milkyWayMaterial);
        this.milkyWay.rotation.x = Math.PI / 6; // Tilt the galaxy band
        this.scene.add(this.milkyWay);
    }

    initEventListeners() {
        window.addEventListener('resize', () => this.resize());

        // Scroll event for camera movement
        window.addEventListener('scroll', () => {
            this.targetScrollY = window.scrollY;
        });

        // Mouse move for subtle camera tilt
        window.addEventListener('mousemove', (e) => {
            this.mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
            this.mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
        });
    }

    resize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    updateCameraFromScroll() {
        // Smooth scroll interpolation
        this.scrollY += (this.targetScrollY - this.scrollY) * 0.05;

        // Calculate scroll progress (0 to 1)
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        const scrollProgress = this.scrollY / Math.max(maxScroll, 1);

        // Camera movement based on scroll
        // Start position: Above and far
        // End position: Close and side view
        const startPos = { x: 0, y: 30, z: 80 };
        const endPos = { x: 120, y: 20, z: 50 };

        this.camera.position.x = startPos.x + (endPos.x - startPos.x) * scrollProgress;
        this.camera.position.y = startPos.y + (endPos.y - startPos.y) * scrollProgress;
        this.camera.position.z = startPos.z + (endPos.z - startPos.z) * scrollProgress;

        // Rotate camera view as we scroll
        const lookAtTarget = new THREE.Vector3(
            -20 * scrollProgress,
            0,
            0
        );
        this.camera.lookAt(lookAtTarget);

        // Add subtle mouse-based camera tilt
        if (this.mouseX !== undefined && this.mouseY !== undefined) {
            this.camera.position.x += this.mouseX * 2;
            this.camera.position.y += this.mouseY * 2;
        }
    }

    animate() {
        // Update camera based on scroll
        this.updateCameraFromScroll();

        // Rotate planets
        this.planets.forEach(planet => {
            // Orbit around sun
            planet.angle += planet.speed;
            planet.mesh.position.x = Math.cos(planet.angle) * planet.orbitRadius;
            planet.mesh.position.z = Math.sin(planet.angle) * planet.orbitRadius;
            planet.mesh.position.y = Math.sin(planet.angle) * planet.tilt * 2;

            // Rotate planet on its axis
            planet.mesh.rotation.y += planet.rotationSpeed;
        });

        // Slowly rotate sun with pulsing effect
        this.sun.rotation.y += 0.002;

        // Add subtle pulsing to sun's children (glow layers)
        const pulseScale = 1 + Math.sin(Date.now() * 0.001) * 0.05;
        this.sun.children.forEach(child => {
            child.scale.setScalar(pulseScale);
        });

        // Slowly rotate starfield for depth effect
        if (this.starField) {
            this.starField.rotation.y += 0.0001;
        }

        // Rotate milky way galaxy slowly
        if (this.milkyWay) {
            this.milkyWay.rotation.y += 0.00005;
        }

        // Render
        this.renderer.render(this.scene, this.camera);

        requestAnimationFrame(() => this.animate());
    }
}

// Initialize when DOM and Three.js are ready
function initBackground() {
    if (typeof THREE === 'undefined') {
        console.error('Three.js not loaded. Please include Three.js library.');
        return;
    }

    const canvas = document.getElementById('webgl-canvas');
    if (canvas) {
        new SolarSystemBackground(canvas);
    }
}

// Wait for both DOM and Three.js to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBackground);
} else {
    // If DOM already loaded, check if Three.js is ready
    if (typeof THREE !== 'undefined') {
        initBackground();
    } else {
        // Wait a bit for Three.js to load
        setTimeout(initBackground, 100);
    }
}
