import { useEffect, useRef } from "react";
import * as THREE from "three";

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
  return 1;
}

function highOf(type) {
  return /HC|HQ|45/.test(String(type || "")) ? 2.9 / 2.59 : 1;
}

function lengthOf(type) {
  return TEU * spanOf(type);
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

function buildYard(zones, units, ghosts, typeColor) {
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
        for (let level = 1; level <= zone.levels; level += 1) {
          const occupant = (units || []).find((unit) => unit.lado === zone.name && unit.ruma === row && unit.columna === col && unit.nivel === level);
          const ghost = (ghosts || []).find((item) => item.zoneId === zone.id && item.row === row && item.col === col && item.level === level);
          if (!occupant && !ghost) continue;
          const named = Boolean(ghost?.code);
          const type = inheritedType(zone, row, col, level, occupant?.type || (named ? ghost.typeCode : ""), units, ghosts);
          const length = lengthOf(type);
          const height = BOX_H * highOf(type);
          const slotX = originX + (col - 1) * PITCH_X;
          const x = slotX + (PITCH_X - 0.7 - length) / 2 + length / 2;
          const z = originZ + (row - 1) * PITCH_Z + BOX_W / 2;
          const color = occupant ? (occupant.typeColor || "#8a90a2") : named ? typeColor(ghost.typeCode) : "#c5ccd6";
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
                ? "Equipo en el patio, fuera del inventario dry."
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

export default function YardScene({ zones, units, ghosts, typeColor, onPick, picked, onClose }) {
  const mountRef = useRef(null);
  const pickRef = useRef(onPick);
  const colorRef = useRef(typeColor);
  const viewRef = useRef(null);
  const yardRoot = useRef(null);
  const selectedRef = useRef("");
  pickRef.current = onPick;
  colorRef.current = typeColor;
  selectedRef.current = picked?.key || "";

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
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
    const view = { yaw: 0.55, pitch: 1.08, dist: 26, target: new THREE.Vector3() };
    viewRef.current = view;

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

    let content = null;
    const show = () => {
      if (content) {
        content.traverse((node) => {
          if (node.geometry) node.geometry.dispose?.();
        });
        (content.userData.disposables || []).forEach((item) => item?.dispose?.());
        scene.remove(content);
      }
      content = buildYard(zones, units, ghosts, colorRef.current);
      yardRoot.current = content;
      scene.add(content);
      view.target.copy(content.userData.center);
      view.dist = Math.max(content.userData.radius * 2.4, 16);
      placeCamera();
    };
    show();

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
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const drag = { active: false, x: 0, y: 0, moved: false };
    const onDown = (event) => {
      drag.active = true;
      drag.x = event.clientX;
      drag.y = event.clientY;
      drag.moved = false;
    };
    const onMove = (event) => {
      if (!drag.active) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      drag.x = event.clientX;
      drag.y = event.clientY;
      view.yaw -= dx * 0.008;
      view.pitch = Math.min(1.25, Math.max(0.35, view.pitch - dy * 0.005));
      placeCamera();
    };
    const onUp = (event) => {
      const moved = drag.moved;
      drag.active = false;
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
      view.dist = Math.min(160, Math.max(12, view.dist * (event.deltaY > 0 ? 1.08 : 0.92)));
      placeCamera();
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    viewRef.current = {
      closer: () => { view.dist = Math.max(12, view.dist * 0.82); placeCamera(); },
      farther: () => { view.dist = Math.min(160, view.dist * 1.18); placeCamera(); },
      reset: () => { view.yaw = 0.55; view.pitch = 1.08; show(); },
    };

    return () => {
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
  }, [zones, units, ghosts]);

  return (
    <div className="yard-scene">
      <div className="yard-scene-tools">
        <span>Arrastra para girar. La rueda y los botones acercan. Un 40 pies mide el doble que un 20, y el desconocido de abajo copia ese largo.</span>
        <button className="btn-ghost" type="button" onClick={() => viewRef.current?.reset()}>Restablecer vista</button>
      </div>
      <div className="yard-viewport" ref={mountRef}>
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
            {picked.unknown ? <p>Este hueco no está en el catálogo.</p> : <p>Esa referencia de movimientos queda en el catálogo comercial.</p>}
          </aside>
        ) : null}
        <div className="yard-zoom">
          <button type="button" aria-label="Acercar" onClick={() => viewRef.current?.closer()}>+</button>
          <button type="button" aria-label="Alejar" onClick={() => viewRef.current?.farther()}>−</button>
        </div>
      </div>
    </div>
  );
}
