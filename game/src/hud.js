// hud.js — the instrument overlay: heading tape, speed & altitude tapes,
// artificial horizon, throttle/fuel/damage gauges, mission banner, warnings.

import { headingDeg } from "./flight.js";

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = "rgba(8,14,24,0.62)";
  ctx.strokeStyle = "rgba(160,200,255,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();
}

function bar(ctx, x, y, w, h, frac, colour, label, valueText) {
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#e8f1fb";
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(label, x, y - 4);
  ctx.textAlign = "right";
  ctx.fillText(valueText, x + w, y - 4);
}

export function drawHud(ctx, w, h, plane, view) {
  const hdg = headingDeg(plane);
  const knots = Math.round(plane.speed * 1.944);
  const feet = Math.round(plane.y * 3.281);
  const vsi = Math.round(plane.vspeed * 196.85); // ft/min

  drawHeadingTape(ctx, w, hdg);
  drawSpeedTape(ctx, h, knots, plane);
  drawAltTape(ctx, w, h, feet, vsi, view.agl);
  drawHorizon(ctx, w, h, plane);
  drawGauges(ctx, w, h, plane);
  drawMissionPanel(ctx, view);
  drawCentreCues(ctx, w, h, plane, view);
  drawWarnings(ctx, w, h, plane, view);
}

function drawHeadingTape(ctx, w, hdg) {
  const tw = Math.min(420, w * 0.5);
  const x0 = w / 2 - tw / 2;
  panel(ctx, x0, 10, tw, 40);
  const pxPerDeg = tw / 90;
  ctx.fillStyle = "#e8f1fb";
  ctx.font = "bold 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  const firstDeg = Math.floor((hdg - 45) / 5) * 5;
  for (let abs = firstDeg; abs <= hdg + 45; abs += 5) {
    const deg = ((abs % 360) + 360) % 360;
    const x = w / 2 + (abs - hdg) * pxPerDeg;
    if (x < x0 + 4 || x > x0 + tw - 4) continue;
    const major = deg % 30 === 0;
    ctx.fillRect(x - 0.5, 36, 1, major ? 9 : 5);
    if (deg % 45 === 0) ctx.fillText(CARDINALS[deg / 45], x, 28);
    else if (major) ctx.fillText(String(deg / 10).padStart(2, "0"), x, 28);
  }
  ctx.fillStyle = "#ffd23e";
  ctx.beginPath();
  ctx.moveTo(w / 2 - 7, 52);
  ctx.lineTo(w / 2 + 7, 52);
  ctx.lineTo(w / 2, 44);
  ctx.closePath();
  ctx.fill();
  ctx.font = "bold 15px system-ui, sans-serif";
  ctx.fillText(String(Math.round(hdg)).padStart(3, "0") + "°", w / 2, 68);
}

function drawSpeedTape(ctx, h, knots, plane) {
  const x = 14, y0 = h * 0.3, th = h * 0.4;
  panel(ctx, x, y0, 64, th);
  ctx.fillStyle = "#e8f1fb";
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("KT", x + 6, y0 + 16);
  const pxPerKt = th / 120;
  for (let k = 0; k <= 160; k += 10) {
    const y = y0 + th / 2 + (knots - k) * pxPerKt;
    if (y < y0 + 22 || y > y0 + th - 6) continue;
    ctx.fillRect(x + 40, y - 0.5, k % 20 === 0 ? 14 : 8, 1);
    if (k % 20 === 0) ctx.fillText(String(k), x + 6, y + 4);
  }
  ctx.fillStyle = plane.stalled ? "#ff5a4e" : "#ffd23e";
  ctx.fillRect(x + 2, y0 + th / 2 - 11, 60, 22);
  ctx.fillStyle = "#10151d";
  ctx.font = "bold 16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(String(knots), x + 32, y0 + th / 2 + 6);
}

function drawAltTape(ctx, w, h, feet, vsi, agl) {
  const x = w - 78, y0 = h * 0.3, th = h * 0.4;
  panel(ctx, x, y0, 64, th);
  ctx.fillStyle = "#e8f1fb";
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("ALT FT", x + 6, y0 + 16);
  const pxPerFt = th / 1600;
  for (let f = 0; f <= 4000; f += 200) {
    const y = y0 + th / 2 + (feet - f) * pxPerFt;
    if (y < y0 + 22 || y > y0 + th - 6) continue;
    ctx.fillRect(x + 8, y - 0.5, f % 500 === 0 ? 14 : 8, 1);
    if (f % 500 === 0) ctx.fillText(String(f), x + 26, y + 4);
  }
  ctx.fillStyle = "#ffd23e";
  ctx.fillRect(x + 2, y0 + th / 2 - 11, 60, 22);
  ctx.fillStyle = "#10151d";
  ctx.font = "bold 15px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(String(feet), x + 32, y0 + th / 2 + 6);
  ctx.fillStyle = "#e8f1fb";
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.fillText((vsi >= 0 ? "+" : "") + vsi + " fpm", x + 32, y0 + th + 16);
  ctx.fillText("AGL " + Math.round(agl * 3.281) + " ft", x + 32, y0 + th + 32);
}

function drawHorizon(ctx, w, h, plane) {
  const cx = 86, cy = h - 86, r = 52;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-plane.roll);
  const pitchPx = plane.pitch * 90;
  ctx.fillStyle = "#4a90d9";
  ctx.fillRect(-r * 1.6, -r * 1.6 + pitchPx, r * 3.2, r * 1.6);
  ctx.fillStyle = "#8a6a44";
  ctx.fillRect(-r * 1.6, pitchPx, r * 3.2, r * 1.6);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-r * 1.6, pitchPx);
  ctx.lineTo(r * 1.6, pitchPx);
  ctx.stroke();
  ctx.lineWidth = 1;
  for (const d of [-20, -10, 10, 20]) {
    const y = pitchPx - d * 1.6;
    ctx.beginPath();
    ctx.moveTo(-16, y);
    ctx.lineTo(16, y);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(160,200,255,0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#ffd23e";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 26, cy);
  ctx.lineTo(cx - 8, cy);
  ctx.lineTo(cx - 8, cy + 6);
  ctx.moveTo(cx + 26, cy);
  ctx.lineTo(cx + 8, cy);
  ctx.lineTo(cx + 8, cy + 6);
  ctx.stroke();
  ctx.fillStyle = "#e8f1fb";
  ctx.font = "bold 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("ATTITUDE", cx, cy + r + 14);
}

function drawGauges(ctx, w, h, plane) {
  const x = w - 196, y = h - 140;
  panel(ctx, x, y, 182, 126);
  bar(ctx, x + 12, y + 30, 158, 12, plane.throttle, "#6ab0ff", "THROTTLE", Math.round(plane.throttle * 100) + "%");
  bar(ctx, x + 12, y + 62, 158, 12, plane.fuel / 100, plane.fuel < 20 ? "#ff5a4e" : "#7ee787", "FUEL", Math.round(plane.fuel) + "%");
  bar(ctx, x + 12, y + 94, 158, 12, 1 - plane.damage / 100, plane.damage > 40 ? "#ff5a4e" : "#ffd76a", "AIRFRAME", Math.round(100 - plane.damage) + "%");
  ctx.fillStyle = plane.gearDown ? "#7ee787" : "#8a94a6";
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(plane.gearDown ? "GEAR ▼ DOWN" : "GEAR ▲ UP", x + 12, y + 120);
  ctx.fillStyle = plane.flaps ? "#7ee787" : "#8a94a6";
  ctx.textAlign = "right";
  ctx.fillText(plane.flaps ? "FLAPS OUT" : "FLAPS IN", x + 170, y + 120);
}

function drawMissionPanel(ctx, view) {
  panel(ctx, 14, 10, 300, 86);
  ctx.fillStyle = "#ffd23e";
  ctx.font = "bold 14px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(view.missionTitle, 26, 34);
  ctx.fillStyle = "#e8f1fb";
  ctx.font = "12px system-ui, sans-serif";
  wrapText(ctx, view.objective, 26, 54, 276, 15);
  ctx.fillStyle = "#9fd0ff";
  ctx.font = "bold 12px system-ui, sans-serif";
  ctx.fillText(view.progress, 26, 88);
  // Score + clock, top right.
  const w = ctx.canvas.width;
  panel(ctx, w - 176, 10, 162, 52);
  ctx.fillStyle = "#e8f1fb";
  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("SCORE " + view.score, w - 164, 34);
  ctx.fillText("TIME " + view.clock, w - 164, 54);
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      yy += lineH;
      line = word;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, yy);
}

function drawCentreCues(ctx, w, h, plane, view) {
  const cx = w / 2, cy = h / 2;
  // Pitch ladder.
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineWidth = 1.5;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "center";
  for (const deg of [-20, -10, 10, 20]) {
    const y = cy - (deg * Math.PI / 180 - plane.pitch) * h * 0.9;
    if (y < 60 || y > h - 60) continue;
    ctx.beginPath();
    ctx.moveTo(cx - 46, y);
    ctx.lineTo(cx - 16, y);
    ctx.moveTo(cx + 16, y);
    ctx.lineTo(cx + 46, y);
    ctx.stroke();
    ctx.fillText(String(Math.abs(deg)), cx, y + 3);
  }
  // Flight-path marker.
  ctx.strokeStyle = "#7ee787";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 20, cy); ctx.lineTo(cx - 11, cy);
  ctx.moveTo(cx + 11, cy); ctx.lineTo(cx + 20, cy);
  ctx.moveTo(cx, cy - 16); ctx.lineTo(cx, cy - 11);
  ctx.stroke();
  // Objective pointer: an arrow at the screen edge toward the target.
  if (view.targetScreen) {
    const t = view.targetScreen;
    const onScreen = t.x > 40 && t.x < w - 40 && t.y > 40 && t.y < h - 40;
    if (onScreen) {
      ctx.strokeStyle = "#ffd23e";
      ctx.lineWidth = 2;
      ctx.strokeRect(t.x - 14, t.y - 14, 28, 28);
      ctx.fillStyle = "#ffd23e";
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.fillText(t.label, t.x, t.y - 20);
    } else {
      const ang = Math.atan2(t.y - cy, t.x - cx);
      const ex = cx + Math.cos(ang) * (Math.min(w, h) * 0.36);
      const ey = cy + Math.sin(ang) * (Math.min(w, h) * 0.36);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(ang);
      ctx.fillStyle = "#ffd23e";
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-8, -9);
      ctx.lineTo(-8, 9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#ffd23e";
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.fillText(t.label, ex, ey + 26);
    }
  }
}

function drawWarnings(ctx, w, h, plane, view) {
  const warns = [];
  if (plane.stalled) warns.push(["STALL — NOSE DOWN, ADD POWER", "#ff5a4e"]);
  if (plane.fuel <= 0) warns.push(["ENGINE OUT — GLIDE TO A RUNWAY", "#ff5a4e"]);
  else if (plane.fuel < 15) warns.push(["LOW FUEL", "#ffb84e"]);
  if (!plane.onGround && !plane.gearDown && view.agl < 60) warns.push(["GEAR UP — PRESS G", "#ffb84e"]);
  if (view.banner) warns.push([view.banner, "#7ee787"]);
  ctx.textAlign = "center";
  warns.forEach(([text, colour], i) => {
    const y = h * 0.24 + i * 30;
    ctx.font = "bold 19px system-ui, sans-serif";
    const tw = ctx.measureText(text).width + 28;
    ctx.fillStyle = "rgba(10,10,14,0.66)";
    ctx.beginPath();
    ctx.roundRect(w / 2 - tw / 2, y - 22, tw, 30, 8);
    ctx.fill();
    ctx.fillStyle = colour;
    ctx.fillText(text, w / 2, y);
  });
  // Bottom centre: controls reminder, small.
  ctx.fillStyle = "rgba(232,241,251,0.75)";
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText("Arrows/WASD fly · Shift/Ctrl throttle · F flaps · G gear · Space brake · C camera · R restart", w / 2, h - 12);
}
