// Module aliases
const Engine = Matter.Engine,
    Render = Matter.Render,
    Runner = Matter.Runner,
    Bodies = Matter.Bodies,
    Composite = Matter.Composite,
    Constraint = Matter.Constraint,
    Body = Matter.Body,
    Events = Matter.Events,
    Vector = Matter.Vector,
    Mouse = Matter.Mouse,
    MouseConstraint = Matter.MouseConstraint;

// Game State
let engine, render, runner;
let playerBase, balanceBeam, pivotConstraint;
let leftBucket, rightBucket;
let isGameOver = false;
let score = 0;
let lastSpawnTime = 0;
let spawnInterval = 2000; // Initial spawn interval (ms)
let difficultyMultiplier = 1;
let inputState = { left: false, right: false };

// Configuration
const CONFIG = {
    playerSpeed: 8,
    beamWidth: 300,
    beamHeight: 20,
    bucketSize: 60,
    bucketWallHeight: 80,
    maxAngle: Math.PI / 3, // 60 degrees
    warningAngle: Math.PI / 6, // 30 degrees
    colors: {
        red: { color: '#FF4444', weight: 1 },
        blue: { color: '#4444FF', weight: 1.2 },
        green: { color: '#44FF44', weight: 1.5 },
        yellow: { color: '#FFFF44', weight: 2 },
        purple: { color: '#FF44FF', weight: 3 }
    }
};

// DOM Elements
const scoreEl = document.getElementById('score');
const finalScoreEl = document.getElementById('final-score');
const warningOverlay = document.getElementById('warning-overlay');
const gameOverScreen = document.getElementById('game-over-screen');
const restartBtn = document.getElementById('restart-btn');

// Initialize Game
function init() {
    // Create engine
    engine = Engine.create();

    // Create renderer
    render = Render.create({
        element: document.getElementById('game-container'),
        engine: engine,
        options: {
            width: window.innerWidth,
            height: window.innerHeight,
            wireframes: false,
            background: 'transparent' // Use CSS background
        }
    });

    // Create player rig
    createPlayerRig();

    // Create walls
    createWalls();

    // Add mouse control (optional, for debugging or interaction)
    const mouse = Mouse.create(render.canvas);
    const mouseConstraint = MouseConstraint.create(engine, {
        mouse: mouse,
        constraint: {
            stiffness: 0.2,
            render: { visible: false }
        }
    });
    Composite.add(engine.world, mouseConstraint);
    render.mouse = mouse;

    // Collision Events (Merging & Bomb)
    Events.on(engine, 'collisionStart', handleCollisions);

    // Before Update (Input & Game Logic)
    Events.on(engine, 'beforeUpdate', gameLoop);

    // After Render (Custom Drawing)
    Events.on(render, 'afterRender', drawCustomEffects);

    // Run
    Render.run(render);
    runner = Runner.create();
    Runner.run(runner, engine);

    // Start Spawning
    lastSpawnTime = performance.now();
}

function createPlayerRig() {
    const startX = window.innerWidth / 2;
    const startY = window.innerHeight - 150;

    // 1. Player Base (The character body - invisible or simple shape)
    // Kinematic? No, we want physics forces. But we want to control it directly.
    // Let's make it a heavy rectangle that slides on a floor or is constrained to a line.
    // Simplest: A rectangle with high friction, constrained to Y axis.

    playerBase = Bodies.rectangle(startX, startY, 60, 100, {
        label: 'PlayerBase',
        frictionAir: 0.1,
        density: 0.05,
        render: { fillStyle: '#FFFFFF' },
        collisionFilter: { group: -1 }
    });

    // Constraint to keep player on fixed Y height
    const yConstraint = Constraint.create({
        bodyA: playerBase,
        pointB: { x: startX, y: startY },
        stiffness: 1,
        length: 0,
        render: { visible: false }
    });

    // 2. Balance Beam
    balanceBeam = Bodies.rectangle(startX, startY - 60, CONFIG.beamWidth, CONFIG.beamHeight, {
        label: 'Beam',
        density: 0.01,
        collisionFilter: { group: -1 },
        render: { fillStyle: '#8B4513' }
    });

    // 3. Pivot (Hinge)
    pivotConstraint = Constraint.create({
        bodyA: playerBase,
        bodyB: balanceBeam,
        pointA: { x: 0, y: -50 }, // Top of player head
        pointB: { x: 0, y: 0 },   // Center of beam
        stiffness: 1,
        length: 0,
        render: { visible: true, lineWidth: 5, strokeStyle: '#555' }
    });

    // 4. Buckets
    // Buckets should hang BELOW the beam to be stable (Center of Mass below Pivot)
    // Or at least not colliding.
    const bucketOptions = {
        density: 0.01,
        friction: 0.5,
        render: { fillStyle: '#555' },
        collisionFilter: { group: -1 } // Don't collide with beam/player
    };
    const wallOptions = { ...bucketOptions, render: { fillStyle: '#444' } };

    function createBucket(xOffset) {
        const w = CONFIG.bucketSize;
        const h = CONFIG.bucketWallHeight;
        const wallThick = 10;
        const hangDistance = 60; // Distance below beam

        const beamX = balanceBeam.position.x;
        const beamY = balanceBeam.position.y;

        // Create parts for the compound body
        // Note: When creating parts, we position them where we want them to be initially.

        const bottom = Bodies.rectangle(beamX + xOffset, beamY + hangDistance, w, 10, { render: { fillStyle: '#555' } });
        const left = Bodies.rectangle(beamX + xOffset - w / 2 + wallThick / 2, beamY + hangDistance - h / 2 + 5, wallThick, h, { render: { fillStyle: '#444' } });
        const right = Bodies.rectangle(beamX + xOffset + w / 2 - wallThick / 2, beamY + hangDistance - h / 2 + 5, wallThick, h, { render: { fillStyle: '#444' } });

        // Create a single rigid body from parts
        const bucket = Body.create({
            parts: [bottom, left, right],
            friction: 0.5,
            density: 0.01,
            collisionFilter: { group: -1 } // Don't collide with beam/player
        });

        // Attach to beam with a constraint (like a handle/rope)
        // Better attachment: Two constraints to prevent free rotation like a pendulum if we want it rigid?
        // Or one constraint for a swinging bucket?
        // User said "Buckets collapsing", implying parts separating. 
        // Swinging is fine. But let's make it slightly rigid rotation-wise to avoid spilling too easily?
        // No, let's stick to one constraint for now, but maybe attach it to the "handle" position.

        // We need to calculate the offset for pointB (relative to bucket CoM).
        // Since we don't know CoM easily without calculation, let's just use the world position for the constraint creation.
        // Matter.js Constraint.create can take world points if we don't specify bodyB/pointB initially, but we want bodyB.
        // Actually, if we pass `pointB` as a Vector, it's relative to bodyB center.

        // Alternative: Create the constraint using world coordinates immediately after creation.
        const anchorX = beamX + xOffset;
        const anchorY = beamY; // Beam center Y (approx)

        // We want the bucket to hang from here.
        // The bucket CoM will be lower.

        Composite.add(engine.world, [bucket]);

        const c1 = Constraint.create({
            bodyA: balanceBeam,
            bodyB: bucket,
            pointA: { x: xOffset, y: 0 },
            // Let's refine the attachment point to be the "handle" position (top center of bucket)
            // We calculate the offset from the bucket's current position.
            // The bucket's CoM is at `bucket.position`. We want to attach to the top of the bucket structure.
            // The top of the bucket walls is at `beamY + hangDistance - h + 10` (where 10 is bottom thickness).
            // So, the handle position in world coordinates is `(beamX + xOffset, beamY + hangDistance - h + 10)`.
            // `pointB` needs to be this position relative to the `bucket.position`.
            pointB: Vector.sub({ x: beamX + xOffset, y: beamY + hangDistance - h + 10 }, bucket.position),
            length: 0, // Rigid link from beam to handle
            stiffness: 1
        });

        Composite.add(engine.world, [c1]);

        return { bottom: bucket };
    }

    leftBucket = createBucket(-CONFIG.beamWidth / 2);
    rightBucket = createBucket(CONFIG.beamWidth / 2);

    Composite.add(engine.world, [playerBase, balanceBeam, pivotConstraint]);
}

function createWalls() {
    const ground = Bodies.rectangle(window.innerWidth / 2, window.innerHeight + 50, window.innerWidth, 100, { isStatic: true });
    const leftWall = Bodies.rectangle(-50, window.innerHeight / 2, 100, window.innerHeight, { isStatic: true });
    const rightWall = Bodies.rectangle(window.innerWidth + 50, window.innerHeight / 2, 100, window.innerHeight, { isStatic: true });

    Composite.add(engine.world, [ground, leftWall, rightWall]);
}

// Input Handling
window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') inputState.left = true;
    if (e.key === 'ArrowRight') inputState.right = true;
});
window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft') inputState.left = false;
    if (e.key === 'ArrowRight') inputState.right = false;
});

// Mobile Controls
document.getElementById('btn-left').addEventListener('touchstart', (e) => { e.preventDefault(); inputState.left = true; });
document.getElementById('btn-left').addEventListener('touchend', (e) => { e.preventDefault(); inputState.left = false; });
document.getElementById('btn-right').addEventListener('touchstart', (e) => { e.preventDefault(); inputState.right = true; });
document.getElementById('btn-right').addEventListener('touchend', (e) => { e.preventDefault(); inputState.right = false; });

function gameLoop(event) {
    if (isGameOver) return;

    const time = event.timestamp;

    // 1. Player Movement
    // We apply force or velocity. Velocity is snappier.
    const speed = CONFIG.playerSpeed;
    let vx = 0;
    if (inputState.left) vx = -speed;
    if (inputState.right) vx = speed;

    // Apply velocity to Base
    Body.setVelocity(playerBase, { x: vx, y: 0 });

    // Lock Y position and Rotation of Base
    Body.setPosition(playerBase, { x: playerBase.position.x, y: window.innerHeight - 150 });
    Body.setAngularVelocity(playerBase, 0);
    Body.setAngle(playerBase, 0);

    // 2. Balance Beam Logic
    const angle = balanceBeam.angle;
    const angularVelocity = balanceBeam.angularVelocity;

    // Stabilizer (Arm Strength)
    // Apply a torque to push angle towards 0
    // Torque = -k * angle - b * angularVelocity
    // k = stiffness, b = damping
    const k = 0.5; // Strength of the arm
    const b = 0.2; // Damping to prevent oscillation

    // Only apply if not game over
    if (!isGameOver) {
        const torque = -k * angle - b * angularVelocity;
        // Scale torque by beam inertia to be effective
        Body.applyTorque(balanceBeam, torque * balanceBeam.inertia * 0.1);
    }

    // Warning Effect
    if (Math.abs(angle) > CONFIG.warningAngle) {
        warningOverlay.classList.add('active');
    } else {
        warningOverlay.classList.remove('active');
    }

    // Game Over Check
    if (Math.abs(angle) > CONFIG.maxAngle) {
        triggerGameOver();
    }

    // 3. Spawning
    if (time - lastSpawnTime > spawnInterval) {
        spawnBlock();
        lastSpawnTime = time;

        // Increase difficulty
        if (spawnInterval > 500) spawnInterval -= 20;
    }
}

function spawnBlock() {
    const x = Math.random() * (window.innerWidth - 100) + 50;
    const typeKey = Object.keys(CONFIG.colors)[Math.floor(Math.random() * Object.keys(CONFIG.colors).length)];
    const type = CONFIG.colors[typeKey];

    // 10% chance for Bomb
    if (Math.random() < 0.1) {
        const bomb = Bodies.circle(x, -50, 20, {
            label: 'Bomb',
            render: { fillStyle: '#000' },
            restitution: 0.5,
            density: 0.02
        });
        Composite.add(engine.world, bomb);
    } else {
        const block = Bodies.rectangle(x, -50, 30, 30, {
            label: 'Block',
            customColor: typeKey, // Store color key for merging
            render: { fillStyle: type.color },
            density: 0.005 * type.weight,
            friction: 0.8
        });
        Composite.add(engine.world, block);
    }
}

function handleCollisions(event) {
    const pairs = event.pairs;

    for (let i = 0; i < pairs.length; i++) {
        const bodyA = pairs[i].bodyA;
        const bodyB = pairs[i].bodyB;

        // Bomb Logic
        if (bodyA.label === 'Bomb' || bodyB.label === 'Bomb') {
            const bomb = bodyA.label === 'Bomb' ? bodyA : bodyB;
            const other = bodyA.label === 'Bomb' ? bodyB : bodyA;

            // Explode if hitting anything other than walls (optional)
            // Let's explode on any impact
            explode(bomb);
            return; // Stop processing this pair
        }

        // Merge Logic
        if (bodyA.label === 'Block' && bodyB.label === 'Block') {
            if (bodyA.customColor === bodyB.customColor) {
                // Merge!
                mergeBlocks(bodyA, bodyB);
            }
        }
    }
}

function explode(bomb) {
    // Remove bomb
    Composite.remove(engine.world, bomb);

    // Apply force to nearby objects
    const bodies = Composite.allBodies(engine.world);
    bodies.forEach(body => {
        if (body === bomb || body.isStatic) return;
        const d = Vector.magnitude(Vector.sub(body.position, bomb.position));
        if (d < 200) {
            const forceMagnitude = 0.05 * (200 - d) / 200;
            const force = Vector.mult(Vector.normalise(Vector.sub(body.position, bomb.position)), forceMagnitude);
            Body.applyForce(body, body.position, force);
        }
    });

    // Visual effect (simple flash or particle - omitted for MVP, just console log)
    console.log("BOOM");
}

function mergeBlocks(b1, b2) {
    // Avoid double merging
    if (!b1.parent || !b2.parent) return; // Already removed

    const newPos = Vector.div(Vector.add(b1.position, b2.position), 2);
    const colorKey = b1.customColor;
    const colorData = CONFIG.colors[colorKey];

    // Remove old blocks
    Composite.remove(engine.world, [b1, b2]);

    // Create new bigger block
    // Size * 1.2, Weight * 1.5
    const newSize = (b1.bounds.max.x - b1.bounds.min.x) * 1.2;
    const newBlock = Bodies.rectangle(newPos.x, newPos.y, newSize, newSize, {
        label: 'Block',
        customColor: colorKey,
        render: { fillStyle: colorData.color },
        density: b1.density * 1.5, // Increase density
        friction: 0.8
    });

    Composite.add(engine.world, newBlock);

    // Add Score
    score += 100 * colorData.weight;
    scoreEl.innerText = Math.floor(score);
}

function triggerGameOver() {
    if (isGameOver) return;
    isGameOver = true;

    // Calculate final score (Total mass of blocks in buckets?)
    // For now, just use the running score from merges + survival
    finalScoreEl.innerText = Math.floor(score);

    gameOverScreen.classList.remove('hidden');
    Runner.stop(runner);
}

function drawCustomEffects() {
    const ctx = render.context;

    // Draw Player Character (Simple Stickman or Face)
    const pos = playerBase.position;
    const angle = balanceBeam.angle;

    ctx.save();
    ctx.translate(pos.x, pos.y);

    // Draw Head
    ctx.beginPath();
    ctx.arc(0, -60, 20, 0, 2 * Math.PI);
    ctx.fillStyle = '#FFCC00';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.stroke();

    // Draw Face
    ctx.fillStyle = '#000';
    // Eyes
    ctx.beginPath();
    ctx.arc(-7, -65, 3, 0, 2 * Math.PI);
    ctx.arc(7, -65, 3, 0, 2 * Math.PI);
    ctx.fill();
    // Mouth (Sad if tipping)
    ctx.beginPath();
    if (Math.abs(angle) > CONFIG.warningAngle) {
        ctx.arc(0, -50, 10, Math.PI, 0); // Frown
    } else {
        ctx.arc(0, -55, 10, 0, Math.PI); // Smile
    }
    ctx.stroke();

    // Sweating Effect
    if (Math.abs(angle) > CONFIG.warningAngle) {
        ctx.fillStyle = '#00FFFF';
        ctx.beginPath();
        ctx.arc(-25, -70, 5, 0, 2 * Math.PI); // Drop 1
        ctx.arc(25, -60, 4, 0, 2 * Math.PI);  // Drop 2
        ctx.fill();
    }

    ctx.restore();
}

// Restart Logic
restartBtn.addEventListener('click', () => {
    // Simple reload for now
    location.reload();
});

// Start
init();
