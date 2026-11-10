import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import YardUnitDetail from "./YardUnitDetail.jsx";

const TEU = 6.1;
const BOX_W = 2.44;
const BOX_H = 2.59;
const PITCH_X = TEU * 2 + 0.7;
const PITCH_Z = BOX_W + 0.55;
const AISLE = 8;

function spanOf(type) {
  const code = String(type || "");
  if (code.startsWith("45")) return 45 / 20;
  if (code.startsWith("40")) return 2;
  if (code.startsWith("20")) return 1;
  if (code.startsWith("10")) return 0.5;
  return 1;
}

function highOf(type) {
  return /HC|HQ|45/.test(String(type || "")) ? 2.9 / 2.59 : 1;
}

function lengthOf(type) {
  return TEU * spanOf(type);
}

function feetOf(type) {
  const code = String(type || "").toUpperCase();
  if (code.startsWith("45")) return 45;
  if (code.startsWith("40")) return 40;
  if (code.startsWith("20")) return 20;
  if (code.startsWith("10")) return 10;
  return 0;
}

function columnAllows(zone, row, col, level, incomingType, units, ghosts) {
  const incoming = feetOf(incomingType);
  if (incoming <= 0) return true;
  for (let cursor = level - 1; cursor >= 1; cursor -= 1) {
    const unit = (units || []).find((item) => item.lado === zone.name && item.ruma === row && item.columna === col && item.nivel === cursor);
    const ghost = (ghosts || []).find((item) => item.zoneId === zone.id && item.row === row && item.col === col && item.level === cursor);
    const feet = feetOf(unit?.type || ghost?.typeCode);
    if (feet > 0 && incoming > feet) return false;
  }
  return true;
}

function inheritedType(zone, row, col, level, ownType, units, ghosts) {
  if (ownType) return ownType;
  const aboveUnit = (units || [])
    .filter((unit) => unit.lado === zone.name && unit.ruma === row && unit.columna === col && unit.nivel > level && unit.type)
    .sort((left, right) => left.nivel - right.nivel)[0];
  if (aboveUnit) return aboveUnit.type;
  const aboveGhost = (ghosts || []).find((ghost) => ghost.zoneId === zone.id && ghost.row === row && ghost.col === col && ghost.level > level && ghost.typeCode);
  if (aboveGhost) return aboveGhost.typeCode;
  const anyUnit = (units || []).find((unit) => unit.lado === zone.name && unit.ruma === row && unit.columna === col && unit.type);
  return anyUnit?.type || "";
}

function faceTexture(color, label, hatch) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color || "#8a90a2";
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = "rgba(255,255,255,.35)";
  ctx.lineWidth = 10;
  ctx.strokeRect(16, 16, 480, 224);
  if (hatch) {
    ctx.strokeStyle = "rgba(28,36,51,.45)";
    ctx.lineWidth = 8;
    for (let x = -256; x < 512; x += 36) {
      ctx.beginPath();
      ctx.moveTo(x, 256);
      ctx.lineTo(x + 256, 0);
      ctx.stroke();
    }
  }
  ctx.fillStyle = hatch ? "#1c2433" : "#ffffff";
  ctx.font = label && label.length > 4 ? "700 54px sans-serif" : "700 72px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label || "", 256, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function groundLabel(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 64px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function buildYard(zones, units, ghosts, typeColor, options = {}) {
  const stackedUnits = (units || []).filter((unit) => unit.lado && !unit.onAisle && unit.lado !== "PASILLO");
  const held = (units || []).filter((unit) => unit.onAisle || unit.lado === "PASILLO");
  const root = new THREE.Group();
  const disposables = [];
  const maxCols = Math.max(...zones.map((zone) => Number(zone.cols) || 1), 1);
  const maxRows = Math.max(...zones.map((zone) => Number(zone.rows) || 1), 1);
  const blockX = maxCols * PITCH_X;
  const blockZ = maxRows * PITCH_Z;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  zones.forEach((zone) => {
    const originX = ((Number(zone.gridCol) || 1) - 1) * (blockX + AISLE);
    const originZ = ((Number(zone.gridRow) || 1) - 1) * (blockZ + AISLE);
    const padW = zone.cols * PITCH_X - 0.4;
    const padD = zone.rows * PITCH_Z - 0.3;
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(padW, padD),
      new THREE.MeshStandardMaterial({ color: "#2c3548", roughness: 0.95, metalness: 0 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(originX + padW / 2, 0.02, originZ + padD / 2);
    pad.receiveShadow = true;
    root.add(pad);
    const title = groundLabel(zone.name);
    title.position.set(originX + padW / 2, 0.04, originZ + padD - 1.2);
    root.add(title);
    disposables.push(pad.geometry, pad.material, title.geometry, title.material, title.material.map);
    minX = Math.min(minX, originX);
    maxX = Math.max(maxX, originX + padW);
    minZ = Math.min(minZ, originZ);
    maxZ = Math.max(maxZ, originZ + padD);

    for (let row = 1; row <= zone.rows; row += 1) {
      for (let col = 1; col <= zone.cols; col += 1) {
        let floor = 0.04;
        let offered = false;
        for (let level = 1; level <= zone.levels; level += 1) {
          const occupant = stackedUnits.find((unit) => unit.lado === zone.name && unit.ruma === row && unit.columna === col && unit.nivel === level);
          const ghost = (ghosts || []).find((item) => item.zoneId === zone.id && item.row === row && item.col === col && item.level === level);
          if (!occupant && !ghost) {
            if (options.targets && !offered && (level === 1 || floor > 0.2) && columnAllows(zone, row, col, level, options.incomingType, stackedUnits, ghosts)) {
              offered = true;
              const length = lengthOf(options.incomingType);
              const height = BOX_H * highOf(options.incomingType);
              const slotX = originX + (col - 1) * PITCH_X;
              const x = slotX + (PITCH_X - 0.7 - length) / 2 + length / 2;
              const z = originZ + (row - 1) * PITCH_Z + BOX_W / 2;
              const hint = new THREE.Mesh(
                new THREE.BoxGeometry(length, height * 0.35, BOX_W),
                new THREE.MeshStandardMaterial({ color: "#f0c14a", transparent: true, opacity: 0.35, roughness: 0.8 }),
              );
              hint.position.set(x, floor + height * 0.18, z);
              hint.userData.pick = {
                key: `slot-${zone.id}-${row}-${col}-${level}`,
                empty: true,
                zoneName: zone.name,
                row,
                col,
                level,
              };
              root.add(hint);
              disposables.push(hint.geometry, hint.material);
            }
            continue;
          }
          const named = Boolean(ghost?.code);
          const type = inheritedType(zone, row, col, level, occupant?.type || (named ? ghost.typeCode : ""), units, ghosts);
          const length = lengthOf(type);
          const height = BOX_H * highOf(type);
          const slotX = originX + (col - 1) * PITCH_X;
          const x = slotX + (PITCH_X - 0.7 - length) / 2 + length / 2;
          const z = originZ + (row - 1) * PITCH_Z + BOX_W / 2;
          const color = occupant ? (occupant.typeColor || "#8a90a2") : named ? (ghost.color || typeColor(ghost.typeCode)) : "#c5ccd6";
          const label = occupant ? occupant.iso.slice(-6) : named ? ghost.code.slice(-6) : "?";
          const texture = faceTexture(color, label, !occupant && !named);
          const geometry = new THREE.BoxGeometry(length, height, BOX_W);
          const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.62, metalness: 0.04 });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set(x, floor + height / 2, z);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData.pick = occupant
            ? {
              key: occupant.iso,
              code: occupant.iso,
              typeLabel: occupant.typeLabel || occupant.type,
              where: `${zone.name} · fila ${row} · columna ${col} · altura ${level}`,
              note: occupant.status || "",
            }
            : {
              key: `g-${zone.id}-${row}-${col}-${level}`,
              code: named ? ghost.code : "Ocupado sin identificar",
              typeLabel: named ? (ghost.typeCode || "Sin tipo") : "Pendiente",
              where: `${zone.name} · fila ${row} · columna ${col} · altura ${level}`,
              note: named
                ? [ghost.note, "Equipo en el patio, fuera del inventario dry."].filter(Boolean).join(". ")
                : "El espacio está ocupado. El equipo todavía no tiene código.",
              ghost: { zoneId: zone.id, row, col, level },
            };
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            new THREE.LineBasicMaterial({ color: "#121820" }),
          );
          mesh.add(edges);
          root.add(mesh);
          disposables.push(geometry, material, texture, edges.geometry, edges.material);
          floor += height;
        }
      }
    }
  });

  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 20;
    minZ = 0;
    maxZ = 12;
  }
  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(spanX + 28, spanZ + 28),
    new THREE.MeshStandardMaterial({ color: "#1a2230", roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  ground.receiveShadow = true;
  root.add(ground);
  disposables.push(ground.geometry, ground.material);

  const paintLane = (x, z, width, depth) => {
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshBasicMaterial({ color: "#d5deea" }),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, 0.012, z);
    root.add(line);
    disposables.push(line.geometry, line.material);
  };
  const gridRows = Math.max(...zones.map((zone) => Number(zone.gridRow) || 1));
  const gridCols = Math.max(...zones.map((zone) => Number(zone.gridCol) || 1));
  for (let gridRow = 1; gridRow <= gridRows; gridRow += 1) {
    for (let gridCol = 1; gridCol < gridCols; gridCol += 1) {
      const left = zones.find((zone) => Number(zone.gridCol) === gridCol && Number(zone.gridRow) === gridRow);
      const right = zones.find((zone) => Number(zone.gridCol) === gridCol + 1 && Number(zone.gridRow) === gridRow);
      if (!left || !right) continue;
      const x = gridCol * blockX + (gridCol - 1) * AISLE + AISLE / 2;
      const z = (gridRow - 1) * (blockZ + AISLE) + blockZ / 2;
      paintLane(x, z, 0.16, blockZ);
    }
  }
  for (let gridRow = 1; gridRow < gridRows; gridRow += 1) {
    const x = (minX + maxX) / 2;
    const z = gridRow * blockZ + (gridRow - 1) * AISLE + AISLE / 2;
    paintLane(x, z, spanX, 0.16);
  }

  held.forEach((unit, index) => {
    const length = lengthOf(unit.type);
    const height = BOX_H * highOf(unit.type);
    const texture = faceTexture(unit.typeColor || "#8a90a2", String(unit.iso || "").slice(-6), false);
    const geometry = new THREE.BoxGeometry(length, height, BOX_W);
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.62, metalness: 0.04 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(minX + length / 2 + index * (length + 1.1), 0.04 + height / 2, maxZ + 3.4);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.pick = {
      key: unit.iso,
      code: unit.iso,
      typeLabel: unit.typeLabel || unit.type,
      where: "Pasillo · en el suelo",
      note: "A la espera de un lugar.",
    };
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: "#121820" }));
    mesh.add(edges);
    root.add(mesh);
    disposables.push(geometry, material, texture, edges.geometry, edges.material);
  });

  const picks = [];
  root.traverse((node) => {
    if (node.userData.pick) picks.push(node.position);
  });
  const center = new THREE.Vector3();
  if (picks.length) {
    picks.forEach((position) => center.add(position));
    center.multiplyScalar(1 / picks.length);
  } else {
    center.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  }
  const radius = picks.length
    ? Math.max(...picks.map((position) => position.distanceTo(center)), 8)
    : Math.max(spanX, spanZ, 12) / 2;
  root.userData.center = center;
  root.userData.radius = radius;
  root.userData.disposables = disposables;
  return root;
}

export default function YardScene({ zones, units, ghosts, typeColor, onPick, picked, onClose, targets, incomingType, transferring, onTransfer, onPark, onRelease, history }) {
  const mountRef = useRef(null);
  const pickRef = useRef(onPick);
  const colorRef = useRef(typeColor);
  const viewRef = useRef(null);
  const yardRoot = useRef(null);
  const selectedRef = useRef("");
  const dataRef = useRef({ zones, units, ghosts, targets, incomingType });
  const [detailIso, setDetailIso] = useState("");
  pickRef.current = onPick;
  colorRef.current = typeColor;
  selectedRef.current = picked && !picked.empty ? (picked.key || "") : "";
  dataRef.current = { zones, units, ghosts, targets, incomingType };
  const yardKey = JSON.stringify({
    zones: (zones || []).map((zone) => [zone.id, zone.name, zone.rows, zone.cols, zone.levels, zone.gridRow, zone.gridCol]),
    units: (units || []).map((unit) => [unit.iso, unit.lado, unit.ruma, unit.columna, unit.nivel, unit.type, unit.onAisle]),
    ghosts: (ghosts || []).map((ghost) => [ghost.zoneId, ghost.row, ghost.col, ghost.level, ghost.code || "", ghost.typeCode || ""]),
    targets: Boolean(targets),
    incomingType: incomingType || "",
  });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight, false);
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#8ea0b5");
    scene.add(new THREE.HemisphereLight("#f4f7fb", "#1a2230", 1.05));
    const sun = new THREE.DirectionalLight("#ffffff", 1.35);
    sun.position.set(28, 46, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / Math.max(mount.clientHeight, 1), 0.1, 800);
    const view = { yaw: 0.55, pitch: 1.08, dist: 26, target: new THREE.Vector3(), mode: "overview" };
    let content = null;
    let booted = false;
    let idle = 0;

    const placeCamera = () => {
      const { yaw, pitch, dist, target } = view;
      camera.position.set(
        target.x + dist * Math.sin(pitch) * Math.sin(yaw),
        target.y + dist * Math.cos(pitch),
        target.z + dist * Math.sin(pitch) * Math.cos(yaw),
      );
      camera.lookAt(target);
      sun.position.set(target.x + 24, target.y + 40, target.z + 12);
      sun.target.position.copy(target);
      sun.target.updateMatrixWorld();
      const reach = Math.max(dist * 1.6, 30);
      sun.shadow.camera.left = -reach;
      sun.shadow.camera.right = reach;
      sun.shadow.camera.top = reach;
      sun.shadow.camera.bottom = -reach;
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = reach * 4;
      sun.shadow.camera.updateProjectionMatrix();
    };

    const fitOverviewDist = () => {
      const radius = Math.max(content?.userData.radius || 8, 8);
      const aspect = Math.max(camera.aspect || 1, 0.35);
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
      const dist = Math.max(radius / Math.tan(vFov / 2), radius / Math.tan(hFov / 2), 14);
      return dist * 1.35;
    };

    const frameOverview = () => {
      if (!content) return;
      view.mode = "overview";
      view.yaw = 0.55;
      view.pitch = 1.08;
      view.target.copy(content.userData.center);
      view.dist = fitOverviewDist();
      placeCamera();
    };

    const frameSelection = (key) => {
      if (!content || !key) return false;
      let mesh = null;
      content.traverse((node) => {
        if (!mesh && node.userData?.pick?.key === key) mesh = node;
      });
      if (!mesh) return false;
      const box = new THREE.Box3().setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      view.mode = "selection";
      view.target.copy(center);
      view.dist = Math.min(28, Math.max(size.length() * 2.2, 7));
      view.pitch = 1.02;
      placeCamera();
      return true;
    };

    const armIdle = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        if (selectedRef.current) return;
        frameOverview();
      }, 120000);
    };

    const rebuild = (mode) => {
      const first = !booted;
      booted = true;
      const prev = { yaw: view.yaw, pitch: view.pitch, dist: view.dist, target: view.target.clone() };
      if (content) {
        content.traverse((node) => {
          if (node.geometry) node.geometry.dispose?.();
        });
        (content.userData.disposables || []).forEach((item) => item?.dispose?.());
        scene.remove(content);
      }
      const data = dataRef.current;
      content = buildYard(data.zones, data.units, data.ghosts, colorRef.current, { targets: data.targets, incomingType: data.incomingType });
      yardRoot.current = content;
      scene.add(content);
      const next = first || mode === "overview" ? "overview" : mode;
      if (next === "overview") frameOverview();
      else {
        view.yaw = prev.yaw;
        view.pitch = prev.pitch;
        view.dist = prev.dist;
        view.target.copy(prev.target);
        if (next === "selection" && selectedRef.current) frameSelection(selectedRef.current);
        else placeCamera();
      }
    };

    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const glow = 0.55 + Math.sin(performance.now() / 180) * 0.4;
      yardRoot.current?.traverse((node) => {
        if (!node.isMesh || !node.userData.pick || !node.material?.emissive) return;
        const on = node.userData.pick.key === selectedRef.current;
        node.material.emissive.set(on ? 0xffc107 : 0x000000);
        node.material.emissiveIntensity = on ? glow : 0;
      });
      renderer.render(scene, camera);
    };
    loop();

    const resize = () => {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (view.mode === "overview") frameOverview();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const pointers = new Map();
    const drag = { x: 0, y: 0, moved: false };
    let pinch = 0;
    const onDown = (event) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (pointers.size === 1) drag.moved = false;
      armIdle();
    };
    const onMove = (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      armIdle();
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) {
          view.dist = Math.min(160, Math.max(6, view.dist * (pinch / Math.max(dist, 1))));
          placeCamera();
        }
        pinch = dist;
        drag.moved = true;
        view.mode = "free";
        return;
      }
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      drag.x = event.clientX;
      drag.y = event.clientY;
      view.mode = "free";
      view.yaw -= dx * 0.008;
      view.pitch = Math.min(1.25, Math.max(0.35, view.pitch - dy * 0.005));
      placeCamera();
    };
    const onUp = (event) => {
      pointers.delete(event.pointerId);
      pinch = 0;
      if (pointers.size) return;
      const moved = drag.moved;
      drag.moved = false;
      if (moved || !content) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(content.children, true).find((item) => item.object.userData.pick || item.object.parent?.userData?.pick);
      const pick = hit?.object.userData.pick || hit?.object.parent?.userData?.pick;
      if (pick) pickRef.current?.(pick);
    };
    const onWheel = (event) => {
      event.preventDefault();
      armIdle();
      view.mode = "free";
      view.dist = Math.min(160, Math.max(6, view.dist * (event.deltaY > 0 ? 1.08 : 0.92)));
      placeCamera();
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    armIdle();

    viewRef.current = {
      closer: () => { armIdle(); view.mode = "free"; view.dist = Math.max(6, view.dist * 0.82); placeCamera(); },
      farther: () => { armIdle(); view.mode = "free"; view.dist = Math.min(160, view.dist * 1.18); placeCamera(); },
      reset: () => { armIdle(); frameOverview(); },
      rebuild,
      frameSelection,
      armIdle,
    };

    return () => {
      window.clearTimeout(idle);
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      if (content) (content.userData.disposables || []).forEach((item) => item?.dispose?.());
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    viewRef.current?.rebuild(selectedRef.current ? "selection" : "keep");
  }, [yardKey]);

  const focusKey = picked && !picked.empty ? (picked.key || "") : "";
  useEffect(() => {
    if (focusKey) {
      viewRef.current?.frameSelection(focusKey);
      return;
    }
    viewRef.current?.armIdle();
  }, [focusKey]);

  const detailCode = picked && !picked.unknown && !picked.empty
    ? (units || []).find((unit) => unit.iso === (picked.code || picked.key))?.iso
    : "";

  return (
    <div className="yard-scene">
      <div className="yard-scene-tools">
        <span>Arrastra para girar. Pellizca o usa los botones para acercar. Un 40 pies mide el doble que un 20.</span>
        <button className="btn-ghost yard-reset-view" type="button" onClick={() => viewRef.current?.reset()}>Vista general</button>
      </div>
      <div className={`yard-viewport${picked ? " has-pick" : ""}`} ref={mountRef}>
        {picked ? (
          <aside className="yard-float" role="dialog" aria-label="Equipo seleccionado">
            <div className="yard-float-head">
              <div>
                <b>{picked.title || picked.code}</b>
                <div>{picked.unknown ? "Desconocido" : picked.typeLabel}</div>
              </div>
              <button type="button" aria-label="Cerrar" onClick={onClose}>×</button>
            </div>
            <p>{picked.where}</p>
            <p>{picked.access}</p>
            <p>{picked.cost}</p>
            {picked.unknown ? <p>Este hueco no está en el catálogo.</p> : <p className="yard-float-note">Esa referencia de movimientos queda en el catálogo comercial.</p>}
            <div className="yard-float-actions">
              {detailCode ? (
                <button className="btn-primary" type="button" onClick={() => setDetailIso(detailCode)}>Más información</button>
              ) : null}
              {!picked.unknown && !picked.empty && onTransfer ? (
                <button className="btn-primary" type="button" onClick={onTransfer}>{transferring ? "Destino" : "Trasladar"}</button>
              ) : null}
              {transferring ? <button className="btn-ghost" type="button" onClick={onPark}>Pasillo</button> : null}
              {transferring ? <button className="btn-ghost" type="button" onClick={onRelease}>Devolver</button> : null}
            </div>
            {transferring ? <p>Elige un cuadro amarillo libre. Un 40 no puede apoyarse en un 20.</p> : null}
            {history?.length ? (
              <ul className="yard-history">
                {history.slice(0, 6).map((row) => <li key={row.id}>{row.detail}</li>)}
              </ul>
            ) : null}
          </aside>
        ) : null}
        <div className="yard-zoom">
          <button type="button" aria-label="Acercar" onClick={() => viewRef.current?.closer()}>+</button>
          <button type="button" aria-label="Alejar" onClick={() => viewRef.current?.farther()}>−</button>
        </div>
      </div>
      {detailIso ? <YardUnitDetail iso={detailIso} onClose={() => setDetailIso("")} /> : null}
    </div>
  );
}
