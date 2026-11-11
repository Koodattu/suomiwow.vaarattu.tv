import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { coinCollectionFlight } from "@/lib/figurine-coin-flight";
import { orientCoinModel, type PlaceProp } from "@/lib/figurine-props";

export const CHEST_REWARD_SECONDS = 0.85, CHEST_COLLECT_SECONDS = 0.65;
// Several coins leave and land one after another, this far apart, and never more than this many.
export const COIN_STAGGER = 0.09, MAX_REWARD_COINS = 12;
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
// Where each of `count` coins hangs about the middle of the screen, in coin widths (rows of up to
// four, each row centred), and how much smaller each coin is than a coin shown alone.
export function rewardCoinLayout(count: number) {
  const perRow = count <= 4 ? count : Math.ceil(count / Math.ceil(count / 4)), rows = Math.ceil(count / perRow);
  const size = count <= 1 ? 1 : count === 2 ? 0.8 : count <= 4 ? 0.62 : count <= 8 ? 0.52 : 0.44;
  return { size, slots: Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / perRow), inRow = Math.min(perRow, count - row * perRow);
    return { x: (index % perRow - (inRow - 1) / 2) * 1.14, y: ((rows - 1) / 2 - row) * 1.1 };
  }) };
}

// One presentation owns the flight from where the reward appears (`from`) to the screen, and from
// the screen to the wallet, for one coin or several: they leave one after another, hang together
// before the camera, and on dismissal fly to the wallet in turn, each reporting its own arrival.
// The authored coin orientation remains on `coin`; only its parent performs the flip.
export function chestRewardPresentation(parent: THREE.Group, coin: THREE.Group, sparkMap: THREE.Texture, burst: (position: THREE.Vector3) => void, collected: () => void = () => {}, from = new THREE.Vector3(0, 0.4, 0.12)) {
  const presentation = new THREE.Group();
  parent.add(presentation);
  const entry = (model: THREE.Object3D) => {
    const reward = new THREE.Group(), spin = new THREE.Group();
    reward.name = "chest-reward"; reward.visible = false;
    presentation.add(reward); reward.add(spin); spin.add(model);
    return { reward, spin, centre: new THREE.Vector3(0, 1.4, 1), slot: { x: 0, y: 0 }, landed: false, flight: null as ReturnType<typeof coinCollectionFlight> | null,
      collectFrom: new THREE.Vector3(), collectRotation: new THREE.Quaternion(), collectSpin: new THREE.Quaternion(), collectScale: 1 };
  };
  const entries = [entry(coin)];
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: sparkMap, color: 0x000000, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  backdrop.name = "chest-reward-backdrop"; backdrop.raycast = () => {}; presentation.add(backdrop);
  const start = from, wallet = new THREE.Vector3();
  const facing = new THREE.Quaternion(), scratch = new THREE.Vector3(), identity = new THREE.Quaternion();
  let phase: "idle" | "flying" | "showing" | "collecting" = "idle", elapsed = 0, reduced = false, count = 1, size = 1;
  let scale = 0.67, walletScale = 0.08, complete: (() => void) | null = null;
  const wait = () => (count - 1) * COIN_STAGGER;
  const pose = () => entries.forEach((item, index) => {
    const { reward, spin, centre } = item, own = elapsed - index * COIN_STAGGER, shown = scale * size;
    reward.visible = index < count && phase !== "idle" && !item.landed && (phase !== "flying" || own >= 0);
    if (!reward.visible) return;
    if (phase === "flying") {
      const k = smooth(own / CHEST_REWARD_SECONDS);
      reward.position.lerpVectors(start, centre, k);
      if (!reduced) reward.position.y += 16 * k * k * (1 - k) ** 2 * 0.35;
      reward.quaternion.copy(facing); reward.scale.setScalar(THREE.MathUtils.lerp(0.45 * size, shown, k));
      spin.rotation.set(reduced ? 0 : Math.PI * 2 * k, 0, 0);
    } else if (phase === "showing" || own < 0) {
      reward.position.copy(centre); reward.quaternion.copy(facing); reward.scale.setScalar(shown);
      if (phase === "showing") spin.rotation.set(0, reduced ? 0 : Math.PI * 2 * smooth(elapsed / 1.5), 0);
    } else {
      const k = smooth(own / CHEST_COLLECT_SECONDS);
      reward.position.lerpVectors(item.collectFrom, wallet, k);
      reward.quaternion.slerpQuaternions(item.collectRotation, facing, k);
      if (!reduced) item.flight?.(reward.position, reward.quaternion, k);
      spin.quaternion.slerpQuaternions(item.collectSpin, identity, k);
      reward.scale.setScalar(THREE.MathUtils.lerp(item.collectScale, walletScale, k));
    }
  });
  const shade = () => {
    const leaving = smooth((elapsed - wait()) / CHEST_COLLECT_SECONDS);
    backdrop.material.opacity = phase === "flying" ? smooth(elapsed / CHEST_REWARD_SECONDS) * 0.6 : phase === "showing" ? 0.6 : phase === "collecting" ? (1 - leaving) * 0.6 : 0;
    backdrop.visible = backdrop.material.opacity > 0;
  };
  const reset = () => { phase = "idle"; elapsed = 0; complete = null; entries.forEach((item) => { item.landed = false; item.spin.rotation.set(0, 0, 0); }); pose(); shade(); };
  reset();
  return {
    // Starts `coins` coins on their way (the coin model must have loaded for more than one).
    begin(done: () => void, coins = 1) {
      if (phase !== "idle") return;
      count = THREE.MathUtils.clamp(Math.round(coins), 1, MAX_REWARD_COINS);
      while (entries.length < count) { const copy = clone(coin); copy.traverse((object) => { object.raycast = () => {}; }); entries.push(entry(copy)); }
      const layout = rewardCoinLayout(count); size = layout.size;
      entries.forEach((item, index) => { if (index < count) item.slot = layout.slots[index]; });
      phase = "flying"; elapsed = 0; complete = done; pose(); shade();
    },
    dismiss() {
      if (phase !== "showing") return;
      entries.forEach((item) => {
        item.collectFrom.copy(item.reward.position); item.collectRotation.copy(item.reward.quaternion); item.collectSpin.copy(item.spin.quaternion); item.collectScale = item.reward.scale.x;
        item.flight = coinCollectionFlight(facing);
      });
      phase = "collecting"; elapsed = 0;
    },
    present(camera: THREE.PerspectiveCamera | null, reducedMotion: boolean, target: CoinTarget | null) {
      presentation.visible = !!camera;
      if (!camera) return;
      reduced = reducedMotion; camera.updateWorldMatrix(true, false);
      const halfHeight = 3 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const at = target ?? { x: 0.9, y: 0.8 };
      scale = 0.67 * Math.min(1, camera.aspect / 0.8);
      // A coin is three quarters of a unit across at full size; the slots are in coin widths.
      const width = 0.75 * scale * size;
      entries.forEach((item, index) => { if (index < count) item.centre.copy(parent.worldToLocal(scratch.set(item.slot.x * width, 0.04 + item.slot.y * width, -3).applyMatrix4(camera.matrixWorld))); });
      wallet.copy(parent.worldToLocal(scratch.set(at.x * halfHeight * camera.aspect, at.y * halfHeight, -3).applyMatrix4(camera.matrixWorld)));
      parent.getWorldQuaternion(facing).invert().multiply(camera.quaternion);
      walletScale = (at.width ?? 0.08) * halfHeight * camera.aspect / 0.75;
      backdrop.position.copy(parent.worldToLocal(scratch.set(0, -0.2, -4).applyMatrix4(camera.matrixWorld)));
      backdrop.quaternion.copy(facing);
      const height = 8 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      backdrop.scale.set(Math.min(height * 1.15, height * camera.aspect * 0.95), height * 0.72, 1);
      pose();
    },
    update(delta: number) {
      elapsed += delta;
      if (phase === "flying" && elapsed >= CHEST_REWARD_SECONDS + wait()) {
        phase = "showing"; elapsed = 0; pose(); shade(); burst(entries[0].reward.position.clone());
        const done = complete; complete = null; done?.();
      } else if (phase === "collecting") {
        // Each coin lands in its turn; the last one ends the presentation.
        entries.forEach((item, index) => {
          if (index >= count || item.landed || elapsed - index * COIN_STAGGER < CHEST_COLLECT_SECONDS) return;
          item.reward.position.copy(wallet); item.landed = true; burst(wallet.clone()); collected();
        });
        if (entries.every((item, index) => index >= count || item.landed)) reset(); else { pose(); shade(); }
      } else { pose(); shade(); }
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
