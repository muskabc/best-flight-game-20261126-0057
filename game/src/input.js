// input.js — keyboard and mouse controls for the Kestrel-2.
// Arrow keys / WASD fly, Shift & Ctrl work the throttle, F flaps, G gear,
// Space brakes, C swaps camera, R restarts, M mutes. Mouse drag also steers.

export function makeInput(canvas, hooks) {
  const keys = new Set();
  const state = {
    pitch: 0, roll: 0, brake: false,
    mousePitch: 0, mouseRoll: 0,
    dragging: false, lastX: 0, lastY: 0,
  };

  function onKeyDown(e) {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    if (e.repeat) return;
    keys.add(k);
    if (k === "f" && hooks.onFlaps) hooks.onFlaps();
    if (k === "g" && hooks.onGear) hooks.onGear();
    if (k === "c" && hooks.onCamera) hooks.onCamera();
    if (k === "r" && hooks.onRestart) hooks.onRestart();
    if (k === "m" && hooks.onMute) hooks.onMute();
    if (k === "p" && hooks.onPause) hooks.onPause();
    if (k === "enter" && hooks.onConfirm) hooks.onConfirm();
    if (["1", "2", "3", "4"].includes(k) && hooks.onPick) hooks.onPick(Number(k) - 1);
  }
  function onKeyUp(e) {
    keys.delete(e.key.toLowerCase());
  }

  function onPointerDown(e) {
    state.dragging = true;
    state.lastX = e.clientX;
    state.lastY = e.clientY;
    if (hooks.onTap) hooks.onTap(e.clientX, e.clientY);
  }
  function onPointerMove(e) {
    if (!state.dragging) return;
    const dx = e.clientX - state.lastX;
    const dy = e.clientY - state.lastY;
    state.lastX = e.clientX;
    state.lastY = e.clientY;
    state.mouseRoll = clampN(state.mouseRoll + dx * 0.004, -1, 1);
    state.mousePitch = clampN(state.mousePitch - dy * 0.004, -1, 1);
  }
  function onPointerUp() {
    state.dragging = false;
    state.mousePitch = 0;
    state.mouseRoll = 0;
  }
  function onWheel(e) {
    if (hooks.onThrottleDelta) hooks.onThrottleDelta(e.deltaY < 0 ? 0.08 : -0.08);
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: true });

  // Poll once per frame: folds keys + mouse into the flight model's input shape.
  function poll(dt, plane) {
    let pitch = 0;
    let roll = 0;
    if (keys.has("arrowup") || keys.has("w")) pitch += 1;
    if (keys.has("arrowdown") || keys.has("s")) pitch -= 1;
    if (keys.has("arrowleft") || keys.has("a")) roll -= 1;
    if (keys.has("arrowright") || keys.has("d")) roll += 1;
    pitch += state.mousePitch;
    roll += state.mouseRoll;
    if (keys.has("shift")) plane.throttle = clampN(plane.throttle + dt * 0.55, 0, 1);
    if (keys.has("control")) plane.throttle = clampN(plane.throttle - dt * 0.55, 0, 1);
    if (keys.has("pageup")) plane.throttle = clampN(plane.throttle + dt * 0.8, 0, 1);
    if (keys.has("pagedown")) plane.throttle = clampN(plane.throttle - dt * 0.8, 0, 1);
    state.pitch = clampN(pitch, -1, 1);
    state.roll = clampN(roll, -1, 1);
    state.brake = keys.has(" ") || keys.has("b");
    return { pitch: state.pitch, roll: state.roll, brake: state.brake };
  }

  return { poll, keys };
}

function clampN(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
