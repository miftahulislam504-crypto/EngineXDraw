'use client';

import { useState, useCallback, useEffect, useMemo, useRef, Fragment } from 'react';
import clsx from 'clsx';
import { Stage, Layer, Line, Circle, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type {
  Balcony,
  Beam,
  Ceiling,
  Column,
  CurtainWall,
  Dimension,
  Footing,
  Foundation,
  GridLine,
  Note,
  Point2D,
  PlacedObject,
  PlacedObjectCategory,
  Railing,
  Ramp,
  Roof,
  Room,
  SectionLine,
  Shaft,
  SiteBoundary,
  Skylight,
  Slab,
  Stair,
  Wall,
  Opening,
} from '@archibim/object-model';
import { DEFAULT_WALL_THICKNESS, PLACED_OBJECT_DEFAULTS } from '@archibim/object-model';
import {
  resolveSnap,
  findNearestWall,
  nearestParameterOnWall,
  pointAtParameter,
  computeMiteredWallPolygons,
  isPointInPolygon,
} from '@archibim/core-engine';
import { useDesignStudioStore, type DesignTool } from '@/lib/design-studio-store';
import { getOpeningAutoTag, getGridLineAutoLabel, getSectionLineAutoLabel } from '@/lib/floors';

export interface FloorPlanCanvasProps {
  walls: Wall[];
  openings: Opening[];
  columns: Column[];
  beams: Beam[];
  slabs: Slab[];
  ceilings: Ceiling[];
  foundations: Foundation[];
  footings: Footing[];
  roofs: Roof[];
  ramps: Ramp[];
  railings: Railing[];
  stairs: Stair[];
  balconies: Balcony[];
  curtainWalls: CurtainWall[];
  skylights: Skylight[];
  placedObjects: PlacedObject[];
  rooms: Room[];
  dimensions: Dimension[];
  notes: Note[];
  gridLines: GridLine[];
  sectionLines: SectionLine[];
  shafts: Shaft[];
  siteBoundary: SiteBoundary | null;
  currentFloorLevel: number;
  onCreateWall: (start: Point2D, end: Point2D) => void;
  onCreateBeam: (start: Point2D, end: Point2D) => void;
  onCreateColumn: (center: Point2D) => void;
  onCreateFooting: (center: Point2D) => void;
  onCreateRectangle: (
    tool: 'slab' | 'ceiling' | 'foundation' | 'roof' | 'balcony' | 'shaft' | 'siteBoundary',
    corner1: Point2D,
    corner2: Point2D,
  ) => void;
  onCreateRamp: (start: Point2D, end: Point2D) => void;
  onCreateRailing: (start: Point2D, end: Point2D) => void;
  onCreateStair: (start: Point2D, end: Point2D) => void;
  onCreateCurtainWall: (start: Point2D, end: Point2D) => void;
  onCreateSkylight: (roofId: string, center: Point2D) => void;
  onCreatePlacedObject: (category: PlacedObjectCategory, center: Point2D) => void;
  onCreateOpening: (wallId: string, positionOnWall: number, kind: 'DOOR' | 'WINDOW') => void;
  onCreateDimension: (start: Point2D, end: Point2D) => void;
  onCreateNote: (position: Point2D) => void;
  onCreateGridLine: (orientation: 'vertical' | 'horizontal', position: number) => void;
  onCreateSectionLine: (start: Point2D, end: Point2D) => void;
  onOpenElevation?: (direction: 'N' | 'E' | 'S' | 'W') => void;
  onMoveWallEndpoint: (wallId: string, end: 'start' | 'end', point: Point2D) => void;
  width?: number;
  height?: number;
  /** Renders everything but disables all interaction — used for the
   * Sheet Manager's Floor Plan viewport, where the person is looking at
   * a printable drawing, not editing the model. Implemented by turning
   * off Konva's hit-testing at the Stage level (`listening={false}`),
   * which stops every click/drag handler in the whole tree below it from
   * ever firing — much safer than trying to individually guard dozens of
   * onClick handlers scattered through this file. */
  readOnly?: boolean;
  /** Fires with the underlying Konva Stage instance once mounted — the
   * Sheet export flow uses `stage.toDataURL()` to capture this view as
   * an image for the PDF, same idea as the onCanvasReady bridge the R3F
   * views (Elevation/Section) use, just via Konva's own built-in API
   * instead of reaching into a raw WebGL canvas. */
  onStageReady?: (stage: Konva.Stage) => void;
}

const ORIGIN_RATIO = 0.5; // meters (0,0) renders at the canvas center

const CHAINING_LINE_TOOLS: DesignTool[] = ['wall', 'beam', 'railing', 'curtainWall'];
const ONESHOT_LINE_TOOLS: DesignTool[] = ['ramp', 'stair', 'dimension', 'section'];
const RECTANGLE_TOOLS: DesignTool[] = ['slab', 'ceiling', 'foundation', 'roof', 'balcony', 'shaft', 'siteBoundary'];
const PLACED_OBJECT_TOOLS: DesignTool[] = ['furniture', 'kitchen', 'bathroom', 'parking', 'landscape'];
const PLACED_OBJECT_CATEGORY_BY_TOOL: Partial<Record<DesignTool, PlacedObjectCategory>> = {
  furniture: 'FURNITURE',
  kitchen: 'KITCHEN',
  bathroom: 'BATHROOM',
  parking: 'PARKING',
  landscape: 'LANDSCAPE',
};
const SNAP_AWARE_TOOLS: DesignTool[] = [...CHAINING_LINE_TOOLS, ...ONESHOT_LINE_TOOLS, ...RECTANGLE_TOOLS];

const PLACED_OBJECT_COLORS: Record<PlacedObjectCategory, { fill: string; stroke: string }> = {
  FURNITURE: { fill: 'rgba(139,148,167,0.4)', stroke: '#5B6478' },
  KITCHEN: { fill: 'rgba(232,135,30,0.25)', stroke: '#E8871E' },
  BATHROOM: { fill: 'rgba(45,108,223,0.2)', stroke: '#2D6CDF' },
  PARKING: { fill: 'rgba(28,138,94,0.2)', stroke: '#1C8A5E' },
  LANDSCAPE: { fill: 'rgba(28,138,94,0.35)', stroke: '#1C8A5E' },
};

export function FloorPlanCanvas({
  walls,
  openings,
  columns,
  beams,
  slabs,
  ceilings,
  foundations,
  footings,
  roofs,
  ramps,
  railings,
  stairs,
  balconies,
  curtainWalls,
  skylights,
  placedObjects,
  rooms,
  dimensions,
  notes,
  gridLines,
  sectionLines,
  shafts,
  siteBoundary,
  currentFloorLevel,
  onCreateWall,
  onCreateBeam,
  onCreateColumn,
  onCreateFooting,
  onCreateRectangle,
  onCreateRamp,
  onCreateRailing,
  onCreateStair,
  onCreateCurtainWall,
  onCreateSkylight,
  onCreatePlacedObject,
  onCreateOpening,
  onCreateDimension,
  onCreateNote,
  onCreateGridLine,
  onCreateSectionLine,
  onOpenElevation,
  onMoveWallEndpoint,
  width: widthOverride,
  height: heightOverride,
  readOnly = false,
  onStageReady,
}: FloorPlanCanvasProps) {
  const {
    activeTool,
    drawStart,
    setDrawStart,
    selection,
    setSelection,
    gridSize,
    pixelsPerMeter,
    setPixelsPerMeter,
    panOffset,
    setPanOffset,
  } = useDesignStudioStore();

  const [snappedCursor, setSnappedCursor] = useState<Point2D | null>(null);
  const [guide, setGuide] = useState<{ from: Point2D; to: Point2D } | null>(null);

  // When width/height aren't explicitly passed in (the normal Design
  // Studio case), measure the wrapping container instead of falling
  // back to a fixed pixel size. A fixed size doesn't shrink to fit a
  // phone screen, which is what was clipping the canvas and leaving
  // no way to scroll to the rest of it.
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredSize, setMeasuredSize] = useState({ width: 700, height: 600 });

  useEffect(() => {
    if (widthOverride != null && heightOverride != null) return;
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setMeasuredSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [widthOverride, heightOverride]);

  const width = widthOverride ?? measuredSize.width;
  const height = heightOverride ?? measuredSize.height;

  useEffect(() => {
    if (readOnly) setSelection(null);
    // Only meant to clear whatever selection happened to be left over
    // from a Design Studio session when this canvas opens in read-only
    // (Sheet Manager) mode — deliberately keyed on readOnly, not on
    // every selection change.
  }, [readOnly, setSelection]);

  const origin = {
    x: width * ORIGIN_RATIO + panOffset.x,
    y: height * ORIGIN_RATIO + panOffset.y,
  };

  const toPixels = useCallback(
    (p: Point2D): Point2D => ({
      x: origin.x + p.x * pixelsPerMeter,
      y: origin.y - p.y * pixelsPerMeter,
    }),
    [origin.x, origin.y, pixelsPerMeter],
  );

  const toMeters = useCallback(
    (p: Point2D): Point2D => ({
      x: (p.x - origin.x) / pixelsPerMeter,
      y: -(p.y - origin.y) / pixelsPerMeter,
    }),
    [origin.x, origin.y, pixelsPerMeter],
  );

  // Pan (click-drag on empty canvas) is only active for the Select tool,
  // since every drawing tool needs its own clicks to place points instead
  // of moving the view. Tracked in refs (not state) so mousemove during a
  // pan doesn't re-render on every pixel and doesn't fight with the
  // snapped-cursor preview logic below.
  const isPanningRef = useRef(false);
  const panStartRef = useRef<Point2D | null>(null);
  const panOffsetStartRef = useRef<Point2D>({ x: 0, y: 0 });
  const hasPannedRef = useRef(false);
  const pinchDistRef = useRef<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (activeTool !== 'select') return;
      // Only start a pan if the empty stage/background was hit, not a
      // shape (wall, endpoint handle, placed object, etc.) — those need
      // their own click/drag behavior to keep working.
      const target = e.target;
      const isBackground = target === target.getStage() || target.name() === 'canvas-background';
      if (!isBackground) return;
      const pos = target.getStage()?.getPointerPosition();
      if (!pos) return;
      isPanningRef.current = true;
      panStartRef.current = pos;
      panOffsetStartRef.current = panOffset;
      hasPannedRef.current = false;
      setIsPanning(true);
    },
    [activeTool, panOffset],
  );

  const handleStageMouseUp = useCallback(() => {
    isPanningRef.current = false;
    panStartRef.current = null;
    pinchDistRef.current = null;
    setIsPanning(false);
  }, []);

  // Zooms so that the given pixel point stays under the same meter
  // coordinate before and after — shared by wheel-zoom (desktop) and
  // pinch-zoom (touch).
  const zoomAroundPoint = useCallback(
    (pixelPoint: Point2D, newScale: number) => {
      const clamped = Math.min(120, Math.max(10, newScale));
      const meterUnderPoint = {
        x: (pixelPoint.x - origin.x) / pixelsPerMeter,
        y: -(pixelPoint.y - origin.y) / pixelsPerMeter,
      };
      const newOriginX = pixelPoint.x - meterUnderPoint.x * clamped;
      const newOriginY = pixelPoint.y + meterUnderPoint.y * clamped;
      setPixelsPerMeter(clamped);
      setPanOffset({
        x: newOriginX - width * ORIGIN_RATIO,
        y: newOriginY - height * ORIGIN_RATIO,
      });
    },
    [origin.x, origin.y, pixelsPerMeter, width, height, setPixelsPerMeter, setPanOffset],
  );

  // Zooms in/out around the cursor position rather than the canvas
  // center, so whatever the person is pointing at stays under their
  // cursor instead of the view jumping.
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;
      const direction = e.evt.deltaY > 0 ? -1 : 1;
      const newScale = pixelsPerMeter + direction * pixelsPerMeter * 0.08;
      if (newScale === pixelsPerMeter) return;
      zoomAroundPoint(pointer, newScale);
    },
    [pixelsPerMeter, zoomAroundPoint],
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setDrawStart(null);
        setSelection(null);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setDrawStart, setSelection]);

  // Given a raw pointer position (pixels), returns the snapped point in
  // meters using the same snap rules the hover preview uses. Both the
  // preview and the actual click/tap go through this so they always
  // agree on where a point will land.
  const snapFromPointer = useCallback(
    (pos: Point2D) => {
      const cursorMeters = toMeters(pos);
      if (SNAP_AWARE_TOOLS.includes(activeTool)) {
        return resolveSnap(cursorMeters, {
          walls,
          gridSize,
          lastPoint: drawStart ?? undefined,
        }).point;
      }
      return cursorMeters;
    },
    [toMeters, activeTool, walls, gridSize, drawStart],
  );

  function handleMouseMove(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    // Two-finger touch = pinch-to-zoom, checked before anything else so
    // it takes priority over the single-finger pan/draw logic below.
    const nativeEvt = e.evt as TouchEvent;
    if (nativeEvt.touches && nativeEvt.touches.length === 2) {
      const stage = e.target.getStage();
      const rect = stage?.container().getBoundingClientRect();
      if (stage && rect) {
        const [t1, t2] = [nativeEvt.touches[0], nativeEvt.touches[1]];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const midpoint = {
          x: (t1.clientX + t2.clientX) / 2 - rect.left,
          y: (t1.clientY + t2.clientY) / 2 - rect.top,
        };
        if (pinchDistRef.current != null) {
          const scaleFactor = dist / pinchDistRef.current;
          zoomAroundPoint(midpoint, pixelsPerMeter * scaleFactor);
        }
        pinchDistRef.current = dist;
      }
      return;
    }
    pinchDistRef.current = null;

    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;

    if (isPanningRef.current && panStartRef.current) {
      const dx = pos.x - panStartRef.current.x;
      const dy = pos.y - panStartRef.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) hasPannedRef.current = true;
      setPanOffset({
        x: panOffsetStartRef.current.x + dx,
        y: panOffsetStartRef.current.y + dy,
      });
      return;
    }

    const cursorMeters = toMeters(pos);

    if (SNAP_AWARE_TOOLS.includes(activeTool)) {
      const snap = resolveSnap(cursorMeters, {
        walls,
        gridSize,
        lastPoint: drawStart ?? undefined,
      });
      setSnappedCursor(snap.point);
      setGuide(snap.guide ?? null);
    } else {
      setSnappedCursor(cursorMeters);
      setGuide(null);
    }
  }

  // Reads the click/tap's own pointer position instead of relying on
  // `snappedCursor` (which is only populated by mousemove). On touch
  // devices a tap fires with no preceding move event, so relying on
  // that state alone placed the object at whatever position the
  // *previous* interaction last set — one tap behind where the person
  // actually touched. Falls back to the tracked snappedCursor only if
  // the stage position is unavailable for some reason.
  function handleStageClick(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (hasPannedRef.current) {
      hasPannedRef.current = false;
      return;
    }
    const pos = e.target.getStage()?.getPointerPosition();
    const point = pos ? snapFromPointer(pos) : snappedCursor;
    if (!point) return;
    setSnappedCursor(point);

    if (CHAINING_LINE_TOOLS.includes(activeTool)) {
      if (!drawStart) {
        setDrawStart(point);
      } else {
        if (activeTool === 'wall') onCreateWall(drawStart, point);
        if (activeTool === 'beam') onCreateBeam(drawStart, point);
        if (activeTool === 'railing') onCreateRailing(drawStart, point);
        if (activeTool === 'curtainWall') onCreateCurtainWall(drawStart, point);
        setDrawStart(point); // chain into the next segment
      }
      return;
    }

    if (ONESHOT_LINE_TOOLS.includes(activeTool)) {
      if (!drawStart) {
        setDrawStart(point);
      } else {
        if (activeTool === 'ramp') onCreateRamp(drawStart, point);
        if (activeTool === 'stair') onCreateStair(drawStart, point);
        if (activeTool === 'dimension') onCreateDimension(drawStart, point);
        if (activeTool === 'section') onCreateSectionLine(drawStart, point);
        setDrawStart(null);
      }
      return;
    }

    if (RECTANGLE_TOOLS.includes(activeTool)) {
      if (!drawStart) {
        setDrawStart(point);
      } else {
        onCreateRectangle(
          activeTool as 'slab' | 'ceiling' | 'foundation' | 'roof' | 'balcony' | 'shaft' | 'siteBoundary',
          drawStart,
          point,
        );
        setDrawStart(null);
      }
      return;
    }

    if (activeTool === 'column') {
      onCreateColumn(point);
      return;
    }

    if (activeTool === 'footing') {
      onCreateFooting(point);
      return;
    }

    if (activeTool === 'note') {
      onCreateNote(point);
      return;
    }

    if (activeTool === 'gridV') {
      // The first vertical grid line anchors to the origin (x = 0m) instead
      // of wherever was tapped, so the grid always starts from the plan's
      // 0,0 point like a real structural grid — every grid line after the
      // first still places exactly where the person taps.
      const hasVertical = gridLines.some((l) => l.orientation === 'vertical');
      onCreateGridLine('vertical', hasVertical ? point.x : 0);
      return;
    }

    if (activeTool === 'gridH') {
      const hasHorizontal = gridLines.some((l) => l.orientation === 'horizontal');
      onCreateGridLine('horizontal', hasHorizontal ? point.y : 0);
      return;
    }

    if (activeTool === 'skylight') {
      const roof = roofs.find((r) => isPointInPolygon(point, r.boundary));
      if (roof) onCreateSkylight(roof.id, point);
      return;
    }

    if (PLACED_OBJECT_TOOLS.includes(activeTool)) {
      const category = PLACED_OBJECT_CATEGORY_BY_TOOL[activeTool];
      if (category) onCreatePlacedObject(category, point);
      return;
    }

    if (activeTool === 'door' || activeTool === 'window') {
      const wall = findNearestWall(point, walls, DEFAULT_WALL_THICKNESS * 3);
      if (wall) {
        const t = nearestParameterOnWall(wall, point);
        onCreateOpening(wall.id, t, activeTool === 'door' ? 'DOOR' : 'WINDOW');
      }
      return;
    }

    setSelection(null);
  }

  function handleEndpointDragEnd(
    wallId: string,
    endName: 'start' | 'end',
    e: Konva.KonvaEventObject<DragEvent>,
  ) {
    const node = e.target;
    const raw = toMeters({ x: node.x(), y: node.y() });
    const otherWalls = walls.filter((w) => w.id !== wallId);
    const snap = resolveSnap(raw, { walls: otherWalls, gridSize });
    onMoveWallEndpoint(wallId, endName, snap.point);
    const px = toPixels(snap.point);
    node.position({ x: px.x, y: px.y });
  }

  const miteredPolygons = computeMiteredWallPolygons(walls);

  // Wall bounding box, in meters — used to place the Elevation Marks
  // just outside the building on each of the 4 cardinal sides.
  const wallBounds = useMemo(() => {
    if (walls.length === 0) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const wall of walls) {
      for (const p of [wall.start, wall.end]) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
    return { minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
  }, [walls]);

  // Shafts are building-level (span multiple floors) but only render on
  // the floor plans they actually pass through.
  const visibleShafts = useMemo(
    () => shafts.filter((s) => currentFloorLevel >= s.startLevel && currentFloorLevel <= s.endLevel),
    [shafts, currentFloorLevel],
  );

  const backgroundGridLines: number[][] = [];
  const gridPx = gridSize * pixelsPerMeter;
  for (let x = origin.x % gridPx; x < width; x += gridPx) {
    backgroundGridLines.push([x, 0, x, height]);
  }
  for (let y = origin.y % gridPx; y < height; y += gridPx) {
    backgroundGridLines.push([0, y, width, y]);
  }

  function rectPolygon(boundary: Point2D[]) {
    return boundary.flatMap((p) => {
      const px = toPixels(p);
      return [px.x, px.y];
    });
  }

  return (
    <div ref={containerRef} className="h-full w-full min-h-[320px] min-w-0">
      <Stage
        width={width}
        height={height}
        listening={!readOnly}
        ref={(node) => {
          if (node) onStageReady?.(node);
        }}
        onMouseMove={readOnly ? undefined : handleMouseMove}
        onTouchMove={readOnly ? undefined : handleMouseMove}
        onMouseDown={readOnly ? undefined : handleStageMouseDown}
        onTouchStart={readOnly ? undefined : handleStageMouseDown}
        onMouseUp={readOnly ? undefined : handleStageMouseUp}
        onTouchEnd={readOnly ? undefined : handleStageMouseUp}
        onMouseLeave={readOnly ? undefined : handleStageMouseUp}
        onWheel={readOnly ? undefined : handleWheel}
        onClick={readOnly ? undefined : handleStageClick}
        onTap={readOnly ? undefined : handleStageClick}
        className={
          readOnly
            ? 'rounded-sheet border border-line bg-white'
            : clsx(
                'rounded-sheet border border-line bg-white',
                isPanning ? 'cursor-grabbing' : activeTool === 'select' ? 'cursor-grab' : 'cursor-crosshair',
              )
        }
      >
        <Layer listening={false}>
          {backgroundGridLines.map((pts, i) => (
            <Line key={i} points={pts} stroke="#EEF1F6" strokeWidth={1} />
          ))}
          <Line points={[0, origin.y, width, origin.y]} stroke="#D8DEE9" strokeWidth={1.5} />
          <Line points={[origin.x, 0, origin.x, height]} stroke="#D8DEE9" strokeWidth={1.5} />
        </Layer>

        <Layer>
          {rooms.map((room) => {
            const flat = rectPolygon(room.boundary);
            return (
              <Line
                key={room.id}
                points={flat}
                closed
                fill="rgba(45,108,223,0.04)"
                stroke="rgba(45,108,223,0.15)"
                strokeWidth={1}
                listening={false}
              />
            );
          })}
          {rooms.map((room) => {
            const px = toPixels(room.centroid);
            return (
              <Text
                key={`${room.id}-label`}
                x={px.x}
                y={px.y}
                text={`${room.name}\n${room.areaSqm.toFixed(1)} m²`}
                fontFamily="monospace"
                fontSize={11}
                fill="#5B6478"
                align="center"
                offsetX={30}
                offsetY={10}
                width={60}
                listening={false}
              />
            );
          })}

          {/* Horizontal planar elements render first, bottom-to-top by role, so
              walls/columns always appear on top of them */}
          {foundations.map((f) => (
            <Line
              key={f.id}
              points={rectPolygon(f.boundary)}
              closed
              fill={selection?.kind === 'foundation' && selection.id === f.id ? 'rgba(45,108,223,0.25)' : 'rgba(154,163,178,0.35)'}
              stroke={selection?.kind === 'foundation' && selection.id === f.id ? '#2D6CDF' : '#9AA3B2'}
              strokeWidth={1}
              dash={[4, 3]}
              onClick={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  setSelection({ kind: 'foundation', id: f.id });
                }
              }}
              onTap={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  setSelection({ kind: 'foundation', id: f.id });
                }
              }}
            />
          ))}
          {slabs.map((slab) => (
            <Line
              key={slab.id}
              points={rectPolygon(slab.boundary)}
              closed
              fill={selection?.kind === 'slab' && selection.id === slab.id ? 'rgba(45,108,223,0.25)' : 'rgba(184,192,209,0.35)'}
              stroke={selection?.kind === 'slab' && selection.id === slab.id ? '#2D6CDF' : '#B7C0D1'}
              strokeWidth={1}
              onClick={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  setSelection({ kind: 'slab', id: slab.id });
                }
              }}
              onTap={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  setSelection({ kind: 'slab', id: slab.id });
                }
              }}
            />
          ))}
          {roofs.map((r) => (
            <Line
              key={r.id}
              points={rectPolygon(r.boundary)}
              closed
              fill={selection?.kind === 'roof' && selection.id === r.id ? 'rgba(45,108,223,0.25)' : 'rgba(139,94,74,0.25)'}
              stroke={selection?.kind === 'roof' && selection.id === r.id ? '#2D6CDF' : '#8B5E4A'}
              strokeWidth={1}
              dash={[8, 3]}
              onClick={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  setSelection({ kind: 'roof', id: r.id });
                }
              }}
              onTap={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  setSelection({ kind: 'roof', id: r.id });
                }
              }}
            />
          ))}
          {visibleShafts.map((shaft) => {
            const isSelected = selection?.kind === 'shaft' && selection.id === shaft.id;
            const centroid = shaft.boundary.reduce(
              (acc, p) => ({ x: acc.x + p.x / shaft.boundary.length, y: acc.y + p.y / shaft.boundary.length }),
              { x: 0, y: 0 },
            );
            const centroidPx = toPixels(centroid);
            return (
              <Fragment key={shaft.id}>
                <Line
                  points={rectPolygon(shaft.boundary)}
                  closed
                  fill={isSelected ? 'rgba(45,108,223,0.2)' : 'rgba(196,105,44,0.15)'}
                  stroke={isSelected ? '#2D6CDF' : '#C4692C'}
                  strokeWidth={1.5}
                  dash={[4, 3]}
                  onClick={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      setSelection({ kind: 'shaft', id: shaft.id });
                    }
                  }}
                  onTap={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      setSelection({ kind: 'shaft', id: shaft.id });
                    }
                  }}
                />
                <Text
                  x={centroidPx.x}
                  y={centroidPx.y}
                  text={`${shaft.label ?? shaft.shaftType}\nL${shaft.startLevel}–L${shaft.endLevel}`}
                  fontFamily="monospace"
                  fontSize={10}
                  fill="#C4692C"
                  align="center"
                  width={90}
                  offsetX={45}
                  offsetY={12}
                  listening={false}
                />
              </Fragment>
            );
          })}

          {siteBoundary && (
            <Fragment key={siteBoundary.id}>
              <Line
                points={rectPolygon(siteBoundary.boundary)}
                closed
                fill="transparent"
                stroke={selection?.kind === 'siteBoundary' ? '#2D6CDF' : '#4C9A6A'}
                strokeWidth={2}
                dash={[8, 5]}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'siteBoundary', id: siteBoundary.id });
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'siteBoundary', id: siteBoundary.id });
                  }
                }}
              />
              {(() => {
                const xs = siteBoundary.boundary.map((p) => p.x);
                const ys = siteBoundary.boundary.map((p) => p.y);
                const minX = Math.min(...xs);
                const maxX = Math.max(...xs);
                const minY = Math.min(...ys);
                const maxY = Math.max(...ys);
                const midpointByEdge: Record<string, Point2D> = {
                  top: { x: (minX + maxX) / 2, y: minY },
                  bottom: { x: (minX + maxX) / 2, y: maxY },
                  left: { x: minX, y: (minY + maxY) / 2 },
                  right: { x: maxX, y: (minY + maxY) / 2 },
                };
                const labelPx = toPixels(midpointByEdge[siteBoundary.frontEdge]);
                return (
                  <Text
                    x={labelPx.x}
                    y={labelPx.y}
                    text="▲ ROAD"
                    fontFamily="monospace"
                    fontSize={10}
                    fill="#4C9A6A"
                    align="center"
                    width={70}
                    offsetX={35}
                    offsetY={6}
                    listening={false}
                  />
                );
              })()}
            </Fragment>
          )}

          {ceilings.map((c) => (
            <Line
              key={c.id}
              points={rectPolygon(c.boundary)}
              closed
              fill={selection?.kind === 'ceiling' && selection.id === c.id ? 'rgba(45,108,223,0.25)' : 'rgba(237,239,243,0.5)'}
              stroke={selection?.kind === 'ceiling' && selection.id === c.id ? '#2D6CDF' : '#D8DEE9'}
              strokeWidth={1}
              dash={[2, 3]}
              onClick={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  setSelection({ kind: 'ceiling', id: c.id });
                }
              }}
              onTap={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  setSelection({ kind: 'ceiling', id: c.id });
                }
              }}
            />
          ))}
          {balconies.map((b) => (
            <Line
              key={b.id}
              points={rectPolygon(b.boundary)}
              closed
              fill={selection?.kind === 'balcony' && selection.id === b.id ? 'rgba(45,108,223,0.25)' : 'rgba(184,192,209,0.45)'}
              stroke={selection?.kind === 'balcony' && selection.id === b.id ? '#2D6CDF' : '#8B93A7'}
              strokeWidth={1.5}
              onClick={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  setSelection({ kind: 'balcony', id: b.id });
                }
              }}
              onTap={(e) => {
                if (activeTool === 'select') {
                  e.cancelBubble = true;
                  setSelection({ kind: 'balcony', id: b.id });
                }
              }}
            />
          ))}

          {/* Line-based elements */}
          {beams.map((beam) => {
            const a = toPixels(beam.start);
            const b = toPixels(beam.end);
            const isSelected = selection?.kind === 'beam' && selection.id === beam.id;
            return (
              <Line
                key={beam.id}
                points={[a.x, a.y, b.x, b.y]}
                stroke={isSelected ? '#2D6CDF' : '#8B93A7'}
                strokeWidth={Math.max(2, beam.width * pixelsPerMeter * 0.4)}
                hitStrokeWidth={20}
                dash={[10, 6]}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'beam', id: beam.id });
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'beam', id: beam.id });
                  }
                }}
              />
            );
          })}
          {ramps.map((r) => {
            const a = toPixels(r.start);
            const b = toPixels(r.end);
            const isSelected = selection?.kind === 'ramp' && selection.id === r.id;
            return (
              <Line
                key={r.id}
                points={[a.x, a.y, b.x, b.y]}
                stroke={isSelected ? '#2D6CDF' : '#C7CCD6'}
                strokeWidth={Math.max(4, r.width * pixelsPerMeter * 0.5)}
                hitStrokeWidth={20}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'ramp', id: r.id });
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'ramp', id: r.id });
                  }
                }}
              />
            );
          })}
          {stairs.map((s) => {
            const a = toPixels(s.start);
            const b = toPixels(s.end);
            const isSelected = selection?.kind === 'stair' && selection.id === s.id;
            return (
              <Line
                key={s.id}
                points={[a.x, a.y, b.x, b.y]}
                stroke={isSelected ? '#2D6CDF' : '#B7C0D1'}
                strokeWidth={Math.max(6, s.width * pixelsPerMeter * 0.6)}
                hitStrokeWidth={20}
                dash={[3, 4]}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'stair', id: s.id });
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'stair', id: s.id });
                  }
                }}
              />
            );
          })}
          {railings.map((r) => {
            const a = toPixels(r.start);
            const b = toPixels(r.end);
            const isSelected = selection?.kind === 'railing' && selection.id === r.id;
            return (
              <Line
                key={r.id}
                points={[a.x, a.y, b.x, b.y]}
                stroke={isSelected ? '#2D6CDF' : '#8B93A7'}
                strokeWidth={2}
                hitStrokeWidth={20}
                dash={[1, 4]}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'railing', id: r.id });
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'railing', id: r.id });
                  }
                }}
              />
            );
          })}
          {curtainWalls.map((cw) => {
            const a = toPixels(cw.start);
            const b = toPixels(cw.end);
            const isSelected = selection?.kind === 'curtainWall' && selection.id === cw.id;
            return (
              <Line
                key={cw.id}
                points={[a.x, a.y, b.x, b.y]}
                stroke={isSelected ? '#2D6CDF' : '#7FB3E8'}
                strokeWidth={Math.max(2, cw.thickness * pixelsPerMeter * 2)}
                hitStrokeWidth={20}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'curtainWall', id: cw.id });
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'curtainWall', id: cw.id });
                  }
                }}
              />
            );
          })}

          {miteredPolygons.map((poly) => {
            const wall = walls.find((w) => w.id === poly.wallId)!;
            const isSelected = selection?.kind === 'wall' && selection.id === wall.id;
            return (
              <Line
                key={wall.id}
                points={rectPolygon(poly.points)}
                closed
                fill={isSelected ? '#2D6CDF' : '#131B2E'}
                stroke={isSelected ? '#1E4FB0' : undefined}
                strokeWidth={isSelected ? 2 : 0}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'wall', id: wall.id });
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'wall', id: wall.id });
                  }
                }}
              />
            );
          })}

          {/* Footings render BEFORE columns (not after) so that columns —
              which are almost always centered inside their footing and
              visually smaller — sit on top in both paint order and Konva's
              hit-test order. A footing with fill="transparent" is still a
              solid hit target (transparent fill ≠ listening={false}), so
              drawing it after the column used to let its rectangle swallow
              every tap meant for the column beneath it, making the column
              impossible to select once a footing was placed under it. */}
          {footings.map((f) => {
            const px = toPixels(f.center);
            const isSelected = selection?.kind === 'footing' && selection.id === f.id;
            const wPx = f.width * pixelsPerMeter;
            const dPx = f.depth * pixelsPerMeter;
            return (
              <Rect
                key={f.id}
                x={px.x - wPx / 2}
                y={px.y - dPx / 2}
                width={wPx}
                height={dPx}
                fill={isSelected ? '#2D6CDF' : 'transparent'}
                stroke={isSelected ? '#2D6CDF' : '#6B7280'}
                strokeWidth={2}
                dash={[4, 3]}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'footing', id: f.id });
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'footing', id: f.id });
                  }
                }}
              />
            );
          })}

          {columns.map((column) => {
            const px = toPixels(column.center);
            const isSelected = selection?.kind === 'column' && selection.id === column.id;
            const wPx = column.width * pixelsPerMeter;
            const dPx = (column.shape === 'CIRCULAR' ? column.width : column.depth) * pixelsPerMeter;
            return column.shape === 'CIRCULAR' ? (
              <Circle
                key={column.id}
                x={px.x}
                y={px.y}
                radius={wPx / 2}
                fill={isSelected ? '#2D6CDF' : '#5B6478'}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'column', id: column.id });
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'column', id: column.id });
                  }
                }}
              />
            ) : (
              <Rect
                key={column.id}
                x={px.x - wPx / 2}
                y={px.y - dPx / 2}
                width={wPx}
                height={dPx}
                fill={isSelected ? '#2D6CDF' : '#5B6478'}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'column', id: column.id });
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'column', id: column.id });
                  }
                }}
              />
            );
          })}

          {openings.map((opening) => {
            const wall = walls.find((w) => w.id === opening.wallId);
            if (!wall) return null;
            const center = pointAtParameter(wall, opening.positionOnWall);
            const px = toPixels(center);
            const isDoor = opening.kind === 'DOOR';
            const isSelected = selection?.kind === 'opening' && selection.id === opening.id;
            const tag = opening.tag ?? getOpeningAutoTag(opening, openings);
            return (
              <Fragment key={opening.id}>
                <Circle
                  x={px.x}
                  y={px.y}
                  radius={(opening.width * pixelsPerMeter) / 2}
                  fill={isDoor ? '#FDF1E2' : '#E8EFFD'}
                  stroke={isSelected ? '#2D6CDF' : isDoor ? '#E8871E' : '#2D6CDF'}
                  strokeWidth={isSelected ? 3 : 2}
                  onClick={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      setSelection({ kind: 'opening', id: opening.id });
                    }
                  }}
                  onTap={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      setSelection({ kind: 'opening', id: opening.id });
                    }
                  }}
                />
                <Text
                  x={px.x}
                  y={px.y}
                  text={`${tag} · ${opening.width.toFixed(2)}m`}
                  fontFamily="monospace"
                  fontSize={10}
                  fill={isDoor ? '#B4620F' : '#2D6CDF'}
                  align="center"
                  width={80}
                  offsetX={40}
                  offsetY={(opening.width * pixelsPerMeter) / 2 + 14}
                  listening={false}
                />
              </Fragment>
            );
          })}

          {skylights.map((sky) => {
            const px = toPixels(sky.center);
            const isSelected = selection?.kind === 'skylight' && selection.id === sky.id;
            const wPx = sky.width * pixelsPerMeter;
            const dPx = sky.depth * pixelsPerMeter;
            return (
              <Rect
                key={sky.id}
                x={px.x - wPx / 2}
                y={px.y - dPx / 2}
                width={wPx}
                height={dPx}
                fill="rgba(232,239,253,0.8)"
                stroke={isSelected ? '#2D6CDF' : '#2D6CDF'}
                strokeWidth={isSelected ? 3 : 1}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'skylight', id: sky.id });
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'skylight', id: sky.id });
                  }
                }}
              />
            );
          })}

          {placedObjects.map((obj) => {
            const px = toPixels(obj.center);
            const isSelected = selection?.kind === 'placedObject' && selection.id === obj.id;
            const wPx = obj.width * pixelsPerMeter;
            const dPx = obj.depth * pixelsPerMeter;
            const categoryColor = PLACED_OBJECT_COLORS[obj.category];
            return (
              <Rect
                key={obj.id}
                x={px.x}
                y={px.y}
                width={wPx}
                height={dPx}
                offsetX={wPx / 2}
                offsetY={dPx / 2}
                rotation={obj.rotationDeg}
                fill={isSelected ? 'rgba(45,108,223,0.5)' : categoryColor.fill}
                stroke={isSelected ? '#2D6CDF' : categoryColor.stroke}
                strokeWidth={1.5}
                onClick={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'placedObject', id: obj.id });
                  }
                }}
                onTap={(e) => {
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    setSelection({ kind: 'placedObject', id: obj.id });
                  }
                }}
              />
            );
          })}

          {/* Dimensions — Phase 4 Annotation System. Drawn in meter-space
              (start/end/offset) then converted to pixels, so the extension
              lines and dimension line stay correct regardless of zoom. */}
          {dimensions.map((dim) => {
            const dx = dim.end.x - dim.start.x;
            const dy = dim.end.y - dim.start.y;
            const len = Math.hypot(dx, dy) || 1e-6;
            const ux = dx / len;
            const uy = dy / len;
            const nx = -uy;
            const ny = ux;
            const offsetStart: Point2D = { x: dim.start.x + nx * dim.offset, y: dim.start.y + ny * dim.offset };
            const offsetEnd: Point2D = { x: dim.end.x + nx * dim.offset, y: dim.end.y + ny * dim.offset };
            const a = toPixels(offsetStart);
            const b = toPixels(offsetEnd);
            const startPx = toPixels(dim.start);
            const endPx = toPixels(dim.end);
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            let angleDeg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
            if (angleDeg > 90 || angleDeg < -90) angleDeg += 180;
            const isSelected = selection?.kind === 'dimension' && selection.id === dim.id;
            const color = isSelected ? '#2D6CDF' : '#8B93A7';
            return (
              <Fragment key={dim.id}>
                <Line points={[startPx.x, startPx.y, a.x, a.y]} stroke={color} strokeWidth={1} opacity={0.6} />
                <Line points={[endPx.x, endPx.y, b.x, b.y]} stroke={color} strokeWidth={1} opacity={0.6} />
                <Line
                  points={[a.x, a.y, b.x, b.y]}
                  stroke={color}
                  strokeWidth={1.5}
                  hitStrokeWidth={20}
                  onClick={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      setSelection({ kind: 'dimension', id: dim.id });
                    }
                  }}
                  onTap={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      setSelection({ kind: 'dimension', id: dim.id });
                    }
                  }}
                />
                <Circle x={a.x} y={a.y} radius={2.5} fill={color} listening={false} />
                <Circle x={b.x} y={b.y} radius={2.5} fill={color} listening={false} />
                <Text
                  x={mid.x}
                  y={mid.y}
                  text={dim.label ?? `${len.toFixed(2)} m`}
                  fontFamily="monospace"
                  fontSize={11}
                  fill={color}
                  align="center"
                  width={70}
                  offsetX={35}
                  offsetY={16}
                  rotation={angleDeg}
                  listening={false}
                />
              </Fragment>
            );
          })}

          {/* Grid lines — Phase 4 Annotation System. Full-span reference
              lines with a bubble+label at one end, same auto-label-unless-
              overridden pattern as Dimension/Opening tags. */}
          {gridLines.map((line) => {
            const label = line.label ?? getGridLineAutoLabel(line, gridLines);
            const isSelected = selection?.kind === 'gridLine' && selection.id === line.id;
            const color = isSelected ? '#2D6CDF' : '#C7739A';
            if (line.orientation === 'vertical') {
              const x = toPixels({ x: line.position, y: 0 }).x;
              return (
                <Fragment key={line.id}>
                  <Line
                    points={[x, 0, x, height]}
                    stroke={color}
                    strokeWidth={1}
                    hitStrokeWidth={20}
                    dash={[6, 4]}
                    onClick={(e) => {
                      if (activeTool === 'select') {
                        e.cancelBubble = true;
                        setSelection({ kind: 'gridLine', id: line.id });
                      }
                    }}
                    onTap={(e) => {
                      if (activeTool === 'select') {
                        e.cancelBubble = true;
                        setSelection({ kind: 'gridLine', id: line.id });
                      }
                    }}
                  />
                  <Circle x={x} y={16} radius={12} fill="#fff" stroke={color} strokeWidth={1.5} listening={false} />
                  <Text
                    x={x}
                    y={16}
                    text={label}
                    fontFamily="monospace"
                    fontSize={11}
                    fill={color}
                    align="center"
                    width={24}
                    offsetX={12}
                    offsetY={6}
                    listening={false}
                  />
                </Fragment>
              );
            }
            const y = toPixels({ x: 0, y: line.position }).y;
            return (
              <Fragment key={line.id}>
                <Line
                  points={[0, y, width, y]}
                  stroke={color}
                  strokeWidth={1}
                  hitStrokeWidth={20}
                  dash={[6, 4]}
                  onClick={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      setSelection({ kind: 'gridLine', id: line.id });
                    }
                  }}
                  onTap={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      setSelection({ kind: 'gridLine', id: line.id });
                    }
                  }}
                />
                <Circle x={16} y={y} radius={12} fill="#fff" stroke={color} strokeWidth={1.5} listening={false} />
                <Text
                  x={16}
                  y={y}
                  text={label}
                  fontFamily="monospace"
                  fontSize={11}
                  fill={color}
                  align="center"
                  width={24}
                  offsetX={12}
                  offsetY={6}
                  listening={false}
                />
              </Fragment>
            );
          })}

          {/* Notes — Phase 4 Annotation System. Freeform text callouts;
              the only annotation type with no auto-computed content. */}
          {notes.map((note) => {
            const px = toPixels(note.position);
            const isSelected = selection?.kind === 'note' && selection.id === note.id;
            return (
              <Fragment key={note.id}>
                <Rect
                  x={px.x - 6}
                  y={px.y - 6}
                  width={Math.max(24, note.text.length * 5.5)}
                  height={20}
                  fill="#FEF9E7"
                  stroke={isSelected ? '#2D6CDF' : '#D4B106'}
                  strokeWidth={isSelected ? 2 : 1}
                  cornerRadius={3}
                  onClick={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      setSelection({ kind: 'note', id: note.id });
                    }
                  }}
                  onTap={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      setSelection({ kind: 'note', id: note.id });
                    }
                  }}
                />
                <Text
                  x={px.x}
                  y={px.y + 4}
                  text={note.text}
                  fontFamily="sans-serif"
                  fontSize={10}
                  fill="#7A6200"
                  listening={false}
                />
              </Fragment>
            );
          })}

          {/* Section lines — Phase 4 Annotation System (Section Marks) +
              Phase 4 Drawing Documentation (defines the actual Section cut).
              Heavier dash pattern than Dimension/Grid so it reads as a
              distinct, more consequential mark on the plan. */}
          {sectionLines.map((line) => {
            const label = line.label ?? getSectionLineAutoLabel(line, sectionLines);
            const bubbleLabel = label.includes('-') ? label.split('-')[0] : label;
            const isSelected = selection?.kind === 'sectionLine' && selection.id === line.id;
            const color = isSelected ? '#2D6CDF' : '#B4620F';
            const a = toPixels(line.start);
            const b = toPixels(line.end);
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1e-6;
            const ux = dx / len;
            const uy = dy / len;
            // Left-hand normal of the a->b direction, in pixel space (screen
            // y grows downward, so this matches the meter-space left-normal
            // used when defining the clipping plane for the 3D Section view).
            const nx = -uy;
            const ny = ux;
            const arrowDir = line.viewDirection === 'left' ? 1 : -1;
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const arrowTip = { x: mid.x + nx * 18 * arrowDir, y: mid.y + ny * 18 * arrowDir };
            return (
              <Fragment key={line.id}>
                <Line
                  points={[a.x, a.y, b.x, b.y]}
                  stroke={color}
                  strokeWidth={2}
                  dash={[16, 4, 3, 4]}
                  onClick={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      setSelection({ kind: 'sectionLine', id: line.id });
                    }
                  }}
                  onTap={(e) => {
                    if (activeTool === 'select') {
                      e.cancelBubble = true;
                      setSelection({ kind: 'sectionLine', id: line.id });
                    }
                  }}
                />
                <Line points={[mid.x, mid.y, arrowTip.x, arrowTip.y]} stroke={color} strokeWidth={2} listening={false} />
                {[a, b].map((pt, i) => (
                  <Fragment key={i}>
                    <Circle x={pt.x} y={pt.y} radius={11} fill="#fff" stroke={color} strokeWidth={1.5} listening={false} />
                    <Text
                      x={pt.x}
                      y={pt.y}
                      text={bubbleLabel}
                      fontFamily="monospace"
                      fontSize={11}
                      fill={color}
                      align="center"
                      width={22}
                      offsetX={11}
                      offsetY={5.5}
                      listening={false}
                    />
                  </Fragment>
                ))}
              </Fragment>
            );
          })}

          {/* Elevation Marks — Phase 4 Annotation System. Auto-derived from
              the wall bounding box (no separate placed object, same idea
              as Room Tags/Levels), one per cardinal direction, clickable
              straight through to that Elevation view. */}
          {wallBounds &&
            (['N', 'S', 'E', 'W'] as const).map((dir) => {
              const margin = 1.2;
              const point: Point2D =
                dir === 'N'
                  ? { x: wallBounds.centerX, y: wallBounds.maxY + margin }
                  : dir === 'S'
                    ? { x: wallBounds.centerX, y: wallBounds.minY - margin }
                    : dir === 'E'
                      ? { x: wallBounds.maxX + margin, y: wallBounds.centerY }
                      : { x: wallBounds.minX - margin, y: wallBounds.centerY };
              const px = toPixels(point);
              return (
                <Fragment key={dir}>
                  <Circle
                    x={px.x}
                    y={px.y}
                    radius={13}
                    fill="#FFFFFF"
                    stroke="#3F7A4E"
                    strokeWidth={1.5}
                    onClick={(e) => {
                      if (activeTool === 'select' && onOpenElevation) {
                        e.cancelBubble = true;
                        onOpenElevation(dir);
                      }
                    }}
                    onTap={(e) => {
                      if (activeTool === 'select' && onOpenElevation) {
                        e.cancelBubble = true;
                        onOpenElevation(dir);
                      }
                    }}
                  />
                  <Text
                    x={px.x}
                    y={px.y}
                    text={dir}
                    fontFamily="monospace"
                    fontSize={12}
                    fill="#3F7A4E"
                    align="center"
                    width={26}
                    offsetX={13}
                    offsetY={6}
                    listening={false}
                  />
                </Fragment>
              );
            })}

          {/* Draggable endpoint handles for the selected wall — Parametric Editing */}
          {selection?.kind === 'wall' &&
            (() => {
              const wall = walls.find((w) => w.id === selection.id);
              if (!wall) return null;
              const startPx = toPixels(wall.start);
              const endPx = toPixels(wall.end);
              return (
                <>
                  <Circle
                    x={startPx.x}
                    y={startPx.y}
                    radius={6}
                    fill="#fff"
                    stroke="#2D6CDF"
                    strokeWidth={2}
                    draggable
                    onDragEnd={(e) => handleEndpointDragEnd(wall.id, 'start', e)}
                  />
                  <Circle
                    x={endPx.x}
                    y={endPx.y}
                    radius={6}
                    fill="#fff"
                    stroke="#2D6CDF"
                    strokeWidth={2}
                    draggable
                    onDragEnd={(e) => handleEndpointDragEnd(wall.id, 'end', e)}
                  />
                </>
              );
            })()}

          {SNAP_AWARE_TOOLS.includes(activeTool) && drawStart && snappedCursor && (
            <Line
              points={[
                toPixels(drawStart).x,
                toPixels(drawStart).y,
                toPixels(snappedCursor).x,
                toPixels(snappedCursor).y,
              ]}
              stroke="#2D6CDF"
              strokeWidth={2}
              dash={[6, 4]}
            />
          )}

          {guide && (
            <Line
              points={[
                toPixels(guide.from).x,
                toPixels(guide.from).y,
                toPixels(guide.to).x,
                toPixels(guide.to).y,
              ]}
              stroke="#E8871E"
              strokeWidth={1}
              dash={[2, 4]}
            />
          )}

          {drawStart && (
            <Circle x={toPixels(drawStart).x} y={toPixels(drawStart).y} radius={4} fill="#2D6CDF" />
          )}
        </Layer>
      </Stage>
    </div>
  );
}
