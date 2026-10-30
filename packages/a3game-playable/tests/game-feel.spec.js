import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { A3GameCameraRig, A3GameFeedback } from '../src/index.js';

function events() {
  const listeners = new Map();
  return {
    addEventListener: (key, fn) => listeners.set(key, fn),
    removeEventListener: (key, fn) => { if (listeners.get(key) === fn) listeners.delete(key); },
    fire: (key, value = {}) => listeners.get(key)?.(value), listeners,
  };
}

describe('presentation feedback', () => {
  it('degrades safely for unsupported, rejected and throwing haptics', () => {
    for (const navigator of [{}, { vibrate: () => false }, { vibrate: () => { throw Error('denied'); } }]) {
      const feedback = new A3GameFeedback({ navigator, haptics: true });
      expect(feedback.trigger()).toBe(true);
      expect(feedback.update(0.05).offset.length()).toBeGreaterThan(0);
      feedback.dispose();
    }
  });
  it('bounds and replaces repeated impulses, throttles haptics and expires', () => {
    const vibrate = vi.fn(() => true);
    const feedback = new A3GameFeedback({ navigator: { vibrate }, haptics: true });
    for (let i = 0; i < 100; i++) feedback.trigger({ strength: 100, fovKick: 100, vibrationMs: 1000 });
    expect(vibrate.mock.calls).toEqual([[100]]);
    expect(feedback.update(0.05).offset.length()).toBeLessThan(0.43);
    expect(feedback.update(1)).toEqual({ offset: new THREE.Vector3(), fovKick: 0 });
    feedback.trigger();
    expect(vibrate).toHaveBeenLastCalledWith(35);
    feedback.setPreferences({ enabled: false });
    expect(vibrate).toHaveBeenLastCalledWith(0);
    expect(feedback.trigger()).toBe(false);
  });
  it('respects live OS motion preference, focus and teardown', () => {
    const window = events(), document = events(), media = { ...events(), matches: true };
    const feedback = new A3GameFeedback({ window, document, media, navigator: {} });
    feedback.trigger();
    expect(feedback.update(0.05).offset.length()).toBe(0);
    media.fire('change', { matches: false });
    feedback.trigger();
    expect(feedback.update(0.05).offset.length()).toBeGreaterThan(0);
    window.fire('blur');
    expect(feedback.trigger()).toBe(false);
    feedback.setSuspended(true);
    window.fire('focus');
    expect(feedback.trigger()).toBe(false);
    feedback.setSuspended(false);
    expect(feedback.trigger()).toBe(true);
    feedback.setPreferences({ reducedMotion: true });
    feedback.trigger();
    expect(feedback.pulse).toBeNull();
    feedback.setPreferences({ reducedMotion: null });
    feedback.trigger();
    expect(feedback.pulse).not.toBeNull();
    document.hidden = true;
    document.fire('visibilitychange');
    expect(feedback.pulse).toBeNull();
    feedback.dispose();
    feedback.dispose();
    expect(window.listeners.size + document.listeners.size + media.listeners.size).toBe(0);
    expect(feedback.trigger()).toBe(false);
  });
  it('samples identical envelopes at 30, 60 and 120 Hz', () => {
    const samples = [30, 60, 120].map((hz) => {
      const feedback = new A3GameFeedback({ navigator: {} });
      feedback.trigger({ duration: 0.5 });
      let sample;
      for (let i = 0; i < hz / 2; i++) sample = feedback.update(1 / hz);
      return sample;
    });
    for (const sample of samples) {
      expect(sample.offset.distanceTo(samples[0].offset)).toBeLessThan(1e-12);
      expect(sample.fovKick).toBeCloseTo(samples[0].fovKick, 12);
    }
  });
});

describe('camera framing', () => {
  it('converges identically at 30, 60 and 120 Hz across shot switches', () => {
    const poses = [30, 60, 120].map((hz) => {
      const camera = new THREE.PerspectiveCamera();
      const rig = new A3GameCameraRig(camera);
      for (let i = 0; i < hz; i++) rig.update(1 / hz, new THREE.Vector3(10, 0, 0));
      rig.setShot({ offset: new THREE.Vector3(2, 2, 3), fov: 40 });
      for (let i = 0; i < hz; i++) rig.update(1 / hz, new THREE.Vector3(10, 0, 0));
      return { position: camera.position.clone(), fov: camera.fov };
    });
    for (const pose of poses) {
      expect(pose.position.distanceTo(poses[0].position)).toBeLessThan(1e-10);
      expect(pose.fov).toBeCloseTo(poses[0].fov, 10);
    }
  });
  it('keeps a separate base pose, restores it on pause and suppresses motion', () => {
    const camera = new THREE.PerspectiveCamera(55);
    const rig = new A3GameCameraRig(camera, { fov: 55 });
    const target = new THREE.Vector3();
    rig.update(0, target, { cut: true });
    const base = camera.position.clone();
    for (let i = 0; i < 100; i++) rig.update(0, target, { offset: new THREE.Vector3(0.1, 0, 0), fovKick: 2 });
    expect(camera.position.distanceTo(base)).toBeCloseTo(0.1);
    expect(camera.fov).toBe(57);
    rig.clear();
    expect(camera.position.equals(base)).toBe(true);
    expect(camera.fov).toBe(55);
    rig.update(0, new THREE.Vector3(20, 0, 0), { reducedMotion: true, offset: new THREE.Vector3(1, 1, 1), fovKick: 4 });
    expect(camera.position.x).toBe(20);
    expect(camera.fov).toBe(55);
  });
  it('pulls the display boom in front of blockers and restores framing after removal', () => {
    const camera = new THREE.PerspectiveCamera();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 0.2), new THREE.MeshBasicMaterial());
    wall.position.z = 3;
    wall.updateMatrixWorld(true);
    const rig = new A3GameCameraRig(camera, {
      offset: new THREE.Vector3(0, 0, 7), focusOffset: new THREE.Vector3(),
      occlusionTargets: [wall], clearance: 0.25,
    });
    rig.update(0, new THREE.Vector3(), { cut: true });
    expect(camera.position.z).toBeCloseTo(2.65);
    expect(rig.position.z).toBe(7);
    rig.clear();
    expect(camera.position.z).toBeCloseTo(2.65);
    wall.position.z = 10; // The query updates blocker matrices, even before the first render.
    rig.update(0, new THREE.Vector3());
    expect(camera.position.z).toBe(7);
    wall.geometry.dispose(); wall.material.dispose();
  });
  it('supports orthographic poses and rejects competing parent transforms', () => {
    const camera = new THREE.OrthographicCamera(-4, 4, 4, -4);
    const rig = new A3GameCameraRig(camera);
    rig.update(0, new THREE.Vector3(2, 0, 0), { cut: true, fovKick: 3 });
    expect(camera.position.x).toBe(2);
    expect(camera.left).toBe(-4);
    new THREE.Group().add(camera);
    expect(() => new A3GameCameraRig(camera)).toThrow();
  });
  it('rejects invalid profile values', () => {
    const feedback = new A3GameFeedback({ navigator: {} });
    expect(() => feedback.update(NaN)).toThrow();
    expect(() => feedback.update(-1)).toThrow();
    expect(() => feedback.trigger({ strength: Infinity })).toThrow();
    const rig = new A3GameCameraRig(new THREE.PerspectiveCamera());
    expect(() => rig.setShot({ fov: NaN })).toThrow();
  });
});
