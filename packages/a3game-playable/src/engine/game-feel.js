import * as THREE from 'three';

const seconds = (value) => {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('delta must be finite and non-negative');
  return value;
};

const bounded = (value, min, max, name) => {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return THREE.MathUtils.clamp(value, min, max);
};

/** Presentation-only impulses. No timers, simulation time scaling, or gameplay writes. */
export class A3GameFeedback {
  constructor({ navigator = globalThis.navigator, window = globalThis.window,
    document = globalThis.document, media = window?.matchMedia?.('(prefers-reduced-motion: reduce)'),
    enabled = true, haptics = false, intensity = 1, reducedMotion } = {}) {
    this.navigator = navigator;
    this.window = window;
    this.document = document;
    this.media = media;
    this.systemReduced = Boolean(media?.matches);
    this.reducedOverride = reducedMotion;
    this.enabled = Boolean(enabled);
    this.haptics = Boolean(haptics);
    this.intensity = bounded(intensity, 0, 1, 'intensity');
    this.pulse = null;
    this.cooldown = 0;
    this.suspended = false;
    this.background = Boolean(document?.hidden);
    this.disposed = false;
    this.onMedia = (event) => { this.systemReduced = event.matches; this.clear(); };
    this.onBlur = () => { this.background = true; this.clear(); };
    this.onFocus = () => { this.background = Boolean(document?.hidden); };
    this.onVisibility = () => {
      this.background = Boolean(document?.hidden);
      if (this.background) this.clear();
    };
    media?.addEventListener?.('change', this.onMedia);
    window?.addEventListener?.('blur', this.onBlur);
    window?.addEventListener?.('focus', this.onFocus);
    document?.addEventListener?.('visibilitychange', this.onVisibility);
  }

  get reducedMotion() { return this.reducedOverride ?? this.systemReduced; }

  setPreferences({ enabled = this.enabled, haptics = this.haptics,
    intensity = this.intensity, reducedMotion = this.reducedOverride } = {}) {
    const level = bounded(intensity, 0, 1, 'intensity');
    this.enabled = Boolean(enabled);
    this.haptics = Boolean(haptics);
    this.intensity = level;
    this.reducedOverride = reducedMotion;
    this.clear();
  }

  /** One confirmed event, not every active attack frame. Latest pulse replaces earlier pulse. */
  trigger({ strength = 0.08, duration = 0.18, fovKick = 1, vibrationMs = 35 } = {}) {
    const pulse = {
      strength: bounded(strength, 0, 0.3, 'strength'),
      duration: bounded(duration, 0.01, 0.5, 'duration'),
      fovKick: bounded(fovKick, 0, 4, 'fovKick'), age: 0,
    };
    const ms = bounded(vibrationMs, 0, 100, 'vibrationMs');
    if (!this.enabled || this.suspended || this.background || this.disposed || this.intensity === 0) return false;
    if (!this.reducedMotion) this.pulse = pulse;
    if (this.haptics && this.cooldown === 0 && ms > 0) {
      this.vibrate(Math.round(ms * this.intensity));
      this.cooldown = 0.1;
    }
    return true;
  }

  vibrate(ms) {
    try { return this.navigator?.vibrate?.(ms) === true; } catch { return false; }
  }

  update(delta) {
    const dt = seconds(delta);
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.pulse) {
      this.pulse.age += dt;
      if (this.pulse.age >= this.pulse.duration) this.pulse = null;
    }
    const offset = new THREE.Vector3();
    if (!this.pulse) return { offset, fovKick: 0 };
    const { age, duration, strength, fovKick } = this.pulse;
    const envelope = (1 - age / duration) ** 2 * this.intensity;
    // Time-based, deterministic, camera-local translation; no roll or flashing.
    offset.set(Math.sin(age * 97), Math.sin(age * 71), 0).multiplyScalar(strength * envelope);
    return { offset, fovKick: fovKick * envelope };
  }

  clear() { this.pulse = null; this.cooldown = 0; this.vibrate(0); }
  setSuspended(value) { this.suspended = Boolean(value); if (value) this.clear(); }
  dispose() {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.media?.removeEventListener?.('change', this.onMedia);
    this.window?.removeEventListener?.('blur', this.onBlur);
    this.window?.removeEventListener?.('focus', this.onFocus);
    this.document?.removeEventListener?.('visibilitychange', this.onVisibility);
  }
}

/** Single camera owner. Use an unparented camera; detach Orbit/PointerLock controls first. */
export class A3GameCameraRig {
  constructor(camera, { offset = new THREE.Vector3(0, 4, 7),
    focusOffset = new THREE.Vector3(0, 1.2, 0), response = 8, fov = camera.fov ?? 50,
    occlusionTargets = [], clearance = 0.25 } = {}) {
    if (camera.parent) throw new Error('CameraRig requires an unparented camera');
    this.camera = camera;
    this.occlusionTargets = occlusionTargets;
    this.clearance = bounded(clearance, 0, 2, 'clearance');
    this.raycaster = new THREE.Raycaster();
    this.position = camera.position.clone();
    this.focus = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()));
    this.fov = camera.fov ?? fov;
    this.setShot({ offset, focusOffset, response, fov });
  }

  /** Switch follow/composition shots by changing offsets/FOV; blend from the current base pose. */
  setShot({ offset = this.offset, focusOffset = this.focusOffset,
    response = this.response, fov = this.targetFov } = {}) {
    if (![...offset.toArray(), ...focusOffset.toArray()].every(Number.isFinite)) {
      throw new RangeError('shot offsets must be finite Vector3 values');
    }
    this.response = bounded(response, 0.01, 100, 'response');
    this.targetFov = bounded(fov, 10, 100, 'fov');
    this.offset = offset.clone();
    this.focusOffset = focusOffset.clone();
  }

  update(delta, target, { offset = new THREE.Vector3(), fovKick = 0, reducedMotion = false, cut = false } = {}) {
    const dt = seconds(delta);
    const alpha = cut || reducedMotion ? 1 : 1 - Math.exp(-this.response * dt);
    this.position.lerp(target.clone().add(this.offset), alpha);
    this.focus.lerp(target.clone().add(this.focusOffset), alpha);
    this.fov = THREE.MathUtils.lerp(this.fov, this.targetFov, alpha);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.focus);
    if (!reducedMotion) this.camera.position.add(offset.clone().applyQuaternion(this.camera.quaternion));
    if (this.camera.isPerspectiveCamera) {
      this.camera.fov = this.fov + (reducedMotion ? 0 : fovKick);
      this.camera.updateProjectionMatrix();
    }
    this.resolveOcclusion();
    this.camera.updateMatrixWorld(true);
  }

  /** Center-line boom test against explicit static blockers; not a swept camera volume. */
  resolveOcclusion() {
    const direction = this.camera.position.clone().sub(this.focus);
    const distance = direction.length();
    if (!distance || !this.occlusionTargets.length) return;
    for (const target of this.occlusionTargets) target.updateWorldMatrix(true, true);
    this.raycaster.set(this.focus, direction.normalize());
    this.raycaster.far = distance;
    const hit = this.raycaster.intersectObjects(this.occlusionTargets, true)[0];
    if (hit) this.camera.position.copy(this.focus).addScaledVector(direction, Math.max(0, hit.distance - this.clearance));
  }

  /** Remove transient presentation before pause/exit without changing the base framing. */
  clear() {
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.focus);
    if (this.camera.isPerspectiveCamera) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.resolveOcclusion();
    this.camera.updateMatrixWorld(true);
  }
}
