/**
 * 生成《DeepSeek V4.1 多用户产品级本地部署服务器方案》
 * 面向：能正常跑 DeepSeek-V4.1-Flash，并支撑多个产品的多用户并发
 */
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, BorderStyle, WidthType, AlignmentType, ShadingType,
  PageNumber, Header, Footer } = require("docx");
const fs = require("fs");
const path = require("path");

const CONTENT_WIDTH = 9360;
const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
const borders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
const headerShading = { type: ShadingType.CLEAR, fill: "0B3D5C" };
const altRowShading = { type: ShadingType.CLEAR, fill: "F3F7FA" };
const warnShading = { type: ShadingType.CLEAR, fill: "FFF4E5" };

function p(text, options = {}) {
  return new Paragraph({
    spacing: { after: options.after ?? 120, before: options.before ?? 0, line: 276 },
    alignment: options.align,
    children: [
      new TextRun({
        text,
        font: "微软雅黑",
        size: options.size ?? 21,
        bold: options.bold,
        color: options.color ?? "222222",
        italics: options.italics,
      }),
    ],
  });
}

function heading(text, level) {
  return new Paragraph({
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 360 : 220, after: 140 },
    children: [new TextRun({ text, font: "微软雅黑", bold: true, color: "0B3D5C" })],
  });
}

function cell(text, opts = {}) {
  return new TableCell({
    borders,
    width: { size: opts.width ?? 2000, type: WidthType.DXA },
    shading: opts.header ? headerShading : opts.alt ? altRowShading : opts.warn ? warnShading : undefined,
    children: [
      new Paragraph({
        spacing: { before: 50, after: 50 },
        children: [
          new TextRun({
            text: String(text),
            font: "微软雅黑",
            size: opts.size ?? 17,
            bold: opts.header || opts.bold,
            color: opts.header ? "FFFFFF" : "222222",
          }),
        ],
      }),
    ],
  });
}

function makeTable(headers, rows, colWidths) {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      new TableRow({
        children: headers.map((h, i) => cell(h, { header: true, width: colWidths[i] })),
      }),
      ...rows.map(
        (row, rowIndex) =>
          new TableRow({
            children: row.map((value, colIndex) =>
              cell(value, {
                width: colWidths[colIndex],
                alt: rowIndex % 2 === 1,
                warn: row.warn,
              })
            ),
          })
      ),
    ],
  });
}

function bullets(lines) {
  return lines.map((line) => p("• " + line));
}

const doc = new Document({
  sections: [
    {
      properties: {
        page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: "DeepSeek V4.1 多用户产品级本地部署｜专业GPU服务器方案",
                  font: "微软雅黑",
                  size: 16,
                  color: "666666",
                }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "第 ", font: "微软雅黑", size: 16, color: "666666" }),
                new TextRun({ children: [PageNumber.CURRENT], font: "微软雅黑", size: 16 }),
                new TextRun({ text: " 页｜价格与货源以2026年9月市场快照为参考", font: "微软雅黑", size: 16, color: "666666" }),
              ],
            }),
          ],
        }),
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [
            new TextRun({
              text: "DeepSeek V4.1 本地部署",
              font: "微软雅黑",
              size: 36,
              bold: true,
              color: "0B3D5C",
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [
            new TextRun({
              text: "多产品 · 多用户并发 · 专业/数据中心级显卡服务器方案",
              font: "微软雅黑",
              size: 26,
              bold: true,
              color: "1A6B9A",
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 360 },
          children: [
            new TextRun({
              text: "目标模型：DeepSeek-V4.1-Flash（开源 MIT）｜撰写：2026-09-26",
              font: "微软雅黑",
              size: 18,
              color: "666666",
            }),
          ],
        }),

        heading("一、先把目标说清楚（非常重要）", HeadingLevel.HEADING_1),
        p("你要的是：本地部署 DeepSeek V4.1，并且能给「多个产品、很多用户」正常用。这已经不是家用游戏主机范畴，必须上专业/数据中心级多卡节点。", {
          bold: true,
        }),
        ...bullets([
          "当前可本地部署、且能力被官方用来替代 V4 Pro 的开源模型是：DeepSeek-V4.1-Flash（Hugging Face：deepseek-ai/DeepSeek-V4.1-Flash）。",
          "DeepSeek V4.1 Pro 权重尚未开源；API 里访问 deepseek-v4-pro 在过渡期会被路由到 V4.1 Flash。因此「本地 V4.1」= 部署 V4.1-Flash。",
          "V4.1-Flash：约 552B 骨干 MoE，prefill 激活约 8B、decode 激活约 16B；另有约 196.6B Engram 记忆表；权重盘约占 510GB。",
          "vLLM 官方 recipe 给出的显存底线约 614GB（含余量）。消费级单卡/双卡家用机无法「正常生产」跑通。",
          "多用户产品服务还要额外预留：KV Cache、并发批处理、网关、日志、限流、监控、故障切换——所以不要用「刚好塞进权重」的机器。",
        ]),

        heading("二、硬门槛与推荐平台对照", HeadingLevel.HEADING_1),
        makeTable(
          ["配置", "总算力显存", "对 V4.1-Flash", "多用户产品建议"],
          [
            ["4× GB200 / GB300 NVL", "~740GB~1.1TB", "官方/社区已验证路线", "最强推荐（有预算）"],
            ["4× B200 / B300", "768GB / ~1.1TB", "recipe 存在", "强烈推荐生产"],
            ["8× H200 141GB", "1,128GB", "Hopper 主流生产路径", "强烈推荐（货源相对多）"],
            ["8× RTX PRO 6000 96GB", "768GB", "显存过线；需确认 V4.1 镜像适配", "中小团队性价比候选"],
            ["4× H200 + Engram进主机内存", "564GB GPU + ≥250GB RAM", "SGLang 预览能力，延迟未知", "仅评估/演示，勿直接上生产"],
            ["4× A100 80GB + Engram卸载", "320GB + 大内存", "社区有跑通案例，极紧", "不适合多用户产品"],
            ["8× H100 80GB", "640GB", "纸面刚过 614GB，无正式 recipe", "不建议作为生产基线"],
            ["单卡 5090 / 双卡消费级", "≤64GB", "不可行", "排除"],
          ],
          [2400, 1600, 2800, 2560]
        ),
        p("结论：要「正常使用 + 多用户产品」，请按「至少 8×H200」或「4×B200/GB200 级」规划；有余量才谈并发。", {
          before: 160,
          bold: true,
        }),

        heading("三、多用户产品需要多大并发？（先估业务）", HeadingLevel.HEADING_1),
        p("「很多用户」必须拆成可量化指标，否则硬件无法选型："),
        ...bullets([
          "同时在线用户数 ≠ 同时推理请求数。真正吃 GPU 的是：并发生成流（active generations）+ prefill 队列。",
          "建议你先定三个数：①峰值同时生成流 N；②平均输入/输出 token；③可接受首字延迟 TTFT 与生成速度。",
          "经验分层（单节点、开启 DSpark 投机解码、文本为主、上下文中等）：轻负载 10~30 并发流；中负载 30~80；高负载需要多副本水平扩展。",
          "Agent/工具调用/长思考会显著拉长占用时间，同等用户数所需算力可能翻倍以上。",
          "KV 方面：V4.1-Flash 的 KV 很小（公开资料约 890 bytes/token），长上下文对显存压力相对友好；瓶颈主要在权重装载与算力吞吐。",
        ]),
        makeTable(
          ["业务档位", "建议同时生成流", "推荐硬件形态", "备注"],
          [
            ["内测/小产品", "5~20", "1× 8卡 H200 或 1× 8卡 PRO 6000", "单节点 + 网关限流"],
            ["正式上线多产品", "20~60", "1~2× 8卡 H200（或 4×B200）", "建议 Prefill/Decode 分离预留"],
            ["高并发 SaaS 级", "60~200+", "多节点副本 + 负载均衡", "按副本线性扩，不是堆单机无脑"],
            ["极高并发/全国用户", "200+", "集群 + PD 分离 + 缓存命中优化", "需专业运维与机房"],
          ],
          [1800, 1600, 3200, 2760]
        ),

        heading("四、推荐方案（专业卡，按预算与目标）", HeadingLevel.HEADING_1),

        heading("方案 A｜生产首选：8× NVIDIA H200 SXM 单节点（强烈推荐）", HeadingLevel.HEADING_2),
        p("定位：当前国内最现实的「能稳跑 V4.1-Flash + 服务多用户」主力形态。", { bold: true }),
        ...bullets([
          "GPU：8× H200 141GB（SXM，NVLink/NVSwitch 优先，吞吐与稳定性远好于纯 PCIe）",
          "总显存：约 1,128GB，远超 614GB 底线，给并发与上下文留足余量",
          "CPU：双路高核（如 Xeon / EPYC，总物理核建议 ≥64）",
          "内存：建议 1~2TB DDR5 ECC（Engram/框架/操作系统与缓存）",
          "系统盘：≥2TB 企业级 NVMe；模型盘：≥4TB 高速 NVMe（权重约 510GB，建议镜像与热备）",
          "网络：至少双 25/100GbE；多节点时配 InfiniBand/RoCE",
          "机箱：标准 4U/8U GPU 服务器（戴尔/超微/浪潮/华硕 ESC 等 HGX 或兼容平台）",
          "推理：vLLM ≥0.30（deepseekv41-flash 专用镜像）或 SGLang；启用 DSpark 投机解码",
          "并发预期：单节点通常可支撑「中小多产品」正式流量；再高上第二台做副本",
        ]),
        p("价格量级（2026-09 国内渠道快照，波动极大）：H200 SXM 八卡整机常见报价约数百万人民币量级（公开渠道可见约 400万上下的组装整机信息）；租赁可见约 9.8万~14万/台·月（PCIe/SXM、机房、是否全包差异大）。务必货比三家、认发票与保修。", {
          color: "5A4A3A",
        }),

        heading("方案 B｜更高吞吐：4× B200 / GB200（或 GB300）Blackwell 节点", HeadingLevel.HEADING_2),
        p("定位：预算与货源允许时的「更优生产节点」，官方/社区 recipe 更贴新架构。", { bold: true }),
        ...bullets([
          "4× B200（约 768GB）起可作为较小 Blackwell 生产候选；GB200/GB300 NVL4 更从容",
          "适合更高并发、更低延迟目标；与 vLLM/SGLang/NVIDIA Dynamo 新 recipe 契合",
          "采购门槛高、交期与出口/供货政策敏感，适合有渠道的企业",
          "多用户产品：单节点即可作为「核心推理池」，产品侧通过 API 网关接入",
        ]),

        heading("方案 C｜中小团队性价比：8× RTX PRO 6000 Blackwell 96GB（专业卡）", HeadingLevel.HEADING_2),
        p("定位：专业工作站/服务器卡，96GB×8=768GB，显存过 V4.1 底线；比 H200 集群更容易以「工作站/4U」形态落地。", {
          bold: true,
        }),
        ...bullets([
          "GPU：8× RTX PRO 6000（优先 Server Edition 被动散热进机架；工作站版适合塔式少卡验证）",
          "注意：V4-Flash 曾有 4×PRO 6000 实测；V4.1-Flash 更大，请按 8 卡规划，并验证 vLLM 0.30+ / sm_120 适配",
          "平台：支持 8 卡大功耗的专业机箱/服务器，ATX/冗余电源按 8×600W 级估算留足余量",
          "内存：≥512GB~1TB ECC；存储同方案 A",
          "并发：适合内测到中等正式流量；极高并发仍建议多节点 H200/B200",
          "价格快照：国内服务器版单卡明盘曾见约 17.8万~18万/片量级；8卡仅 GPU 就可能过百万，整机视平台另加",
        ]),
        p("适用：你有几个产品要接私有模型、用户量中等、希望比 H200 更好买/更好装机房。", { before: 80 }),

        heading("方案 D｜入门验证（不推荐直接对公网用户）：4×H200 + Engram 主机表 / 4×A100 社区方案", HeadingLevel.HEADING_2),
        ...bullets([
          "SGLang 可将约 183GiB Engram 放到主机内存， theoretically 让 4×H200 变得可能，但延迟与稳定性未作为生产基准公布",
          "社区有 4×A100 80GB + 自定义 runtime + Engram 进 RAM 的跑通记录：显存几乎打满，冷启动极长，不适合多用户产品 SLA",
          "用途：研发验证、功能联调；验证通过后立刻迁到方案 A/B/C",
        ]),

        heading("方案 E｜水平扩展架构（真正「很多用户 + 多个产品」的正确姿势）", HeadingLevel.HEADING_2),
        p("单机再强也有上限。产品级建议按「推理池 + 网关」设计：", { bold: true }),
        ...bullets([
          "L1 接入：API 网关（鉴权、配额、按产品 AppId 隔离、限流、审计）",
          "L2 调度：负载均衡到多个 vLLM/SGLang 副本；可做 Prefill/Decode 分离（PD Disaggregation）提高吞吐",
          "L3 推理节点：每节点=方案 A 或 B 或 C 的一刀",
          "L4 缓存：前缀缓存 / KV 复用（Agent 场景省钱又提速）",
          "L5 观测：GPU 利用率、队列长度、TTFT、tok/s、错误率、每产品用量账单",
          "L6 高可用：至少 2 个推理副本；一台维护时另一台顶住",
        ]),
        makeTable(
          ["产品用户规模（示意）", "建议节点组合", "说明"],
          [
            ["几个产品，日活百~千级，峰值几十并发流", "1×方案A 或 1×方案C", "必须加网关限流"],
            ["多产品，日活千~万，峰值近百并发流", "2×方案A（主备/分流）", "按产品路由或统一池"],
            ["偏 SaaS，峰值数百并发流", "3~N×方案A/B + PD分离", "专人运维/托管机房"],
          ],
          [3200, 2800, 3360]
        ),

        heading("五、单节点参考 BOM（方案 A 示例）", HeadingLevel.HEADING_1),
        makeTable(
          ["部件", "规格建议", "作用"],
          [
            ["GPU 模组", "HGX H200 8-GPU 或同等 8×H200 SXM", "装载 V4.1-Flash + 并发推理"],
            ["CPU", "双路 64核级以上", "调度、分词、网络、PD辅助"],
            ["内存", "1TB~2TB ECC", "框架、Engram可选、OS、页缓存"],
            ["系统盘", "企业级 NVMe 2TB RAID1", "系统与容器"],
            ["模型盘", "企业级 NVMe 4TB+", "510GB 权重 + 多版本镜像"],
            ["网络", "100GbE×2 或 IB", "多节点与存储"],
            ["电源/散热", "机房级冗余 + 强风道", "8卡满载长期稳定"],
            ["软件", "Ubuntu + NVIDIA Driver + vLLM/SGLang Docker", "OpenAI 兼容 API"],
          ],
          [1800, 3800, 3760]
        ),

        heading("六、软件部署要点（能「正常用」而不只是「勉强加载」）", HeadingLevel.HEADING_1),
        ...bullets([
          "引擎：优先 vLLM 官方 deepseekv41-flash 镜像（≥0.30），或 SGLang day-zero；不要指望 Ollama/GGUF（撰写时无成熟桌面量化路径）。",
          "关键参数方向：tensor-parallel-size=8（8卡）；开启 speculative DSpark；按业务设 max-model-len（例如先 32K/128K，不要一上来就 1M 打满 prefill）。",
          "日一 recipe 多为 --language-model-only（文本）；多模态视觉服务需等对应 recipe 成熟再开。",
          "对外给产品：统一 OpenAI Compatible API；每个产品独立 API Key + RPM/TPM 配额。",
          "采样：官方建议 temperature=1.0；Agent 场景 top_p≈0.95；给足 max_tokens（模型爱长思考）。",
          "冷启动很长：设置足够的 engine ready timeout（社区/文档常见到数十分钟级）。",
          "安全：内网优先；若公网必须 HTTPS、WAF、IP 允许列表、密钥轮换；防止变成「免费公共算力」。",
        ]),

        heading("七、和「几个产品」怎么接", HeadingLevel.HEADING_1),
        ...bullets([
          "产品 A/B/C 都只调用你的网关，不直连 GPU 节点。",
          "网关按 product_id 做：配额、账本、模型路由（例如正式走 V4.1-Flash，低优先级走更小模型省算力）。",
          "高峰时可降级：截断上下文、关闭最重 Agent 工具、排队而不是全部 OOM。",
          "日志与溯源：每个请求带 request_id，方便客服与排障。",
        ]),

        heading("八、采购与落地路径（建议按这个顺序）", HeadingLevel.HEADING_1),
        p("1）先用官方 API 把产品链路跑通（功能正确）。"),
        p("2）租 1 台 8×H200（或 8×PRO 6000）做私有化压测：测出你的真实峰值并发与延迟。"),
        p("3）根据压测决定买 1 台还是 2 台；不要先拍脑袋买满。"),
        p("4）机房：电、空调、承重、网络一次性规划；家用电/普通办公室很难撑 8 卡旗舰。"),
        p("5）签约：保修、备件、驱动支持、是否可退换、交期写进合同。"),

        heading("九、预算速览（人民币量级，仅供决策，下单以实时报价为准）", HeadingLevel.HEADING_1),
        makeTable(
          ["方案", "CAPEX 量级（买断）", "OPEX 量级（租赁）", "适合"],
          [
            ["A 8×H200", "常见数百万/节点", "约 10万~14万+/台·月可见", "正式多用户生产"],
            ["B 4×B200/GB200", "通常更高、货源紧", "按小时/月询价", "要极致吞吐"],
            ["C 8×PRO 6000", "GPU约百万级起 + 平台", "相对灵活", "中小团队私有化"],
            ["仅 API", "无", "按 token（官方有峰谷价）", "流量未起来时最理性"],
          ],
          [2000, 2600, 2600, 2160]
        ),
        p("经验法则：在流量不够大时，自建节点很难打过官方 API 的综合成本；自建的核心价值是数据不出域、可控 SLA、高峰不被公有云卡脖子。", {
          before: 140,
          bold: true,
        }),

        heading("十、给你的直接选型建议（按你的描述）", HeadingLevel.HEADING_1),
        p("目标：本地 DeepSeek V4.1 + 多产品多用户 → 请直接按下面执行：", { bold: true }),
        ...bullets([
          "最低可接受生产基线：方案 A（8×H200）或方案 C（8×RTX PRO 6000 96GB），外加 API 网关与限流。",
          "若用户量会明显增长：一开始就按「2 节点」预算（主 + 热备/分流），或先租后买。",
          "不要用家用 5090/双卡方案幻想「也能凑合给很多用户用」——会不稳定、不可运维、也无法达标。",
          "V4.1 Pro 开源前，本地就是 Flash；产品文案可写「DeepSeek V4.1 级能力（V4.1-Flash 私有化）」。",
        ]),

        heading("十一、需要你补充的 4 个数字（可据此把方案收敛到一句采购清单）", HeadingLevel.HEADING_1),
        ...bullets([
          "峰值同时生成流大概多少？（例如 20 / 50 / 100）",
          "平均每次请求输入+输出大概多少 token？是否长 Agent？",
          "是否必须数据完全不出机器（合规）？还是可接受专有云托管？",
          "预算是买断还是接受月租？机房是否已有？",
        ]),

        heading("十二、主要参考", HeadingLevel.HEADING_1),
        ...bullets([
          "DeepSeek 官方新闻：V4.1 Flash 发布、开源与 API 路由说明",
          "Hugging Face：deepseek-ai/DeepSeek-V4.1-Flash 模型卡",
          "vLLM Recipes：DeepSeek-V4.1-Flash（vram_minimum≈614GB，8×H200 / Blackwell 路径）",
          "Yotta Labs：V4.1 Flash Hardware Requirements（2026-09）",
          "社区：4×A100 Engram 卸载跑通讨论（仅作下限证明，非生产建议）",
          "国内算力行情快照：SMM 等渠道 H200/PRO 6000 买断与租赁报价（2026-09）",
        ]),

        p("免责声明：硬件行情、驱动与推理框架版本变化极快；本文用于架构选型，不构成报价单。采购前请用目标镜像在目标硬件上完成压测验收。", {
          before: 240,
          italics: true,
          color: "666666",
          size: 18,
        }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buffer) => {
  const outPath = path.join(
    __dirname,
    "DeepSeek-V4.1-多用户产品级服务器部署方案-2026-09.docx"
  );
  fs.writeFileSync(outPath, buffer);
  console.log("OK: " + outPath);
});
