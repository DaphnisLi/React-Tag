/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { enableIsInputPending } from '../SchedulerFeatureFlags';

// TAGS Scheduler 关键函数：请求调度，时间切片
// 调度相关: 请求或取消调度
export let requestHostCallback; // 请求及时回调
export let cancelHostCallback; // 取消及时回调
export let requestHostTimeout; // 请求延时回调，应该是在下一次事件循环执行
export let cancelHostTimeout; // 取消延时回调

// 时间切片(time slicing)相关: 执行时间分割, 让出主线程(把控制权归还浏览器, 浏览器可以处理用户输入, UI 绘制等紧急任务).
export let shouldYieldToHost; // 是否让出主线程
export let requestPaint; // 请求绘制
export let getCurrentTime; // 获取当前时间
export let forceFrameRate; // 强制设置 yieldInterval (让出主线程的周期)

const hasPerformanceNow =
  typeof performance === 'object' && typeof performance.now === 'function';

// 如果有 performance 可以使用就用，没有就用Date
// TAGS 获取当前时间
if (hasPerformanceNow) {
  const localPerformance = performance;
  getCurrentTime = () => localPerformance.now();
} else {
  const localDate = Date;
  const initialTime = localDate.now();
  getCurrentTime = () => localDate.now() - initialTime;
}

if (
  // If Scheduler runs in a non-DOM environment, it falls back to a naive
  // implementation using setTimeout.
  typeof window === 'undefined' ||
  // Check if MessageChannel is supported, too.
  typeof MessageChannel !== 'function'
) {
  // If this accidentally gets imported in a non-browser environment, e.g. JavaScriptCore,
  // fallback to a naive implementation.
  let _callback = null;
  let _timeoutID = null;
  const _flushCallback = function () {
    if (_callback !== null) {
      try {
        const currentTime = getCurrentTime();
        const hasRemainingTime = true;
        _callback(hasRemainingTime, currentTime);
        _callback = null;
      } catch (e) {
        setTimeout(_flushCallback, 0);
        throw e;
      }
    }
  };
  requestHostCallback = function (cb) {
    if (_callback !== null) {
      // Protect against re-entrancy.
      setTimeout(requestHostCallback, 0, cb);
    } else {
      _callback = cb;
      setTimeout(_flushCallback, 0);
    }
  };
  cancelHostCallback = function () {
    _callback = null;
  };
  requestHostTimeout = function (cb, ms) {
    _timeoutID = setTimeout(cb, ms);
  };
  cancelHostTimeout = function () {
    clearTimeout(_timeoutID);
  };
  shouldYieldToHost = function () {
    return false;
  };
  requestPaint = forceFrameRate = function () { };
} else {
  // Capture local references to native APIs, in case a polyfill overrides them.
  const setTimeout = window.setTimeout;
  const clearTimeout = window.clearTimeout;

  if (typeof console !== 'undefined') {
    // todo: Scheduler no longer requires these methods to be polyfilled. But
    // maybe we want to continue warning if they don't exist, to preserve the
    // option to rely on it in the future?
    const requestAnimationFrame = window.requestAnimationFrame;
    const cancelAnimationFrame = window.cancelAnimationFrame;

    if (typeof requestAnimationFrame !== 'function') {
      // Using console['error'] to evade Babel and ESLint
      console['error'](
        "This browser doesn't support requestAnimationFrame. " +
        'Make sure that you load a ' +
        'polyfill in older browsers. https://reactjs.org/link/react-polyfills',
      );
    }
    if (typeof cancelAnimationFrame !== 'function') {
      // Using console['error'] to evade Babel and ESLint
      console['error'](
        "This browser doesn't support cancelAnimationFrame. " +
        'Make sure that you load a ' +
        'polyfill in older browsers. https://reactjs.org/link/react-polyfills',
      );
    }
  }

  let isMessageLoopRunning = false;
  let scheduledHostCallback = null;
  let taskTimeoutID = -1;

  // Scheduler periodically yields in case there is other work on the main
  // thread, like user events. By default, it yields multiple times per frame.
  // It does not attempt to align with frame boundaries, since most tasks don't
  // need to be frame aligned; for those that do, use requestAnimationFrame.

  // TAGS 时间切片周期, 默认是5ms，只能通过 forceFrameRate 改变时间周期。如果一个 task 运行超过该周期, 下一个 task 执行之前, 会把控制权归还浏览器。
  let yieldInterval = 5;
  /** 任务到期的最后期限，其实就是倒计时5ms */
  let deadline = 0;

  // todo: Make this configurable
  // todo: Adjust this based on priority?
  const maxYieldInterval = 300;
  let needsPaint = false;

  if (
    enableIsInputPending &&
    navigator !== undefined &&
    navigator.scheduling !== undefined &&
    navigator.scheduling.isInputPending !== undefined
  ) {
    const scheduling = navigator.scheduling;

    // ! 注意shouldYieldToHost的判定条件:
    // currentTime >= deadline: 只有时间超过deadline之后才会让出主线程(其中deadline = currentTime + yieldInterval).
    // yieldInterval默认是5ms, 只能通过forceFrameRate函数来修改(事实上在 v17.0.2 源码中, 并没有使用到该函数).
    // 如果一个task运行时间超过5ms, 下一个task执行之前, 会把控制权归还浏览器.
    // navigator.scheduling.isInputPending(): 这 facebook 官方贡献给 Chromium 的 api, 现在已经列入 W3C 标准(具体解释), 用于判断是否有输入事件(包括: input 框输入事件, 点击事件等).
    
    // TAGS 是否让出主线程
    shouldYieldToHost = function () {
      const currentTime = getCurrentTime();
      // deadline = currentTime + yieldInterval 其实就是开始执行任务的时间 + 5ms。可以简单理解成倒计时 5ms
      if (currentTime >= deadline) {
        // ? 让出主线程
        // There's no time left. We may want to yield control of the main
        // thread, so the browser can perform high priority tasks. The main ones
        // are painting and user input. If there's a pending paint or a pending
        // input, then we should yield. But if there's neither, then we can
        // yield less often while remaining responsive. We'll eventually yield
        // regardless, since there could be a pending paint that wasn't
        // accompanied by a call to `requestPaint`, or other main thread tasks
        // like network events.
        if (needsPaint || scheduling.isInputPending()) {
          // There is either a pending paint or a pending input.
          return true;
        }
        // There's no pending input. Only yield if we've reached the max
        // yield interval.
        // 在持续运行的react应用中, currentTime肯定大于300ms, 这个判断只在初始化过程中才有可能返回false
        return currentTime >= maxYieldInterval;
      } else {
        // There's still time left in the frame.
        return false;
      }
    };

    //TAGS 请求绘制
    requestPaint = function () {
      needsPaint = true;
    };
  } else {
    // `isInputPending` is not available. Since we have no way of knowing if
    // there's pending input, always yield at the end of the frame.
    shouldYieldToHost = function () {
      return getCurrentTime() >= deadline;
    };

    // Since we yield every frame regardless, `requestPaint` has no effect.
    requestPaint = function () { };
  }

  // TAGS 设置时间切片的周期
  forceFrameRate = function (fps) {
    if (fps < 0 || fps > 125) {
      // Using console['error'] to evade Babel and ESLint
      console['error'](
        'forceFrameRate takes a positive int between 0 and 125, ' +
        'forcing frame rates higher than 125 fps is not supported',
      );
      return;
    }
    if (fps > 0) {
      yieldInterval = Math.floor(1000 / fps);
    } else {
      // reset the framerate
      yieldInterval = 5;
    }
  };
  /**
   * ? 接收 port2.postMessage 的消息
   * 作用：执行 Task 回调函数
   */
  const performWorkUntilDeadline = () => {
    if (scheduledHostCallback !== null) {
      // 1. 获取当前时间
      const currentTime = getCurrentTime();
      // Yield after `yieldInterval` ms, regardless of where we are in the vsync
      // cycle. This means there's always time remaining at the beginning of
      // the message event.'

      // 2. 更新deadline
      deadline = currentTime + yieldInterval;
      const hasTimeRemaining = true;
      try {
        // 3. 执行回调, 返回是否有还有剩余任务
        const hasMoreWork = scheduledHostCallback(
          hasTimeRemaining,
          currentTime,
        );
        if (!hasMoreWork) {
          // 没有剩余任务, 退出
          isMessageLoopRunning = false;
          scheduledHostCallback = null;
        } else {
          // If there's more work, schedule the next message event at the end
          // of the preceding one.

          // 有剩余任务, 发起新的调度
          port.postMessage(null);
        }
      } catch (error) {
        // If a scheduler task throws, exit the current browser task so the
        // error can be observed.

        // 如有异常, 重新发起调度
        port.postMessage(null);
        throw error;
      }
    } else {
      isMessageLoopRunning = false;
    }
    // Yielding to the browser will give it a chance to paint, so we can
    // reset this.
    // 重置开关
    needsPaint = false;
  };

  //TAGS MessageChannel
  /**
   * 此处需要注意: MessageChannel 在浏览器事件循环中属于宏任务，所以调度中心永远是异步执行回调函数。
   */
  const channel = new MessageChannel();
  const port = channel.port2;
  channel.port1.onmessage = performWorkUntilDeadline;

  // TAGS 请求及时回调
  requestHostCallback = function (callback) {
    // 保存 callback
    scheduledHostCallback = callback;
    if (!isMessageLoopRunning) {
      isMessageLoopRunning = true;
      // ? 给 port1.onmessage 发送消息
      port.postMessage(null);
    }
  };

  // TAGS 取消及时回调
  cancelHostCallback = function () {
    // 直接把调度的回调函数给弄没了
    scheduledHostCallback = null;
  };

  // TAGS 请求延时回调
  requestHostTimeout = function (callback, ms) {
    taskTimeoutID = setTimeout(() => {
      callback(getCurrentTime());
    }, ms);
  };

  // TAGS 取消延时回调
  cancelHostTimeout = function () {
    clearTimeout(taskTimeoutID);
    taskTimeoutID = -1;
  };
}
