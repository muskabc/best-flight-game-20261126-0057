// render.js — the 3D view: chase camera, projected terrain, sky, rings, runway,
// and the Kestrel-2 herself drawn in frame. Canvas 2D with a painter's sort.

import { groundHeight, terrainColour, RUNWAYS, WATER_Y } from "./world.js";
import { forwardVector } from "./flight.js";

const CELL = 42; // metres per terrain quad
const GRID = 30; // quads across the visible patch

// Camera state smoothed toward the plane so the view never fights the pilot.
export function makeCamera() {
  return { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, mode: "chase" };
}

export function updateCamera(cam, plane, dt) {
  const fwd = forwardVector(plane);
  let tx, ty, tz, th, tp;
  if (cam.mode === "cockpit") {
    tx = plane.x + fwd.x * 1.2; ty = plane.y + 0.7; tz = plane.z + fwd.z * 1.2;
    th = plane.heading; tp = plane.pitch;
  } else {
    const back = 15, up = 4.6;
    tx = plane.x - fwd.x * back; ty = plane.y - fwd.y * back + up; tz = plane.z - fwd.z * back;
    th = plane.heading; tp = plane.pitch * 0.82;
  }
  const k = cam.mode === "cockpit" ? 1 : Math.min(1, dt * 5.5);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
  cam.z += (tz - cam.z) * k;
  let dh = th - cam.heading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  cam.heading += dh * k;
  cam.pitch += (tp - cam.pitch) * k;
  cam.roll += ((cam.mode === "cockpit" ? plane.roll : plane.roll * 0.45) - cam.roll) * k;
  // Never let the camera sink under the terrain.
  const floor = Math.max(groundHeight(cam.x, cam.z), WATER_Y) + 1.4;
  if (cam.y < floor) cam.y = floor;
}

// Project a world point. Returns {x, y, d} screen coords + depth, or null behind.
function projector(cam, w, h) {
  const fovScale = h * 1.15;
  const ch = Math.cos(cam.heading), sh = Math.sin(cam.heading);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const cr = Math.cos(cam.roll), sr = Math.sin(cam.roll);
  return function project(x, y, z) {
    let dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
    // yaw around Y (heading 0 looks toward -z, +x is right)
    let x1 = dx * ch + dz * sh;
    let z1 = -dx * sh + dz * ch;
    let y1 = dy;
    // pitch around X (positive pitch = nose up, world sinks in frame)
    let y2 = y1 * cp + z1 * sp;
    let z2 = -y1 * sp + z1 * cp;
    // roll around Z (view axis)
    let x3 = x1 * cr - y2 * sr;
    let y3 = x1 * sr + y2 * cr;
    if (z2 > -0.6) return null; // behind or on the camera plane
    const s = fovScale / -z2;
    return { x: w / 2 + x3 * s, y: h / 2 - y3 * s, d: -z2, s };
  };
}

function skyGradient(ctx, w, h, sun) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  if (sun > 0.55) { g.addColorStop(0, "#3a6fd8"); g.addColorStop(0.55, "#7fb2e8"); g.addColorStop(1, "#cfe6f7"); }
  else if (sun > 0.25) { g.addColorStop(0, "#4a5fa8"); g.addColorStop(0.55, "#d98a5a"); g.addColorStop(1, "#f4c98a"); }
  else { g.addColorStop(0, "#1c2a52"); g.addColorStop(0.6, "#3d4a7a"); g.addColorStop(1, "#7a6a8a"); }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function shade(rgb, f) {
  return "rgb(" + Math.min(255, rgb[0] * f | 0) + "," + Math.min(255, rgb[1] * f | 0) + "," + Math.min(255, rgb[2] * f | 0) + ")";
}

// Draw the whole 3D scene (everything except the HUD).
export function drawScene(ctx, w, h, cam, plane, scene) {
  const project = projector(cam, w, h);
  skyGradient(ctx, w, h, scene.sun);

  // Sea-colour fill below the horizon, so gaps near the camera never show sky.
  const fwdX = Math.sin(cam.heading), fwdZ = -Math.cos(cam.heading);
  const horizonPt = project(cam.x + fwdX * 3000, WATER_Y, cam.z + fwdZ * 3000);
  const horizonY = horizonPt ? Math.max(0, Math.min(h, horizonPt.y)) : h * 0.55;
  ctx.fillStyle = scene.sun > 0.3 ? "#2e6ea8" : "#274a73";
  ctx.fillRect(0, horizonY, w, h - horizonY);

  // Sun disc, far away in the sun's direction.
  const sunPt = project(cam.x + scene.sunDir.x * 3000, cam.y + scene.sunDir.y * 3000, cam.z + scene.sunDir.z * 3000);
  if (sunPt) {
    ctx.fillStyle = scene.sun > 0.3 ? "#fff3b0" : "#ffb37a";
    ctx.beginPath();
    ctx.arc(sunPt.x, sunPt.y, 26, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sea: a coarse grid of quads at water level around the camera, so the
  // horizon always sits on water even when some corners fall behind us.
  ctx.fillStyle = scene.sun > 0.3 ? "#2e6ea8" : "#274a73";
  const seaCell = 700;
  const seaBaseX = Math.round(cam.x / seaCell) * seaCell;
  const seaBaseZ = Math.round(cam.z / seaCell) * seaCell;
  for (let iz = -3; iz < 3; iz++) {
    for (let ix = -3; ix < 3; ix++) {
      const sx = seaBaseX + ix * seaCell;
      const sz = seaBaseZ + iz * seaCell;
      const c = [
        project(sx, WATER_Y, sz), project(sx + seaCell, WATER_Y, sz),
        project(sx + seaCell, WATER_Y, sz + seaCell), project(sx, WATER_Y, sz + seaCell),
      ];
      if (c.some((q) => !q)) continue;
      ctx.beginPath();
      ctx.moveTo(c[0].x, c[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Terrain patch snapped to the grid around the plane, far quads first.
  const baseX = Math.round(plane.x / CELL) * CELL;
  const baseZ = Math.round(plane.z / CELL) * CELL;
  const half = (GRID / 2) * CELL;
  const quads = [];
  for (let iz = 0; iz < GRID; iz++) {
    for (let ix = 0; ix < GRID; ix++) {
      const x0 = baseX - half + ix * CELL;
      const z0 = baseZ - half + iz * CELL;
      const pts = [
        [x0, z0], [x0 + CELL, z0], [x0 + CELL, z0 + CELL], [x0, z0 + CELL],
      ].map(([px, pz]) => {
        const gy = groundHeight(px, pz);
        return { p: project(px, Math.max(gy, WATER_Y), pz), gy };
      });
      if (pts.some((q) => !q.p)) continue;
      const depth = (pts[0].p.d + pts[2].p.d) / 2;
      const avgH = (pts[0].gy + pts[1].gy + pts[2].gy + pts[3].gy) / 4;
      const slope = Math.abs(pts[0].gy - pts[2].gy) / CELL;
      // Deterministic per-quad tint so flat ground still reads as terrain.
      const hash = Math.sin(x0 * 12.9898 + z0 * 78.233) * 43758.5453;
      const jitter = 0.9 + (hash - Math.floor(hash)) * 0.2;
      quads.push({ pts, depth, avgH, slope, jitter });
    }
  }
  quads.sort((a, b) => b.depth - a.depth);
  const light = 0.55 + scene.sun * 0.55;
  for (const q of quads) {
    const rgb = terrainColour(q.avgH, q.slope);
    const f = light * q.jitter * (1 - Math.min(0.35, q.slope * 0.5)) * (1 - Math.min(0.45, q.depth / 2600));
    ctx.fillStyle = shade(rgb, f);
    ctx.beginPath();
    ctx.moveTo(q.pts[0].p.x, q.pts[0].p.y);
    for (let i = 1; i < 4; i++) ctx.lineTo(q.pts[i].p.x, q.pts[i].p.y);
    ctx.closePath();
    ctx.fill();
  }

  drawRunways(ctx, project, scene);
  drawTrees(ctx, project, scene.trees, plane);
  drawClouds(ctx, project, scene.clouds, scene.time);
  drawRings(ctx, project, scene.rings, scene.nextRing, scene.time);
  if (scene.beacon) drawBeacon(ctx, project, scene.beacon, scene.time);
  drawPlaneShadow(ctx, project, plane);
  if (cam.mode !== "cockpit") drawAircraft(ctx, w, h, plane, scene.time);
  else drawCockpitFrame(ctx, w, h, plane);
}

function drawRunways(ctx, project, scene) {
  for (const rw of RUNWAYS) {
    const hw = rw.len / 2, hd = rw.wid / 2;
    // Asphalt in segments, so a strip passing under the camera still draws.
    const segs = 10;
    ctx.fillStyle = "#3c4048";
    for (let i = 0; i < segs; i++) {
      const xa = rw.x - hw + (i * rw.len) / segs;
      const xb = rw.x - hw + ((i + 1) * rw.len) / segs;
      const corners = [
        project(xa, rw.y + 0.15, rw.z - hd), project(xb, rw.y + 0.15, rw.z - hd),
        project(xb, rw.y + 0.15, rw.z + hd), project(xa, rw.y + 0.15, rw.z + hd),
      ];
      if (corners.some((c) => !c)) continue;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let k = 1; k < 4; k++) ctx.lineTo(corners[k].x, corners[k].y);
      ctx.closePath();
      ctx.fill();
    }
    // Centreline dashes + threshold bars.
    ctx.strokeStyle = "#f2f2f2";
    ctx.lineWidth = 2;
    for (let i = -4; i <= 4; i++) {
      const a = project(rw.x + i * 34 - 9, rw.y + 0.2, rw.z);
      const b = project(rw.x + i * 34 + 9, rw.y + 0.2, rw.z);
      if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    }
    // Edge lights.
    ctx.fillStyle = "#ffd76a";
    for (let i = -5; i <= 5; i++) {
      for (const side of [-1, 1]) {
        const p = project(rw.x + i * 30, rw.y + 0.6, rw.z + side * hd);
        if (p) { ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.4, p.s * 0.35), 0, Math.PI * 2); ctx.fill(); }
      }
    }
    // Name board at the near threshold.
    const label = project(rw.x - hw + 8, rw.y + 3, rw.z + hd + 4);
    if (label && label.d < 700) {
      ctx.fillStyle = "rgba(10,16,28,0.75)";
      const tw = ctx.measureText(rw.name).width + 14;
      ctx.fillRect(label.x - tw / 2, label.y - 11, tw, 20);
      ctx.fillStyle = "#ffe9a8";
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(rw.name, label.x, label.y + 3);
    }
  }
}

function drawTrees(ctx, project, trees, plane) {
  const near = [];
  for (const t of trees) {
    const dx = t.x - plane.x, dz = t.z - plane.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 900 * 900) near.push({ t, d2 });
  }
  near.sort((a, b) => b.d2 - a.d2);
  for (const { t } of near) {
    const base = project(t.x, t.y, t.z);
    const top = project(t.x, t.y + 7 * t.s, t.z);
    if (!base || !top) continue;
    ctx.strokeStyle = "#6b4a2b";
    ctx.lineWidth = Math.max(1, base.s * 0.3);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    ctx.fillStyle = "#2e7d46";
    ctx.beginPath();
    ctx.arc(top.x, top.y, Math.max(2, top.s * 2.2 * t.s), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawClouds(ctx, project, clouds, time) {
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  for (const c of clouds) {
    const drift = (time * 3) % 5200;
    let cx = c.x + drift;
    if (cx > 2600) cx -= 5200;
    const p = project(cx, c.y, c.z);
    if (!p) continue;
    const r = Math.max(4, p.s * c.s * 0.4);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * 1.7, r * 0.55, 0, 0, Math.PI * 2);
    ctx.ellipse(p.x - r * 0.7, p.y + r * 0.15, r, r * 0.45, 0, 0, Math.PI * 2);
    ctx.ellipse(p.x + r * 0.75, p.y + r * 0.1, r * 1.1, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRings(ctx, project, rings, nextRing, time) {
  rings.forEach((ring, i) => {
    const active = i === nextRing;
    const done = i < nextRing;
    const pulse = active ? 1 + Math.sin(time * 4) * 0.06 : 1;
    ctx.strokeStyle = done ? "rgba(120,220,140,0.5)" : active ? "#ffd23e" : "rgba(150,200,255,0.75)";
    ctx.lineWidth = active ? 5 : 3;
    ctx.beginPath();
    let started = false;
    for (let a = 0; a <= 24; a++) {
      const t = (a / 24) * Math.PI * 2;
      // Rings stand vertical, facing along -z/+z travel; tilt by course is approximated.
      const px = ring.x + Math.cos(t) * ring.r * pulse;
      const py = ring.y + Math.sin(t) * ring.r * pulse;
      const p = project(px, py, ring.z);
      if (!p) { started = false; continue; }
      if (!started) { ctx.moveTo(p.x, p.y); started = true; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    if (active) {
      const c = project(ring.x, ring.y + ring.r + 6, ring.z);
      if (c) {
        ctx.fillStyle = "#ffd23e";
        ctx.font = "bold 13px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("RING " + (i + 1), c.x, c.y);
      }
    }
  });
}

function drawBeacon(ctx, project, beacon, time) {
  const base = project(beacon.x, beacon.y - 40, beacon.z);
  const top = project(beacon.x, beacon.y + 90, beacon.z);
  if (base && top) {
    ctx.strokeStyle = "rgba(255,120,80,0.8)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
  }
  const c = project(beacon.x, beacon.y, beacon.z);
  if (c) {
    ctx.strokeStyle = "#ff7a50";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.max(6, c.s * beacon.r * (1 + Math.sin(time * 3) * 0.08)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ffb59a";
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("DELIVERY BEACON", c.x, c.y - Math.max(10, c.s * beacon.r) - 6);
  }
}

function drawPlaneShadow(ctx, project, plane) {
  const gy = Math.max(groundHeight(plane.x, plane.z), WATER_Y);
  const p = project(plane.x, gy + 0.2, plane.z);
  if (!p || p.d < 22) return; // too close to the camera: the blob would fill the screen
  const alt = Math.max(0, plane.y - gy);
  const r = Math.min(64, Math.max(2, p.s * 4.5 * (1 - Math.min(0.7, alt / 220))));
  ctx.fillStyle = "rgba(0,0,0," + (0.35 * (1 - Math.min(0.8, alt / 260))) + ")";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r * 1.6, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

// The Kestrel-2 from behind: fuselage, wing, tail, spinning prop disc.
function drawAircraft(ctx, w, h, plane, time) {
  const cx = w / 2;
  const cy = h * 0.62;
  const s = Math.min(w, h) / 340;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-plane.roll * 0.72);
  ctx.translate(0, Math.sin(time * 2.1) * 2 * s); // gentle bob
  // Wing (behind fuselage), slight dihedral.
  ctx.fillStyle = "#c33b2e";
  ctx.beginPath();
  ctx.moveTo(-72 * s, 6 * s);
  ctx.lineTo(-14 * s, -2 * s);
  ctx.lineTo(14 * s, -2 * s);
  ctx.lineTo(72 * s, 6 * s);
  ctx.lineTo(66 * s, 13 * s);
  ctx.lineTo(-66 * s, 13 * s);
  ctx.closePath();
  ctx.fill();
  // Fuselage.
  ctx.fillStyle = "#f4ead2";
  ctx.beginPath();
  ctx.ellipse(0, 0, 13 * s, 30 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c33b2e";
  ctx.beginPath();
  ctx.ellipse(0, -16 * s, 9 * s, 14 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // Canopy.
  ctx.fillStyle = "#2b4a6b";
  ctx.beginPath();
  ctx.ellipse(0, -4 * s, 7.5 * s, 11 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(180,220,255,0.7)";
  ctx.beginPath();
  ctx.ellipse(-2 * s, -7 * s, 3 * s, 5 * s, -0.4, 0, Math.PI * 2);
  ctx.fill();
  // Tailplane + fin.
  ctx.fillStyle = "#c33b2e";
  ctx.beginPath();
  ctx.moveTo(-26 * s, 26 * s);
  ctx.lineTo(26 * s, 26 * s);
  ctx.lineTo(20 * s, 33 * s);
  ctx.lineTo(-20 * s, 33 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(-2.5 * s, 18 * s, 5 * s, 14 * s);
  // Prop disc at the nose (top of the drawing).
  ctx.strokeStyle = "rgba(30,30,30,0.55)";
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.ellipse(0, -29 * s, 17 * s, 4.5 * s, 0, 0, Math.PI * 2);
  ctx.stroke();
  const pa = plane.propAngle;
  ctx.strokeStyle = "rgba(20,20,20,0.85)";
  ctx.lineWidth = 2.4 * s;
  ctx.beginPath();
  ctx.moveTo(Math.cos(pa) * 16 * s, -29 * s + Math.sin(pa) * 4 * s);
  ctx.lineTo(-Math.cos(pa) * 16 * s, -29 * s - Math.sin(pa) * 4 * s);
  ctx.stroke();
  // Gear legs when down.
  if (plane.gearDown) {
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(-8 * s, 12 * s); ctx.lineTo(-13 * s, 22 * s);
    ctx.moveTo(8 * s, 12 * s); ctx.lineTo(13 * s, 22 * s);
    ctx.stroke();
    ctx.fillStyle = "#222";
    ctx.beginPath(); ctx.arc(-13 * s, 23 * s, 3.4 * s, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(13 * s, 23 * s, 3.4 * s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// Cockpit view: a glareshield and window posts over the world.
function drawCockpitFrame(ctx, w, h, plane) {
  ctx.fillStyle = "#20242c";
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, h * 0.78);
  ctx.quadraticCurveTo(w * 0.5, h * 0.66, w, h * 0.78);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#2c313b";
  ctx.fillRect(w * 0.06, h * 0.8, w * 0.88, h * 0.16);
  ctx.fillStyle = "#14181f";
  ctx.fillRect(0, 0, w * 0.045, h);
  ctx.fillRect(w * 0.955, 0, w * 0.045, h);
  ctx.fillRect(w * 0.487, 0, w * 0.026, h * 0.68);
  // Lit instrument dots on the panel.
  const lit = ["#7ee787", "#ffd76a", "#7ee787", "#6ab0ff", "#ffd76a", "#7ee787"];
  lit.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(w * (0.2 + i * 0.12), h * 0.885, 4, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = "#cfd8e3";
  ctx.font = "bold 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("KESTREL-2", w / 2, h * 0.845);
}
