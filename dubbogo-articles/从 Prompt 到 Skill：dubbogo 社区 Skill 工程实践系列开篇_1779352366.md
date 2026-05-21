# 从 Prompt 到 Skill：dubbogo 社区 Skill 工程实践系列开篇

**作者**: dubbogo示土区
**发布时间**: 
**原文链接**: https://mp.weixin.qq.com/s/AzWe8NshXdXPtqnY83aIag

---



在 Go 后端、微服务和网关工程里，最消耗团队的往往不是“不会做”，而是同类排障、评审与交付流程一遍遍重来：规则靠口口相传，经验散在文档里，AI 也常因上下文不足而答得不稳。对 dubbogo 的诸多项目，尤其是 Pixiu / AI Gateway 场景而言，把这些重复流程沉淀为可触发、可复用、可评测、可维护的 Skill，才是把经验变成工程资产的关键。本文是该系列开篇，先回答“为什么写、何时该写、如何写得可维护”，后续再进入触发、目录、评测与治理的具体实践。


Agent Skill 不是“更长的提示词”，也不是简单的工具调用说明。更准确地说，它是一种把重复性需求封装成**可触发、可复用、可评测、可维护**的 Agent 能力包的方式。


如果一句话概括：


Skill 的本质，是让 Agent 在下一次遇到同类问题时，更少猜、更少问、更少翻资料、更少犯错，并且更容易验证。


再精确一点说，Skill 的本质还包括**渐进式加载**：


Agent 不应该一开始就背上所有知识，而应该先看到最小触发信息；只有任务匹配时才加载主流程；只有执行到具体分支时才读取详细资料或运行脚本。


这也是 Skill 和“长 prompt”最根本的差异。长 prompt 是一次性把所有内容塞进上下文；Skill 是把内容分层，让 Agent 按需加载。


这篇文章不追求把所有生态细节都列全，而是围绕一个实践问题展开：**如果我要自己写一个 Skill，应该怎么判断它值不值得写，怎么设计目录，怎么写`SKILL.md`，怎么评估好坏，怎么避免安全和维护问题？**


全文分为 12 个部分：

```
1. Skill 到底是什么2. 为什么需要 Skill，而不是更长的 Prompt3. Skill 的底层原理：渐进式加载4. 主流规范和生态差异5. Skill 的目录设计6. SKILL.md 应该怎么写7. references / scripts / assets / agents / evals 怎么放8. Trigger Engineering：如何让 Skill 准确触发9. Workflow / Example / Script Engineering10. 如何评价一个 Skill 的好坏11. eval-viewer 与评测闭环12. 安全、权限和团队治理13. 从重复需求到 Skill 的完整开发流程
```

## 1. Skill 到底是什么


Skill 是一个可复用的任务能力包。它通常是一个目录，里面至少包含一个`SKILL.md`文件，也可以包含`references/`、`scripts/`、`assets/`等资源。Agent 在遇到相关任务时，会根据 Skill 的`name`和`description`判断是否需要加载它；触发后再读取`SKILL.md`，并按需读取额外文档或执行脚本。


所以，Skill 的关键不是“它写了多少知识”，而是“它能否在正确时机进入 Agent 的执行路径”。


一个简单的 Skill 可能只有：

```
code-review/└── SKILL.md
```


一个更完整的 Skill 可能是：

```
k8s-gateway-debug/├── SKILL.md├── references/│   ├── minikube-networking.md│   ├── metallb.md│   └── nginx-gateway.md├── scripts/│   └── collect-diagnostics.sh└── evals/    └── evals.json
```


前者适合纯文本规范，比如 code review 输出格式、commit message 规则、客服回复风格。后者适合复杂排障流程：需要参考文档，需要收集命令输出，需要区分多个故障层，还需要用 eval 验证它是否真的有帮助。


从使用体验上看，Skill 像是给 Agent 增加了一种“专业习惯”。没有 Skill 时，Agent 只能依靠模型已有知识和当前 prompt；有 Skill 后，Agent 可以在特定任务中加载团队沉淀过的流程、文档、脚本和验证标准。


这就是为什么我更愿意把 Skill 理解成：

```
Skill = 触发条件 + 渐进式加载 + 执行流程 + 按需知识 + 确定性工具 + 验证标准
```

## 2. 为什么需要 Skill，而不是更长的 Prompt


很多人第一次接触 Skill 时，会有一个疑问：既然 Skill 的主体也是 Markdown，那为什么不直接写一个更长的 prompt？


这个问题很关键。因为如果只是偶尔用一次，长 prompt 完全够用。但只要任务开始重复，prompt 就会暴露几个问题。


第一，prompt 很难版本化。一个团队里可能有人复制了旧版 prompt，有人省略了几条规则，有人临时加了不兼容要求。最后大家都以为自己在执行“同一个流程”，实际输出越来越不一致。


第二，prompt 会污染上下文。把所有团队规范、框架知识、API 文档、错误码、示例都塞到系统提示词或用户提示词里，会让每次任务都背负大量无关内容。模型注意力被稀释，token 成本上升，冲突规则也更难处理。


第三，prompt 不容易评测。你可以说“请按规范输出”，但很难稳定检查 Agent 是否真的读了对应文档、是否执行了验证命令、是否在失败时走了 fallback。


Skill 解决的正是这些问题。它把一个重复任务沉淀成一个可维护的文件包：

- `description`负责触发。
- `SKILL.md`负责主流程。
- `references/`负责长文档。
- `scripts/`负责确定性动作。
- `assets/`负责模板资源。
- `evals/`负责质量验证。



一个好的 Skill，会让 Agent 在下一次遇到同类任务时“自动进入正确工作模式”。这和每次复制一段 prompt 的体验完全不同。


可以用一句话判断是否该写 Skill：


如果这个任务会重复出现，而且每次都需要相同的判断流程、输出格式或验证步骤，就应该考虑写成 Skill。


反过来，如果只是一次性讨论、临时偏好、实时查询，或者用户当前 prompt 已经足够清楚，那就没有必要 Skill 化。

## 3. Skill 的底层原理：渐进式加载


如果只用一个技术概念解释 Skill，我会选**渐进式加载**，也就是 progressive disclosure。


它的意思是：Agent 不需要在一开始读取所有内容，而是按任务需要逐层展开。


典型加载过程是：

```
第 1 层：Metadata- name- description- skill path第 2 层：Instructions- 完整 SKILL.md- 主流程- 输入输出- 验证规则- references/scripts/assets 的入口第 3 层：Resources- references/ 中的详细文档- scripts/ 中的可执行逻辑- assets/ 中的模板和静态资源- evals/ 中的测试数据
```


这一层设计非常关键。因为它让 Skill 同时拥有两个看起来矛盾的优点：

```
1. 平时很轻：只暴露 name 和 description，不污染上下文。2. 用时很深：触发后可以读取完整流程、文档、脚本和模板。
```


这也是为什么`description`如此重要。它位于第一层，是 Agent 判断是否加载 Skill 的入口。如果 description 写得太弱，Skill 后面写得再好也不会被使用；如果 description 写得太宽，Skill 会在不该出现时误触发。


`SKILL.md`则是第二层。它不应该放所有知识，而应该像索引和 runbook：告诉 Agent 主流程是什么、什么时候读哪个 reference、什么时候运行哪个 script、最终如何验证。


`references/`、`scripts/`、`assets/`是第三层。它们只有在任务需要时才进入执行路径。这就是上下文经济：不把所有资料提前塞给 Agent，而是在正确时间加载正确资料。

### 3.1 为什么渐进式加载比长 prompt 更好


长 prompt 的问题是“一次性加载”。不管任务是否需要，所有规则、示例、背景和文档都进上下文。这样会带来几个后果：

- 无关内容干扰当前任务。
- token 成本增加。
- 规则冲突更难判断。
- 文档更新后很难知道用户复制的是哪一版。
- Agent 更容易忽略真正关键的步骤。



Skill 的渐进式加载则是“先路由，再执行，再按需展开”。它把内容拆成层：

```
description：负责触发SKILL.md：负责流程references：负责细节scripts：负责确定性动作assets：负责输出资源evals：负责质量验证
```


这让 Skill 更像一个工程化能力包，而不是一段长提示词。

### 3.2 渐进式加载如何影响写作


理解渐进式加载后，`SKILL.md`的写法会完全不同。


你不会再把所有 API 文档复制进主文件，而是写：

```
Read `references/api.md` when implementing or reviewing endpoint behavior.
```


你不会在正文里展开所有错误码，而是写：

```
For error code mapping, read `references/error-codes.md`.
```


你不会让模型手动检查 JSON，而是写：

```
Run `python scripts/validate.py --input output.json --schema references/schema.json` before final delivery.
```


这种写法的重点是“导航”。`SKILL.md`不是仓库本身，而是仓库的入口和执行路线图。

### 3.3 渐进式加载的反模式


常见反模式有三类。


第一，把所有东西塞进`SKILL.md`：

```
SKILL.md- 1000 行 API 文档- 200 行示例- 100 行错误码- 50 行 changelog
```


这破坏了渐进式加载，因为主文件变成了知识垃圾桶。


第二，reference 没有入口：

```
references/├── api.md├── examples.md└── edge-cases.md
```


但`SKILL.md`从来没告诉 Agent 什么时候读这些文件。结果是 reference 很可能永远不会被用到。


第三，引用链太深：

```
SKILL.md → references/index.md → references/api/index.md → references/api/v2/details.md
```


Agent 不是人类读者，不应该让它在深层链接里寻找关键规则。最好的方式是从`SKILL.md`一层直达关键 reference。

### 3.4 判断一个 Skill 是否真正利用了渐进式加载


可以问四个问题：

```
1. 只看 description，Agent 能否知道什么时候用？2. 只读 SKILL.md，Agent 能否知道主流程怎么走？3. 需要细节时，Agent 能否从 SKILL.md 找到具体 reference？4. 需要确定性动作时，Agent 能否从 SKILL.md 找到具体 script？
```


如果答案都是“是”，这个 Skill 才真正利用了渐进式加载。

## 4. 主流规范和生态差异


目前围绕 Agent Skill 的生态，大致可以分成几类：

```
1. AgentSkills.io 开放规格2. OpenAI / Codex Skills3. Anthropic / Claude Skills4. LangChain Deep Agents Skills5. OpenClaw / marketplace 型 Skills
```

### 4.1 AgentSkills.io：最小公约数


AgentSkills.io 更像跨平台基础规格。它定义了一个 Skill 目录至少应该包含`SKILL.md`，并支持`scripts/`、`references/`、`assets/`等可选目录。


核心结构是：

```
skill-name/├── SKILL.md├── scripts/├── references/└── assets/
```


它最重要的价值是提供“通用底座”：无论你后续在哪个平台用，`SKILL.md + scripts/references/assets`都是最稳定、最可移植的结构。


因此，如果你要写一个希望长期维护、跨平台迁移的 Skill，建议先按 AgentSkills.io 的最小公约数设计。平台扩展可以有，但不要让平台扩展污染基础结构。

### 4.2 OpenAI / Codex：强调 coding workflow 和产品化扩展


OpenAI Codex Skills 在基础结构之上增加了 Codex 的加载和分发方式。Codex 可以通过显式调用使用 Skill，也可以根据`description`隐式匹配。


Codex 场景里比较特殊的是`agents/openai.yaml`：

```
my-skill/├── SKILL.md├── scripts/├── references/├── assets/└── agents/    └── openai.yaml
```


`agents/openai.yaml`可以用于 UI metadata、调用策略、工具依赖等。例如展示名、短描述、默认 prompt、是否允许隐式触发、依赖哪些 MCP server。


但要注意：`agents/openai.yaml`是 Codex 生态扩展，不是所有平台都识别的通用标准。

### 4.3 Anthropic / Claude：强调 progressive disclosure 和 eval 闭环


Anthropic / Claude 的 Skill 体系非常强调 progressive disclosure，也就是渐进式加载：

```
启动时：只加载 name + description触发后：读取完整 SKILL.md执行中：按需读取 references、scripts、assets
```


这个思想在前面已经展开过：Skill 不是“把所有东西都塞进上下文”，而是让 Agent 在合适阶段加载合适内容。


Anthropic 的`skill-creator`还体现了另一点：Skill 应该被测试和迭代。写完 Skill 后，要设计 test prompts，运行 with-skill 和 baseline，对结果进行 benchmark 和人工 review，然后再修改。


这也解释了`eval-viewer`的位置：它不是普通业务 Skill 的标准目录，而是 Skill 创建和评测工作流的一部分。

### 4.4 LangChain Deep Agents：强调 runtime 集成


LangChain Deep Agents Skills 更像从 agent runtime 角度看 Skill。它把 Skill 使用过程概括成：

```
Match → Read → Execute
```


也就是先根据 description 匹配，匹配后读取`SKILL.md`，再按指令执行，必要时访问脚本、模板和 reference docs。


LangChain 还强调 main agent 和 subagent 可以拥有不同 skills。这对复杂多代理系统很重要：不要把所有 skills 都暴露给所有 subagents，而应该按职责分配。

### 4.5 OpenClaw：强调 marketplace 和安全问题


OpenClaw 这类生态让 Skill 更像本地插件或 marketplace 扩展。它带来更强的分发能力，也带来更高的安全风险。


一旦 Skill 可以从第三方安装，并携带 scripts、assets、工具依赖，它就不能再被当成普通 prompt，而应该被当成供应链对象审查。


这意味着你需要关心：

- Skill 来源是否可信。
- scripts 是否会执行危险命令。
- 是否访问 secrets。
- 是否有网络请求。
- 是否有自动更新。
- 是否有签名、checksum、权限声明。


## 5. Skill 的目录设计


一个清晰的目录结构，是 Skill 可维护的基础。


最推荐的结构是：

```
skill-name/├── SKILL.md├── references/├── scripts/├── assets/└── evals/
```


其中：


目录


作用


是否通用
`SKILL.md`

必需入口，放 metadata 和主流程


通用
`references/`

按需读取的文档


通用
`scripts/`

可执行脚本


通用
`assets/`

模板、图片、静态资源


通用
`evals/`

测试用例和评测数据


常见工程约定
`agents/`

平台扩展，如 Codex metadata 或子代理说明


非通用
`eval-viewer/`

评测展示工具


非普通业务标准


从渐进式加载角度看，这些目录其实对应不同加载层：

```
第一层：name + description第二层：SKILL.md第三层：references/scripts/assets第四层：evals 和 review 工具链
```


也就是说，目录不是为了好看，而是为了让 Agent 能按需加载、按层执行。

### 5.1`SKILL.md`


`SKILL.md`是主入口。它不应该太长，也不应该承担所有细节。它最重要的职责是：

- 说明 Skill 做什么。
- 说明什么时候使用。
- 给出主 workflow。
- 定义输入和输出。
- 指向 references/scripts/assets。
- 定义验证和失败处理。


### 5.2`references/`


`references/`放模型需要读懂的材料，比如：

- API 文档。
- schema。
- 错误码。
- 框架架构。
- 业务规则。
- 大型示例。
- 边界情况。



判断标准是：**这个文件是否需要被模型读进上下文理解？**


如果是，就放`references/`。

### 5.3`scripts/`


`scripts/`放确定性执行逻辑，比如：

- 校验。
- 转换。
- 抽取。
- 收集诊断信息。
- 生成文件。
- 格式化。
- 批处理。



判断标准是：**这件事是否适合用程序稳定完成，而不是让模型每次手动推理？**


如果是，就放`scripts/`。

### 5.4`assets/`


`assets/`放输出会用到的静态资源，比如：

- Word/PPT 模板。
- HTML 模板。
- logo。
- 字体。
- 图片。
- boilerplate 文件。
- 样例输入文件。



判断标准是：**这个文件是给模型读的，还是给最终输出用的？**


给模型读的放`references/`；给输出用的放`assets/`。

### 5.5`agents/`


`agents/`要谨慎使用。它不是通用标准，而是平台扩展。


在 Codex 中，`agents/openai.yaml`可以用于 UI metadata 和调用策略。在 Anthropic skill-creator 里，`agents/`可能用于 grader、comparator、analyzer 等 specialized subagents。


所以写文档时一定要说明：`agents/`是生态扩展，不是所有 Skill 都应该有。

### 5.6`evals/`


`evals/`用于保存测试提示、输入 fixtures、期望行为和断言。它不是最小规范必需项，但如果 Skill 要团队复用，就强烈建议有。


没有 eval 的 Skill 很容易“看起来很好”，但真实触发和执行都不稳定。

## 6. SKILL.md 应该怎么写


推荐结构如下：

```
---name: your-skill-namedescription: Does X for Y. Use when the user asks about A, B, C, or provides Z files.---# Your Skill Name## Purpose一句话说明这个 Skill 解决什么重复任务。## When to use- 用户说了哪些关键词时使用- 输入出现哪些文件/目录/上下文时使用- 不该使用的场景## Inputs- 必需输入- 可选输入- 缺失输入时怎么处理## Workflow1. 检查输入2. 选择执行路径3. 读取 reference 或运行 script4. 生成输出5. 验证输出## Output format明确最终输出格式。## Validation- 必须检查什么- 失败时如何修复- 何时可以停止## Edge cases- 常见异常- 冲突规则- fallback 策略## References- Read `references/schema.md` when schema details are needed.## Scripts- Run `scripts/validate.py --input ...` before final delivery.
```

### 6.1 Frontmatter


Frontmatter 里最重要的是`name`和`description`。


`name`应该是稳定的机器名，通常使用 kebab-case：

```
name: k8s-gateway-debug
```


`description`是触发依据，不是广告语。


坏：

```
description: Helps with Kubernetes.
```


好：

```
description: DebugsKubernetesGatewayAPI,HTTPRoute,MetalLBLoadBalancerIP,minikubeDockerdrivernetworking,andexternalnginxreverseproxyexposureissues.UsewhentheuseraskswhytrafficcannotreachaGateway,LoadBalancerIP,wildcarddomain,ornginx-to-Kubernetesroute.
```


好的 description 有几个特点：

- 任务对象清楚。
- 触发词具体。
- 用户自然说法被覆盖。
- 关键技术名词前置。
- 边界足够窄。


### 6.2 Purpose


Purpose 一句话即可。它回答“这个 Skill 为什么存在”。


例如：

```
## PurposeUse this skill to debug Kubernetes Gateway API exposure problems by following a layer-by-layer network troubleshooting workflow.
```


不要把 Purpose 写成一大段背景介绍。背景可以放正文或 reference，Purpose 要短。

### 6.3 When to use


`When to use`是 description 的展开。它可以写得更细：

```
## When to useUse this skill when the user mentions:- Kubernetes Gateway API- HTTPRoute- MetalLB LoadBalancer IP- minikube Docker driver networking- external nginx reverse proxy- wildcard domain exposureDo not use this skill for:- generic Kubernetes YAML authoring- unrelated frontend work- non-network cluster questions
```


这能降低误触发。

### 6.4 Inputs


Inputs 要避免 Agent 猜测。

```
## InputsRequired:- Network topology or public entrypoint- Kubernetes host and LoadBalancer IP- Relevant Gateway / HTTPRoute / Service status if availableOptional:- nginx config- `kubectl describe gateway`- `kubectl describe httproute`- `ip route` outputIf missing:- Ask for the smallest missing evidence needed to identify the failure layer.- Do not invent cluster state.
```


好的 Inputs 会让 Agent 知道什么时候可以继续、什么时候必须补证据。

### 6.5 Workflow


Workflow 是`SKILL.md`的核心。


坏 workflow：

```
1. Understand the problem.2. Think carefully.3. Provide a good answer.
```


好 workflow：

```
1. Draw the full request path: public IP → NAT → nginx → target IP → Gateway → Service → Pod.2. Identify the first unreachable hop.3. If external nginx cannot reach the MetalLB IP, classify this as L3 reachability before inspecting HTTPRoute.4. If the MetalLB IP is reachable, inspect Gateway listener, HTTPRoute status, Service selector, Endpoints, and backend readiness.5. Return the recommended architecture and verification commands.
```


好的 workflow 不是抽象原则，而是可执行动作。

### 6.6 Output format


输出格式决定 Skill 是否可评测。


例如：

```
## Output formatReturn:- Topology summary- Failure layer- Evidence- Recommended solution- Exact commands or config snippets- Verification plan- Rollback plan
```


不要只写 “provide a detailed answer”。这无法判断是否合格。

### 6.7 Validation


Validation 是交付前的检查。


例如：

```
## ValidationBefore finalizing:- Confirm whether the failure is DNS, TCP reachability, HTTP routing, Gateway status, Service endpoints, or backend readiness.- Do not recommend changing HTTPRoute until L3 reachability to the LoadBalancer IP is confirmed.- If a script was run, summarize its findings and mention failed commands.
```


Validation 的价值是把“好答案”变成“可检查答案”。

## 7. references / scripts / assets / agents / evals 怎么放


目录设计最容易出错的地方，不是“不知道有哪些目录”，而是“不知道该把内容放哪”。

### 7.1 放`references/`：模型需要读懂它


适合：

```
references/├── architecture.md├── api.md├── schema.md├── edge-cases.md└── examples.md
```


例如一个内部 API Skill，`references/api.md`可以放接口说明，`references/schema.md`可以放请求和响应结构，`references/examples.md`可以放复杂样例。


不要把模板、图片、字体、二进制文件放进`references/`。这些东西不是给模型读懂的。

### 7.2 放`scripts/`：任务需要确定性


适合：

```
scripts/├── validate.py├── extract.py└── generate.py
```


脚本应满足：

- 支持`--help`。
- 错误信息清楚。
- 依赖明确。
- 默认不做危险修改。
- 有 dry-run 或确认机制。



坏脚本：

```
echo "Please analyze manually"
```


好脚本：

```
python scripts/validate_schema.py --input output.json --schema references/schema.json
```

### 7.3 放`assets/`：输出要用到它


适合：

```
assets/├── report-template.docx├── logo.png└── style.css
```


`assets/`的关键是许可证和用途说明。比如 logo 是否能改、模板是否能删页脚、字体是否能商用，都应该写清楚。

### 7.4 放`agents/`：只有平台需要时才放


`agents/`不是通用标准。


Codex 可以用：

```
agents/openai.yaml
```


Anthropic skill-creator 可能用：

```
agents/grader.mdagents/comparator.mdagents/analyzer.md
```


所以不要在普通业务 Skill 中默认创建`agents/`。只有当平台或评测流程确实需要时再创建。

### 7.5 放`evals/`：想要长期维护就应该放


`evals/`用来保存测试集。至少应该覆盖：

```
- obvious trigger- paraphrased trigger- file-based trigger- no-trigger- functional task- regression case
```


如果 Skill 只是个人临时使用，可以不写 evals。但如果要团队共享，强烈建议写。

## 8. Trigger Engineering：如何让 Skill 准确触发


Skill 的第一个质量问题不是“执行得好不好”，而是“会不会被用上”。


触发失败通常来自`description`太弱。误触发通常来自`description`太宽。

### 8.1 description 的公式


可以用这个公式：

```
Does X for Y. Use when the user asks about A, B, C, or provides Z files. Do not use for N.
```


例如：

```
description: ReviewsFastAPIbackendpullrequestsforAPIdesign,Pydanticschemacorrectness,dependencyinjection,securityrisks,errorhandling,andtestcoverage.UsewhentheuserasksforFastAPIPRreview,backendcodereview,orprovidesadifftouchingroutes,schemas,services,dependencies,ortests.
```


这个 description 比 “Helps review code” 好很多，因为它说明了：

- 技术栈：FastAPI。
- 任务类型：backend PR review。
- 检查维度：API design、Pydantic、DI、安全、错误处理、测试。
- 触发场景：PR review、diff、相关目录。


### 8.2 触发测试


每个 Skill 至少做 5 类触发测试：

```
1. obvious trigger2. paraphrased trigger3. file-based trigger4. no-trigger5. conflict trigger
```


例如`k8s-gateway-debug`：

```
obvious:"Debug why my Kubernetes Gateway API HTTPRoute is not reachable through MetalLB."paraphrased:"外层 nginx 反代到 k8s 的 LB IP 超时，帮我判断是哪一层断了。"file-based:用户提供 gateway.yaml、httproute.yaml、nginx.conf。no-trigger:"帮我写一个 React Todo App。"conflict:"Review this Kubernetes networking PR."
```


如果 obvious 不触发，description 太弱。
如果 no-trigger 触发，description 太宽。
如果 conflict 选错，说明 Skill 粒度或优先级不清。

### 8.3 触发失败和执行失败要分开


这是一个重要经验。


Skill 失败有两种：

```
触发失败：Agent 没有使用 Skill。执行失败：Agent 使用了 Skill，但结果不好。
```


触发失败通常修：

- description。
- trigger words。
- when to use。
- when not to use。



执行失败通常修：

- workflow。
- examples。
- references。
- scripts。
- validation。



不要混淆这两类问题。否则很容易在 workflow 上加很多内容，却没有解决 Skill 根本不触发的问题。

## 9. Workflow / Example / Script Engineering


Skill 写作的核心不是写很多原则，而是写出 Agent 能执行的流程、能模仿的示例、能运行的脚本。

### 9.1 Workflow Engineering


好的 workflow 应该具备：

- 顺序。
- 分支。
- 检查点。
- 停止条件。
- fallback。



坏：

```
1. Think carefully.2. Ensure quality.3. Be helpful.
```


好：

```
1. Inspect staged files and identify changed behavior.2. Read nearby tests and call sites.3. Look for correctness bugs, regressions, missing tests, and unsafe assumptions.4. Return findings first, ordered by severity, with file and line references.5. If no findings are found, say so and mention residual test gaps.
```


这就是从“原则”到“动作”的区别。

### 9.2 Example Engineering


示例不是装饰，它是 Agent 模仿的样本。


坏：

```
User asks for a report. Generate a good report.
```


好：

```
Input:- sales.csv with columns: region, revenue, quarterUser:"Create a Q4 regional revenue report."Expected:- Validate required columns.- Group revenue by region.- Identify missing values.- Generate summary table.- Return assumptions and output file path.
```


好的示例必须有真实输入、用户话术、预期行为。只写“好好做”没有意义。

### 9.3 Script Engineering


脚本负责确定性，模型负责判断性。


脚本适合：

- 检查。
- 收集。
- 转换。
- 生成。
- 格式化。
- 校验。



模型适合：

- 判断根因。
- 方案取舍。
- 理解用户目标。
- 解释脚本输出。
- 组织最终回答。



脚本接口建议统一：

```
python scripts/validate.py --input output.json --format jsonpython scripts/generate.py --input source.csv --output report.md --dry-run
```


脚本输出建议结构化：

```
{  "status": "ok",  "findings": [],  "warnings": [],  "next_steps": []}
```


这样 Agent 不需要猜脚本结果，可以直接根据结构化输出继续工作。

## 10. 如何评价一个 Skill 的好坏


一个 Skill 好不好，不应该只看作者写得是否详细，而应该看它是否让 Agent 在真实任务中更稳定。


我建议用 100 分制：


维度


分值


判断


触发准确率


20


相关任务能触发，改写说法也能触发


误触发控制


10


不相关任务不触发，边界清楚


输出正确性


20


结果符合任务、格式和业务规则


流程遵循


10


Agent 按`SKILL.md`执行


示例质量


10


示例具体，能覆盖真实输入和边界


脚本/资源使用


10


scripts/references/assets 放置正确且可用


安全性


10


无隐式危险操作，无 secret 读取，无混淆脚本


可维护性


5


结构清晰、少重复、易更新


兼容性


5


不把平台扩展误写成通用标准


低于 70 分，不建议团队发布。
70-85 分，可以内部试用。
85 分以上，才适合进入共享 registry。

### 10.1 静态 review 看什么


静态 review 看文件本身：

- `name`是否合法。
- `description`是否清楚。
- `SKILL.md`是否过长。
- workflow 是否可执行。
- references 是否从主文件可发现。
- scripts 是否有帮助。
- assets 是否有用途说明。
- 是否存在危险操作。


### 10.2 动态 review 看什么


动态 review 看 Agent 运行过程：

- 是否真的触发 Skill。
- 是否读了正确 reference。
- 是否运行了必要 script。
- 是否跳过 validation。
- 是否误用了旧知识。
- 是否违反用户直接指令。
- 是否被 Skill 过度约束。



这就是 transcript review。很多问题只看最终答案看不出来。


例如，最终答案看起来对，但 transcript 显示 Agent 没有读取 schema，而是凭记忆写字段。这就是潜在风险。

## 11. eval-viewer 与评测闭环


`eval-viewer`最容易被误解。它不是普通业务 Skill 的标准目录，也不是每个 Skill 都应该带的东西。


它更像 Skill 创建和评测工具链的一部分。它解决的问题是：当你跑了多个测试 prompt，产生了 with-skill 输出、baseline 输出、评分、token、耗时和人工反馈后，如何把这些结果展示给人类 review。


典型评测结构可以是：

```
iteration-1/├── benchmark.json├── feedback.json├── eval-0/│   ├── with_skill/│   └── without_skill/└── review.html
```


一个成熟的 Skill 评测闭环应该包括：

```
1. 设计测试 prompt2. 同时跑 with-skill 和 baseline3. 收集输出、token、耗时4. 自动评分或断言5. 用 viewer 展示结果6. 人类填写反馈7. 根据 feedback 和 benchmark 修改 Skill8. 进入下一轮 regression
```


这里最重要的是 baseline。


如果没有 baseline，你只能说“这个 Skill 看起来不错”。有了 baseline，你才能回答：

```
这个 Skill 是否真的让 Agent：- 更少问问题？- 更少幻觉？- 更快定位问题？- 输出更稳定？- 更遵守格式？- 更容易验证？
```

### 11.1 eval 应该覆盖什么


至少覆盖四类：

```
Trigger EvalFunctional EvalBaseline EvalRegression Eval
```


Trigger Eval 测是否触发。
Functional Eval 测是否完成任务。
Baseline Eval 测是否比不用 Skill 更好。
Regression Eval 测修改后是否破坏旧能力。


不要只测 happy path。真正有价值的 eval 一定包含错误输入、缺失输入、不该触发、冲突触发、脚本失败等场景。

## 12. 安全、权限和团队治理


Skill 一旦包含 scripts、assets、外部工具依赖或 marketplace 分发，就不能再被当成普通 Markdown。


它可能带来：

- prompt injection。
- 恶意 markdown 指令。
- scripts 执行恶意代码。
- assets 携带 payload。
- 第三方供应链风险。
- workspace 覆盖。
- secrets 读取。
- 权限升级。


### 12.1 安全规则


建议默认采用这些规则：

- 默认 dry-run。
- 删除、覆盖、发布、付费、改权限必须确认。
- 禁止`curl | bash`。
- 禁止混淆 shell。
- 禁止默认读取 secrets。
- 网络访问必须声明。
- 第三方 Skill 安装前审计。
- 脚本最小权限运行。


### 12.2 Trust Model


不同来源的 Skill 应有不同信任等级：


类型


策略


first-party skill


可默认启用，但仍需测试


team-approved skill


通过 review、eval、CI 后启用


marketplace skill


安装前审计，默认限制权限


untrusted local skill


默认禁用或只允许显式调用


generated skill


先 eval，再发布

### 12.3 团队治理


团队 Skill 应该有 owner。


至少记录：

- owner。
- reviewer。
- domain expert。
- update cadence。
- support channel。
- version。
- compatibility。
- deprecation policy。



推荐流程：

```
draft→ domain review→ security review→ trigger eval→ functional eval→ release→ regression eval
```


Skill 本质上已经是工程资产。它和脚本、文档、CI 配置一样，需要 review、测试、版本和回滚。

## 13. 从重复需求到 Skill 的完整开发流程


最后给一个完整流程。假设你经常让 Agent 排查 Kubernetes Gateway API + MetalLB + minikube Docker driver + 外层 nginx 反代问题。

### 第 1 步：采集真实需求


先不要写文件，先列真实案例：

```
1. MetalLB IP 只有 minikube 宿主机能访问2. 外层 nginx 访问 LoadBalancer IP 超时3. HTTPRoute Accepted=True 但外部 5024. wildcard 域名想统一转到 k8s Gateway
```


提炼：

```
- 用户怎么问- 任务对象是什么- 输入是什么- 输出是什么- 哪些步骤稳定重复- 哪些内容需要 reference- 哪些动作可以脚本化
```

### 第 2 步：定义 Skill 名称和 description

```
---name:k8s-gateway-debugdescription:DebugsKubernetesGatewayAPI,HTTPRoute,MetalLBLoadBalancerIP,minikubeDockerdrivernetworking,andexternalnginxreverseproxyexposureissues.UsewhentheuseraskswhytrafficcannotreachaGateway,LoadBalancerIP,wildcarddomain,ornginx-to-Kubernetesroute.---
```

### 第 3 步：设计目录

```
k8s-gateway-debug/├── SKILL.md├── scripts/│   └── collect-diagnostics.sh├── references/│   ├── minikube-networking.md│   ├── metallb.md│   └── nginx-gateway.md└── evals/    └── evals.json
```

### 第 4 步：写主 workflow

```
## Workflow1. Draw the full request path: public IP → NAT → nginx → target IP → Gateway → Service → Pod.2. Identify the first unreachable hop.3. If external nginx cannot reach the MetalLB IP, classify this as L3 reachability before inspecting HTTPRoute.4. If the MetalLB IP is reachable, inspect Gateway listener, HTTPRoute status, Service selector, Endpoints, and backend readiness.5. If minikube Docker driver is involved, read `references/minikube-networking.md`.6. If MetalLB advertisement mode is unclear, read `references/metallb.md`.7. Return the recommended architecture and verification commands.
```

### 第 5 步：写 eval

```
{  "skill_name": "k8s-gateway-debug","evals": [    {      "id": "obvious-trigger",      "prompt": "Debug why my Kubernetes Gateway API HTTPRoute is not reachable through MetalLB.",      "expected_output": "Should identify Gateway/MetalLB/network layers and request evidence if missing."    },    {      "id": "no-trigger",      "prompt": "Help me build a React Todo App.",      "expected_output": "Should not trigger k8s-gateway-debug."    }  ]}
```

### 第 6 步：显式触发测试


直接点名 Skill：

```
$k8s-gateway-debug公网 443 NAT 到 10.14.1.222，minikube 在 10.14.1.10，MetalLB IP 是 192.168.49.240，只有 minikube host 能访问这个 IP。请按 Skill 流程分析。
```


看它是否先判断 L3 reachability，而不是马上改 HTTPRoute。

### 第 7 步：隐式触发测试


不提 Skill 名：

```
我想让外层 nginx 的 wildcard 域名统一转到 k8s Gateway API，但 LB IP 只有 minikube 宿主机能访问。怎么设计最稳？
```


如果没有触发，说明 description 需要加强。

### 第 8 步：no-trigger 测试

```
帮我写一个 React Todo App。
```


如果触发了，说明 description 太宽。

### 第 9 步：baseline 对比


同一个任务分别跑：

```
without skillwith skill
```


看 with-skill 是否更稳定：

- 是否更快定位故障层。
- 是否更少问无关问题。
- 是否更少幻觉。
- 是否输出格式更稳定。
- 是否使用了 references/scripts。
- 是否给出验证计划。


### 第 10 步：迭代


根据结果修改：

- 触发失败：改 description。
- 误触发：加边界和 no-trigger。
- 执行失败：改 workflow。
- 缺少知识：补 references。
- 重复手工动作：加 scripts。
- 输出不稳定：改 output format。
- 无法验收：加 validation 和 eval。


## 总结


如果把整篇文章压缩成一个判断标准，那么就是：


一个好的 Skill，不是写得多，而是让 Agent 在正确时间加载正确流程，并且能被测试、被 review、被维护。


写 Skill 时要抓住五个核心：

```
1. description 决定触发2. 渐进式加载决定上下文经济3. SKILL.md 决定执行4. references/scripts/assets 决定知识、脚本和资源分层5. eval/review 决定质量上限
```


最终，一个优秀 Skill 应该满足：

```
- 该触发时能触发- 不该触发时不触发- 触发后步骤清楚- 复杂知识按需读取- 确定性动作脚本化- 输出格式稳定- 失败路径明确- 安全边界清楚- 能用真实任务评测- 能被团队 review 和迭代
```


Skill 的本质不是提示词技巧，而是**Agent 能力工程化**。

## 后续阅读与实践

- 从你所在项目仓库里挑一个最近重复出现的 Pixiu / AI Gateway case，先写出最小`SKILL.md`
- 为这个 Skill 补 2 条 trigger 样例、1 条 no-trigger 用例和一个最小验证步骤
- 记录一次 with-skill / without-skill 对比，作为后续评测与迭代基线


## 参考来源

- Agent Skills 标准：https://agentskills.io/specification
- OpenAI Codex Skills：https://developers.openai.com/codex/skills
- Anthropic Skills：https://github.com/anthropics/skills
- LangChain Deep Agents Skills：https://docs.langchain.com/oss/python/deepagents/skills
- LangChain Memory：https://docs.langchain.com/oss/python/deepagents/memory
- OpenClaw Skills：https://docs.openclaw.ai/tools/skills


## 欢迎加入 dubbogo hub


欢迎你加入dubbogo社区钉钉群:23331795，也欢迎你扫码加入 dubbogo 社区交流群：


![invite.png](https://images.weserv.nl/?url=https%3A%2F%2Fmmbiz.qpic.cn%2Fmmbiz_png%2FjDRxFzURcjdmedicRb5faoau9hPOibhAic20yWKBaw7dlgDND4CR4CJias38pyYn1YJQc1QH25uHLN0BczTdiaFdxDO6BPSbKFDN4ZaMiakebRseU%2F640%3Fwx_fmt%3Dpng%26from%3Dappmsg)
