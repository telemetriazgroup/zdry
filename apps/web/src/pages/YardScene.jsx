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

function baySpan(type, half) {
  const feet = feetOf(type);
  if (feet >= 40) return "full";
  if (half === "A" || half === "B") return half;
  if (feet > 0) return "center";
  return "full";
}

function coversHalf(item, half) {
  const span = baySpan(item.type || item.typeCode, item.half ?? item.bayHalf);
  return span === "full" || span === half;
}

function columnAllows(zone, row, col, level, incomingType, units, ghosts, half) {
  const incoming = feetOf(incomingType);
  if (incoming <= 0) return true;
  const span = baySpan(incomingType, half);
  for (let cursor = level - 1; cursor >= 1; cursor -= 1) {
    const items = [
      ...(units || [])
        .filter((item) => item.lado === zone.name && item.ruma === row && item.columna === col && item.nivel === cursor)
        .map((item) => ({ type: item.type, half: item.bayHalf })),
      ...(ghosts || [])
        .filter((item) => item.zoneId === zone.id && item.row === row && item.col === col && item.level === cursor)
        .map((item) => ({ type: item.typeCode, half: item.half })),
    ];
    const typed = (side) => {
      const found = items.filter((item) => coversHalf(item, side) && feetOf(item.type) > 0);
      return found.length ? Math.max(...found.map((item) => feetOf(item.type))) : null;
    };
    const feetA = typed("A");
    const feetB = typed("B");
    const centered = items.filter((item) => baySpan(item.type, item.half) === "center" && feetOf(item.type) > 0);
    const centerFeet = centered.length ? Math.max(...centered.map((item) => feetOf(item.type))) : null;
    if (span === "center") {
      const pair = feetA != null && feetB != null && feetA >= incoming && feetB >= incoming;
      const onCenter = centerFeet != null && centerFeet >= incoming;
      const onFull = items.some((item) => baySpan(item.type, item.half) === "full" && feetOf(item.type) >= incoming);
      if (!pair && !onCenter && !onFull && (feetA != null || feetB != null || centerFeet != null)) return false;
    }
    if ((span === "full" || span === "center") && centerFeet != null && incoming > centerFeet) return false;
    if ((span === "A" || span === "B") && centerFeet != null && (span === "A" ? feetA : feetB) == null) return false;
    if (span === "full" && feetA != null && feetB != null && feetA >= 20 && feetB >= 20 && incoming <= 40) continue;
    const sides = span === "full" ? ["A", "B"] : [span];
    for (const side of sides) {
      const feet = side === "A" ? feetA : feetB;
      if (feet != null && incoming > feet) return false;
    }
  }
  return true;
}

function inheritedType(zone, row, col, level, ownType, units, ghosts, half) {
  if (ownType) return ownType;
  const sameSide = (item) => !half || coversHalf(item, half);
  const aboveUnit = (units || [])
    .filter((unit) => unit.lado === zone.name && unit.ruma === row && unit.columna === col && unit.nivel > level && unit.type && sameSide({ type: unit.type, half: unit.bayHalf }))
    .sort((left, right) => left.nivel - right.nivel)[0];
  if (aboveUnit) return aboveUnit.type;
  const aboveGhost = (ghosts || []).find((ghost) => ghost.zoneId === zone.id && ghost.row === row && ghost.col === col && ghost.level > level && ghost.typeCode && sameSide({ type: ghost.typeCode, half: ghost.half }));
  if (aboveGhost) return aboveGhost.typeCode;
  const anyUnit = (units || []).find((unit) => unit.lado === zone.name && unit.ruma === row && unit.columna === col && unit.type && sameSide({ type: unit.type, half: unit.bayHalf }));
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

function walkPerimeter(sides) {
  const points = [{ x: 0, z: 0 }];
  let x = 0;
  let z = 0;
  let heading = 0;
  sides.forEach((side) => {
    const length = Number(side.lengthM) || 0;
    x += Math.cos(heading) * length;
    z += Math.sin(heading) * length;
    points.push({ x, z });
    heading += ((Number(side.turnDeg) || 0) * Math.PI) / 180;
  });
  return points;
}

function pointAlong(a, b, meters, length) {
  const f = length ? meters / length : 0;
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
}

function addRun(root, disposables, from, to, height, thick, color, y) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.2) return;
  const geometry = new THREE.BoxGeometry(len, height, thick);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.04 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set((from.x + to.x) / 2, y + height / 2, (from.z + to.z) / 2);
  mesh.rotation.y = -Math.atan2(dz, dx);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  disposables.push(geometry, material);
}

function addFenceBox(root, disposables, from, to, unit, pick) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.2) return;
  const height = unit ? 2.59 : 0.28;
  const texture = faceTexture(unit?.typeColor || "#8ea0b5", unit ? String(unit.iso).slice(-6) : "LIBRE", !unit);
  const geometry = new THREE.BoxGeometry(len, height, 2.44);
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.62, metalness: 0.04 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set((from.x + to.x) / 2, (pick.level - 1) * 2.59 + height / 2, (from.z + to.z) / 2);
  mesh.rotation.y = -Math.atan2(dz, dx);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (unit) mesh.userData.pick = pick;
  root.add(mesh);
  disposables.push(geometry, material, texture);
}

function addFenceTarget(root, disposables, from, to, level, pick) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.2) return;
  const height = 2.59;
  const geometry = new THREE.BoxGeometry(len, height, 2.44);
  const material = new THREE.MeshBasicMaterial({ color: "#f0c14a", transparent: true, opacity: 0.9 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set((from.x + to.x) / 2, (level - 1) * 2.59 + height / 2, (from.z + to.z) / 2);
  mesh.rotation.y = -Math.atan2(dz, dx);
  mesh.userData.pick = pick;
  root.add(mesh);
  disposables.push(geometry, material);
}

function fenceLevelCells(perimeter, sideId, slot, level) {
  return (perimeter?.cells || []).filter((item) => item.sideId === sideId && Number(item.slot) === slot && Number(item.level) === level);
}

function fenceHalfOpen(cells, half) {
  const others = cells || [];
  if (!half) return !others.length;
  return !others.some((cell) => !cell.half || cell.half === half);
}

function fenceHalfSupported(perimeter, side, slot, level, half, movingIso) {
  if (level <= 1) return true;
  const below = fenceLevelCells(perimeter, side.id, slot, level - 1).filter((cell) => cell.iso !== movingIso);
  if (!half) {
    return below.some((cell) => !cell.half) || (below.some((cell) => cell.half === "A") && below.some((cell) => cell.half === "B"));
  }
  return below.some((cell) => !cell.half || cell.half === half);
}

function fenceOpenLevel(perimeter, side, slot, half, movingIso) {
  const levels = Math.min(3, Math.max(1, Number(side.levels) || 1));
  for (let level = 1; level <= levels; level += 1) {
    if (!fenceHalfOpen(fenceLevelCells(perimeter, side.id, slot, level), half, movingIso)) continue;
    if (!fenceHalfSupported(perimeter, side, slot, level, half, movingIso)) return 0;
    return level;
  }
  return 0;
}

function shiftInside(from, to, amount) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const ox = (-dz / len) * amount;
  const oz = (dx / len) * amount;
  return {
    from: { x: from.x + ox, z: from.z + oz },
    to: { x: to.x + ox, z: to.z + oz },
  };
}

function addPerimeter(root, disposables, perimeter, bounds, units = [], options = {}) {
  const sides = perimeter?.sides || [];
  if (sides.length < 3) return;
  const raw = walkPerimeter(sides);
  const xs = raw.map((point) => point.x);
  const zs = raw.map((point) => point.z);
  const shiftX = (bounds.minX + bounds.maxX) / 2 - (Math.min(...xs) + Math.max(...xs)) / 2;
  const shiftZ = (bounds.minZ + bounds.maxZ) / 2 - (Math.min(...zs) + Math.max(...zs)) / 2;
  const points = raw.map((point) => ({ x: point.x + shiftX, z: point.z + shiftZ }));
  points.forEach((point) => {
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.minZ = Math.min(bounds.minZ, point.z);
    bounds.maxZ = Math.max(bounds.maxZ, point.z);
  });
  sides.forEach((side, index) => {
    const from = points[index];
    const to = points[index + 1];
    const length = Number(side.lengthM) || 0;
    const feet = Number(side.containerFeet) === 20 ? 6.1 : 12.2;
    const wallUntil = side.kind === "pared" ? length : side.kind === "mixto" ? Math.min(Number(side.wallM) || 0, length) : 0;
    const cuts = (perimeter.gates || [])
      .filter((gate) => gate.sideId === side.id)
      .map((gate) => ({ from: Number(gate.atM) || 0, to: (Number(gate.atM) || 0) + (Number(gate.widthM) || 0), name: gate.name }))
      .filter((gate) => gate.to > gate.from && gate.from < length)
      .sort((a, b) => a.from - b.from);
    const spans = [];
    let cursor = 0;
    cuts.forEach((cut) => {
      const start = Math.max(0, Math.min(length, cut.from));
      const end = Math.max(start, Math.min(length, cut.to));
      if (start > cursor) spans.push({ from: cursor, to: start });
      spans.push({ from: start, to: end, gate: cut.name || "Entrada" });
      cursor = end;
    });
    if (cursor < length) spans.push({ from: cursor, to: length });
    spans.forEach((span) => {
      const a = pointAlong(from, to, span.from, length);
      const b = pointAlong(from, to, span.to, length);
      if (span.gate) {
        addRun(root, disposables, a, b, 0.08, 6, "#6b7280", 0.02);
        const label = groundLabel(span.gate);
        label.position.set((a.x + b.x) / 2, 0.06, (a.z + b.z) / 2);
        root.add(label);
        disposables.push(label.geometry, label.material, label.material.map);
        return;
      }
      let at = span.from;
      while (at < span.to - 0.2) {
        const remain = span.to - at;
        const container = at >= wallUntil;
        const step = container ? Math.min(feet, remain) : Math.min(remain, wallUntil - at || remain);
        const next = at + Math.max(step, 0.2);
        const pieceFrom = pointAlong(from, to, at, length);
        const pieceTo = pointAlong(from, to, Math.min(next, span.to), length);
        if (container && remain + 0.05 >= feet) {
          const slot = Math.floor((at - wallUntil + 0.05) / feet) + 1;
          const end = pointAlong(from, to, at + feet, length);
          if ((side.wallSlots || []).includes(slot)) {
            addRun(root, disposables, pieceFrom, end, 3.2, 0.35, "#d5d8de", 0);
          } else {
            const levels = Math.min(3, Math.max(1, Number(side.levels) || 1));
            const incomingFeet = feetOf(options.incomingType);
            const wide = Number(side.containerFeet) !== 20;
            const drawSpan = (fromM, toM, unit, pick) => {
              const start = pointAlong(from, to, fromM, length);
              const finish = pointAlong(from, to, toM, length);
              const shifted = shiftInside(start, finish, 1.6);
              if (pick.empty) addFenceTarget(root, disposables, shifted.from, shifted.to, pick.level, pick);
              else addFenceBox(root, disposables, shifted.from, shifted.to, unit, pick);
            };
            const whereOf = (level, half) => `Cerco · ${side.name} · puesto ${slot} · nivel ${level}${half ? ` · mitad ${half}` : ""}`;
            for (let level = 1; level <= levels; level += 1) {
              const here = fenceLevelCells(perimeter, side.id, slot, level);
              const fullCell = here.find((cell) => !cell.half);
              if (fullCell) {
                const unit = units.find((item) => item.iso === fullCell.iso);
                if (unit) {
                  drawSpan(at, at + feet, unit, {
                    key: unit.iso,
                    code: unit.iso,
                    typeLabel: unit.typeLabel || unit.type || "Puesto de cerco",
                    where: whereOf(level, ""),
                    note: unit.status || "En el cerco",
                    level,
                  });
                }
                continue;
              }
              const fullTarget = options.targets && incomingFeet === 40 && wide && fenceOpenLevel(perimeter, side, slot, "", options.movingIso) === level;
              if (fullTarget) {
                drawSpan(at, at + feet, null, {
                  key: `fence-${side.id}-${slot}-${level}`,
                  empty: true,
                  fence: true,
                  sideId: side.id,
                  slot,
                  level,
                  code: "Cerco libre",
                  typeLabel: "40 pies",
                  where: whereOf(level, ""),
                  note: "Puesto de 40 pies libre. También caben dos de 20.",
                });
                continue;
              }
              const parts = wide ? ["A", "B"] : [""];
              parts.forEach((half, index) => {
                const piece = feet / parts.length;
                const fromM = at + index * piece;
                const cell = here.find((item) => (item.half || "") === half);
                const unit = cell ? units.find((item) => item.iso === cell.iso) : null;
                const halfTarget = options.targets && incomingFeet === 20 && (wide || Number(side.containerFeet) === 20) && fenceOpenLevel(perimeter, side, slot, wide ? half : "", options.movingIso) === level;
                if (unit) {
                  drawSpan(fromM, fromM + piece, unit, {
                    key: unit.iso,
                    code: unit.iso,
                    typeLabel: unit.typeLabel || unit.type || "Puesto de cerco",
                    where: whereOf(level, half),
                    note: unit.status || "En el cerco",
                    level,
                    half: half || undefined,
                  });
                  return;
                }
                if (halfTarget) {
                  drawSpan(fromM, fromM + piece, null, {
                    key: `fence-${side.id}-${slot}-${level}-${half || "F"}`,
                    empty: true,
                    fence: true,
                    sideId: side.id,
                    slot,
                    level,
                    half: wide ? half : undefined,
                    code: "Cerco libre",
                    typeLabel: wide ? `20 pies · mitad ${half}` : "20 pies",
                    where: whereOf(level, half),
                    note: wide ? "Mitad libre de un puesto de 40 pies." : "Puesto libre del cerco.",
                  });
                  return;
                }
                if (level === 1 && index === 0 && !here.length) {
                  addFenceBox(root, disposables, pieceFrom, end, null, {
                    key: "",
                    code: "Cerco libre",
                    typeLabel: "Puesto de cerco",
                    where: whereOf(level, ""),
                    note: "Puesto libre.",
                    level,
                  });
                }
              });
            }
          }
          at += feet;
        } else if (container) {
          addRun(root, disposables, pieceFrom, pointAlong(from, to, span.to, length), 2.4, 0.35, "#d5d8de", 0);
          at = span.to;
        } else {
          addRun(root, disposables, pieceFrom, pieceTo, 3.2, 0.35, "#d5d8de", 0);
          at = next;
        }
      }
    });
  });
  return { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ };
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
    const originX = Number.isFinite(Number(zone.xM)) ? Number(zone.xM) : ((Number(zone.gridCol) || 1) - 1) * (blockX + AISLE);
    const originZ = Number.isFinite(Number(zone.zM)) ? Number(zone.zM) : ((Number(zone.gridRow) || 1) - 1) * (blockZ + AISLE);
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
    if (zone.closedSide) {
      const thick = 0.45;
      const height = 3.2;
      const alongRows = zone.closedSide === "frente" || zone.closedSide === "fondo";
      const width = alongRows ? padW : thick;
      const depth = alongRows ? thick : padD;
      const x = zone.closedSide === "derecha" ? originX + padW - thick / 2 : zone.closedSide === "izquierda" ? originX + thick / 2 : originX + padW / 2;
      const z = zone.closedSide === "fondo" ? originZ + padD - thick / 2 : zone.closedSide === "frente" ? originZ + thick / 2 : originZ + padD / 2;
      const wallGeometry = new THREE.BoxGeometry(width, height, depth);
      const wallMaterial = new THREE.MeshStandardMaterial({ color: "#5c6570", roughness: 0.9, metalness: 0.02 });
      const wall = new THREE.Mesh(wallGeometry, wallMaterial);
      wall.position.set(x, height / 2, z);
      wall.castShadow = true;
      root.add(wall);
      const closedLabel = groundLabel("Sin acceso");
      closedLabel.position.set(x, 0.05, z);
      root.add(closedLabel);
      disposables.push(wallGeometry, wallMaterial, closedLabel.geometry, closedLabel.material, closedLabel.material.map);
    }
    minX = Math.min(minX, originX);
    maxX = Math.max(maxX, originX + padW);
    minZ = Math.min(minZ, originZ);
    maxZ = Math.max(maxZ, originZ + padD);

    for (let row = 1; row <= zone.rows; row += 1) {
      for (let col = 1; col <= zone.cols; col += 1) {
        let floorA = 0.04;
        let floorB = 0.04;
        const offered = { A: false, B: false, full: false, center: false };
        const slotX = originX + (col - 1) * PITCH_X;
        const usable = PITCH_X - 0.7;
        const z = originZ + (row - 1) * PITCH_Z + BOX_W / 2;
        const xFor = (span, length) => {
          if (span === "A") return slotX + length / 2;
          if (span === "B") return slotX + usable - length / 2;
          return slotX + (usable - length) / 2 + length / 2;
        };
        for (let level = 1; level <= zone.levels; level += 1) {
          const occupants = stackedUnits.filter((unit) => unit.lado === zone.name && unit.ruma === row && unit.columna === col && unit.nivel === level);
          const marked = (ghosts || []).filter((item) => item.zoneId === zone.id && item.row === row && item.col === col && item.level === level);
          const wide = (item, type, half) => {
            const span = baySpan(type, half);
            return span === "full" || span === "center" ? span : "";
          };
          const wideUnit = occupants.find((unit) => wide(unit, unit.type, unit.bayHalf));
          const wideGhost = marked.find((item) => wide(item, item.typeCode, item.half));
          const wideSpan = wideUnit ? wide(wideUnit, wideUnit.type, wideUnit.bayHalf) : wideGhost ? wide(wideGhost, wideGhost.typeCode, wideGhost.half) : "";
          const pieces = wideSpan
            ? [{ span: wideSpan, occupant: wideUnit || null, ghost: wideUnit ? null : wideGhost }]
            : ["A", "B"].map((span) => ({
              span,
              occupant: occupants.find((unit) => baySpan(unit.type, unit.bayHalf) === span) || null,
              ghost: marked.find((item) => baySpan(item.typeCode, item.half) === span) || null,
            })).filter((piece) => piece.occupant || piece.ghost);
          if (options.targets) {
            const incomingSpan = baySpan(options.incomingType, null);
            const free = wideSpan ? [] : ["A", "B"].filter((span) => !pieces.some((piece) => piece.span === span));
            const hints = incomingSpan === "full" ? (free.length === 2 ? ["full"] : []) : free.length === 2 ? ["A", "center", "B"] : free;
            hints.forEach((span) => {
              const floor = span === "B" ? floorB : span === "A" ? floorA : Math.max(floorA, floorB);
              if (offered[span]) return;
              if (!columnAllows(zone, row, col, level, options.incomingType, stackedUnits, ghosts, span === "A" || span === "B" ? span : span === "center" ? "center" : null)) return;
                offered[span] = true;
                const trio = hints.includes("center");
                const length = span === "A" || span === "B"
                  ? (trio ? usable * 0.28 : Math.min(lengthOf(options.incomingType), usable / 2 - 0.15))
                  : span === "center"
                    ? usable * 0.28
                    : lengthOf(options.incomingType);
                const height = BOX_H * highOf(options.incomingType);
                const hint = new THREE.Mesh(
                  new THREE.BoxGeometry(length, height * 0.35, BOX_W),
                  new THREE.MeshStandardMaterial({ color: "#f0c14a", transparent: true, opacity: 0.35, roughness: 0.8 }),
                );
                hint.position.set(xFor(span, length), floor + height * 0.18, z);
                hint.userData.pick = {
                  key: `slot-${zone.id}-${row}-${col}-${level}-${span}`,
                  empty: true,
                  zoneName: zone.name,
                  row,
                  col,
                  level,
                  ...(span === "A" || span === "B" || span === "center" ? { half: span } : {}),
                };
                root.add(hint);
                disposables.push(hint.geometry, hint.material);
            });
          }
          if (!pieces.length) continue;
          pieces.forEach((piece) => {
            const occupant = piece.occupant;
            const ghost = piece.ghost;
            const named = Boolean(ghost?.code);
            const ownType = occupant?.type || (named ? ghost.typeCode : "");
            const type = inheritedType(zone, row, col, level, ownType, units, ghosts, piece.span === "full" ? "" : piece.span);
            const natural = !occupant && ghost && !named && piece.span === "full"
              ? lengthOf("40")
              : lengthOf(type || (piece.span === "full" ? "40" : "20"));
            const length = piece.span === "A" || piece.span === "B" ? Math.min(natural, usable / 2 - 0.15) : natural;
            const height = BOX_H * highOf(type);
            const floor = piece.span === "B" ? floorB : piece.span === "A" ? floorA : Math.max(floorA, floorB);
            const color = occupant ? (occupant.typeColor || "#8a90a2") : named ? (ghost.color || typeColor(ghost.typeCode)) : "#c5ccd6";
            const label = occupant ? occupant.iso.slice(-6) : named ? ghost.code.slice(-6) : "?";
            const texture = faceTexture(color, label, !occupant && !named);
            const geometry = new THREE.BoxGeometry(length, height, BOX_W);
            const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.62, metalness: 0.04 });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(xFor(piece.span, length), floor + height / 2, z);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            const side = piece.span === "A" || piece.span === "B" ? ` · mitad ${piece.span}` : piece.span === "center" ? " · al centro" : "";
            mesh.userData.pick = occupant
              ? {
                key: occupant.iso,
                code: occupant.iso,
                typeLabel: occupant.typeLabel || occupant.type,
                where: `${zone.name} · fila ${row} · columna ${col} · altura ${level}${side}`,
                note: occupant.status || "",
              }
              : {
                key: `g-${zone.id}-${row}-${col}-${level}-${ghost.half || "F"}`,
                code: named ? ghost.code : "Ocupado sin identificar",
                typeLabel: named ? (ghost.typeCode || "Sin tipo") : "Pendiente",
                where: `${zone.name} · fila ${row} · columna ${col} · altura ${level}${side}`,
                note: named
                  ? [ghost.note, "Equipo en el patio, fuera del inventario dry."].filter(Boolean).join(". ")
                  : "El espacio está ocupado. El equipo todavía no tiene código.",
                splittable: !named && !ghost.half,
                ghost: { zoneId: zone.id, row, col, level, ...(ghost.half ? { half: ghost.half } : {}) },
              };
            const edges = new THREE.LineSegments(
              new THREE.EdgesGeometry(geometry),
              new THREE.LineBasicMaterial({ color: "#121820" }),
            );
            mesh.add(edges);
            root.add(mesh);
            disposables.push(geometry, material, texture, edges.geometry, edges.material);
            const top = floor + height;
            if (piece.span === "A") floorA = top;
            else if (piece.span === "B") floorB = top;
            else {
              floorA = top;
              floorB = top;
            }
          });
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

  const fenceBounds = addPerimeter(root, disposables, options.perimeter, { minX, maxX, minZ, maxZ }, units, options);

  const picks = [];
  root.traverse((node) => {
    if (node.userData.pick) picks.push(node.position);
  });
  const framed = (options.perimeter?.sides || []).length >= 3;
  const center = new THREE.Vector3();
  if (framed) {
    center.set((fenceBounds.minX + fenceBounds.maxX) / 2, 0, (fenceBounds.minZ + fenceBounds.maxZ) / 2);
  } else if (picks.length) {
    picks.forEach((position) => center.add(position));
    center.multiplyScalar(1 / picks.length);
  } else {
    center.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  }
  const radius = framed
    ? Math.max(Math.hypot(fenceBounds.maxX - fenceBounds.minX, fenceBounds.maxZ - fenceBounds.minZ) / 2, 12)
    : picks.length
      ? Math.max(...picks.map((position) => position.distanceTo(center)), 8)
      : Math.max(spanX, spanZ, 12) / 2;
  root.userData.center = center;
  root.userData.radius = radius;
  root.userData.disposables = disposables;
  return root;
}

export default function YardScene({ zones, units, ghosts, perimeter, typeColor, onPick, picked, onClose, targets, incomingType, movingIso, transferring, onTransfer, onSlide, onSplit, onContextMenu, onPark, onRelease, history, fenceHint }) {
  const mountRef = useRef(null);
  const pickRef = useRef(onPick);
  const menuRef = useRef(onContextMenu);
  const colorRef = useRef(typeColor);
  const viewRef = useRef(null);
  const yardRoot = useRef(null);
  const selectedRef = useRef("");
  const dataRef = useRef({ zones, units, ghosts, targets, incomingType });
  const [detailIso, setDetailIso] = useState("");
  pickRef.current = onPick;
  menuRef.current = onContextMenu;
  colorRef.current = typeColor;
  selectedRef.current = picked && !picked.empty ? (picked.key || "") : "";
  dataRef.current = { zones, units, ghosts, targets, incomingType, perimeter, movingIso };
  const yardKey = JSON.stringify({
    zones: (zones || []).map((zone) => [zone.id, zone.name, zone.rows, zone.cols, zone.levels, zone.gridRow, zone.gridCol, zone.xM || 0, zone.zM || 0, zone.closedSide || ""]),
    units: (units || []).map((unit) => [unit.iso, unit.lado, unit.ruma, unit.columna, unit.nivel, unit.type, unit.onAisle, unit.bayHalf || ""]),
    ghosts: (ghosts || []).map((ghost) => [ghost.zoneId, ghost.row, ghost.col, ghost.level, ghost.code || "", ghost.typeCode || "", ghost.half || ""]),
    perimeter: (perimeter?.sides || []).map((side) => [side.id, side.name, side.lengthM, side.turnDeg, side.kind, side.containerFeet, side.wallM, side.levels, side.wallSlots || [], ...(perimeter.gates || []).filter((gate) => gate.sideId === side.id).map((gate) => [gate.atM, gate.widthM])]),
    cells: (perimeter?.cells || []).map((cell) => [cell.sideId, cell.slot, cell.level, cell.iso, cell.half || ""]),
    targets: Boolean(targets),
    incomingType: incomingType || "",
    movingIso: movingIso || "",
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
      content = buildYard(data.zones, data.units, data.ghosts, colorRef.current, { targets: data.targets, incomingType: data.incomingType, perimeter: data.perimeter, units: data.units, movingIso: data.movingIso });
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
      if (moved || !content || event.target !== renderer.domElement) return;
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
    const onContext = (event) => {
      event.preventDefault();
      if (!content) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(content.children, true).find((item) => item.object.userData.pick || item.object.parent?.userData?.pick);
      const pick = hit?.object.userData.pick || hit?.object.parent?.userData?.pick;
      if (pick) menuRef.current?.(pick, event.clientX, event.clientY);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("contextmenu", onContext);
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
      renderer.domElement.removeEventListener("contextmenu", onContext);
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
    const showTargets = dataRef.current.targets;
    viewRef.current?.rebuild(showTargets ? "overview" : (selectedRef.current ? "selection" : "keep"));
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
        <span>Arrastra para girar. Pellizca o usa los botones para acercar. Un 20 al centro se corre a la izquierda o a la derecha.</span>
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
            {picked.note ? <p>{picked.note}</p> : null}
            <p>{picked.access}</p>
            <p>{picked.cost}</p>
            {picked.unknown ? <p>Este hueco no está en el catálogo.</p> : <p className="yard-float-note">Esa referencia de movimientos queda en el catálogo comercial.</p>}
            {(() => {
              const pickedUnit = picked && !picked.unknown && !picked.empty
                ? (units || []).find((unit) => unit.iso === (picked.code || picked.key))
                : null;
              const pickedGhost = picked?.ghost
                ? (ghosts || []).find((ghost) => ghost.zoneId === picked.ghost.zoneId && ghost.row === picked.ghost.row && ghost.col === picked.ghost.col && ghost.level === picked.ghost.level && (ghost.half || "") === (picked.ghost.half || ""))
                : null;
              const feet = feetOf(pickedUnit?.type || pickedGhost?.typeCode);
              const placed = pickedUnit ? pickedUnit.lado && pickedUnit.lado !== "PASILLO" : Boolean(pickedGhost?.code);
              if (!onSlide || feet <= 0 || feet >= 40 || !placed) return null;
              const side = pickedUnit?.bayHalf || pickedGhost?.half || "";
              return (
                <>
                  <p>{side ? `Está en la mitad ${side}. El otro lado queda libre.` : "Está al centro y ocupa A y B. Arriba no puede ir un 40."}</p>
                  <div className="yard-float-actions">
                    <button className={side === "A" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => onSlide("A")}>A la izquierda</button>
                    <button className={!side ? "btn-primary" : "btn-ghost"} type="button" onClick={() => onSlide("center")}>Al centro</button>
                    <button className={side === "B" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => onSlide("B")}>A la derecha</button>
                  </div>
                </>
              );
            })()}
            {picked.splittable && onSplit ? (
              <div className="yard-float-actions">
                <button className="btn-ghost" type="button" onClick={onSplit}>Dividir en dos de 20</button>
              </div>
            ) : null}
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
            {transferring ? <p>Toca un cuadro amarillo del patio o del cerco. Un puesto de 40 pies admite un 40, o dos de 20, uno en cada mitad.</p> : null}
            {transferring && fenceHint ? <p>{fenceHint}</p> : null}
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
