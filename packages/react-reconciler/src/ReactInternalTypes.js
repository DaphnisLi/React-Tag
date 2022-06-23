/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Source} from 'shared/ReactElementType';
import type {
  RefObject,
  ReactContext,
  MutableSourceSubscribeFn,
  MutableSourceGetSnapshotFn,
  MutableSourceVersion,
  MutableSource,
} from 'shared/ReactTypes';
import type {SuspenseInstance} from './ReactFiberHostConfig';
import type {WorkTag} from './ReactWorkTags';
import type {TypeOfMode} from './ReactTypeOfMode';
import type {Flags} from './ReactFiberFlags';
import type {Lane, LanePriority, Lanes, LaneMap} from './ReactFiberLane';
import type {HookType} from './ReactFiberHooks.old';
import type {RootTag} from './ReactRootTags';
import type {TimeoutHandle, NoTimeout} from './ReactFiberHostConfig';
import type {Wakeable} from 'shared/ReactTypes';
import type {Interaction} from 'scheduler/src/Tracing';

export type ReactPriorityLevel = 99 | 98 | 97 | 96 | 95 | 90;

export type ContextDependency<T> = {
  context: ReactContext<T>,
  observedBits: number,
  next: ContextDependency<mixed> | null,
  ...
};

export type Dependencies = {
  lanes: Lanes,
  firstContext: ContextDependency<mixed> | null,
  ...
};

// A Fiber is work on a Component that needs to be done or was done. There can
// be more than one per component.
// TAGT Fiber

 /**
  * 一个 Fiber 对象代表一个即将渲染或者已经渲染的组件(ReactElement), 一个组件可能对应两个 Fiber(current 和 WorkInProgress)
  */
export type Fiber = {|
  // These first fields are conceptually members of an Instance. This used to
  // be split into a separate type and intersected with the other Fiber fields,
  // but until Flow fixes its intersection bugs, we've merged them into a
  // single type.

  // An Instance is shared between all versions of a component. We can easily
  // break this out into a separate object to avoid copying so much to the
  // alternate versions of the tree. We put this on a single object for now to
  // minimize the number of objects created during the initial render.

  // Tag identifying the type of fiber.
  tag: WorkTag, // 表示 Fiber 类型, 根据 ReactElement 组件的 type 进行生成, 在 react 内部共定义了 25 种 tag.

  // Unique identifier of this child.
  key: null | string, // 和 ReactElement 组件的 key 一致.

  // The value of element.type which is used to preserve the identity during
  // reconciliation of this child.
  elementType: any, // 一般来讲和 ReactElement 组件的 type 一致

  // The resolved function/class/ associated with this fiber.
  type: any, // 一般来讲和 Fiber.elementType 一致. 一些特殊情形下, 比如在开发环境下为了兼容热更新(HotReloading), 会对function, class, ForwardRef 类型的 ReactElement 做一定的处理, 这种情况会区别于 Fiber.elementType, 具体赋值关系可以查看源文件.

  // The local state associated with this fiber.
  stateNode: any, // 与 Fiber 关联的局部状态节点(比如: HostComponent 类型指向与 Fiber 节点对应的 Dom 节点; 根节点 Fiber.stateNode 指向的是 FiberRoot; class 类型节点其 stateNode 指向的是 class 实例).

  // Conceptual aliases
  // parent : Instance -> return The parent happens to be the same as the
  // return fiber since we've merged the fiber and instance.

  // Remaining fields belong to Fiber

  // The Fiber to return to after finishing processing this one.
  // This is effectively the parent, but there can be multiple parents (two)
  // so this is only the parent of the thing we're currently processing.
  // It is conceptually the same as the return address of a stack frame.
  
  return: Fiber | null, // 指向父节点

  // Singly Linked List Tree Structure.
  child: Fiber | null, // 指向第一个子节点.
  sibling: Fiber | null, // 指向下一个兄弟节点.
  index: number, // Fiber 在兄弟节点中的索引, 如果是单节点默认为 0.

  // The ref last used to attach this node.
  // I'll avoid adding an owner field for prod and model that as functions.
  ref: // 指向在 ReactElement 组件上设置的 ref(string 类型的ref除外, 这种类型的 ref 已经不推荐使用, reconciler阶段会将string类型的ref转换成一个function类型).
    | null
    | (((handle: mixed) => void) & {_stringRef: ?string, ...})
    | RefObject,

  // Input is the data coming into process this fiber. Arguments. Props.
  // This type will be more specific once we overload the tag.
  pendingProps: any, // 输入属性, 从 ReactElement 对象传入的 props. 用于和 Fiber.memoizedProps 比较可以得出属性是否变动.
  // The props used to create the output.
  memoizedProps: any, // 上一次生成子节点时用到的属性, 生成子节点之后保持在内存中. 向下生成子节点之前叫做 pendingProps, 生成子节点之后会把 pendingProps 赋值给 memoizedProps 用于下一次比较。pendingProps 和 memoizedProps 比较可以得出属性是否变动.

  // A queue of state updates and callbacks.
  updateQueue: mixed, // 存储 update 更新对象的队列, 每一次发起更新, 都需要在该队列上创建一个 update 对象.

  // The state used to create the output
  memoizedState: any, // 上一次生成子节点之后保持在内存中的局部状态.

  // Dependencies (contexts, events) for this fiber, if it has any
  dependencies: Dependencies | null, // 该 Fiber 节点所依赖的(contexts, events)等

  // Bitfield that describes properties about the fiber and its subtree. E.g.
  // the ConcurrentMode flag indicates whether the subtree should be async-by-
  // default. When a fiber is created, it inherits the mode of its
  // parent. Additional flags can be set at creation time, but after that the
  // value should remain unchanged throughout the fiber's lifetime, particularly
  // before its child fibers are created.
  mode: TypeOfMode, // 二进制位 Bitfield,继承至父节点,影响本 fiber 节点及其子树中所有节点. 与 react 应用的运行模式有关(有 ConcurrentMode, BlockingMode, NoMode 等选项).

  // ? 副作用
  flags: Flags, // 标志位, 副作用标记(在 16.x 版本中叫做effectTag, 相应pr), 在ReactFiberFlags.js中定义了所有的标志位. reconciler阶段会将所有拥有flags标记的节点添加到副作用链表中, 等待 commit 阶段的处理.
  subtreeFlags: Flags, // 替代16.x版本中的 firstEffect, nextEffect. 当设置了 enableNewReconciler=true 才会启用
  deletions: Array<Fiber> | null, // 存储将要被删除的子节点. 默认未开启, 当设置了 enableNewReconciler=true 才会启用

  // Singly linked list fast path to the next fiber with side-effects.
  nextEffect: Fiber | null, // 单向链表, 指向下一个有副作用的 fiber 节点.

  // The first and last fiber with side-effect within this subtree. This allows
  // us to reuse a slice of the linked list when we reuse the work done within
  // this fiber.
  firstEffect: Fiber | null, // 指向副作用链表中的第一个 fiber 节点.
  lastEffect: Fiber | null, // 指向副作用链表中的最后一个 fiber 节点.
  // ? 优先级
  lanes: Lanes, // 本 fiber 节点所属的优先级, 创建 fiber 的时候设置.
  childLanes: Lanes, // 子节点所属的优先级.

  // This is a pooled version of a Fiber. Every fiber that gets updated will
  // eventually have a pair. There are cases when we can clean up pairs to save
  // memory if we need to.
  alternate: Fiber | null, // 指向内存中的另一个 fiber, 每个被更新的 fiber 节点在内存中都是成对出现(current 和 workInProgress)

  // Time spent rendering this Fiber and its descendants for the current update.
  // This tells us how well the tree makes use of sCU for memoization.
  // It is reset to 0 each time we render and only updated when we don't bailout.
  // This field is only set when the enableProfilerTimer flag is enabled.

  // ? 性能统计相关(开启 enableProfilerTimer 后才会统计)
  // react-dev-tool会根据这些时间统计来评估性能
  actualDuration?: number, // 本次更新过程, 本节点以及子树所消耗的总时间

  // If the Fiber is currently active in the "render" phase,
  // This marks the time at which the work began.
  // This field is only set when the enableProfilerTimer flag is enabled.
  actualStartTime?: number, // 标记本 Fiber 节点开始构建的时间

  // Duration of the most recent render time for this Fiber.
  // This value is not updated when we bailout for memoization purposes.
  // This field is only set when the enableProfilerTimer flag is enabled.
  selfBaseDuration?: number, // 用于最近一次生成本 Fiber 节点所消耗的时间

  // Sum of base times for all descendants of this Fiber.
  // This value bubbles up during the "complete" phase.
  // This field is only set when the enableProfilerTimer flag is enabled.
  treeBaseDuration?: number, // 生成子树所消耗的时间的总和

  // Conceptual aliases
  // workInProgress : Fiber ->  alternate The alternate used for reuse happens
  // to be the same as work in progress.
  // __DEV__ only
  _debugID?: number,
  _debugSource?: Source | null,
  _debugOwner?: Fiber | null,
  _debugIsCurrentlyTiming?: boolean,
  _debugNeedsRemount?: boolean,

  // Used to verify that the order of hooks does not change between renders.
  _debugHookTypes?: Array<HookType> | null,
|};

type BaseFiberRootProperties = {|
  // The type of root (legacy, batched, concurrent, etc.)
  tag: RootTag,

  // Any additional information from the host associated with this root.
  containerInfo: any,
  // Used only by persistent updates.
  pendingChildren: any,
  // The currently active root fiber. This is the mutable root of the tree.
  current: Fiber,

  pingCache: WeakMap<Wakeable, Set<mixed>> | Map<Wakeable, Set<mixed>> | null,

  // A finished work-in-progress HostRoot that's ready to be committed.
  finishedWork: Fiber | null,
  // Timeout handle returned by setTimeout. Used to cancel a pending timeout, if
  // it's superseded by a new one.
  timeoutHandle: TimeoutHandle | NoTimeout,
  // Top context object, used by renderSubtreeIntoContainer
  context: Object | null,
  pendingContext: Object | null,
  // Determines if we should attempt to hydrate on the initial mount
  +hydrate: boolean,

  // Used by useMutableSource hook to avoid tearing during hydration.
  mutableSourceEagerHydrationData?: Array<
    MutableSource<any> | MutableSourceVersion,
  > | null,

  // Node returned by Scheduler.scheduleCallback. Represents the next rendering
  // task that the root will work on.
  callbackNode: *,
  callbackPriority: LanePriority,
  eventTimes: LaneMap<number>,
  expirationTimes: LaneMap<number>,

  pendingLanes: Lanes,
  suspendedLanes: Lanes,
  pingedLanes: Lanes,
  expiredLanes: Lanes,
  mutableReadLanes: Lanes,

  finishedLanes: Lanes,

  entangledLanes: Lanes,
  entanglements: LaneMap<Lanes>,
|};

// The following attributes are only used by interaction tracing builds.
// They enable interactions to be associated with their async work,
// And expose interaction metadata to the React DevTools Profiler plugin.
// Note that these attributes are only defined when the enableSchedulerTracing flag is enabled.
type ProfilingOnlyFiberRootProperties = {|
  interactionThreadID: number,
  memoizedInteractions: Set<Interaction>,
  pendingInteractionMap: Map<Lane | Lanes, Set<Interaction>>,
|};

export type SuspenseHydrationCallbacks = {
  onHydrated?: (suspenseInstance: SuspenseInstance) => void,
  onDeleted?: (suspenseInstance: SuspenseInstance) => void,
  ...
};

// The follow fields are only used by enableSuspenseCallback for hydration.
type SuspenseCallbackOnlyFiberRootProperties = {|
  hydrationCallbacks: null | SuspenseHydrationCallbacks,
|};

// Exported FiberRoot type includes all properties,
// To avoid requiring potentially error-prone :any casts throughout the project.
// Profiling properties are only safe to access in profiling builds (when enableSchedulerTracing is true).
// The types are defined separately within this file to ensure they stay in sync.
// (We don't have to use an inline :any cast when enableSchedulerTracing is disabled.)
export type FiberRoot = {
  ...BaseFiberRootProperties,
  ...ProfilingOnlyFiberRootProperties,
  ...SuspenseCallbackOnlyFiberRootProperties,
  ...
};

type BasicStateAction<S> = (S => S) | S;
type Dispatch<A> = A => void;

export type Dispatcher = {|
  readContext<T>(
    context: ReactContext<T>,
    observedBits: void | number | boolean,
  ): T,
  useState<S>(initialState: (() => S) | S): [S, Dispatch<BasicStateAction<S>>],
  useReducer<S, I, A>(
    reducer: (S, A) => S,
    initialArg: I,
    init?: (I) => S,
  ): [S, Dispatch<A>],
  useContext<T>(
    context: ReactContext<T>,
    observedBits: void | number | boolean,
  ): T,
  useRef<T>(initialValue: T): {|current: T|},
  useEffect(
    create: () => (() => void) | void,
    deps: Array<mixed> | void | null,
  ): void,
  useLayoutEffect(
    create: () => (() => void) | void,
    deps: Array<mixed> | void | null,
  ): void,
  useCallback<T>(callback: T, deps: Array<mixed> | void | null): T,
  useMemo<T>(nextCreate: () => T, deps: Array<mixed> | void | null): T,
  useImperativeHandle<T>(
    ref: {|current: T | null|} | ((inst: T | null) => mixed) | null | void,
    create: () => T,
    deps: Array<mixed> | void | null,
  ): void,
  useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void,
  useDeferredValue<T>(value: T): T,
  useTransition(): [(() => void) => void, boolean],
  useMutableSource<Source, Snapshot>(
    source: MutableSource<Source>,
    getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
    subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
  ): Snapshot,
  useOpaqueIdentifier(): any,

  unstable_isNewReconciler?: boolean,
|};
