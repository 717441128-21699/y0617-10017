# ab-test-sdk

一个功能完善的前端 A/B 测试 SDK，支持原生 JS / React / Vue，具备批量上报、远程配置、离线补报等能力。

---

## 安装

### 1) 只用基础功能（experiment / track）

不需要安装 React、Vue。

```bash
npm install ab-test-sdk
```

### 2) 在 React 项目中使用

```bash
npm install ab-test-sdk react
```

### 3) 在 Vue 项目中使用

```bash
npm install ab-test-sdk vue
```

> SDK 采用**独立子入口**设计：
> - 基础入口 `from 'ab-test-sdk'` —— 无任何框架依赖
> - React 入口 `from 'ab-test-sdk/react'` —— 仅引入 `useExperiment` Hook
> - Vue 入口 `from 'ab-test-sdk/vue'` —— 仅引入 `useExperiment` Hook
>
> 只用基础 API 时不会附带 React/Vue 的任何依赖。

---

## 快速开始

### 一、原生 JavaScript

```js
import {
  initABTest,
  experiment,
  track,
  fetchConfig,
  setCommonProperties,
  setHeader,
} from 'ab-test-sdk';

// 1. 初始化（建议应用启动时执行一次）
initABTest({
  eventUrl: '/api/ab/events',        // 事件上报地址
  configUrl: '/api/ab/config',       // 远程实验配置地址（可选）
  batchSize: 10,                     // 批量上报阈值，默认 10
  flushInterval: 5000,               // 定时上报间隔（ms），默认 5000
  sampleRate: 1,                     // 采样率，0~1，默认 1
  commonProperties: {                // 全局公共属性，每条事件都会带上
    app: 'my-app',
    version: '1.2.0',
  },
  headers: {                         // 自定义请求头
    'X-Token': 'xxx',
  },
  retryPolicy: {                     // 失败重试策略
    maxRetries: 3,                   // 最多重试 3 次
    backoffBase: 1000,               // 首次重试延迟 1000ms
    backoffMultiplier: 2,            // 指数退避：1000 -> 2000 -> 4000ms
  },
  offlineEnabled: true,              // 离线/失败时写入 localStorage 补报
  offlineMaxEvents: 500,             // 本地最多保留 500 条
});

// 2. 拉取远程配置（可选，若配置了 configUrl 建议调用）
//    拉取失败不会阻塞页面，自动使用本地默认配置/本地缓存兜底
fetchConfig().then((config) => {
  console.log('远程配置已加载', config);
});

// 3. 声明实验，返回分配到的变体
//    参数 1: 实验名  参数 2: 默认变体列表  参数 3: 可选权重数组
const btnVariant = experiment('button-color', ['red', 'blue', 'green'], [50, 30, 20]);
const btn = document.createElement('button');
btn.style.color = btnVariant;
btn.textContent = '立即购买';
document.body.appendChild(btn);

// 4. 记录转化事件
btn.addEventListener('click', () => {
  track('purchase_click', {
    from: 'home_banner',
    amount: 99,
  });
});

// 5. 运行中动态补充公共属性 / Header
setCommonProperties({ userLevel: 'vip' });
setHeader('X-Trace-Id', 'trace-123');
```

### 二、React

从子入口 `ab-test-sdk/react` 引入 Hook：

```tsx
import { initABTest, useExperiment } from 'ab-test-sdk/react';
import { useEffect } from 'react';

// 应用入口初始化
initABTest({
  eventUrl: '/api/ab/events',
  configUrl: '/api/ab/config',
  sampleRate: 1,
  commonProperties: { app: 'shop-web' },
});

export default function App() {
  // 组件挂载前先拉远程配置
  useEffect(() => {
    initABTest({ configUrl: '/api/ab/config' }).fetchConfig();
  }, []);

  return <BuyButton />;
}

function BuyButton() {
  // 声明实验：默认变体 ['red','blue']
  const { variant, track } = useExperiment(
    'button-color',
    ['red', 'blue'],
    [60, 40] // 可选权重
  );

  return (
    <button
      style={{ backgroundColor: variant }}
      onClick={() => track('conversion', { source: 'pdp' })}
    >
      立即购买
    </button>
  );
}
```

Hook 返回值：
```
{
  variant: string;                 // 当前分到的变体
  track: (name, props?) => void;   // 记录转化
  fetchConfig: () => Promise;      // 拉取远程配置
  userId: string;                  // 用户唯一 ID
  isEnabled: boolean;              // SDK 是否启用
  sdk: ABTestSDK;                  // SDK 实例，可调用任意底层方法
}
```

### 三、Vue 3

从子入口 `ab-test-sdk/vue` 引入 Hook：

```vue
<script setup lang="ts">
import { initABTest, useExperiment } from 'ab-test-sdk/vue';
import { onMounted } from 'vue';

// 应用启动初始化
initABTest({
  eventUrl: '/api/ab/events',
  configUrl: '/api/ab/config',
  sampleRate: 1,
  commonProperties: { app: 'shop-app' },
});

onMounted(() => {
  initABTest({ configUrl: '/api/ab/config' }).fetchConfig();
});

// 声明实验
const { variant, track, userId } = useExperiment(
  'button-color',
  ['red', 'blue', 'green'],
  [50, 30, 20]
);

function onClick() {
  track('conversion', { source: 'cart' });
}
</script>

<template>
  <button :style="{ backgroundColor: variant }" @click="onClick">
    立即购买 (user: {{ userId }})
  </button>
</template>
```

---

## 核心特性详解

### 1. 一致性哈希与用户标识

- SDK 首次运行会自动生成 UUID，存储在 `localStorage['ab_test_user_id']`
- 实验分配采用 **FNV-1a 一致性哈希**，哈希 key = `userId + experimentName`
- 同一用户多次访问**始终分到同一个变体**，不会出现抖动
- 若传入 `weights` 数组，则按权重分流（和为任意正数即可，SDK 会归一化）

### 2. URL 强制变体调试

开发/测试时可通过 URL 参数 **绕过哈希**，强制进入指定变体：

```
https://example.com/page?force_exp=button-color:blue
```

同时强制多个实验：

```
https://example.com/page?force_exp=button-color:blue,title-text:variant2
```

> 注意：`force_exp` 指定的变体必须在该实验的变体列表中，否则忽略，回退到正常哈希。

### 3. 批量上报行为

所有事件（曝光 + 转化）先进入内存队列，满足**任一条件**即触发上报：

| 触发条件 | 说明 |
|---------|------|
| 队列达到 `batchSize` | 默认 10 条，立即 flush |
| 每 `flushInterval` 毫秒 | 默认 5000ms 定时上报一次 |
| 页面 `beforeunload` / 标签页隐藏 | 先落盘到 localStorage，再尽力发送（`keepalive`） |
| 网络从离线恢复为在线 | 把离线积压事件一起补发 |
| 手动调用 `flush()` | 立即触发一次 |

单条事件结构：
```json
{
  "type": "exposure | conversion",
  "eventName": "experiment_exposure | purchase",
  "experimentName": "button-color",
  "variant": "blue",
  "userId": "xxxx-xxxx-xxxx",
  "timestamp": 1718438400000,
  "properties": { "from": "banner" },
  "commonProperties": { "app": "my-app", "version": "1.2.0" }
}
```

请求格式：
```http
POST <eventUrl>
Content-Type: application/json
(自定义 headers)

{ "events": [ ... ] }
```

### 4. 失败重试与离线补报

**重试策略**（指数退避）：
- 默认：最多重试 3 次，延迟依次 1s → 2s → 4s
- 4xx 错误**不重试**（属于业务错误，重试无意义）
- 5xx / 网络错误 / 离线 → 进入重试 → 仍失败则落盘

**离线补报**：
- 上报失败的事件会写入 `localStorage['ab_test_offline_events']`（最多 500 条，超过保留最新）
- 下次启动 SDK 或网络恢复 `online` 事件触发时，自动读出并重新进入队列补报
- 页面 `beforeunload` 和 `visibilitychange:hidden` 时也会主动落盘，防止刷新丢失

### 5. 远程配置拉取

可以把实验变体/权重配置在服务端，SDK 启动后拉取：

1. 调用 `experiment(name, localVariants, localWeights)` 时：
   - 优先使用**远程配置**的 variants / weights / enabled
   - 若远程未拉到或失败，**自动回退到本地参数**，不阻塞渲染
2. 首次拉取成功后缓存到 localStorage（默认 TTL 5 分钟），缓存未过期直接使用
3. 可通过 `configCacheTTL` / `configFetchTimeout` 调整 TTL 和超时
4. 远程配置被禁用的实验（`enabled: false`）直接返回第一个变体，且不记录曝光

**远程配置接口格式**（GET `configUrl` 返回）：
```json
{
  "version": "2024-06-17",
  "expiresAt": 1718438400000,
  "experiments": [
    {
      "name": "button-color",
      "variants": ["red", "blue", "green"],
      "weights": [50, 30, 20],
      "enabled": true
    },
    {
      "name": "title-text",
      "variants": ["A", "B"],
      "weights": [80, 20]
    }
  ]
}
```

**推荐用法**：
```ts
// 入口处先 fire-and-forget 拉取（不阻塞渲染）
fetchConfig();

// 组件里正常 experiment()
// 第一次渲染用本地默认值
// 远程配置到达后，React/Vue Hook 会自动触发 re-render 切换到远程变体
```

### 6. 采样率

`sampleRate`（0~1）用于**转化事件**的随机采样，用于在大流量下降低上报量：
- `1` = 100% 采样（默认）
- `0.1` = 约 10% 的转化事件会被上报
- 曝光事件**始终 100%**上报（否则无法计算比例）

可运行时动态调整：
```ts
setSampleRate(0.5); // 之后只上报一半的转化事件
```

---

## 完整 API 列表

```ts
import {
  initABTest,          // 初始化（幂等，重复调用返回同一实例）
  getABTest,           // 获取单例实例
  experiment,          // 声明实验 → 变体
  track,               // 记录转化事件
  fetchConfig,         // 拉远程配置
  setCommonProperties, // 追加全局公共属性
  setHeader,           // 设置请求头
  setSampleRate,       // 设置采样率
  getUserId,           // 获取用户 ID
  flush,               // 立即触发上报
  destroy,             // 销毁 & 最终落盘
  ABTestSDK,           // 底层类（可直接 new，不使用单例）
} from 'ab-test-sdk';

// 配置项
interface ABTestOptions {
  storageKey?: string;
  eventUrl?: string;
  batchSize?: number;
  flushInterval?: number;
  enabled?: boolean;

  configUrl?: string;
  configFetchTimeout?: number;   // 默认 5000ms
  configCacheTTL?: number;       // 默认 5min

  sampleRate?: number;           // 0~1，默认 1
  commonProperties?: Record<string, unknown>;
  headers?: Record<string, string>;
  retryPolicy?: {
    maxRetries?: number;         // 默认 3
    backoffBase?: number;        // 默认 1000
    backoffMultiplier?: number;  // 默认 2
  };

  offlineStorageKey?: string;
  offlineEnabled?: boolean;      // 默认 true
  offlineMaxEvents?: number;     // 默认 500
}
```

---

## 常见问题

**Q: 远程配置还没拉回来，第一次渲染用了本地值，拉取后会更新吗？**
A: 直接调用 `experiment()` 不会自动更新 React/Vue 视图。但 `useExperiment` Hook 会在调用 `fetchConfig()` 之后通过状态更新触发重新渲染；或者你也可以在业务层 await `fetchConfig()` 完成后再渲染。

**Q: 如何保证同一用户跨设备一致？**
A: SDK 默认用 localStorage 本地 ID，跨设备不一致。若业务方有登录态，可在登录后把服务端用户 ID 写入公共属性（`commonProperties.userId = '12345'`），或继承 ABTestSDK 重写 `loadOrCreateUserId()`。

**Q: 事件上报接口要求签名 / Token 怎么办？**
A: 用 `headers` 配置或 `setHeader()` 动态设置，支持任意自定义 Header。

**Q: 忘记调用 `initABTest()` 会怎么样？**
A: `experiment()`、`track()` 会自动用默认配置创建一个实例（无 eventUrl 的情况下事件会在控制台打印，不会真正发送）。
