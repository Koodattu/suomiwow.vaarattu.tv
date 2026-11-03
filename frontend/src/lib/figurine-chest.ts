import * as THREE from "three";

export const CHEST_REWARD_SECONDS = 1.35;
// Absolute poses keep a second opening and low frame rates from accumulating drift.
export function chestRewardPose(seconds: number, reducedMotion = false) {
  const progress = THREE.MathUtils.clamp(seconds / CHEST_REWARD_SECONDS, 0, 1);
  const lift = 1 - (1 - progress) ** 3;
  const bob = reducedMotion ? 0 : Math.sin(progress * Math.PI) * 0.12;
  return {
    y: 0.34 + lift * 1.28 + bob,
    z: 0.1 + lift * 0.62,
    scale: 0.52 + lift * 0.48,
    turn: 0.2 + (reducedMotion ? 0 : Math.PI * 2 * lift),
    glow: Math.sin(progress * Math.PI) * 0.65 + 0.35,
    settled: progress === 1,
  };
}

// treasurechest01's native clips, retained by the animated worker export.
export function dailyChestAnimation(root: THREE.Object3D) {
  const opening = root.animations.find((clip) => clip.name === "Open (ID 148 variation 0)");
  const closing = root.animations.find((clip) => clip.name === "Close (ID 146 variation 0)");
  if (!opening || !closing) return null;
  const mixer = new THREE.AnimationMixer(root);
  const openAction = mixer.clipAction(opening), closeAction = mixer.clipAction(closing);
  for (const action of [openAction, closeAction]) {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  }
  let claimed: boolean | null = null;
  let pending: { elapsed: number; revealed: boolean; reveal: () => void; done: () => void } | null = null;
  const pose = (open: boolean) => {
    mixer.stopAllAction();
    openAction.reset().play();
    openAction.time = open ? opening.duration : 0;
    openAction.paused = true;
    mixer.update(0);
  };
  return {
    setClaimed(value: boolean) {
      if (pending || claimed === value) return;
      const previous = claimed;
      claimed = value;
      if (previous === true && !value) {
        mixer.stopAllAction(); closeAction.reset().play();
      } else pose(value);
    },
    open(reveal: () => void, done: () => void) {
      if (pending) return;
      claimed = true;
      mixer.stopAllAction(); openAction.reset().play();
      mixer.update(0);
      pending = { elapsed: 0, revealed: false, reveal, done };
    },
    update(delta: number) {
      mixer.update(delta);
      if (!pending) return;
      pending.elapsed += delta;
      if (!pending.revealed && pending.elapsed >= opening.duration * 0.55) {
        pending.revealed = true; pending.reveal();
      }
      if (pending.elapsed >= opening.duration) {
        const done = pending.done;
        pending = null;
        done();
      }
    },
    dispose() { pending = null; mixer.stopAllAction(); mixer.uncacheRoot(root); },
  };
}
