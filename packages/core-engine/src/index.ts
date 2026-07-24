/**
 * @archibim/core-engine — Phase 2: Core Modeling Engine.
 *
 * Built deep for Wall + Opening (door/window): real snapping, real
 * endpoint-joining, real parametric opening placement. Column / Beam /
 * Slab / Roof / Stair / etc. from the feature list follow this same
 * pattern as the next increment — see snapping.ts / join.ts for the
 * primitives every future element type will reuse.
 */
export * from './snapping';
export * from './join';
export * from './miter';
export * from './geometry-utils';
export * from './rooms';
export * from './floor-stacking';
export * from './compliance';
export * from './sun-position';
export * from './automation';
export * from './analytics';

