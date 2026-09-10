/**
 * Declarative shape descriptions.
 *
 * An agent talks to this server over MCP and cannot hand across a drawing
 * callback, so shapes are data. The same descriptions drive the programmatic
 * API, so there is one drawing path rather than two.
 */

import { Canvas, type Colour } from './canvas.js';

export interface ShapeBase {
  colour: Colour;
  /** Outline width. Omit to fill. */
  thickness?: number;
  antialias?: boolean;
}

export type Shape =
  | (ShapeBase & { type: 'rect'; x: number; y: number; width: number; height: number })
  | (ShapeBase & { type: 'circle'; x: number; y: number; radius: number })
  | (ShapeBase & { type: 'ellipse'; x: number; y: number; radiusX: number; radiusY: number })
  | (ShapeBase & { type: 'polygon'; points: [number, number][] })
  | (ShapeBase & { type: 'line'; x1: number; y1: number; x2: number; y2: number })
  | (ShapeBase & { type: 'fill' });

export interface FrameSpec {
  shapes: Shape[];
}

export function drawShape(canvas: Canvas, shape: Shape): Canvas {
  const options = { thickness: shape.thickness, antialias: shape.antialias };
  switch (shape.type) {
    case 'fill':
      return canvas.rect(0, 0, canvas.width, canvas.height, shape.colour, options);
    case 'rect':
      return canvas.rect(shape.x, shape.y, shape.width, shape.height, shape.colour, options);
    case 'circle':
      return canvas.circle(shape.x, shape.y, shape.radius, shape.colour, options);
    case 'ellipse':
      return canvas.ellipse(shape.x, shape.y, shape.radiusX, shape.radiusY, shape.colour, options);
    case 'polygon':
      return canvas.polygon(shape.points, shape.colour, options);
    case 'line':
      return canvas.line(shape.x1, shape.y1, shape.x2, shape.y2, shape.colour, options);
  }
}

/** Render one frame's worth of shapes onto a new canvas. */
export function drawFrame(
  width: number,
  height: number,
  frame: FrameSpec,
  background: Colour = 'transparent',
): Canvas {
  const canvas = new Canvas(width, height, background);
  for (const shape of frame.shapes) drawShape(canvas, shape);
  return canvas;
}
