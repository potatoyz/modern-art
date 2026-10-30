import * as THREE from 'three';
import { A3GameCameraRig } from './game-feel.js';
const SHOTS = Object.freeze({
  follow: { fov: 55, elevation: 0.38, orbit: 0 },
  windup: { fov: 52, elevation: 0.28, orbit: -0.12 },
  impact: { fov: 52, elevation: 0.28, orbit: 0.08 },
  airborne: { fov: 62, elevation: 0.42, orbit: 0.24 },
  landing: { fov: 58, elevation: 0.32, orbit: 0.10 },
  recovery: { fov: 55, elevation: 0.38, orbit: 0 },
});
/** Presentation shots from caller-owned combat state; no simulation writes. */
export class A3GameActionCameraDirector {
  constructor(camera, { yaw = 0.7, playerHeight = 1.8, targetHeight = 3.2,
    minDistance = 8, maxDistance = 24, response = 8, occlusionTargets = [], clearance = 0.25 } = {}) {
    if (!camera.isPerspectiveCamera || !Number.isFinite(camera.aspect) || camera.aspect <= 0) {
      throw new Error('Action camera requires a perspective camera with a positive aspect');
    }
    if (![yaw, playerHeight, targetHeight, minDistance, maxDistance, response].every(Number.isFinite)
      || playerHeight <= 0 || targetHeight <= 0 || minDistance <= 0 || maxDistance < minDistance) {
      throw new RangeError('Action camera dimensions and bounds must be finite and positive');
    }
    this.camera = camera; this.yaw = yaw; this.playerHeight = playerHeight; this.targetHeight = targetHeight;
    this.minDistance = minDistance; this.maxDistance = maxDistance;
    this.rig = new A3GameCameraRig(camera, { response, focusOffset: new THREE.Vector3(), occlusionTargets, clearance });
    this.mode = 'follow'; this.age = 0; this.disposed = false;
  }
  update(delta, player, target, { mode = 'follow', cut = false, reducedMotion = false,
    offset = new THREE.Vector3(), fovKick = 0 } = {}) {
    if (!Number.isFinite(delta) || delta < 0) throw new RangeError('delta must be finite and non-negative');
    if (!SHOTS[mode]) throw new RangeError('Unknown combat camera mode');
    if (this.disposed) return;
    if (mode !== this.mode || cut) this.age = 0;
    this.mode = mode; this.age += delta;
    // Same-side bounded arc, with no roll or automatic input-orientation changes.
    const shot = reducedMotion ? SHOTS.follow : SHOTS[mode];
    const yaw = this.yaw + (reducedMotion ? 0 : shot.orbit * (1 - Math.exp(-3 * this.age)));
    const center = player.clone().add(new THREE.Vector3(0, this.playerHeight / 2, 0))
      .add(target.clone().add(new THREE.Vector3(0, this.targetHeight / 2, 0))).multiplyScalar(0.5);
    const radius = player.distanceTo(target) / 2 + Math.max(this.playerHeight, this.targetHeight) / 2 + 0.8;
    const halfFov = THREE.MathUtils.degToRad(Math.min(shot.fov, this.camera.fov) / 2);
    const angle = Math.min(halfFov, Math.atan(Math.tan(halfFov) * this.camera.aspect));
    const requiredDistance = radius / Math.sin(angle) + 1.5;
    this.framingLimited = requiredDistance > this.maxDistance;
    const distance = THREE.MathUtils.clamp(requiredDistance, this.minDistance, this.maxDistance);
    const direction = new THREE.Vector3(Math.sin(yaw), shot.elevation, Math.cos(yaw)).normalize();
    this.rig.setShot({ offset: direction.multiplyScalar(distance), fov: shot.fov });
    this.rig.update(delta, center, { offset, fovKick, reducedMotion, cut });
  }
  clear() { if (!this.disposed) this.rig.clear(); }
  dispose() { if (this.disposed) return; this.clear(); this.disposed = true; }
}
