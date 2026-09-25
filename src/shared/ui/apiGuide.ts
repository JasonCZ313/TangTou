/**
 * API 设置教程。
 * 在设置页和侧栏打开同一份说明：按 DeepSeek、智谱、千问分步告诉用户去哪复制钥匙、网址和模型名。
 */

/** 教程里三家服务商的切换键 */
type ApiGuideProvider = 'deepseek' | 'glm' | 'qwen';

/** 教程截图都放在扩展的 public/guide 目录，打包后从根路径读取 */
const GUIDE_IMAGE_ROOT = '/guide';

/**
 * 给「怎么获取这三项」按钮接上弹层。
 * 页面上没有这个按钮时直接返回，避免设置页以外的入口报错。
 */
export function mountApiGuide(): void {
  const openButton = document.querySelector<HTMLButtonElement>('#openApiGuideButton');
  if (!openButton || openButton.dataset.guideBound === '1') {
    return;
  }
  openButton.dataset.guideBound = '1';
  openButton.addEventListener('click', () => {
    openApiGuideDialog();
  });
}

/**
 * 打开教程弹层。
 * 第一次点击才创建节点，之后只是重新显示，避免重复插入。
 */
function openApiGuideDialog(): void {
  let backdrop = document.querySelector<HTMLElement>('#apiGuideBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'apiGuideBackdrop';
    backdrop.className = 'api-guide-backdrop';
    backdrop.innerHTML = renderApiGuideMarkup();
    document.body.appendChild(backdrop);
    bindApiGuideDialog(backdrop);
  }
  backdrop.hidden = false;
  showApiGuideProvider(backdrop, 'deepseek');
}

/**
 * 关掉教程，并在标签之间切换内容。
 * 点遮罩或「关闭」、按 Esc 都会收起，避免挡住下面的输入框。
 */
function bindApiGuideDialog(backdrop: HTMLElement): void {
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      backdrop.hidden = true;
    }
  });
  backdrop.querySelector<HTMLButtonElement>('.api-guide-close')?.addEventListener('click', () => {
    backdrop.hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !backdrop.hidden) {
      backdrop.hidden = true;
    }
  });
  backdrop.querySelectorAll<HTMLButtonElement>('[data-guide-tab]').forEach((tabButton) => {
    tabButton.addEventListener('click', () => {
      const provider = tabButton.dataset.guideTab;
      if (provider === 'deepseek' || provider === 'glm' || provider === 'qwen') {
        showApiGuideProvider(backdrop, provider);
      }
    });
  });
}

/**
 * 只显示当前选中的服务商步骤。
 * 切过去时把弹层滚回顶部，避免还停在上一家的最后一张图。
 */
function showApiGuideProvider(backdrop: HTMLElement, provider: ApiGuideProvider): void {
  backdrop.querySelectorAll<HTMLButtonElement>('[data-guide-tab]').forEach((tabButton) => {
    tabButton.setAttribute('aria-selected', tabButton.dataset.guideTab === provider ? 'true' : 'false');
  });
  backdrop.querySelectorAll<HTMLElement>('[data-guide-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.guidePanel !== provider;
  });
  backdrop.scrollTo({ top: 0 });
}

/** 拼出教程正文。文案和截图都写死在这里，三家步骤互不混用。 */
function renderApiGuideMarkup(): string {
  return `
    <div class="api-guide" role="dialog" aria-modal="true" aria-labelledby="apiGuideTitle">
      <div class="api-guide-head">
        <h3 id="apiGuideTitle">怎么获取这三项</h3>
        <button type="button" class="btn btn-ghost btn-sm api-guide-close">关闭</button>
      </div>
      <p class="api-guide-lead">
        先选一家。按顺序把钥匙、网址、模型名贴进本页三个框，看到「连接成功」再点保存。账户里要有余额，否则测得通也用不了。钥匙通常只显示一次，复制后立刻贴过来。步骤里<strong class="api-guide-link-hint">加粗并带下划线</strong>的文字可以直接点，会打开对应网页。
      </p>
      <div class="api-guide-tabs" role="tablist">
        <button type="button" data-guide-tab="deepseek" aria-selected="true">DeepSeek</button>
        <button type="button" data-guide-tab="glm" aria-selected="false">智谱 GLM</button>
        <button type="button" data-guide-tab="qwen" aria-selected="false">千问</button>
      </div>
      ${renderDeepSeekGuide()}
      ${renderGlmGuide()}
      ${renderQwenGuide()}
    </div>
  `;
}

/** DeepSeek：钥匙、文档里的网址和模型名，以及用量页余额。 */
function renderDeepSeekGuide(): string {
  return `
    <div data-guide-panel="deepseek">
      <ol class="api-guide-steps">
        <li>
          先看余额。打开
          <a href="https://platform.deepseek.com/usage" target="_blank" rel="noreferrer">用量页</a>
          ，红框里的充值余额要大于 0。没有就先充值。
          ${guideShot('deepseek-balance.png', 'DeepSeek 用量页，红框是充值余额')}
        </li>
        <li>
          打开
          <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">API keys 页</a>
          ，点右上角红框「创建 API key」。
          ${guideShot('deepseek-keys.png', 'DeepSeek API keys 页，红框是创建按钮')}
        </li>
        <li>
          名字可以填「躺投」，再点红框「创建」。
          ${guideShot('deepseek-create.png', '创建 API key 对话框，红框是创建按钮')}
        </li>
        <li>
          点红框「复制」。关掉窗口后就看不到这串钥匙了。
          ${guideShot('deepseek-copy-key.png', '复制刚创建的 DeepSeek API key')}
        </li>
        <li>
          回到躺投，贴到红字标出的「API Key」。
          ${guideShot('paste-key.png', '躺投里 API Key 的粘贴位置')}
        </li>
        <li>
          打开
          <a href="https://api-docs.deepseek.com/zh-cn/" target="_blank" rel="noreferrer">首次调用 API</a>
          ，复制红框里的地址 <code>https://api.deepseek.com</code>。
          ${guideShot('deepseek-url.png', 'DeepSeek 文档里的 base_url')}
        </li>
        <li>
          贴到红字标出的「API Base URL」。
          ${guideShot('paste-url.png', '躺投里 API Base URL 的粘贴位置')}
        </li>
        <li>
          模型名复制红框里的一个即可。日常用 <code>deepseek-flash</code>。想更强可以改成 <code>deepseek-v4-pro</code>。
          ${guideShot('deepseek-models.png', 'DeepSeek 文档里的模型名')}
        </li>
        <li>
          贴到红字标出的「模型名」。
          ${guideShot('paste-model.png', '躺投里模型名的粘贴位置')}
        </li>
        <li>
          点红框「测试连接」。页面最上方出现「连接成功」后，再点「保存」，就可以开始用了。
          ${guideShot('test-save.png', '测试连接成功后再点保存')}
        </li>
      </ol>
    </div>
  `;
}

/** 智谱：钥匙、通用接口地址，以及带图像和文件输入的模型名。 */
function renderGlmGuide(): string {
  return `
    <div data-guide-panel="glm" hidden>
      <ol class="api-guide-steps">
        <li>
          先看余额。打开
          <a href="https://bigmodel.cn/finance-center/finance/overview" target="_blank" rel="noreferrer">财务总览</a>
          ，红框里的可用余额要大于 0。
          ${guideShot('glm-balance.png', '智谱财务总览，红框是余额')}
        </li>
        <li>
          打开
          <a href="https://bigmodel.cn/apikey/platform" target="_blank" rel="noreferrer">API Key 页</a>
          ，点右上角红框「新建 API Key」。
          ${guideShot('glm-keys.png', '智谱 API Key 页，红框是新建按钮')}
        </li>
        <li>
          名字可以填「躺投」，再点红框「确定」。
          ${guideShot('glm-create.png', '智谱新建 API Key，红框是确定按钮')}
        </li>
        <li>
          点红框「复制」，贴到躺投的「API Key」。
          ${guideShot('glm-copy-key.png', '复制智谱 API Key')}
          ${guideShot('paste-key.png', '躺投里 API Key 的粘贴位置')}
        </li>
        <li>
          打开
          <a href="https://docs.bigmodel.cn/cn/api/introduction" target="_blank" rel="noreferrer">快速开始</a>
          ，点红框复制地址 <code>https://open.bigmodel.cn/api/paas/v4</code>，贴到「API Base URL」。
          ${guideShot('glm-url.png', '智谱文档里的 API 端点')}
          ${guideShot('paste-url.png', '躺投里 API Base URL 的粘贴位置')}
        </li>
        <li>
          打开
          <a href="https://docs.bigmodel.cn/cn/guide/start/model-overview" target="_blank" rel="noreferrer">模型概览</a>
          ，点红框「GLM-5.3-Flash」（能看图片和文件）。
          ${guideShot('glm-pick-model.png', '模型概览里选择 GLM-5.3-Flash')}
        </li>
        <li>
          在模型页往下滑，找到「如何使用」。先看输入模态里有没有图像、文件。有的话，只复制红框里的 <code>glm-5.3-flash</code>，不要把逗号和后面的 <code>glm-5.3-flashx</code> 一起贴上。想更快可以单独改成 <code>glm-5.3-flashx</code>。贴到「模型名」。
          ${guideShot('glm-model-code.png', '确认输入模态后复制模型名')}
          ${guideShot('paste-model.png', '躺投里模型名的粘贴位置')}
        </li>
        <li>
          点「测试连接」。页面最上方出现「连接成功」后，再点「保存」。
          ${guideShot('test-save.png', '测试连接成功后再点保存')}
        </li>
      </ol>
    </div>
  `;
}

/** 千问：按量付费钥匙、OpenAI 兼容地址，以及能看图的模型名。 */
function renderQwenGuide(): string {
  return `
    <div data-guide-panel="qwen" hidden>
      <ol class="api-guide-steps">
        <li>
          先看余额。打开
          <a href="https://platform.qianwenai.com/home" target="_blank" rel="noreferrer">千问首页</a>
          ，可用余额要大于 0。
          ${guideShot('qwen-balance.png', '千问首页的可用余额')}
        </li>
        <li>
          打开
          <a href="https://platform.qianwenai.com/home/api-keys" target="_blank" rel="noreferrer">API Keys 页</a>
          ，点右下角红框「创建 API Key」。
          ${guideShot('qwen-keys.png', '千问 API Keys 页，红框是创建按钮')}
        </li>
        <li>
          描述可以填「躺投」，再点红框「生成 API Key」。
          ${guideShot('qwen-create.png', '千问创建 API Key，红框是生成按钮')}
        </li>
        <li>
          点红框复制钥匙，贴到躺投的「API Key」。关掉窗口后就看不到完整钥匙了。
          ${guideShot('qwen-copy-key.png', '复制千问 API Key')}
          ${guideShot('paste-key.png', '躺投里 API Key 的粘贴位置')}
        </li>
        <li>
          回到 API Keys 页，点红框，复制「OpenAI 兼容」那一栏的地址，贴到「API Base URL」。不要复制旁边 Anthropic 那一栏。
          ${guideShot('qwen-copy-url.png', '复制千问 OpenAI 兼容 Base URL')}
          ${guideShot('paste-url.png', '躺投里 API Base URL 的粘贴位置')}
        </li>
        <li>
          「模型名」请原样填写小写。推荐 <code>qwen3.7-plus</code>，能看图片和文件，日常够用。也可以改成 <code>qwen3.6-plus</code>。不要写成 Qwen3.7-Plus。
          ${guideShot('paste-model.png', '躺投里模型名的粘贴位置')}
        </li>
        <li>
          点「测试连接」。页面最上方出现「连接成功」后，再点「保存」。
          ${guideShot('test-save.png', '测试连接成功后再点保存')}
        </li>
      </ol>
    </div>
  `;
}

/** 教程配图。alt 写清这张图在教哪一步，方便看不清红框时也能对上文字。 */
function guideShot(fileName: string, description: string): string {
  return `<img class="api-guide-shot" src="${GUIDE_IMAGE_ROOT}/${fileName}" alt="${description}" />`;
}
