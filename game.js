// ============================================================================
// RETRO RALLY 3D - ENGINE DEFINITIVO CON 3 PISTAS SINCRO REALES
// ============================================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });

const WIDTH = 800;
const HEIGHT = 450;
canvas.width = WIDTH;
canvas.height = HEIGHT;

const FPS = 60;
const STEP = 1 / FPS;
const ROAD_WIDTH = 2000;       
const SEGMENT_LENGTH = 65;     
const DRAW_DISTANCE = 200;     
const BASE_CAMERA_DEPTH = 0.85;
const CAMERA_HEIGHT_DEFAULT = 1000; 

// Imágenes de los autos
const carTextures = [];
const carImageNames = ["escarabajo.png", "coupe.png", "hypercar.png"];
carImageNames.forEach((name, index) => {
    carTextures[index] = new Image();
    carTextures[index].src = name; 
});

const VEHICLE_PRESETS = [
    { name: "VW Escarabajo", maxSpeed: 198, accel: 182, brake: -330, decel: -80, handling: 3.2 },
    { name: "Coupé GT", maxSpeed: 231, accel: 215, brake: -372, decel: -88, handling: 3.5 },
    { name: "V12 Hypercar", maxSpeed: 273, accel: 256, brake: -454, decel: -100, handling: 3.9 }
];

// Mismo +10% aplicado a los rivales para no romper el balance de la carrera
const DIFFICULTY_PRESETS = [
    { name: "Fácil", minSpeed: 108, maxSpeedDelta: 33, curveSlowdown: 0.15 },
    { name: "Media", minSpeed: 136, maxSpeedDelta: 45, curveSlowdown: 0.05 },
    { name: "Difícil", minSpeed: 174, maxSpeedDelta: 42, curveSlowdown: 0.01 }
];

// Paleta visual por circuito: colores de pista/pasto, cielo y montañas, y tipo de decorado lateral.
// Antes las 3 pistas compartían exactamente los mismos colores; ahora cada una tiene identidad propia.
const TRACK_PALETTES = [
    { // 0 - Circuito del Lazo Completo: bosque genérico, paleta original
        grassA: '#1a5220', roadA: '#38383a', rumbleA: '#ffffff',
        grassB: '#113d16', roadB: '#303032', rumbleB: '#d60000',
        skyTop: '#04020a', skyMid: '#8a1f00', skyBottom: '#e57c00',
        mountain1: '#1c1026', mountain2: '#2d163d',
        scenery: 'tree'
    },
    { // 1 - Suzuka GP: bosque japonés, tonos más fríos/verdes
        grassA: '#0f4a28', roadA: '#333336', rumbleA: '#ffffff',
        grassB: '#0a3419', roadB: '#2a2a2d', rumbleB: '#d60000',
        skyTop: '#02060f', skyMid: '#123a52', skyBottom: '#4fa6c4',
        mountain1: '#0c2333', mountain2: '#164a5f',
        scenery: 'tree'
    },
    { // 2 - Mónaco: urbano junto al mar, sin pasto (pavimento/veredas)
        grassA: '#5c6670', roadA: '#3c3c40', rumbleA: '#ffffff',
        grassB: '#4d5761', roadB: '#333336', rumbleB: '#d6a300',
        skyTop: '#050a1c', skyMid: '#123256', skyBottom: '#4fa3d1',
        mountain1: '#0b1b2e', mountain2: '#183a54',
        scenery: 'building'
    }
];
let currentPalette = TRACK_PALETTES[0];

let selectedDifficultyIdx = 1;
let selectedVehicleIdx = 0;
let selectedTrackIdx = 0;
let MAX_SPEED = 198;         
let ACCEL = 182;             
let BRAKE = -330;            
let DECEL = -88;             
const OFF_ROAD_ACCEL_FACTOR = 0.4;
// Distancias (en unidades de mundo "z" y en X normalizado -1..1 de carril) para considerar que
// el auto del jugador se solapa con el de un rival y por lo tanto hay choque.
const OPPONENT_COLLISION_Z_RANGE = 200;
const OPPONENT_COLLISION_X_RANGE = 0.65;
let opponentCrashCooldown = 0; // legacy, ya no se usa globalmente

// Flash visual de choque: dura unos frames con overlay rojo/naranja
let crashFlashTimer = 0;
const CRASH_FLASH_DURATION = 0.35;

// Sistema de audio procedural (Web Audio API, sin archivos externos)
let _audioCtx = null;
let _engineOscillator = null;
let _engineGain = null;
let _engineNoise = null;
let _engineNoiseGain = null;

// Perfiles de audio para cada vehículo
const VEHICLE_AUDIO_PRESETS = {
    0: { // VW Escarabajo - motor pequeño, agudo
        freqMin: 280,
        freqMax: 650,
        volMin: 0.18,
        volMax: 0.35,
        noiseVol: 0.08,
        startFreq: 250
    },
    1: { // Coupé GT - motor medio, sonido balanceado
        freqMin: 150,
        freqMax: 450,
        volMin: 0.22,
        volMax: 0.37,
        noiseVol: 0.10,
        startFreq: 180
    },
    2: { // V12 Hypercar - motor grande, grave/profundo
        freqMin: 80,
        freqMax: 280,
        volMin: 0.26,
        volMax: 0.42,
        noiseVol: 0.12,
        startFreq: 120
    }
};

function getAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return _audioCtx;
}

function playCrashSound() {
    try {
        const ac = getAudioCtx();
        // Ruido blanco filtrado = impacto metálico retro
        const bufferSize = ac.sampleRate * 0.25;
        const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);
        const src = ac.createBufferSource();
        src.buffer = buffer;
        const filter = ac.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(400, ac.currentTime);
        filter.frequency.exponentialRampToValueAtTime(80, ac.currentTime + 0.2);
        filter.Q.value = 0.8;
        const gain = ac.createGain();
        gain.gain.setValueAtTime(0.9, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.25);
        src.connect(filter); filter.connect(gain); gain.connect(ac.destination);
        src.start(ac.currentTime);
        src.stop(ac.currentTime + 0.25);
    } catch(e) {}
}

function playEngineStartSound() {
    try {
        const ac = getAudioCtx();
        const preset = VEHICLE_AUDIO_PRESETS[selectedVehicleIdx];
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(preset.startFreq, ac.currentTime);
        osc.frequency.exponentialRampToValueAtTime(preset.freqMin, ac.currentTime + 0.3);
        gain.gain.setValueAtTime(preset.volMin, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start(ac.currentTime);
        osc.stop(ac.currentTime + 0.3);
    } catch(e) {}
}

function initializeEngineSound() {
    try {
        const ac = getAudioCtx();
        const preset = VEHICLE_AUDIO_PRESETS[selectedVehicleIdx];
        if (_engineOscillator) stopEngineSound();
        
        // Oscilador principal (fundamental del motor)
        _engineOscillator = ac.createOscillator();
        _engineOscillator.type = 'sine';
        _engineGain = ac.createGain();
        _engineGain.gain.value = preset.volMin;
        _engineOscillator.connect(_engineGain);
        
        // Ruido filtrado (característica de motor real)
        const noiseBuffer = ac.createBuffer(1, ac.sampleRate * 0.1, ac.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseBuffer.length; i++) {
            noiseData[i] = (Math.random() * 2 - 1) * 0.3;
        }
        _engineNoise = ac.createBufferSource();
        _engineNoise.buffer = noiseBuffer;
        _engineNoise.loop = true;
        _engineNoiseGain = ac.createGain();
        _engineNoiseGain.gain.value = preset.noiseVol;
        _engineNoise.connect(_engineNoiseGain);
        
        // Conectar al destination
        _engineGain.connect(ac.destination);
        _engineNoiseGain.connect(ac.destination);
        
        _engineOscillator.start(ac.currentTime);
        _engineNoise.start(ac.currentTime);
    } catch(e) {}
}

function updateEngineSound(rpm) {
    try {
        if (!_engineOscillator) return;
        const ac = getAudioCtx();
        const preset = VEHICLE_AUDIO_PRESETS[selectedVehicleIdx];
        // Mapear RPM (1000-7500) a frecuencia según preset del vehículo
        const freq = preset.freqMin + (rpm - 1000) / 6500 * (preset.freqMax - preset.freqMin);
        _engineOscillator.frequency.setTargetAtTime(freq, ac.currentTime, 0.05);
        
        // Volumen aumenta con RPM según preset
        if (_engineGain) {
            const vol = preset.volMin + (rpm - 1000) / 6500 * (preset.volMax - preset.volMin);
            _engineGain.gain.setTargetAtTime(vol, ac.currentTime, 0.05);
        }
    } catch(e) {}
}

function stopEngineSound() {
    try {
        if (_engineOscillator) {
            _engineOscillator.stop(getAudioCtx().currentTime + 0.1);
            _engineOscillator = null;
        }
        if (_engineNoise) {
            _engineNoise.stop(getAudioCtx().currentTime + 0.1);
            _engineNoise = null;
        }
    } catch(e) {}
}
// Estela: rango en Z (por delante del jugador) y en X (mismo carril) donde ir pegado a un rival
// da un pequeño extra de velocidad, hasta un tope por encima del máximo normal.
const DRAFT_MIN_Z = 20;
const DRAFT_MAX_Z = 140;
const DRAFT_X_RANGE = 0.4;
const DRAFT_SPEED_BONUS = 45;
const DRAFT_MAX_OVERSPEED = 1.08;
// Controla qué tan rápido el giro llega a su máximo (STEER_RAMP_RATE) y qué tan rápido se apaga al soltar (STEER_DECAY).
// Valores más bajos de RAMP y más altos de DECAY (más cerca de 1) = giro más suave/progresivo.
const STEER_RAMP_RATE = 4.5;
const STEER_DECAY = 0.88;
// Antes era 24: controla cuántas unidades de mundo se recorren por punto de "velocidad" por segundo.
// Bajarlo hace que el circuito se sienta más lento y legible sin tocar los números de velocidad en pantalla.
const WORLD_SCROLL_FACTOR = 20;

let gameState = 'START';
let totalTime = 0;
let timeLeft = 90;
let currentLap = 1;
let TOTAL_LAPS = 3;
let score = 0;
let damage = 0;
let crashCooldown = 0;

let playerX = 0;               
let position = 0;              
let speed = 0;
let playerRpm = 1000;
let steerInput = 0;

let camX = 0;
let camY = CAMERA_HEIGHT_DEFAULT;
let skyScrollX = 0;

let trackSegments = [];
let trackLength = 0;

let countdownTime = 3.5; 
let countdownText = "3";
let opponents = [];
const TOTAL_OPPONENTS = 4;

const MOUNTAIN_PEAKS_LAYER1 = [50, 35, 60, 40, 55, 30, 45, 60, 35, 50, 40, 55, 30, 60];
const MOUNTAIN_PEAKS_LAYER2 = [75, 50, 90, 60, 85, 45, 70, 95, 55, 80, 65, 90, 50, 85];

let particles = [];
const keys = { left: false, right: false, up: false, down: false };

function initInputSystem() {
    const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '];

    window.addEventListener('keydown', (e) => {
        if (NAV_KEYS.includes(e.key)) e.preventDefault(); // evita que la página haga scroll con las flechas
        if (e.key === 'ArrowLeft'  || e.key.toLowerCase() === 'a') keys.left = true;
        if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') keys.right = true;
        if (e.key === 'ArrowUp'    || e.key.toLowerCase() === 'w') keys.up = true;
        if (e.key === 'ArrowDown'  || e.key.toLowerCase() === 's') keys.down = true;
    });

    window.addEventListener('keyup', (e) => {
        if (e.key === 'ArrowLeft'  || e.key.toLowerCase() === 'a') keys.left = false;
        if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') keys.right = false;
        if (e.key === 'ArrowUp'    || e.key.toLowerCase() === 'w') keys.up = false;
        if (e.key === 'ArrowDown'  || e.key.toLowerCase() === 's') keys.down = false;
    });

    window.pressTouchKey = function(key) { if (keys.hasOwnProperty(key)) keys[key] = true; };
    window.releaseTouchKey = function(key) { if (keys.hasOwnProperty(key)) keys[key] = false; };

    const btnStart = document.getElementById('btnStartRace');
    if (btnStart) {
        btnStart.onclick = function () {
            const trackSelect = document.getElementById('selectTrack');
            const vehicleSelect = document.getElementById('selectVehicle');
            const difficultySelect = document.getElementById('selectDifficulty');
            
            selectedTrackIdx = trackSelect ? parseInt(trackSelect.value) : 0;
            selectedVehicleIdx = vehicleSelect ? parseInt(vehicleSelect.value) : 0;
            selectedDifficultyIdx = difficultySelect ? parseInt(difficultySelect.value) : 1;

            let vp = VEHICLE_PRESETS[selectedVehicleIdx];
            MAX_SPEED = vp.maxSpeed;
            ACCEL = vp.accel;
            BRAKE = vp.brake;
            DECEL = vp.decel;

            buildSelectedChampionshipTrack(selectedTrackIdx);
            invalidateMinimapCache();
            spawnOpponentsIA();
            startCountdownSequence();
        };
    }
}

// ============================================================================
// CONFIGURACIÓN ASIGNADA DE SEGMENTOS RECOPIADOS PARA LAS 3 PISTAS DEL MENÚ
// ============================================================================
function buildSelectedChampionshipTrack(type) {
    trackSegments = [];
    TOTAL_LAPS = 3;
    currentPalette = TRACK_PALETTES[type] || TRACK_PALETTES[0];

    if (type === 0) {
        // Circuito del Lazo Completo (Geometría del Video)
        timeLeft = 110;
        addRoadSegment(90, 0.0, 0);   
        addRoadSegment(60, 1.8, 1);
        addRoadSegment(120, 3.4, 2);  
        addRoadSegment(60, 1.8, -1);
        addRoadSegment(100, -0.6, -2);
        addRoadSegment(70, -2.0, 3);
        addRoadSegment(130, -3.8, 1); 
        addRoadSegment(70, -2.0, -2);
        addRoadSegment(80, 1.2, -3);
        addRoadSegment(50, 0.0, 0);
    } else if (type === 1) {
        // Suzuka GP (Curvas en 'S', horquillas y rectas rápidas)
        timeLeft = 120;
        addRoadSegment(80, 0.0, 0);    // Recta principal
        addRoadSegment(40, 2.5, 1);    // Primera curva a la derecha
        addRoadSegment(50, -2.0, 2);   // Curvas S izquierda
        addRoadSegment(50, 2.0, -1);   // S derecha
        addRoadSegment(60, -1.5, 0);   // Curva Dunlop
        addRoadSegment(80, 0.0, -2);   // Recta trasera
        addRoadSegment(40, -4.5, 3);   // Horquilla cerrada (Hairpin)
        addRoadSegment(70, 3.0, -1);   // Curva de la Cuchara
        addRoadSegment(90, 0.0, 0);    // Recta del túnel
        addRoadSegment(40, -2.0, 0);   // Chicane final
    } else {
        // Mónaco Street Circuit (Urbano, trabado y exigente)
        timeLeft = 140;
        addRoadSegment(50, 0.0, 0);    // Recta de Largada
        addRoadSegment(35, 4.0, 4);    // Subida Sainte-Dévote
        addRoadSegment(50, 1.5, 2);    // Tramo Beau Rivage
        addRoadSegment(40, -3.5, -2);  // Curva de Massenet
        addRoadSegment(30, 5.0, -4);   // Casino Square bajando
        addRoadSegment(45, -7.0, -2);  // Horquilla súper cerrada de Loews (Grand Hotel)
        addRoadSegment(60, 2.0, 0);    // Entrada al Túnel
        addRoadSegment(40, -3.0, 1);   // Chicane del Puerto
        addRoadSegment(40, 4.0, 0);    // Curva de la Piscina
        addRoadSegment(40, -5.0, -1);  // La Rascasse
    }

    trackLength = trackSegments.length * SEGMENT_LENGTH;
    
    let currentX = 0;
    let currentY = 0;
    for (let i = 0; i < trackSegments.length; i++) {
        let seg = trackSegments[i];
        seg.p1.world.x = currentX;
        seg.p1.world.y = currentY;
        currentX += seg.curve * 3.8; 
        currentY += seg.hill * 2.2;
        seg.p2.world.x = currentX;
        seg.p2.world.y = currentY;
    }

    rebuildSkyGradient();
}

// Suaviza la sharpness de todas las curvas de las 3 pistas en un solo punto (afecta física y minimapa por igual,
// ya que ambos leen seg.curve una vez que addRoadSegment ya lo guardó escalado).
const CURVE_SOFTEN_FACTOR = 0.6;

function addRoadSegment(num, curve, hill) {
    curve *= CURVE_SOFTEN_FACTOR;
    for (let i = 0; i < num; i++) {
        let segIndex = trackSegments.length;
        let isAlternate = Math.floor(segIndex / 4) % 2;
        // Decorado lateral cada 5 segmentos, alternando de lado, salvo cerca de la línea de largada
        let decorationGroup = Math.floor(segIndex / 5);
        let hasDecoration = (segIndex % 5 === 0) && segIndex > 10;
        trackSegments.push({
            index: segIndex,
            p1: { world: { x: 0, y: 0, z: segIndex * SEGMENT_LENGTH }, screen: { x: 0, y: 0, w: 0 } },
            p2: { world: { x: 0, y: 0, z: (segIndex + 1) * SEGMENT_LENGTH }, screen: { x: 0, y: 0, w: 0 } },
            curve: curve,
            hill: hill,
            color: isAlternate ? { grass: currentPalette.grassA, road: currentPalette.roadA, rumble: currentPalette.rumbleA }
                               : { grass: currentPalette.grassB, road: currentPalette.roadB, rumble: currentPalette.rumbleB },
            decoration: hasDecoration
                ? { side: (decorationGroup % 2 === 0) ? -1 : 1, type: currentPalette.scenery, sizeVar: 0.75 + Math.random() * 0.5 }
                : null
        });
    }
}

// Evita estirar/deformar las imágenes de los autos (cada PNG tiene su propio aspect ratio:
// coupe 500x500, escarabajo 433x577, hypercar 360x360). Ajusta dentro de la caja manteniendo proporción.
function computeFitDims(img, boxW, boxH) {
    if (!img || !img.naturalWidth || !img.naturalHeight) return { w: boxW, h: boxH };
    const boxAspect = boxW / boxH;
    const imgAspect = img.naturalWidth / img.naturalHeight;
    if (imgAspect > boxAspect) {
        return { w: boxW, h: boxW / imgAspect };
    }
    return { w: boxH * imgAspect, h: boxH };
}

function findSegment(z) {
    if (trackSegments.length === 0) return null;
    let index = Math.floor(z / SEGMENT_LENGTH) % trackSegments.length;
    if (index < 0) index += trackSegments.length;
    return trackSegments[index];
}

function spawnOpponentsIA() {
    opponents = [];
    let diff = DIFFICULTY_PRESETS[selectedDifficultyIdx];
    for (let i = 0; i < TOTAL_OPPONENTS; i++) {
        opponents.push({
            id: i,
            position: 700 + (i * 800), 
            lapsCompleted: 0, 
            playerX: (i % 2 === 0) ? -0.45 : 0.45,
            speed: diff.minSpeed + (Math.random() * diff.maxSpeedDelta),
            textureIndex: Math.floor(Math.random() * 3)
        });
    }
}

function startCountdownSequence() {
    gameState = 'COUNTDOWN';
    countdownTime = 3.5;
    countdownText = "3";
    document.getElementById('menuStart').classList.add('hidden');
    document.getElementById('menuGameOver').classList.add('hidden');
}

function updatePhysicsEngine(dt) {
    if (trackSegments.length === 0) return;

    if (gameState === 'COUNTDOWN') {
        countdownTime -= dt;
        if (countdownTime > 2.5) countdownText = "3";
        else if (countdownTime > 1.5) countdownText = "2";
        else if (countdownTime > 0.5) countdownText = "1";
        else if (countdownTime > -0.5) countdownText = "¡GO!";
        else {
            gameState = 'RUNNING';
            playEngineStartSound();
            initializeEngineSound();
        }
        
        updateOpponentsIA(dt);
        return;
    }

    if (gameState !== 'RUNNING') return;

    totalTime += dt;
    timeLeft -= dt;
    if (crashFlashTimer > 0) crashFlashTimer -= dt;
    
    // Actualizar sonido del motor
    updateEngineSound(playerRpm);

    if (timeLeft <= 0) {
        timeLeft = 0; gameState = 'GAME_OVER';
        stopEngineSound();
        showEndScreen("TIEMPO LÍMITE SUPERADO\nInténtalo de nuevo.", false);
        return;
    }

    updateOpponentsIA(dt);

    let currentSegment = findSegment(position);
    if (!currentSegment) return;
    
    let isOffRoad = Math.abs(playerX) > 1.0;

    if (keys.up) {
        let maxLimit = isOffRoad ? MAX_SPEED * 0.5 : MAX_SPEED;
        let accelRate = isOffRoad ? ACCEL * OFF_ROAD_ACCEL_FACTOR : ACCEL;
        if (speed < maxLimit) speed += (accelRate * dt * 1.5);
        else speed += (DECEL * dt);
    } else if (keys.down) {
        speed += (BRAKE * dt);
    } else {
        speed += (DECEL * dt * 2.0);
    }

    speed = Math.max(0, Math.min(speed, MAX_SPEED));
    playerRpm = playerRpm * 0.8 + (1000 + (speed / MAX_SPEED) * 6500) * 0.2;

    // Estela/aspiración: ir pegado detrás de un rival, en su mismo carril, da un pequeño extra de
    // velocidad (permite superar el tope normal por un margen chico) para incentivar pelear posiciones.
    if (keys.up && !isOffRoad) {
        for (let cp of opponents) {
            let diffZ = cp.position - position;
            if (diffZ > trackLength / 2) diffZ -= trackLength;
            else if (diffZ < -trackLength / 2) diffZ += trackLength;
            if (diffZ > DRAFT_MIN_Z && diffZ < DRAFT_MAX_Z && Math.abs(playerX - cp.playerX) < DRAFT_X_RANGE) {
                let overSpeedCap = MAX_SPEED * DRAFT_MAX_OVERSPEED;
                if (speed < overSpeedCap) speed = Math.min(overSpeedCap, speed + DRAFT_SPEED_BONUS * dt);
                break;
            }
        }
    }

    if (speed > 0) {
        let steerSpeed = VEHICLE_PRESETS[selectedVehicleIdx].handling * (isOffRoad ? 0.6 : 1.0) * (speed / MAX_SPEED);
        // steerInput ahora maneja también el desplazamiento real (antes solo inclinaba el sprite),
        // por eso el auto acelera y frena su giro lateral de forma gradual en vez de saltar de golpe.
        if (keys.left) {
            steerInput = Math.max(-1, steerInput - dt * STEER_RAMP_RATE);
        } else if (keys.right) {
            steerInput = Math.min(1, steerInput + dt * STEER_RAMP_RATE);
        } else {
            steerInput *= STEER_DECAY;
        }
        playerX += (steerInput * steerSpeed * dt * 1.6);

        // Arrastre por curva cerrada a alta velocidad: da sensación de peso y agarre limitado
        // en vez de poder girar a fondo sin perder nada de velocidad.
        if (Math.abs(steerInput) > 0.5 && speed > MAX_SPEED * 0.5) {
            speed = Math.max(0, speed - Math.abs(steerInput) * 35 * dt);
        }
    }

    if (speed > 0) {
        playerX -= (dt * (speed / MAX_SPEED) * currentSegment.curve * 0.5);
        skyScrollX -= (currentSegment.curve * (speed / MAX_SPEED) * 0.0025);
    }

    // Colisión con decorado lateral (árboles / edificios).
    // Se revisa una ventana de segmentos alrededor del jugador para no depender de que el
    // jugador esté exactamente en el único segmento que tiene el árbol (ocurren cada 5 segmentos).
    if (Math.abs(playerX) > 1.1) {
        const SCENERY_HIT_X = 1.22;
        const startSeg = Math.floor(position / SEGMENT_LENGTH);
        for (let di = -3; di <= 6; di++) {
            let idx = (startSeg + di + trackSegments.length) % trackSegments.length;
            let seg = trackSegments[idx];
            if (seg && seg.decoration && Math.abs(playerX) >= SCENERY_HIT_X && Math.sign(playerX) === seg.decoration.side) {
                crashCooldown -= dt;
                if (crashCooldown <= 0) {
                    speed = Math.max(speed * 0.55, 20);
                    damage = Math.min(100, damage + 6);
                    crashCooldown = 0.5;
                    crashFlashTimer = CRASH_FLASH_DURATION;
                    playCrashSound();
                    if (damage >= 100) {
                        gameState = 'GAME_OVER';
                        stopEngineSound();
                        showEndScreen("VEHÍCULO AVERIADO\nImpacto contra el decorado.", false);
                        return;
                    }
                }
                break;
            }
        }
    }

    if (Math.abs(playerX) > 1.8) {
        playerX = Math.sign(playerX) * 1.8;
        crashCooldown -= dt;
        if (crashCooldown <= 0) {
            speed = Math.max(speed * 0.5, 25);
            damage = Math.min(100, damage + 8);
            crashCooldown = 0.5; // medio segundo entre golpes, evita perder 100% de daño en <1s
            crashFlashTimer = CRASH_FLASH_DURATION;
            playCrashSound();
            if (damage >= 100) {
                gameState = 'GAME_OVER';
                stopEngineSound();
                showEndScreen("VEHÍCULO AVERIADO\nDaño crítico en el motor.", false);
                return;
            }
        }
    }

    if (checkOpponentCollisions(dt)) return;

    position += (speed * WORLD_SCROLL_FACTOR * dt);
    
    if (position >= trackLength) {
        if (currentLap < TOTAL_LAPS) {
            position = position % trackLength; 
            currentLap++; 
            timeLeft += 30; 
            score += 3000;
        } else {
            let finalRank = calculateRealRacePosition(true); 
            gameState = 'GAME_OVER'; speed = 0;
            stopEngineSound();
            showEndScreen(`¡CARRERA COMPLETADA!\nClasificación: P${finalRank}\nScore Final: ${score + Math.floor(timeLeft * 100)}`, finalRank <= 2);
            return;
        }
    }

    if (speed > 10) {
        score += Math.floor((speed / 90));
        if (isOffRoad && Math.random() < 0.25) {
            particles.push({ x: playerX * (WIDTH * 0.25) + (Math.random() * 20 - 10), y: HEIGHT - 40, size: Math.random() * 3 + 2, alpha: 0.6, color: '#9e7a44' });
        } else if (!isOffRoad && Math.abs(steerInput) > 0.65 && speed > MAX_SPEED * 0.5 && Math.random() < 0.3) {
            particles.push({ x: (steerInput > 0 ? -1 : 1) * 55 + (Math.random() * 12 - 6), y: HEIGHT - 35, size: Math.random() * 2.5 + 1.5, alpha: 0.5, color: '#e8e8e8' });
        }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].y -= 2; particles[i].alpha -= 0.05;
        if (particles[i].alpha <= 0) particles.splice(i, 1);
    }
}

function updateOpponentsIA(dt) {
    let diff = DIFFICULTY_PRESETS[selectedDifficultyIdx];
    for (let cp of opponents) {
        let seg = findSegment(cp.position);
        if (!seg) continue;
        cp.position += (cp.speed * (1.0 - (Math.abs(seg.curve) * diff.curveSlowdown)) * WORLD_SCROLL_FACTOR * dt);
        if (cp.position >= trackLength) { 
            cp.position = cp.position % trackLength; 
            cp.lapsCompleted++; 
        }
        cp.playerX += Math.sin(totalTime * 2.5 + cp.id) * 0.012;
    }
}

// Detecta choques usando el mismo criterio que el render: segmento del rival vs segmentos
// inmediatamente delante del jugador. Si el rival está en uno de esos segmentos Y su X
// se solapa con el jugador, hay choque real.
let lastOpponentCollisionTime = -1;
function checkOpponentCollisions(dt) {
    const playerSeg = Math.floor(position / SEGMENT_LENGTH) % trackSegments.length;
    // El jugador ocupa visualmente los 4 segmentos que tiene justo delante
    const COLLISION_SEG_AHEAD = 4;

    for (let cp of opponents) {
        const rivalSeg = Math.floor(cp.position / SEGMENT_LENGTH) % trackSegments.length;

        // Distancia en segmentos (circular)
        let segDiff = rivalSeg - playerSeg;
        if (segDiff > trackSegments.length / 2) segDiff -= trackSegments.length;
        else if (segDiff < -trackSegments.length / 2) segDiff += trackSegments.length;

        // Solo los rivales que están en los segmentos justo delante del jugador
        if (segDiff < 0 || segDiff > COLLISION_SEG_AHEAD) continue;

        const diffX = playerX - cp.playerX;
        if (Math.abs(diffX) >= OPPONENT_COLLISION_X_RANGE) continue;

        // Hay solapamiento visual: procesar choque
        // Cooldown global muy corto (0.1s) solo para evitar daño múltiple en el mismo frame
        if (totalTime - lastOpponentCollisionTime > 0.1) {
            speed = Math.max(speed * 0.55, 20);
            damage = Math.min(100, damage + 12);
            lastOpponentCollisionTime = totalTime;
            crashFlashTimer = CRASH_FLASH_DURATION;
            playCrashSound();

            let pushDir = diffX !== 0 ? Math.sign(diffX) : (Math.random() < 0.5 ? -1 : 1);
            playerX += pushDir * 0.4;
            cp.playerX -= pushDir * 0.15;

            if (damage >= 100) {
                gameState = 'GAME_OVER';
                stopEngineSound();
                showEndScreen("VEHÍCULO AVERIADO\nColisión fatal contra un rival.", false);
                return true;
            }
        }
    }
    return false;
}

let _cachedRank = 1;
let _rankFrameCount = 0;
const RANK_UPDATE_INTERVAL = 30; // recalcular posición cada 30 frames (~0.5s) en vez de cada frame

function calculateRealRacePosition(raceFinished = false) {
    let playerDist = raceFinished ? (TOTAL_LAPS * trackLength) : ((currentLap - 1) * trackLength + position);
    let rank = 1;
    for (let cp of opponents) {
        let cpDist = cp.lapsCompleted * trackLength + cp.position;
        if (cpDist > playerDist) rank++;
    }
    return rank;
}

function project3D(point, cameraX, cameraY, cameraZ, depth) {
    let transX = point.world.x - cameraX;
    let transY = point.world.y - cameraY;
    let transZ = point.world.z - cameraZ;
    if (transZ < 0) transZ += trackLength;
    let scale = depth / transZ;
    point.screen.x = Math.round((WIDTH / 2) + (scale * transX * WIDTH / 2));
    point.screen.y = Math.round((HEIGHT / 2) - (scale * transY * HEIGHT / 2));
    point.screen.w = Math.round(scale * ROAD_WIDTH * WIDTH / 2);
    return scale;
}

function drawChampionshipHorizon(horizonY) {
    ctx.fillStyle = currentPalette.mountain1; ctx.beginPath(); ctx.moveTo(0, HEIGHT); ctx.lineTo(0, horizonY);
    for (let i = 0; i <= WIDTH; i += 40) {
        let idx = Math.abs(Math.floor(i / 40 + skyScrollX * 10)) % MOUNTAIN_PEAKS_LAYER1.length;
        ctx.lineTo(i, horizonY - MOUNTAIN_PEAKS_LAYER1[idx]);
    }
    ctx.lineTo(WIDTH, HEIGHT); ctx.closePath(); ctx.fill();

    ctx.fillStyle = currentPalette.mountain2; ctx.beginPath(); ctx.moveTo(0, HEIGHT); ctx.lineTo(0, horizonY);
    for (let i = 0; i <= WIDTH; i += 50) {
        let idx = Math.abs(Math.floor(i / 50 + skyScrollX * 18)) % MOUNTAIN_PEAKS_LAYER2.length;
        ctx.lineTo(i, horizonY - MOUNTAIN_PEAKS_LAYER2[idx]);
    }
    ctx.lineTo(WIDTH, HEIGHT); ctx.closePath(); ctx.fill();
}

function showEndScreen(text, isVictory) {
    const titleElement = document.getElementById('goTitle');
    titleElement.innerText = isVictory ? "¡VICTORIA!" : "FIN DE JUEGO";
    titleElement.style.color = isVictory ? "#00ffcc" : "#ff0055"; 
    document.getElementById('goReason').innerText = text;
    document.getElementById('menuGameOver').classList.remove('hidden');
}

// Gradiente de cielo: depende de la paleta de la pista activa, por eso se reconstruye una sola vez
// cada vez que se arma un circuito (buildSelectedChampionshipTrack) en vez de crearse cada frame.
let _skyGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT / 2);
function rebuildSkyGradient() {
    _skyGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT / 2);
    _skyGrad.addColorStop(0, currentPalette.skyTop);
    _skyGrad.addColorStop(0.6, currentPalette.skyMid);
    _skyGrad.addColorStop(1, currentPalette.skyBottom);
}
rebuildSkyGradient();
// (2 objetos anidados x 200 segmentos x 60fps = ~24.000 objetos/seg antes de este cambio).
const _renderPt1 = { world: { x: 0, y: 0, z: 0 }, screen: { x: 0, y: 0, w: 0 } };
const _renderPt2 = { world: { x: 0, y: 0, z: 0 }, screen: { x: 0, y: 0, w: 0 } };

// Dibuja un elemento de decorado lateral (árbol o edificio) escalado por la perspectiva de la pista.
// x/y llegan en coordenadas de pantalla (igual que los sprites de rivales), scale viene de project3D.
function drawSceneryObject(type, x, y, scale, sizeVar) {
    if (scale <= 0) return;
    const baseSize = 400 * (sizeVar || 1);
    let h = baseSize * scale * (WIDTH / 2);
    if (h < 2 || h > HEIGHT * 1.5) return;
    let w = h * 0.55;

    if (type === 'building') {
        ctx.fillStyle = '#3a4048';
        ctx.fillRect(x - w / 2, y - h, w, h);
        ctx.fillStyle = 'rgba(255, 221, 102, 0.85)';
        let rows = Math.max(1, Math.floor(h / 14));
        let cols = Math.max(1, Math.floor(w / 10));
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if ((r + c) % 3 !== 0) continue;
                ctx.fillRect(x - w / 2 + 3 + c * (w / cols), y - h + 3 + r * (h / rows), 3, 3);
            }
        }
    } else {
        // Tronco y follaje con tonos más saturados + contorno oscuro: el pasto de fondo es un verde
        // apagado, así que sin contraste extra el árbol casi desaparecía sobre él.
        ctx.fillStyle = '#3b2712';
        ctx.fillRect(x - w * 0.08, y - h * 0.35, w * 0.16, h * 0.35);

        ctx.fillStyle = '#2f8a42';
        ctx.strokeStyle = '#0a2410';
        ctx.lineWidth = Math.max(1, w * 0.04);
        ctx.beginPath();
        ctx.moveTo(x, y - h); ctx.lineTo(x - w * 0.5, y - h * 0.32); ctx.lineTo(x + w * 0.5, y - h * 0.32);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y - h * 0.72); ctx.lineTo(x - w * 0.4, y - h * 0.12); ctx.lineTo(x + w * 0.4, y - h * 0.12);
        ctx.closePath(); ctx.fill(); ctx.stroke();
    }
}

// Rastro de neumáticos al derrapar en curva cerrada (distinto del polvo de tierra fuera de pista)
function drawSpeedEffects(speedRatio) {
    if (speedRatio < 0.55) return;
    const intensity = (speedRatio - 0.55) / 0.45;
    ctx.strokeStyle = `rgba(255,255,255,${(0.14 * intensity).toFixed(3)})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
        let y = Math.random() * HEIGHT * 0.85;
        let len = 30 + Math.random() * 90 * intensity;
        let fromLeft = Math.random() < 0.5;
        let xStart = fromLeft ? 0 : WIDTH;
        let dir = fromLeft ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(xStart, y);
        ctx.lineTo(xStart + dir * len, y);
        ctx.stroke();
    }
}

function executeGraphicsRender() {
    if (trackSegments.length === 0) return;
    ctx.imageSmoothingEnabled = false;

    let shakeX = 0, shakeY = 0;
    if (gameState === 'RUNNING' && speed > 20) {
        let shk = (speed / MAX_SPEED) * (Math.abs(playerX) > 1.0 ? 2.5 : 0.5);
        shakeX = (Math.random() - 0.5) * shk; shakeY = (Math.random() - 0.5) * shk;
    }

    ctx.fillStyle = _skyGrad; ctx.fillRect(0, 0, WIDTH, HEIGHT);

    let horizonY = Math.round(HEIGHT / 2);
    drawChampionshipHorizon(horizonY);

    let playerSegment = findSegment(position);
    let playerPercent = (position % SEGMENT_LENGTH) / SEGMENT_LENGTH;
    camY = camY * 0.8 + ((playerSegment.p1.world.y + (playerSegment.p2.world.y - playerSegment.p1.world.y) * playerPercent) + CAMERA_HEIGHT_DEFAULT) * 0.2;
    // camX ya no suma playerSegment.p1/p2.world.x: ese término era el mismo valor absoluto que
    // acabamos de sacar del render por causar el desfasaje. En coordenadas locales, el segmento
    // de la cámara siempre es la referencia "0", así que solo queda el offset lateral por dirección.
    camX = camX * 0.8 + (playerX * ROAD_WIDTH) * 0.2;

    let maxy = HEIGHT;
    let startIdx = Math.floor(position / SEGMENT_LENGTH);
    let spritesToRender = [];
    let sceneryToRender = [];
    let dx = -(playerSegment.curve * playerPercent), xAccum = 0;

    for (let i = 0; i < DRAW_DISTANCE; i++) {
        let currentIdx = (startIdx + i) % trackSegments.length;
        let seg = trackSegments[currentIdx];
        let camZOffset = position - (startIdx + i >= trackSegments.length ? trackLength : 0);

        let pt1 = _renderPt1, pt2 = _renderPt2;
        // Antes: "seg.p1.world.x + xAccum" sumaba un valor absoluto (acumulado sin cerrar el lazo
        // desde el segmento 0 hasta el último) con uno local (reiniciado en 0 cada frame). Al cruzar
        // del último segmento al primero (justo en la línea de llegada) los dos no coincidían y
        // generaban un salto visible en el ancho/posición de la pista. Usando solo la acumulación
        // local, el resultado es continuo sin importar en qué punto de la vuelta esté la cámara.
        pt1.world.x = xAccum; pt1.world.y = seg.p1.world.y; pt1.world.z = seg.p1.world.z;
        pt2.world.x = xAccum + dx + seg.curve; pt2.world.y = seg.p2.world.y; pt2.world.z = seg.p2.world.z;

        let scale = project3D(pt1, camX + shakeX * 3, camY + shakeY * 3, camZOffset, BASE_CAMERA_DEPTH);
        project3D(pt2, camX + shakeX * 3, camY + shakeY * 3, camZOffset, BASE_CAMERA_DEPTH);

        xAccum += dx; dx += seg.curve;
        if (pt1.screen.y >= maxy || pt2.screen.y >= maxy || scale <= 0) continue;

        ctx.fillStyle = seg.color.grass; ctx.fillRect(0, pt2.screen.y, WIDTH, (pt1.screen.y + 1) - pt2.screen.y);
        
        let r1 = pt1.screen.w * 0.12, r2 = pt2.screen.w * 0.12;
        ctx.fillStyle = seg.color.rumble;
        ctx.beginPath(); ctx.moveTo(pt1.screen.x - pt1.screen.w - r1, pt1.screen.y + 1); ctx.lineTo(pt1.screen.x - pt1.screen.w, pt1.screen.y + 1); ctx.lineTo(pt2.screen.x - pt2.screen.w, pt2.screen.y); ctx.lineTo(pt2.screen.x - pt2.screen.w - r2, pt2.screen.y); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(pt1.screen.x + pt1.screen.w + r1, pt1.screen.y + 1); ctx.lineTo(pt1.screen.x + pt1.screen.w, pt1.screen.y + 1); ctx.lineTo(pt2.screen.x + pt2.screen.w, pt2.screen.y); ctx.lineTo(pt2.screen.x + pt2.screen.w + r2, pt2.screen.y); ctx.closePath(); ctx.fill();
        
        ctx.fillStyle = seg.color.road;
        ctx.beginPath(); ctx.moveTo(pt1.screen.x - pt1.screen.w, pt1.screen.y + 1); ctx.lineTo(pt1.screen.x + pt1.screen.w, pt1.screen.y + 1); ctx.lineTo(pt2.screen.x + pt2.screen.w, pt2.screen.y); ctx.lineTo(pt2.screen.x - pt2.screen.w, pt2.screen.y); ctx.closePath(); ctx.fill();
        
        if (seg.index === 0) { 
            ctx.fillStyle = '#ffffff'; ctx.fillRect(pt1.screen.x - pt1.screen.w, pt2.screen.y, pt1.screen.w * 2, (pt1.screen.y - pt2.screen.y) * 0.4);
        }

        maxy = pt1.screen.y;

        if (seg.decoration) {
            // Mismo sistema de posicionamiento lateral que los autos rivales (offset normalizado tipo
            // playerX × ROAD_WIDTH), en vez de sumar sobre el ancho de pista ya proyectado en pantalla:
            // ese ancho es enorme en los segmentos cercanos y empujaba el decorado fuera de la pantalla.
            let lateralOffset = seg.decoration.side * 1.3; // justo pasado el borde transitable (offroad > 1.0)
            let sx = pt1.screen.x + (scale * lateralOffset * ROAD_WIDTH * WIDTH / 2);
            sceneryToRender.push({
                type: seg.decoration.type,
                x: sx,
                y: pt1.screen.y,
                scale: scale,
                sizeVar: seg.decoration.sizeVar
            });
        }

        for (let cp of opponents) {
            if ((Math.floor(cp.position / SEGMENT_LENGTH) % trackSegments.length) === seg.index) {
                spritesToRender.push({ sx: pt1.screen.x + shakeX, sy: pt1.screen.y + shakeY, cp: cp, scale: scale });
            }
        }
    }

    // De más lejos a más cerca, igual que los sprites de rivales, para que el decorado cercano
    // tape al lejano en vez de al revés.
    for (let i = sceneryToRender.length - 1; i >= 0; i--) {
        let s = sceneryToRender[i];
        drawSceneryObject(s.type, s.x + shakeX, s.y + shakeY, s.scale, s.sizeVar);
    }

    for (let p of particles) {
        ctx.fillStyle = p.color; ctx.globalAlpha = p.alpha; ctx.beginPath();
        ctx.arc(WIDTH / 2 + p.x + shakeX, p.y + shakeY, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    for (let i = spritesToRender.length - 1; i >= 0; i--) {
        let s = spritesToRender[i];
        let spriteX = Math.round(s.sx + (s.scale * s.cp.playerX * ROAD_WIDTH * WIDTH / 2));
        let sizeMultiplier = 3.75; // 75% del tamaño duplicado anterior (5)
        let w = Math.round(190 * s.scale * (WIDTH / 2) * sizeMultiplier);
        let h = Math.round(130 * s.scale * (WIDTH / 2) * sizeMultiplier);
        
        if (spriteX + w/2 > 0 && spriteX - w/2 < WIDTH) {
            let rivalImg = carTextures[s.cp.textureIndex];
            if (rivalImg && rivalImg.complete && rivalImg.naturalWidth !== 0) {
                const dims = computeFitDims(rivalImg, w, h);
                ctx.drawImage(rivalImg, spriteX - dims.w / 2, s.sy - dims.h, dims.w, dims.h);
            } else {
                ctx.fillStyle = (s.cp.textureIndex === 0) ? '#ff2a00' : (s.cp.textureIndex === 1) ? '#0066ff' : '#ccaa00';
                ctx.fillRect(spriteX - w / 2, s.sy - h + (25 * sizeMultiplier), w, h - (40 * sizeMultiplier));
            }
        }
    }

    if (gameState === 'RUNNING') {
        drawSpeedEffects(speed / MAX_SPEED);
    }

    if (gameState === 'RUNNING' || gameState === 'COUNTDOWN') {
        const cW = 285, cH = 195; // 75% del tamaño duplicado anterior (380x260)
        // Rebote sutil ligado a la velocidad e inclinación al girar: le da peso al auto en vez de
        // que se deslice como un sprite plano pegado al piso.
        const bounce = (gameState === 'RUNNING' && speed > 5) ? Math.sin(totalTime * 14) * (speed / MAX_SPEED) * 2.2 : 0;
        const leanAngle = steerInput * 0.09;
        const cX = (WIDTH / 2) - (cW / 2) + (steerInput * 35) + shakeX;
        const cY = HEIGHT - cH - 20 + shakeY + bounce;
        let currentImg = carTextures[selectedVehicleIdx];

        ctx.save();
        ctx.translate(cX + cW / 2, cY + cH);
        ctx.rotate(leanAngle);
        ctx.translate(-(cX + cW / 2), -(cY + cH));

        if (currentImg && currentImg.complete && currentImg.naturalWidth !== 0) {
            const dims = computeFitDims(currentImg, cW, cH);
            const dx = cX + (cW - dims.w) / 2;
            const dy = cY + (cH - dims.h);
            ctx.drawImage(currentImg, dx, dy, dims.w, dims.h);
        } else {
            let colBody = (selectedVehicleIdx === 0) ? '#ff2a00' : (selectedVehicleIdx === 1) ? '#0066ff' : '#ccaa00';
            ctx.fillStyle = '#0f0f14'; ctx.fillRect(cX + 6, cY + cH - 35, 24, 35); ctx.fillRect(cX + cW - 30, cY + cH - 35, 24, 35);
            ctx.fillStyle = colBody; ctx.fillRect(cX, cY + 25, cW, cH - 40);
            ctx.fillStyle = '#14161f'; ctx.fillRect(cX + 16, cY + 35, cW - 32, 25);
            ctx.fillStyle = keys.down ? '#ff1111' : '#660000'; ctx.fillRect(cX + 8, cY + cH - 28, 22, 10); ctx.fillRect(cX + cW - 30, cY + cH - 28, 22, 10);
        }

        ctx.restore();
    }

    // Flash rojo de choque: se dibuja sobre todo excepto el HUD
    if (crashFlashTimer > 0) {
        let flashAlpha = (crashFlashTimer / CRASH_FLASH_DURATION) * 0.55;
        ctx.fillStyle = `rgba(255, 30, 0, ${flashAlpha.toFixed(3)})`;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }

    drawHUD();
    
    const trackSelect = document.getElementById('selectTrack');
    let activeTrack = trackSelect ? parseInt(trackSelect.value) : selectedTrackIdx;
    drawAbsoluteMathematicalMinimap(ctx, WIDTH - 115, 20, 95, true, activeTrack); 
}

// Cache del minimapa: el trazado geométrico es fijo por pista, no tiene sentido recalcularlo 60 veces/seg.
// Se invalida solo cuando cambia selectedTrackIdx (al presionar Empezar o al volver al menú).
let _minimapCache = null; // { trackType, coords, minX, maxX, minY, maxY }

function _buildMinimapCoords(segmentsToDraw) {
    let coords = [];
    let heading = 0, cx = 0, cz = 0;
    let totalCurve = 0;
    for (const s of segmentsToDraw) totalCurve += s.curve;

    // La corrección anterior usaba (-2π / N) e ignoraba la curvatura acumulada real de la pista,
    // así que el heading total no cerraba en ±360° y el minimapa se deformaba.
    // Fórmula correcta: corrPerSeg = (targetHeading - totalCurve×0.015) / N
    // donde targetHeading = -2π si la pista gira en sentido horario (sumaCurva < 0), +2π si antihorario.
    const targetHeading = totalCurve <= 0 ? -2 * Math.PI : 2 * Math.PI;
    const corrPerSeg = (targetHeading - totalCurve * 0.015) / segmentsToDraw.length;

    for (let i = 0; i < segmentsToDraw.length; i++) {
        heading += (segmentsToDraw[i].curve * 0.015) + corrPerSeg;
        cx += Math.cos(heading) * SEGMENT_LENGTH * 0.1;
        cz += Math.sin(heading) * SEGMENT_LENGTH * 0.1;
        coords.push({ x: cx, y: cz });
    }

    // Reparto lineal del gap posicional residual (mínimo con la corrección de heading exacta)
    const lastIdx = coords.length - 1;
    const gapX = coords[lastIdx].x, gapY = coords[lastIdx].y;
    for (let i = 0; i < coords.length; i++) {
        const t = i / lastIdx;
        coords[i].x -= gapX * t;
        coords[i].y -= gapY * t;
    }

    // Bounding box precalculado (evita 4 spreads de array en cada frame)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of coords) {
        if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
    }
    return { coords, minX, maxX, minY, maxY };
}

function invalidateMinimapCache() { _minimapCache = null; }
// ============================================================================
// DIBUJO GEOMÉTRICO 100% SINCRO DINÁMICO BASADO EN SEGMENTOS REALES (CORREGIDO)
// ============================================================================
function drawAbsoluteMathematicalMinimap(targetCtx, x, y, size, renderActors, trackType) {
    targetCtx.fillStyle = 'rgba(12, 6, 22, 0.9)';
    targetCtx.strokeStyle = '#5c2e91';
    targetCtx.lineWidth = 3;
    targetCtx.beginPath();
    targetCtx.roundRect(x, y, size, size, 8);
    targetCtx.fill();
    targetCtx.stroke();

    let segmentsToDraw = trackSegments;
    if (!renderActors || trackSegments.length === 0) {
        let backupSegments = trackSegments;
        let backupLength = trackLength;
        let backupTimeLeft = timeLeft;
        let backupTotalLaps = TOTAL_LAPS;
        // buildSelectedChampionshipTrack también fija currentPalette y reconstruye el gradiente del
        // cielo; como esto es solo una previsualización del trazado, hay que restaurar ambos también
        // para no pisarle los colores de cielo/horizonte a la carrera real que sigue detrás del menú.
        let backupPalette = currentPalette;
        let backupSkyGrad = _skyGrad;
        buildSelectedChampionshipTrack(trackType);
        segmentsToDraw = trackSegments;
        trackSegments = backupSegments;
        trackLength = backupLength;
        timeLeft = backupTimeLeft;
        TOTAL_LAPS = backupTotalLaps;
        currentPalette = backupPalette;
        _skyGrad = backupSkyGrad;
    }

    if (segmentsToDraw.length === 0) return;

    // Usar cache del trazado; recalcular solo si cambió la pista
    if (!_minimapCache || _minimapCache.trackType !== trackType) {
        _minimapCache = { trackType, ..._buildMinimapCoords(segmentsToDraw) };
    }
    const { coords, minX, maxX, minY, maxY } = _minimapCache;

    const trackW = maxX - minX;
    const trackH = maxY - minY;
    const scale = Math.min((size - 24) / (trackW || 1), (size - 24) / (trackH || 1));
    const offsetX = x + (size - trackW * scale) / 2 - minX * scale;
    const offsetY = y + (size - trackH * scale) / 2 - minY * scale;

    targetCtx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    targetCtx.lineWidth = 4;
    targetCtx.lineCap = 'round';
    targetCtx.lineJoin = 'round';
    targetCtx.beginPath();
    for (let i = 0; i < coords.length; i++) {
        const scX = offsetX + coords[i].x * scale;
        const scY = offsetY + coords[i].y * scale;
        if (i === 0) targetCtx.moveTo(scX, scY);
        else targetCtx.lineTo(scX, scY);
    }
    targetCtx.closePath();
    targetCtx.stroke();

    if (!renderActors || trackSegments.length === 0) return;

    // Enemigos en el mapa
    targetCtx.fillStyle = '#ff3355';
    for (let cp of opponents) {
        let idx = Math.floor((cp.position / trackLength) * coords.length) % coords.length;
        if (coords[idx]) {
            targetCtx.beginPath();
            targetCtx.arc(offsetX + coords[idx].x * scale, offsetY + coords[idx].y * scale, 3.5, 0, Math.PI * 2);
            targetCtx.fill();
        }
    }

    // Jugador en el mapa
    let pIdx = Math.floor((position / trackLength) * coords.length) % coords.length;
    if (coords[pIdx]) {
        targetCtx.fillStyle = '#00ffcc';
        targetCtx.strokeStyle = '#ffffff';
        targetCtx.lineWidth = 1.5;
        targetCtx.beginPath();
        targetCtx.arc(offsetX + coords[pIdx].x * scale, offsetY + coords[pIdx].y * scale, 5.5, 0, Math.PI * 2);
        targetCtx.fill();
        targetCtx.stroke();
    }
}

window.updateMenuTrackPreview = function() {
    const pCanvas = document.getElementById('menuMapCanvas');
    const trackSelect = document.getElementById('selectTrack');
    if (pCanvas && trackSelect) {
        let trackType = parseInt(trackSelect.value);
        const pCtx = pCanvas.getContext('2d');
        pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
        drawAbsoluteMathematicalMinimap(pCtx, 5, 5, 120, false, trackType);
    }
};

function drawHUD() {
    if (gameState === 'START') return;
    if (gameState === 'COUNTDOWN') {
        ctx.fillStyle = '#ffcc00'; ctx.font = 'bold 55px monospace'; ctx.textAlign = 'center';
        ctx.fillText(countdownText, WIDTH / 2, HEIGHT / 2 - 30); ctx.textAlign = 'left';
        return;
    }

    ctx.fillStyle = timeLeft < 15 ? '#ff3333' : '#ffffff'; ctx.font = 'bold 24px monospace';
    ctx.fillText(`TIEMPO: ${Math.ceil(timeLeft)}s`, 25, 45);

    ctx.fillStyle = '#ffffff'; ctx.font = '22px monospace';
    ctx.fillText(`${Math.floor(speed)} KM/H`, 25, 75);

    ctx.fillStyle = '#222533'; ctx.fillRect(25, 88, 140, 6);
    ctx.fillStyle = playerRpm > 6000 ? '#ff3333' : '#00ffcc';
    ctx.fillRect(25, 88, (playerRpm / 7500) * 140, 6);

    ctx.fillStyle = '#8a9ab0'; ctx.font = '15px monospace';
    ctx.fillText(`DAÑO: ${damage}%`, 25, 120);

    ctx.fillStyle = '#ffff00'; ctx.font = 'bold 22px monospace';
    ctx.fillText(`PUNTOS: ${score}`, WIDTH - 390, 45);
    
    let kmRecorridos = ((currentLap - 1) * trackLength + position) / 1000;
    let kmTotales = (TOTAL_LAPS * trackLength) / 1000;
    ctx.fillStyle = '#ffffff'; ctx.font = '16px monospace';
    ctx.fillText(`TRK: ${kmRecorridos.toFixed(2)} / ${kmTotales.toFixed(2)} KM`, WIDTH - 390, 75);

    _rankFrameCount++;
    if (_rankFrameCount >= RANK_UPDATE_INTERVAL) {
        _cachedRank = calculateRealRacePosition(gameState === 'GAME_OVER');
        _rankFrameCount = 0;
    }
    let rank = _cachedRank;
    ctx.fillStyle = '#00ffcc'; ctx.font = 'bold 18px monospace';
    ctx.fillText(`POSICIÓN: P${rank} (VUELTA ${currentLap}/${TOTAL_LAPS})`, WIDTH - 390, 105);
}

// Antes se llamaba a updatePhysicsEngine(STEP) una vez por cada callback de requestAnimationFrame,
// asumiendo que ese callback siempre llega ~60 veces por segundo. Chrome cumple eso en la práctica,
// pero Firefox (según hardware/configuración) puede disparar rAF con menos frecuencia real, y como
// cada llamada seguía avanzando la física un solo paso fijo, el juego entero corría en cámara lenta.
// Con un acumulador de tiempo real se ejecutan tantos pasos fijos de STEP como hagan falta para
// ponerse al día, sin importar a qué frecuencia dispare rAF cada navegador.
let _lastFrameTime = null;
let _physicsAccumulator = 0;
const MAX_STEPS_PER_FRAME = 5; // evita "spiral of death" si la pestaña estuvo en segundo plano

function runMasterGameLoop(currentTime) {
    if (_lastFrameTime === null) _lastFrameTime = currentTime;
    let frameDelta = (currentTime - _lastFrameTime) / 1000;
    _lastFrameTime = currentTime;
    if (frameDelta > 0.25) frameDelta = 0.25; // clamp ante lag puntual o pestaña recién reactivada

    _physicsAccumulator += frameDelta;
    let steps = 0;
    while (_physicsAccumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
        updatePhysicsEngine(STEP);
        _physicsAccumulator -= STEP;
        steps++;
    }

    executeGraphicsRender();
    requestAnimationFrame(runMasterGameLoop);
}

function resetRaceState() {
    stopEngineSound();
    position = 0; speed = 0; totalTime = 0; currentLap = 1; score = 0; damage = 0; playerX = 0; crashCooldown = 0; opponentCrashCooldown = 0; crashFlashTimer = 0; lastOpponentCollisionTime = -1;
    particles = []; steerInput = 0; camX = 0; camY = CAMERA_HEIGHT_DEFAULT; skyScrollX = 0;
    _cachedRank = 1; _rankFrameCount = 0;
    invalidateMinimapCache();
    gameState = 'START';
    document.getElementById('menuGameOver').classList.add('hidden');
    document.getElementById('menuStart').classList.remove('hidden');
    setTimeout(window.updateMenuTrackPreview, 50);
}

window.resetRaceState = resetRaceState;
window.onload = function() {
    initInputSystem();
    buildSelectedChampionshipTrack(0);
    setTimeout(window.updateMenuTrackPreview, 100);
    requestAnimationFrame(runMasterGameLoop);
};