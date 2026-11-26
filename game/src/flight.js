// flight.js — the Kestrel-2 aircraft: state, arcade flight model, ground handling.
// Pure simulation: step(state, input, dt) advances one tick and reports events.

import { groundHeight, runwayAt, WATER_Y } from "./world.js";

export const STALL_SPEED = 17; // m/s, below this the wing stops holding you up
export const MAX_SPEED = 78;
export const GEAR_HEIGHT = 1.6; // fuselage centre above ground when parked

export function newPlane(start) {
  return {
    x: start.x, y: start.y, z: start.z,
    heading: start.heading || 0, // radians, 0 = north (-z), grows clockwise seen from above
    pitch: 0, // radians, positive = nose up
    roll: 0, // radians, positive = bank right
    speed: start.speed || 0, // m/s along the nose
    vspeed: 0, // m/s vertical, derived each tick (for the HUD)
    throttle: 0, // 0..1
    fuel: start.fuel != null ? start.fuel : 100,
    damage: 0, // 0..100
    gearDown: true,
    flaps: false,
    onGround: start.onGround !== false,
    engineOn: true,
    stalled: false,
    crashed: false,
    crashReason: "",
    touchdown: null, // {quality, vspeed, speed} set on the tick the wheels meet ground
    propAngle: 0,
    time: 0,
  };
}

// Unit vector the nose points along.
export function forwardVector(p) {
  const cp = Math.cos(p.pitch);
  return {
    x: Math.sin(p.heading) * cp,
    y: Math.sin(p.pitch),
    z: -Math.cos(p.heading) * cp,
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Advance the aircraft. input: {pitch, roll, throttle, brake} each -1..1 (throttle 0..1 set or delta handled by caller).
// wind: {x, z} m/s. Returns a list of event strings that happened this tick.
export function stepPlane(p, input, dt, wind) {
  const events = [];
  if (p.crashed) return events;
  p.time += dt;
  p.touchdown = null;

  // --- controls -----------------------------------------------------------
  const authority = p.onGround ? 0.35 : clamp(p.speed / 40, 0.25, 1.15);
  p.pitch = clamp(p.pitch + input.pitch * 0.85 * authority * dt, -0.62, 0.62);
  if (Math.abs(input.pitch) < 0.02 && !p.onGround) p.pitch *= Math.pow(0.35, dt); // settle to level
  const targetRoll = clamp(input.roll, -1, 1) * 1.05;
  p.roll += (targetRoll - p.roll) * Math.min(1, dt * 4.2);
  if (!p.onGround) p.heading = wrapAngle(p.heading + Math.sin(p.roll) * 0.85 * authority * dt * 1.6);
  else if (p.speed > 2) p.heading = wrapAngle(p.heading + input.roll * 0.5 * dt); // nosewheel steering

  // --- engine, drag, fuel ---------------------------------------------------
  const enginePower = p.fuel > 0 && p.engineOn ? p.throttle : 0;
  if (p.fuel > 0 && p.engineOn) p.fuel = Math.max(0, p.fuel - p.throttle * dt * 0.55);
  if (p.fuel <= 0 && p.engineOn) { p.engineOn = false; events.push("fuel-empty"); }
  const flapDrag = p.flaps ? 0.0045 : 0;
  const gearDrag = p.gearDown ? 0.0016 : 0;
  const brakeDrag = input.brake ? 0.02 : 0;
  const dragK = 0.00042 + flapDrag + gearDrag + brakeDrag;
  let accel = enginePower * 9.5 - dragK * p.speed * p.speed - Math.sin(p.pitch) * 4.6;
  if (p.onGround) accel -= p.speed * 0.06; // rolling friction
  p.speed = clamp(p.speed + accel * dt, 0, MAX_SPEED);
  p.propAngle += (2 + enginePower * 55) * dt;

  // --- lift, stall, motion --------------------------------------------------
  const liftSpeed = p.flaps ? STALL_SPEED * 0.82 : STALL_SPEED;
  p.stalled = !p.onGround && p.speed < liftSpeed;
  const fwd = forwardVector(p);
  const liftFactor = p.onGround ? 0 : clamp((p.speed - liftSpeed * 0.55) / (liftSpeed * 0.9), 0, 1);
  let vy = fwd.y * p.speed * liftFactor;
  if (!p.onGround && p.speed < liftSpeed) vy -= (liftSpeed - p.speed) * 0.55; // sink when stalled
  if (p.onGround) vy = 0;
  p.vspeed = vy;
  p.x += (fwd.x * p.speed + (wind ? wind.x : 0)) * dt;
  p.z += (fwd.z * p.speed + (wind ? wind.z : 0)) * dt;
  p.y += vy * dt;

  // --- ground contact ---------------------------------------------------------
  const ground = Math.max(groundHeight(p.x, p.z), WATER_Y);
  const floorY = ground + GEAR_HEIGHT;
  if (p.y <= floorY) {
    const onRunway = runwayAt(p.x, p.z) !== null;
    const inWater = groundHeight(p.x, p.z) < WATER_Y + 0.3;
    if (p.onGround) {
      p.y = floorY;
      // Take-off: enough speed and a nose-up attitude lifts us off.
      if (p.speed > liftSpeed + 3 && p.pitch > 0.06) {
        p.onGround = false;
        events.push("takeoff");
      }
    } else {
      // Touchdown judgement: what the pilot feels as a landing or a crash.
      const hard = vy < -6.5 || p.speed > 46 || Math.abs(p.roll) > 0.55 || p.pitch < -0.28;
      if (inWater) {
        p.crashed = true; p.crashReason = "Ditched in the sea";
        events.push("crash");
      } else if (!p.gearDown) {
        p.crashed = true; p.crashReason = "Belly landing with the gear up";
        events.push("crash");
      } else if (hard) {
        p.damage = Math.min(100, p.damage + 55);
        p.crashed = true;
        p.crashReason = vy < -6.5 ? "Came down far too hard" : "Touched down too fast or banked";
        events.push("crash");
      } else {
        const quality = vy > -1.6 ? "greased it" : vy > -3.4 ? "smooth" : "firm";
        p.touchdown = { quality, vspeed: vy, speed: p.speed, onRunway };
        p.onGround = true;
        p.y = floorY;
        p.pitch = 0;
        p.roll = 0;
        if (!onRunway) p.damage = Math.min(100, p.damage + 12); // rough field
        events.push("landed");
      }
      if (p.crashed) { p.y = floorY; p.speed = 0; p.throttle = 0; }
    }
  } else if (p.onGround && p.y > floorY + 0.5) {
    p.onGround = false;
  }

  // Scraping terrain while "flying" low counts as a crash too.
  if (!p.onGround && !p.crashed && p.y < ground + 0.4) {
    p.crashed = true;
    p.crashReason = "Flew into the terrain";
    p.speed = 0;
    events.push("crash");
  }
  return events;
}

// Heading in degrees 0..359 for the compass tape.
export function headingDeg(p) {
  let d = (p.heading * 180) / Math.PI;
  d = ((d % 360) + 360) % 360;
  return d;
}

// Distance from the plane to a point, in metres.
export function distTo(p, q) {
  const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Ring pass test: the plane crossed the ring's plane within its radius.
// Rings face the course direction; we approximate the plane normal with the
// vector from the previous ring (or from the start) to this ring.
export function crossedRing(prev, now, ring, normal) {
  const side = (pt) => (pt.x - ring.x) * normal.x + (pt.y - ring.y) * normal.y + (pt.z - ring.z) * normal.z;
  const a = side(prev);
  const b = side(now);
  if (a === 0 || a * b > 0) return false;
  const t = a / (a - b);
  const cx = prev.x + (now.x - prev.x) * t;
  const cy = prev.y + (now.y - prev.y) * t;
  const cz = prev.z + (now.z - prev.z) * t;
  const dx = cx - ring.x, dy = cy - ring.y, dz = cz - ring.z;
  return dx * dx + dy * dy + dz * dz <= ring.r * ring.r;
}
