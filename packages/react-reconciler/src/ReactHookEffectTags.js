/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// TAGT HookFlags
export type HookFlags = number;

export const NoFlags = /*  */ 0b000; // 无副作用

// Represents whether effect should fire.
export const HasEffect = /* */ 0b001; // 有副作用, 可以被触发

// Represents the phase in which the effect (not the clean-up) fires.
export const Layout = /*    */ 0b010; // Layout, dom突变后同步触发
export const Passive = /*   */ 0b100; // Passive, dom突变前异步触发
