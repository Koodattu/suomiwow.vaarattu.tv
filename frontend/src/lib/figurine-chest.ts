import * as THREE from "three";
import { coinCollectionFlight } from "@/lib/figurine-coin-flight";
import { orientCoinModel, type PlaceProp } from "@/lib/figurine-props";

export const CHEST_REWARD_SECONDS = 0.85, CHEST_COLLECT_SECONDS = 0.65;
type CoinTarget = { x: number; y: number; width?: number };
const smooth = (value: number) => { const k = THREE.MathUtils.clamp(value, 0, 1); return k * k * (3 - 2 * k); };

// The reward coin: the game's coin, stood up and centred on its own origin, taking no taps.
export function placeRewardCoin(parent: THREE.Object3D, placeProp: PlaceProp) {
  const { group, ready } = placeProp(parent, "coin", { height: 0.5, length: 0.75 });
  return { group, ready: ready.then((model) => {
    const holder = model.parent;
    if (!holder) return model;
    holder.remove(model); orientCoinModel(model);
    model.position.sub(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()));
    holder.add(model);
    model.traverse((object) => { object.raycast = () => {}; });
    return model;
  }) };
}

// One presentation owns the flight from where the reward appears (`from`) to the screen, and from
// the screen to the wallet. The authored coin orientation remains on `coin`; only its parent
// performs the flip.
export function chestRewardPresentation(parent: THREE.Group, coin: THREE.Group, sparkMap: THREE.Texture, burst: (position: THREE.Vector3) => void, collected: () => void = () => {}, from = new THREE.Vector3(0, 0.4, 0.12)) {
  const presentation = new THREE.Group(), reward = new THREE.Group(), spin = new THREE.Group();
  reward.name = "chest-reward";
  parent.add(presentation); presentation.add(reward); reward.add(spin); spin.add(coin);
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: sparkMap, color: 0x000000, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  backdrop.name = "chest-reward-backdrop"; backdrop.raycast = () => {}; presentation.add(backdrop);
  const start = from, centre = new THREE.Vector3(0, 1.4, 1), wallet = new THREE.Vector3();
  const facing = new THREE.Quaternion(), scratch = new THREE.Vector3(), identity = new THREE.Quaternion();
  const collectFrom = new THREE.Vector3(), collectRotation = new THREE.Quaternion(), collectSpin = new THREE.Quaternion();
  let phase: "idle" | "flying" | "showing" | "collecting" = "idle", elapsed = 0, reduced = false;
  let scale = 0.67, walletScale = 0.08, collectScale = 1, complete: (() => void) | null = null;
  let flight: ReturnType<typeof coinCollectionFlight> | null = null;
  const pose = () => {
    reward.visible = phase !== "idle";
    if (phase === "flying") {
      const k = smooth(elapsed / CHEST_REWARD_SECONDS);
      reward.position.lerpVectors(start, centre, k);
      if (!reduced) reward.position.y += 16 * k * k * (1 - k) ** 2 * 0.35;
      reward.quaternion.copy(facing); reward.scale.setScalar(THREE.MathUtils.lerp(0.45, scale, k));
      spin.rotation.set(reduced ? 0 : Math.PI * 2 * k, 0, 0);
    } else if (phase === "showing") {
      reward.position.copy(centre); reward.quaternion.copy(facing); reward.scale.setScalar(scale);
      spin.rotation.set(0, reduced ? 0 : Math.PI * 2 * smooth(elapsed / 1.5), 0);
    } else if (phase === "collecting") {
      const k = smooth(elapsed / CHEST_COLLECT_SECONDS);
      reward.position.lerpVectors(collectFrom, wallet, k);
      reward.quaternion.slerpQuaternions(collectRotation, facing, k);
      if (!reduced) flight?.(reward.position, reward.quaternion, k);
      spin.quaternion.slerpQuaternions(collectSpin, identity, k);
      reward.scale.setScalar(THREE.MathUtils.lerp(collectScale, walletScale, k));
    }
    backdrop.material.opacity = phase === "flying" ? smooth(elapsed / CHEST_REWARD_SECONDS) * 0.6
      : phase === "showing" ? 0.6 : phase === "collecting" ? (1 - smooth(elapsed / CHEST_COLLECT_SECONDS)) * 0.6 : 0;
    backdrop.visible = backdrop.material.opacity > 0;
  };
  const reset = () => { phase = "idle"; elapsed = 0; complete = null; spin.rotation.set(0, 0, 0); pose(); };
  reset();
  return {
    begin(done: () => void) { if (phase !== "idle") return; phase = "flying"; elapsed = 0; complete = done; pose(); },
    dismiss() {
      if (phase !== "showing") return;
      collectFrom.copy(reward.position); collectRotation.copy(reward.quaternion); collectSpin.copy(spin.quaternion); collectScale = reward.scale.x;
      flight = coinCollectionFlight(facing);
      phase = "collecting"; elapsed = 0;
    },
    present(camera: THREE.PerspectiveCamera | null, reducedMotion: boolean, target: CoinTarget | null) {
      presentation.visible = !!camera;
      if (!camera) return;
      reduced = reducedMotion; camera.updateWorldMatrix(true, false);
      const halfHeight = 3 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const at = target ?? { x: 0.9, y: 0.8 };
      centre.copy(parent.worldToLocal(scratch.set(0, 0.04, -3).applyMatrix4(camera.matrixWorld)));
      wallet.copy(parent.worldToLocal(scratch.set(at.x * halfHeight * camera.aspect, at.y * halfHeight, -3).applyMatrix4(camera.matrixWorld)));
      parent.getWorldQuaternion(facing).invert().multiply(camera.quaternion);
      scale = 0.67 * Math.min(1, camera.aspect / 0.8);
      walletScale = (at.width ?? 0.08) * halfHeight * camera.aspect / 0.75;
      backdrop.position.copy(parent.worldToLocal(scratch.set(0, -0.2, -4).applyMatrix4(camera.matrixWorld)));
      backdrop.quaternion.copy(facing);
      const height = 8 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      backdrop.scale.set(Math.min(height * 1.15, height * camera.aspect * 0.95), height * 0.72, 1);
      pose();
    },
    update(delta: number) {
      elapsed += delta;
      if (phase === "flying" && elapsed >= CHEST_REWARD_SECONDS) {
        phase = "showing"; elapsed = 0; pose(); burst(reward.position.clone());
        const done = complete; complete = null; done?.();
      } else if (phase === "collecting" && elapsed >= CHEST_COLLECT_SECONDS) {
        elapsed = CHEST_COLLECT_SECONDS; pose(); burst(reward.position.clone()); reset(); collected();
      } else pose();
    },
    reset,
  };
}

// The chest's native clips, retained by the animated worker export.
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
      if (!pending.revealed && pending.elapsed >= opening.duration * 0.18) {
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
