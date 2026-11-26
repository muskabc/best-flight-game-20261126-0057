// main.js — Sky Courier: Island Run. Game loop, mission logic, screens,
// staged screenshot poses (?shot=...) and the headless self-test (?selftest=1).

import {
  ISLANDS, RUNWAYS, RINGS, BEACON, MISSIONS,
  groundHeight, runwayAt, scatterTrees, scatterClouds, WATER_Y,
} from "./world.js";
import { newPlane, stepPlane, forwardVector, distTo, crossedRing, GEAR_HEIGHT } from "./flight.js";
import { makeCamera, updateCamera, drawScene } from "./render.js";
import { drawHud } from "./hud.js";
import { makeInput } from "./input.js";
import { makeAudio } from "./audio.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const audio = makeAudio();

let W = 0, H = 0;
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();

const params = new URLSearchParams(window.location.search);
const SHOT = params.get("shot");
const SELFTEST = params.get("selftest") === "1";

const trees = scatterTrees(20261126, 260);
const clouds = scatterClouds(777, 26);

// ---------------------------------------------------------------- game state
const game = {
  mode: "title", // title | flying | done | crashed
  mission: MISSIONS[0],
  plane: null,
  cam: makeCamera(),
  nextRing: 0,
  beaconHit: false,
  score: 0,
  time: 0,
  banner: "",
  bannerUntil: 0,
  endText: "",
  paused: false,
  prevPos: null,
  autopilot: false,
  sun: 0.85,
  windPhase: 0,
};

function startMission(mission, airborne) {
  game.mission = mission;
  game.nextRing = 0;
  game.beaconHit = false;
  game.score = 0;
  game.time = 0;
  game.banner = "";
  game.endText = "";
  game.paused = false;
  const home = RUNWAYS[0];
  if (airborne) {
    game.plane = newPlane({
      x: home.x - 500, y: home.y + 130, z: home.z - 120,
      heading: Math.PI / 2.6, speed: 42, fuel: mission.fuel, onGround: false,
    });
    game.plane.throttle = 0.62;
    game.plane.gearDown = false;
  } else {
    game.plane = newPlane({
      x: home.x - home.len / 2 + 26, y: home.y + GEAR_HEIGHT, z: home.z,
      heading: Math.PI / 2, speed: 0, fuel: mission.fuel, onGround: true,
    });
  }
  game.prevPos = { x: game.plane.x, y: game.plane.y, z: game.plane.z };
  game.cam.x = game.plane.x - 16;
  game.cam.y = game.plane.y + 5;
  game.cam.z = game.plane.z;
  game.cam.heading = game.plane.heading;
  game.mode = "flying";
  say(mission.title + ". " + mission.brief);
}

function say(text) {
  if (statusEl) statusEl.textContent = text;
}

function banner(text, seconds) {
  game.banner = text;
  game.bannerUntil = game.time + (seconds || 3);
}

// Wind for the current mission: steady push plus slow gusts.
function windVector() {
  const base = game.mission.wind;
  game.windPhase += 0.002;
  const gust = Math.sin(game.windPhase * 3.1) * base * 0.6;
  return { x: base * 0.7 + gust, z: base * 0.45 + Math.cos(game.windPhase * 2.3) * base * 0.4 };
}

function ringNormal(i) {
  const from = i === 0 ? { x: 0, y: 80, z: 0 } : RINGS[i - 1];
  const to = RINGS[i];
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

function currentTarget() {
  const m = game.mission.id;
  if (m === "rings" && game.nextRing < RINGS.length) {
    const r = RINGS[game.nextRing];
    return { x: r.x, y: r.y, z: r.z, label: "RING " + (game.nextRing + 1) + " · " + Math.round(distTo(game.plane, r)) + "m" };
  }
  if (m === "storm" && !game.beaconHit) {
    return { x: BEACON.x, y: BEACON.y, z: BEACON.z, label: "BEACON · " + Math.round(distTo(game.plane, BEACON)) + "m" };
  }
  if (m === "hop" || m === "rings" || m === "storm") {
    const rw = m === "hop" ? RUNWAYS[1] : RUNWAYS[0];
    return { x: rw.x, y: rw.y + 6, z: rw.z, label: rw.name.toUpperCase() + " · " + Math.round(distTo(game.plane, rw)) + "m" };
  }
  return null;
}

function objectiveText() {
  const m = game.mission.id;
  if (m === "rings") {
    return game.nextRing < RINGS.length
      ? "Fly through ring " + (game.nextRing + 1) + " of " + RINGS.length + " — follow the gold marker."
      : "All rings done! Land at Home Strip to finish.";
  }
  if (m === "hop") return game.plane.onGround && game.time < 2 ? "Throttle up (Shift), rotate at 40 kt, fly north-east to Far Strip." : "Land at Far Strip — gear down, gentle sink rate.";
  if (m === "storm") return game.beaconHit ? "Cargo delivered! Land safely anywhere with a runway." : "Reach the orange beacon over Ember Atoll (west). Watch your fuel!";
  return "Explore the archipelago. Land on either strip whenever you like.";
}

function progressText() {
  const m = game.mission.id;
  if (m === "rings") return "Rings " + game.nextRing + " / " + RINGS.length;
  if (m === "storm") return game.beaconHit ? "Beacon reached ✓" : "Beacon not yet reached";
  if (m === "hop") return "Destination: Far Strip";
  return "Free flight";
}

function clockText() {
  const s = Math.floor(game.time);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

// Project a world point for the HUD target marker (mirrors the render camera).
function projectForHud(cam, x, y, z) {
  const fovScale = H * 1.15;
  const ch = Math.cos(cam.heading), sh = Math.sin(cam.heading);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const cr = Math.cos(cam.roll), sr = Math.sin(cam.roll);
  const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
  const x1 = dx * ch + dz * sh;
  const z1 = -dx * sh + dz * ch;
  const y2 = dy * cp + z1 * sp;
  const z2 = -dy * sp + z1 * cp;
  const x3 = x1 * cr - y2 * sr;
  const y3 = x1 * sr + y2 * cr;
  if (z2 > -0.6) {
    // Behind: mirror to the edge so the arrow still points the right way.
    return { x: W / 2 - x3 * 4, y: H / 2 + y3 * 4 };
  }
  const s = fovScale / -z2;
  return { x: W / 2 + x3 * s, y: H / 2 - y3 * s };
}

// ------------------------------------------------------------- mission logic
function checkMission(events) {
  const p = game.plane;
  const m = game.mission.id;

  if (m === "rings" && game.nextRing < RINGS.length) {
    const ring = RINGS[game.nextRing];
    if (crossedRing(game.prevPos, p, ring, ringNormal(game.nextRing))) {
      game.nextRing++;
      game.score += 250;
      audio.ring();
      banner("Ring " + game.nextRing + " of " + RINGS.length + " ✓  +250", 2.4);
      say("Ring " + game.nextRing + " cleared.");
    }
  }
  if (m === "storm" && !game.beaconHit && distTo(p, BEACON) < BEACON.r) {
    game.beaconHit = true;
    game.score += 400;
    audio.success();
    banner("Cargo delivered ✓  +400 — now land safely", 3.4);
  }

  for (const ev of events) {
    if (ev === "takeoff") banner("Airborne!", 1.6);
    if (ev === "fuel-empty") banner("Out of fuel — glide!", 3);
    if (ev === "landed" && p.touchdown) {
      audio.touchdown();
      const td = p.touchdown;
      const bonus = td.quality === "greased it" ? 300 : td.quality === "smooth" ? 180 : 80;
      if (td.onRunway) {
        game.score += bonus;
        banner("Touchdown — " + td.quality + "  +" + bonus, 2.6);
        const done =
          (m === "rings" && game.nextRing >= RINGS.length && runwayAt(p.x, p.z) === RUNWAYS[0]) ||
          (m === "hop" && runwayAt(p.x, p.z) === RUNWAYS[1]) ||
          (m === "storm" && game.beaconHit);
        if (done) finishMission(true, "Mission complete — you " + td.quality + " at " + runwayAt(p.x, p.z).name + ".");
      } else {
        banner("Rough-field landing — airframe took a knock", 2.6);
      }
    }
    if (ev === "crash") {
      audio.crash();
      finishMission(false, p.crashReason + ". The Kestrel is a write-off — press R to try again.");
    }
  }
}

function finishMission(won, text) {
  if (game.mode !== "flying") return;
  game.mode = won ? "done" : "crashed";
  game.endText = text;
  if (won) {
    const timeBonus = Math.max(0, 600 - Math.floor(game.time) * 2);
    const fuelBonus = Math.round(game.plane.fuel) * 3;
    game.score += timeBonus + fuelBonus;
    game.endText += "  Time bonus +" + timeBonus + ", fuel bonus +" + fuelBonus + ".";
    audio.success();
  }
  say(game.endText);
}

// Autopilot used on the title screen and in screenshot poses: gentle circuit.
function autopilotInput(p, target) {
  const want = Math.atan2(target.x - p.x, -(target.z - p.z));
  let dh = want - p.heading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  const roll = Math.max(-1, Math.min(1, dh * 1.4));
  const dy = target.y - p.y;
  const pitch = Math.max(-1, Math.min(1, dy * 0.02));
  p.throttle = p.speed < 40 ? 0.85 : 0.55;
  return { pitch, roll, brake: false };
}

// ------------------------------------------------------------------- screens
function drawTitle() {
  ctx.fillStyle = "rgba(6,10,20,0.55)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffd23e";
  ctx.font = "bold " + Math.min(64, W * 0.07) + "px system-ui, sans-serif";
  ctx.fillText("SKY COURIER", W / 2, H * 0.24);
  ctx.fillStyle = "#e8f1fb";
  ctx.font = "bold " + Math.min(26, W * 0.03) + "px system-ui, sans-serif";
  ctx.fillText("— Island Run —", W / 2, H * 0.24 + 40);
  ctx.font = "15px system-ui, sans-serif";
  ctx.fillText("Fly the Kestrel-2 over six islands: thread the ring course, hop between strips,", W / 2, H * 0.24 + 74);
  ctx.fillText("or run cargo through gusty wind on half a tank. Mind your throttle, fuel and sink rate.", W / 2, H * 0.24 + 96);

  const bw = Math.min(560, W * 0.8);
  const bx = W / 2 - bw / 2;
  let by = H * 0.46;
  game.menuRects = [];
  MISSIONS.forEach((m, i) => {
    ctx.fillStyle = "rgba(16,26,44,0.88)";
    ctx.strokeStyle = "rgba(160,200,255,0.5)";
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, 52, 10);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffd23e";
    ctx.font = "bold 16px system-ui, sans-serif";
    ctx.fillText((i + 1) + ".  " + m.title, bx + 18, by + 24);
    ctx.fillStyle = "#c9dcf2";
    ctx.font = "12.5px system-ui, sans-serif";
    ctx.fillText(m.brief, bx + 18, by + 42);
    game.menuRects.push({ x: bx, y: by, w: bw, h: 52, index: i });
    by += 62;
  });
  ctx.textAlign = "center";
  ctx.fillStyle = "#9fb6d4";
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillText("Press 1–4 or click a mission · Arrows/WASD fly · Shift/Ctrl throttle · F flaps · G gear · Space brake · C camera", W / 2, by + 26);
}

function drawEndScreen() {
  ctx.fillStyle = game.mode === "done" ? "rgba(8,26,14,0.62)" : "rgba(30,8,8,0.62)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.fillStyle = game.mode === "done" ? "#7ee787" : "#ff8a7a";
  ctx.font = "bold " + Math.min(52, W * 0.055) + "px system-ui, sans-serif";
  ctx.fillText(game.mode === "done" ? "MISSION COMPLETE" : "CRASHED", W / 2, H * 0.36);
  ctx.fillStyle = "#e8f1fb";
  ctx.font = "17px system-ui, sans-serif";
  wrapCentre(game.endText, W / 2, H * 0.36 + 44, Math.min(720, W * 0.85), 24);
  ctx.font = "bold 22px system-ui, sans-serif";
  ctx.fillStyle = "#ffd23e";
  ctx.fillText("Score " + game.score + "   ·   Time " + clockText() + "   ·   Fuel left " + Math.round(game.plane.fuel) + "%", W / 2, H * 0.36 + 120);
  ctx.fillStyle = "#c9dcf2";
  ctx.font = "15px system-ui, sans-serif";
  ctx.fillText("Press R to fly again · Esc for the mission menu", W / 2, H * 0.36 + 156);
}

function wrapCentre(text, cx, y, maxW, lineH) {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, cx, yy);
      yy += lineH;
      line = word;
    } else line = test;
  }
  if (line) ctx.fillText(line, cx, yy);
}

// ------------------------------------------------------------ screenshot poses
function applyShot(name) {
  game.autopilot = true;
  if (name === "ring") {
    startMission(MISSIONS[0], true);
    const p = game.plane;
    p.x = 640; p.y = 116; p.z = -400;
    p.heading = Math.atan2(820 - 640, -(-520 + 400));
    p.pitch = 0.02; p.speed = 44; p.throttle = 0.66; p.gearDown = false;
    game.nextRing = 1;
    game.score = 250;
    game.sun = 0.9;
    game.shotTarget = { x: 820, y: 120, z: -520 };
  } else if (name === "runway") {
    startMission(MISSIONS[1], true);
    const p = game.plane;
    const rw = RUNWAYS[1];
    p.x = rw.x - 520; p.y = rw.y + 34; p.z = rw.z; p.heading = Math.PI / 2;
    p.pitch = -0.045; p.speed = 27; p.throttle = 0.3; p.gearDown = true; p.flaps = true;
    game.sun = 0.8;
    game.shotTarget = { x: rw.x + 300, y: rw.y + 10, z: rw.z };
  } else if (name === "sunset") {
    startMission(MISSIONS[2], true);
    const p = game.plane;
    p.x = -500; p.y = 135; p.z = 180;
    p.heading = Math.atan2(-1400 + 500, -(600 - 180));
    p.pitch = -0.02; p.roll = 0.5; p.speed = 48; p.throttle = 0.7; p.gearDown = false; p.fuel = 41;
    game.sun = 0.32;
    game.shotTarget = { x: -1400, y: 128, z: 600 };
  } else if (name === "landed") {
    startMission(MISSIONS[1], false);
    const p = game.plane;
    const rw = RUNWAYS[1];
    p.x = rw.x - 60; p.y = rw.y + GEAR_HEIGHT; p.z = rw.z; p.heading = Math.PI / 2;
    p.speed = 8; p.throttle = 0.1; p.onGround = true;
    game.sun = 0.85;
    game.shotTarget = { x: rw.x + 400, y: rw.y + 4, z: rw.z };
    game.shotHold = true; // warm up with the brakes on, parked on the strip
  } else {
    startMission(MISSIONS[0], true);
    game.shotTarget = { x: 420, y: 95, z: -260 };
  }
  // Settle the camera instantly for the still.
  const fwd = forwardVector(game.plane);
  game.cam.x = game.plane.x - fwd.x * 15;
  game.cam.y = game.plane.y - fwd.y * 15 + 4.6;
  game.cam.z = game.plane.z - fwd.z * 15;
  game.cam.heading = game.plane.heading;
  game.cam.pitch = game.plane.pitch * 0.82;
  game.cam.roll = game.plane.roll * 0.45;
}

// ------------------------------------------------------------------ self-test
function runSelftest() {
  const results = [];
  const check = (name, ok) => results.push({ name, ok: !!ok });

  // Terrain sanity.
  let finite = true;
  for (let x = -2000; x <= 2000; x += 137) {
    for (let z = -2000; z <= 2000; z += 149) {
      if (!Number.isFinite(groundHeight(x, z))) finite = false;
    }
  }
  check("terrain heights are finite across the map", finite);
  check("Home Strip is flat at its strip height", Math.abs(groundHeight(0, 0) - RUNWAYS[0].y) < 0.01);
  check("open sea sits below water level", groundHeight(-2600, -2600) < WATER_Y + 0.5);
  check("runwayAt finds Home Strip", runwayAt(10, 3) === RUNWAYS[0]);
  check("runwayAt rejects open water", runwayAt(-2600, -2600) === null);

  // Flight model.
  const p = newPlane({ x: 0, y: 200, z: 0, heading: 0, speed: 40, fuel: 100, onGround: false });
  p.throttle = 0.7;
  const before = { x: p.x, z: p.z };
  for (let i = 0; i < 60; i++) stepPlane(p, { pitch: 0, roll: 0, brake: false }, 1 / 60, { x: 0, z: 0 });
  check("one second of cruise moves the plane north", p.z < before.z - 20 && Math.abs(p.x - before.x) < 2);
  check("cruise keeps the plane airborne", !p.crashed && !p.onGround);

  const slow = newPlane({ x: 0, y: 200, z: 0, heading: 0, speed: 8, fuel: 100, onGround: false });
  slow.throttle = 0;
  stepPlane(slow, { pitch: 0, roll: 0, brake: false }, 1 / 60, { x: 0, z: 0 });
  check("slow flight registers as a stall", slow.stalled === true);

  const thirsty = newPlane({ x: 0, y: 200, z: 0, heading: 0, speed: 40, fuel: 0.05, onGround: false });
  thirsty.throttle = 1;
  for (let i = 0; i < 30; i++) stepPlane(thirsty, { pitch: 0, roll: 0, brake: false }, 1 / 60, { x: 0, z: 0 });
  check("full throttle drains the tank and cuts the engine", thirsty.fuel === 0 && thirsty.engineOn === false);

  const turner = newPlane({ x: 0, y: 200, z: 0, heading: 0, speed: 44, fuel: 100, onGround: false });
  turner.throttle = 0.7;
  for (let i = 0; i < 90; i++) stepPlane(turner, { pitch: 0, roll: 1, brake: false }, 1 / 60, { x: 0, z: 0 });
  check("banking right turns the nose right", turner.heading > 0.25);

  // Landing + crash judgement.
  const lander = newPlane({ x: -200, y: RUNWAYS[0].y + 18, z: 0, heading: Math.PI / 2, speed: 24, fuel: 100, onGround: false });
  lander.throttle = 0.25;
  lander.pitch = -0.08;
  let landed = false;
  for (let i = 0; i < 60 * 20 && !lander.crashed; i++) {
    const ev = stepPlane(lander, { pitch: -0.02, roll: 0, brake: false }, 1 / 60, { x: 0, z: 0 });
    if (ev.includes("landed")) { landed = true; break; }
  }
  check("a gentle approach touches down instead of crashing", landed);

  const diver = newPlane({ x: 0, y: 120, z: 0, heading: 0, speed: 60, fuel: 100, onGround: false });
  diver.pitch = -0.6;
  diver.throttle = 0.4;
  // The pilot holds the nose down all the way in (no auto-level rescue).
  for (let i = 0; i < 60 * 10 && !diver.crashed; i++) stepPlane(diver, { pitch: -1, roll: 0, brake: false }, 1 / 60, { x: 0, z: 0 });
  check("a steep dive into the island crashes", diver.crashed === true);

  // Ring crossing.
  const ring = RINGS[0];
  const n = ringNormal(0);
  const a = { x: ring.x - n.x * 30, y: ring.y - n.y * 30, z: ring.z - n.z * 30 };
  const b = { x: ring.x + n.x * 30, y: ring.y + n.y * 30, z: ring.z + n.z * 30 };
  check("flying through a ring centre registers", crossedRing(a, b, ring, n));
  const off = { x: a.x + 90, y: a.y, z: a.z };
  const off2 = { x: b.x + 90, y: b.y, z: b.z };
  check("missing the ring sideways does not register", !crossedRing(off, off2, ring, n));

  // Draw the report and set the title the screenshot script asserts on.
  const allPass = results.every((r) => r.ok);
  document.title = allPass ? "SELFTEST PASS" : "SELFTEST FAIL";
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "left";
  ctx.font = "bold 22px system-ui, sans-serif";
  ctx.fillStyle = allPass ? "#7ee787" : "#ff8a7a";
  ctx.fillText(document.title + "  (" + results.filter((r) => r.ok).length + "/" + results.length + ")", 40, 60);
  ctx.font = "15px system-ui, sans-serif";
  results.forEach((r, i) => {
    ctx.fillStyle = r.ok ? "#c9dcf2" : "#ff8a7a";
    ctx.fillText((r.ok ? "PASS  " : "FAIL  ") + r.name, 40, 100 + i * 26);
  });
  return allPass;
}

// -------------------------------------------------------------------- input
const input = makeInput(canvas, {
  onFlaps() {
    if (game.mode === "flying") { game.plane.flaps = !game.plane.flaps; banner(game.plane.flaps ? "Flaps out" : "Flaps in", 1.2); audio.click(); }
  },
  onGear() {
    if (game.mode === "flying") { game.plane.gearDown = !game.plane.gearDown; banner(game.plane.gearDown ? "Gear down" : "Gear up", 1.2); audio.click(); }
  },
  onCamera() {
    game.cam.mode = game.cam.mode === "chase" ? "cockpit" : "chase";
    banner(game.cam.mode === "chase" ? "Chase camera" : "Cockpit camera", 1.2);
  },
  onRestart() {
    if (game.mode !== "title") startMission(game.mission, false);
  },
  onMute() {
    audio.setMuted(!audio.isMuted());
    banner(audio.isMuted() ? "Sound off" : "Sound on", 1.2);
  },
  onPause() {
    if (game.mode === "flying") game.paused = !game.paused;
  },
  onConfirm() {
    if (game.mode === "title") startMission(MISSIONS[0], false);
  },
  onPick(i) {
    if (game.mode === "title" && MISSIONS[i]) { audio.unlock(); startMission(MISSIONS[i], false); }
  },
  onTap(x, y) {
    audio.unlock();
    if (game.mode === "title" && game.menuRects) {
      for (const r of game.menuRects) {
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          audio.click();
          startMission(MISSIONS[r.index], false);
          return;
        }
      }
    }
    if (game.mode === "done" || game.mode === "crashed") startMission(game.mission, false);
  },
  onThrottleDelta(d) {
    if (game.mode === "flying") game.plane.throttle = Math.max(0, Math.min(1, game.plane.throttle + d));
  },
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    game.mode = "title";
    game.autopilot = true;
    startTitleFlight();
  }
  audio.unlock();
});

// Title backdrop: the Kestrel circling Home Isle on autopilot.
function startTitleFlight() {
  game.mission = MISSIONS[3];
  game.plane = newPlane({ x: -500, y: 140, z: -300, heading: Math.PI / 2, speed: 42, fuel: 100, onGround: false });
  game.plane.throttle = 0.6;
  game.plane.gearDown = false;
  game.prevPos = { x: game.plane.x, y: game.plane.y, z: game.plane.z };
  game.cam.x = game.plane.x - 16;
  game.cam.y = game.plane.y + 5;
  game.cam.z = game.plane.z;
  game.cam.heading = game.plane.heading;
}

// -------------------------------------------------------------------- loop
let lastTs = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, lastTs ? (ts - lastTs) / 1000 : 0.016);
  lastTs = ts;
  if (SELFTEST) return; // report already drawn once

  const p = game.plane;
  if (!p) return;

  if (SHOT) {
    // Screenshot pose: hold the warmed-up state still and just render it.
  } else if (game.mode === "flying" && !game.paused) {
    game.time += dt;
    game.prevPos = { x: p.x, y: p.y, z: p.z };
    const ctl = game.autopilot && game.shotTarget
      ? autopilotInput(p, game.shotTarget)
      : input.poll(dt, p);
    const events = stepPlane(p, ctl, dt, windVector());
    checkMission(events);
    audio.engine(p.throttle, p.speed, p.engineOn && !p.crashed);
    if (p.stalled && Math.random() < dt * 2) audio.warning();
  } else if (game.mode === "title") {
    // Slow circuit around Home Isle.
    const t = performance.now() / 1000;
    const target = { x: Math.cos(t * 0.07) * 620, y: 140 + Math.sin(t * 0.23) * 18, z: Math.sin(t * 0.07) * 620 };
    stepPlane(p, autopilotInput(p, target), dt, { x: 0, z: 0 });
  }

  updateCamera(game.cam, p, dt);

  const scene = {
    sun: game.sun,
    sunDir: { x: -0.55, y: 0.35 + game.sun * 0.5, z: -0.4 },
    trees,
    clouds,
    rings: game.mission.id === "rings" ? RINGS : [],
    nextRing: game.nextRing,
    beacon: game.mission.id === "storm" && !game.beaconHit ? BEACON : null,
    time: performance.now() / 1000,
  };
  drawScene(ctx, W, H, game.cam, p, scene);

  if (game.mode === "title") {
    drawTitle();
  } else {
    const target = currentTarget();
    let targetScreen = null;
    if (target) {
      const sp = projectForHud(game.cam, target.x, target.y, target.z);
      targetScreen = { x: sp.x, y: sp.y, label: target.label };
    }
    const agl = Math.max(0, p.y - Math.max(groundHeight(p.x, p.z), WATER_Y));
    drawHud(ctx, W, H, p, {
      missionTitle: game.mission.title,
      objective: objectiveText(),
      progress: progressText(),
      score: game.score,
      clock: clockText(),
      agl,
      targetScreen,
      banner: game.time < game.bannerUntil ? game.banner : "",
    });
    if (game.paused) {
      ctx.fillStyle = "rgba(6,10,20,0.5)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#e8f1fb";
      ctx.font = "bold 34px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED — press P to resume", W / 2, H / 2);
    }
    if (game.mode === "done" || game.mode === "crashed") drawEndScreen();
  }
}

if (SELFTEST) {
  runSelftest();
} else if (SHOT) {
  applyShot(SHOT);
  // Warm up a few simulated seconds so the pose is alive, not frozen at spawn.
  for (let i = 0; i < 50; i++) {
    game.prevPos = { x: game.plane.x, y: game.plane.y, z: game.plane.z };
    const ctl = game.shotHold
      ? { pitch: 0, roll: 0, brake: true }
      : autopilotInput(game.plane, game.shotTarget);
    stepPlane(game.plane, ctl, 1 / 60, windVector());
    game.time += 1 / 60;
  }
  requestAnimationFrame(frame);
} else {
  startTitleFlight();
  requestAnimationFrame(frame);
}
