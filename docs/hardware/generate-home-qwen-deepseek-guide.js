/**
 * 家用塔式主机方案：Qwen3.8 / DeepSeek V4-Flash
 * 约束：自家、1~几台主机、不要机柜大服务器；多产品小程序 + Agent 多并发/长思考
 */
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, BorderStyle, WidthType, AlignmentType, ShadingType,
  PageNumber, Header, Footer } = require("docx");
const fs = require("fs");
const path = require("path");

const W = 9360;
const thin = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
const borders = { top: thin, bottom: thin, left: thin, right: thin };
const headBg = { type: ShadingType.CLEAR, fill: "1B4332" };
const altBg = { type: ShadingType.CLEAR, fill: "F1F8F4" };

function p(text, o = {}) {
  return new Paragraph({
    spacing: { after: o.after ?? 110, before: o.before ?? 0, line: 276 },
    children: [new TextRun({ text, font: "微软雅黑", size: o.size ?? 21, bold: o.bold, color: o.color ?? "222222", italics: o.italics })],
  });
}
function h(text, level) {
  return new Paragraph({
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 320 : 200, after: 120 },
    children: [new TextRun({ text, font: "微软雅黑", bold: true, color: "1B4332" })],
  });
}
function cell(text, o = {}) {
  return new TableCell({
    borders,
    width: { size: o.w ?? 2000, type: WidthType.DXA },
    shading: o.head ? headBg : o.alt ? altBg : undefined,
    children: [new Paragraph({
      spacing: { before: 40, after: 40 },
      children: [new TextRun({ text: String(text), font: "微软雅黑", size: o.size ?? 17, bold: o.head || o.bold, color: o.head ? "FFFFFF" : "222222" })],
    })],
  });
}
function table(headers, rows, widths) {
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ children: headers.map((x, i) => cell(x, { head: true, w: widths[i] })) }),
      ...rows.map((r, ri) => new TableRow({ children: r.map((x, i) => cell(x, { alt: ri % 2 === 1, w: widths[i] })) })),
    ],
  });
}
function bullets(arr) { return arr.map((t) => p("• " + t)); }

const doc = new Document({
  sections: [{
    properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
    headers: {
      default: new Header({
        children: [new Paragraph({ children: [new TextRun({ text: "家用塔式主机｜Qwen3.8 / DeepSeek V4 · 多产品Agent方案", font: "微软雅黑", size: 16, color: "666666" })] })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "第 ", font: "微软雅黑", size: 16, color: "666666" }),
            new TextRun({ children: [PageNumber.CURRENT], font: "微软雅黑", size: 16 }),
            new TextRun({ text: " 页｜2026-09-26｜非机柜·家用电", font: "微软雅黑", size: 16, color: "666666" }),
          ],
        })],
      }),
    },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [new TextRun({ text: "家里几台主机就能跑", font: "微软雅黑", size: 36, bold: true, color: "1B4332" })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [new TextRun({ text: "Qwen3.8-27B / DeepSeek V4-Flash · 多小程序 · Agent 多并发", font: "微软雅黑", size: 24, bold: true, color: "2D6A4F" })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
        children: [new TextRun({ text: "不要大机柜｜塔式/工作站主机｜分档预算", font: "微软雅黑", size: 18, color: "666666" })],
      }),

      h("一、先对齐你的真实场景（我按这个来估并发）", HeadingLevel.HEADING_1),
      p("你说的是：自己开发的程序/小程序等几个产品放家里；要 Agent、多并发、长思考；最好一台或几台主机，不要机柜大服务器。", { bold: true }),
      p("我按「早期自研产品全家桶」给一个合理峰值模型（不是公网大型 SaaS）："),
      table(
        ["场景假设", "内容", "峰值「同时生成流」"],
        [
          ["产品数量", "3~5 个（小程序A/B + Web后台 + 内部工具）", "—"],
          ["用户形态", "自己开发调试 + 亲友/种子用户，不是全国公网爆量", "—"],
          ["轻对话高峰", "多人同时问短问题、不长思考", "约 4~8 路"],
          ["Agent 高峰", "2~4 个 Agent 同时跑（工具调用+检索+改代码）", "约 2~6 路（但每路占很久）"],
          ["长思考高峰", "开启 high/xhigh reasoning，单次可能跑十几秒~数分钟", "有效并发往往只有 1~4 路就「感觉很满」"],
          ["综合设计目标", "家里私有化「舒服能用」", "按 6~12 路同时生成流设计即可"],
          ["再往上", "真要 20+ 路长思考 Agent", "需要第 2 台主机，而不是机柜"],
        ],
        [2000, 4200, 3160]
      ),
      p("关键认知：Agent + 长思考吃的是「占坑时间」，不是「在线人数」。10 个用户轮流用，峰值流可能只有 3；3 个重度 Agent 同时开，峰值流就是 3 且机器会很忙。", {
        before: 140, bold: true,
      }),

      h("二、模型怎么选（家里能跑、能力够用）", HeadingLevel.HEADING_1),
      table(
        ["模型", "体量", "家用可行性", "能力定位", "推荐角色"],
        [
          ["Qwen3.8-27B", "27B 稠密，多模态，262K 上下文", "★★★★★ 一张 24G 就能主力", "Agent/代码/长流程很强，Apache-2.0", "家里主力首选"],
          ["Qwen3.6-35B-A3B", "35B MoE / 约3B激活", "★★★★☆ 24G 可量化跑", "偏 agentic coding", "可作第二模型"],
          ["DeepSeek V4-Flash", "284B MoE / 约13B激活，权重~160GB+", "★★☆☆☆ 要双专业卡或强异构", "更强推理/工具调用天花板", "预算够再上的「旗舰脑」"],
          ["DeepSeek V4.1-Flash", "552B，~510GB 权重", "☆☆☆☆☆ 要节点级，超你家约束", "更强但不符合「几台家用主机」", "本次排除"],
        ],
        [1800, 2200, 2000, 2000, 1360]
      ),
      p("结论：家里先把 Qwen3.8-27B 当主脑；想冲 DeepSeek V4 再上「双专业卡工作站」档。不要一上来追 V4.1。", { before: 120, bold: true }),

      h("三、家用电与形态硬约束（必须看）", HeadingLevel.HEADING_1),
      ...bullets([
        "形态：中塔/全塔 DIY 或品牌塔式工作站；最多 2~3 台放书房/阳台通风处。",
        "电力：普通家用回路约 10~16A。单卡 5070Ti/5080 通常可接受；双旗舰卡（双5090/双PRO6000）建议独立插线、评估空开，夏天注意散热。",
        "噪音：Agent 长满载风扇会响，别放卧室；可「推理机关机休眠 + 小主机常开网关」。",
        "散热：封闭柜慎放双卡；优先网孔机箱、空调房。",
      ]),

      h("四、分档预算方案（人民币，2026-09 量级）", HeadingLevel.HEADING_1),

      h("档位① 入门可用｜约 1.2万 ~ 1.8万｜1 台主机", HeadingLevel.HEADING_2),
      p("机器：1 台中塔。GPU：RTX 5060 Ti 16G 或 5070 Ti 16G。内存 64GB。SSD 2TB。", { bold: true }),
      ...bullets([
        "模型：Qwen3.8-27B（IQ3/Q4 量化）全显存跑；上下文建议 8K~32K 日常，别一上来 256K。",
        "峰值生成流：轻松 2~4；短对话可冲到 4~6；长思考 Agent 建议限制 1~2 同时。",
        "产品用法：小程序/后端都打到本机 OpenAI 兼容 API；加简单限流。",
        "体验：个人开发 + 少量种子用户「能正常用」；重度长思考会排队。",
        "不适合：同时开很多 Agent 硬刚。",
      ]),

      h("档位② 家用甜点（最推荐）｜约 2.0万 ~ 3.2万｜1 台主机", HeadingLevel.HEADING_2),
      p("机器：1 台。GPU：RTX 5080 16G 或 RTX 5090 32G（更香）。CPU：9700X/9900X。内存 64~128GB。SSD 2TB+。电源 1000W ATX3.1。", { bold: true }),
      ...bullets([
        "模型：Qwen3.8-27B 可上 Q5/Q6/更高量化，速度与Agent质量明显好于入门档；5090 余量更大。",
        "峰值生成流：短对话约 6~10；混合 Agent+对话设计目标 6~8；长思考同时 2~4 较舒服。",
        "刚好覆盖「几个小程序 + 自己开发 Agent」的综合高峰假设。",
        "一台搞定：推理 + 轻量 Docker（网关/Redis）可同机；重下载/NAS 仍建议另购小盒子。",
        "这是性价比与能力的甜蜜点，优先选这档。",
      ]),

      h("档位③ 双卡加强｜约 3.5万 ~ 5.5万｜1 台主机（或 1 主 + 1 小）", HeadingLevel.HEADING_2),
      p("机器：1 台全塔双卡，例如 2×5070 Ti / 2×5080；或「5090 主机 + 一台安静小主机做网关/数据库」。", { bold: true }),
      ...bullets([
        "玩法A：双卡张量并行，把 Qwen3.8 跑更高精度/更长上下文。",
        "玩法B（更推荐）：卡1 跑主模型；卡2 跑嵌入/重排/小工具模型，或第二路 Agent，提高「多产品同时忙」时的互不抢坑。",
        "峰值生成流：设计目标 8~12；长思考 Agent 可同时 3~5。",
        "注意电源、机箱风道、家用空开；双卡满载噪音与电费上升。",
      ]),

      h("档位④ DeepSeek V4 家用旗舰｜约 8万 ~ 20万｜1~2 台工作站（仍不要机柜）", HeadingLevel.HEADING_2),
      p("目标：在家跑 DeepSeek V4-Flash（不是 V4.1），并尽量「正常」而不是「勉强」。", { bold: true }),
      table(
        ["子方案", "硬件", "预算量级", "能力与并发", "备注"],
        [
          ["4A 异构省钱", "1×5090/4090 + 大内存(≥192~256GB) + KTransformers等卸载", "约 4~7万（若已有主机更低）", "能跑 V4-Flash，速度较慢(约十余tok/s级)，并发弱", "适合尝鲜，不适合多用户高峰"],
          ["4B 双专业卡", "塔式工作站 2× RTX PRO 6000 96GB", "单卡行情波动大，两卡+平台常见十余万起", "纯GPU更稳，单流很快；并发中等", "家用顶格但仍是「主机」"],
          ["4C 双机", "机1：Qwen3.8 主力服务；机2：V4-Flash 重任务", "档② + 档④B", "产品日常走 Qwen；难题/长思考走 DeepSeek", "最符合多产品调度"],
        ],
        [1400, 2800, 2200, 1800, 1160]
      ),
      p("4×PRO 6000 那种接近「半机柜」功耗与预算的，不按你家约束推荐。", { before: 100, color: "8B4513" }),

      h("档位⑤ 两台主机「产品级家用」｜约 4万 ~ 8万｜2 台（强烈结构推荐）", HeadingLevel.HEADING_2),
      p("形态：主机A（算力）+ 主机B（常开服务）。都是普通塔式/迷你主机，不是机柜。", { bold: true }),
      ...bullets([
        "主机A（按需开机）：档②或③，专跑 Qwen3.8 /（有钱再加 V4）。",
        "主机B（24h）：N100/小主机或绿联等，跑数据库、对象存储、反向代理、小程序后端、排队网关。",
        "好处：算力满载时不影响业务库；电费与噪音隔离；坏一台不整站完蛋。",
        "峰值仍由主机A决定：按档②估 6~10 流，档③估 8~12 流。",
      ]),

      h("五、各档「能不能撑住你的几个产品」对照", HeadingLevel.HEADING_1),
      table(
        ["档位", "预算", "主机数", "主力模型", "建议峰值流", "小程序多产品", "Agent长思考"],
        [
          ["①入门", "1.2~1.8万", "1", "Qwen3.8 Q3/Q4", "2~4（冲到6）", "可，需严格限流", "同时1~2"],
          ["②甜点", "2.0~3.2万", "1", "Qwen3.8 Q5/Q6", "6~10", "舒服", "同时2~4"],
          ["③双卡", "3.5~5.5万", "1(~2)", "Qwen3.8 高精度/双模型", "8~12", "很舒服", "同时3~5"],
          ["⑤双机结构", "4~8万", "2", "同上+常开业务机", "同②/③", "最稳", "同②/③"],
          ["④V4旗舰", "8~20万", "1~2", "V4-Flash(+Qwen)", "视子方案", "可", "强，但贵"],
        ],
        [1200, 1400, 1000, 2000, 1400, 1200, 1160]
      ),

      h("六、推荐落地组合（直接抄）", HeadingLevel.HEADING_1),
      p("若只能买一套：买档位②（5090 优先，其次 5080），模型部署 Qwen3.8-27B，用 vLLM/SGLang/Ollama 提供 API，前面加一层限流网关。", { bold: true }),
      p("若你认真做多个小程序：档位⑤ = 档②算力机 + 一台 2~4千的静音小主机常开。"),
      p("若以后非 DeepSeek V4 不可：在档②跑通业务后，再加档④B 或 ④C，不要先花光预算在 V4 上导致产品服务不稳。"),

      h("七、软件侧让「多并发 + 长思考」不炸机（家用必做）", HeadingLevel.HEADING_1),
      ...bullets([
        "全产品共用一个推理 API，按 api_key / 产品名限流（例如每产品同时最多 2 流）。",
        "长思考单独队列：普通聊天优先，Agent 进慢队列，避免把机器占死。",
        "默认 reasoning 别开到最高档；需要时再开 high/xhigh（Qwen3.8 默认偏猛）。",
        "上下文：交互对话 8K~32K；长文档用 RAG，别动不动 128K+ prefill。",
        "超时与取消：小程序前端允许取消请求，释放生成流。",
        "监控：看 GPU 利用率、队列长度；满了返回「繁忙请稍后」而不是 OOM。",
      ]),

      h("八、参考零件方向（档②示例，价随市场浮动）", HeadingLevel.HEADING_1),
      table(
        ["部件", "示例", "备注"],
        [
          ["CPU", "R7 9700X / R9 9900X", "够用即可"],
          ["主板", "华硕/微星 B850", "一线"],
          ["内存", "64GB起，有预算上128GB", "Agent/多服务吃内存"],
          ["显卡", "RTX 5090 32G 或 5080 16G", "家用AI核心"],
          ["SSD", "三星990 PRO 等 2TB", "放大模型"],
          ["电源", "海韵/海盗船 1000W ATX3.1", "稳"],
          ["机箱散热", "网孔中塔 + 360水冷", "降噪散热"],
        ],
        [1600, 4000, 3760]
      ),

      h("九、一句话决策", HeadingLevel.HEADING_1),
      p("家里几台主机、多小程序、要 Agent：选 Qwen3.8-27B + 预算 2~3.2 万单机（档②）；用户/Agent 变多就加一台静音业务机或升双卡（档③/⑤）；DeepSeek V4 作为 8万+ 的加餐，不是起步项。", {
        bold: true,
      }),
      p("V4.1 与机柜八卡方案：不符合你这次约束，已排除。", { before: 80, color: "666666" }),

      p("免责声明：并发数字为基于自研小产品+Agent场景的工程估算，受量化、上下文、工具调用次数、框架影响很大；到手请用你自己的压测脚本验收。价格为2026年9月量级区间。", {
        before: 200, italics: true, size: 18, color: "666666",
      }),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join(__dirname, "家用塔式-Qwen3.8与DeepSeek-V4-多产品Agent方案.docx");
  fs.writeFileSync(out, buf);
  console.log("OK " + out);
});
