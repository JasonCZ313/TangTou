function g(){return{totalPromptTokens:0,totalCompletionTokens:0,totalTokens:0,callCount:0,lastCall:null,lastCallAt:null}}const m="tokenUsageStats";async function q(){const a=(await chrome.storage.local.get(m))[m];if(!a||typeof a!="object")return g();const n=a;return{...g(),...n,lastCall:n.lastCall??null,lastCallAt:n.lastCallAt??null}}async function S(){const e=g();return await chrome.storage.local.set({[m]:e}),e}function G(e){return`提示 ${e.promptTokens} · 补全 ${e.completionTokens} · 合计 ${e.totalTokens}`}const k="jasonc13@163.com",y="【躺投】问题反馈";function f(e){const a=e.trim();return`收件人：${k}
主题：${y}

${a}`}function $(e){const a=encodeURIComponent(k),n=encodeURIComponent(y);return e==="gmail"?`https://mail.google.com/mail/?view=cm&fs=1&to=${a}&su=${n}`:e==="outlook"?`https://outlook.live.com/mail/0/deeplink/compose?to=${a}&subject=${n}`:e==="qq"?"https://mail.qq.com/":"https://mail.163.com/"}async function h(e){try{return await navigator.clipboard.writeText(f(e)),!0}catch{return!1}}function I(e){chrome.tabs.create({url:$(e)})}function K(){const e=document.getElementById("feedbackToggleButton"),a=document.getElementById("feedbackComposer"),n=document.getElementById("feedbackBodyInput"),l=document.getElementById("feedbackCopyButton"),u=document.getElementById("feedbackMailboxRow"),d=document.getElementById("feedbackResult"),o=document.getElementById("feedbackFallbackLetter");if(!(e instanceof HTMLButtonElement)||!(a instanceof HTMLElement)||!(n instanceof HTMLTextAreaElement)||!(l instanceof HTMLButtonElement)||!(u instanceof HTMLElement)||!(d instanceof HTMLElement)||!(o instanceof HTMLTextAreaElement))return;const c=(i,s)=>{d.hidden=!1,d.textContent=i,d.classList.toggle("is-ok",s),d.classList.toggle("is-bad",!s)};e.addEventListener("click",()=>{const i=a.hidden;a.hidden=!i,e.textContent=i?"收起反馈":"意见反馈",i&&n.focus()}),l.addEventListener("click",()=>{(async()=>{const i=n.value.trim();if(!i){o.hidden=!0,c("请先写下问题和所在页面，再复制。",!1);return}const s=await h(i);if(u.hidden=!1,!s){o.hidden=!1,o.value=f(i),c("自动复制没有成功。请手动复制下面这段，再选择网页邮箱粘贴发送。",!1);return}o.hidden=!0,c(`已复制。收件人 ${k}，主题「${y}」。请选择下面的网页邮箱：Gmail 和 Outlook 会带上收件人与主题，打开后粘贴正文再发送；163 和 QQ 请在写信页粘贴整段已复制内容。`,!0)})()}),u.addEventListener("click",i=>{const s=i.target;if(!(s instanceof HTMLButtonElement))return;const r=s.dataset.webmail;if(r!=="netease163"&&r!=="qq"&&r!=="gmail"&&r!=="outlook")return;const p=n.value.trim();if(!p){c("请先写下问题和所在页面。",!1);return}h(p).then(A=>{A?o.hidden=!0:(o.hidden=!1,o.value=f(p)),I(r)})})}const v="/guide";function C(){const e=document.querySelector("#openApiGuideButton");!e||e.dataset.guideBound==="1"||(e.dataset.guideBound="1",e.addEventListener("click",()=>{E()}))}function E(){let e=document.querySelector("#apiGuideBackdrop");e||(e=document.createElement("div"),e.id="apiGuideBackdrop",e.className="api-guide-backdrop",e.innerHTML=T(),document.body.appendChild(e),P(e)),e.hidden=!1,b(e,"deepseek")}function P(e){var a;e.addEventListener("click",n=>{n.target===e&&(e.hidden=!0)}),(a=e.querySelector(".api-guide-close"))==null||a.addEventListener("click",()=>{e.hidden=!0}),e.querySelectorAll("a[href]").forEach(n=>{if(n.dataset.urlAppended==="1")return;n.dataset.urlAppended="1";const l=document.createElement("span");l.className="api-guide-url",l.textContent=` ${n.href}`,n.after(l)}),document.addEventListener("keydown",n=>{n.key==="Escape"&&!e.hidden&&(e.hidden=!0)}),e.querySelectorAll("[data-guide-tab]").forEach(n=>{n.addEventListener("click",()=>{const l=n.dataset.guideTab;(l==="deepseek"||l==="glm"||l==="qwen")&&b(e,l)})})}function b(e,a){e.querySelectorAll("[data-guide-tab]").forEach(n=>{n.setAttribute("aria-selected",n.dataset.guideTab===a?"true":"false")}),e.querySelectorAll("[data-guide-panel]").forEach(n=>{n.hidden=n.dataset.guidePanel!==a}),e.scrollTo({top:0})}function T(){return`
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
      ${L()}
      ${B()}
      ${w()}
    </div>
  `}function L(){return`
    <div data-guide-panel="deepseek">
      <ol class="api-guide-steps">
        <li>
          先看余额。打开
          <a href="https://platform.deepseek.com/usage" target="_blank" rel="noreferrer">用量页</a>
          ，红框里的充值余额要大于 0。没有就先充值。
          ${t("deepseek-balance.png","DeepSeek 用量页，红框是充值余额")}
        </li>
        <li>
          打开
          <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">API keys 页</a>
          ，点右上角红框「创建 API key」。
          ${t("deepseek-keys.png","DeepSeek API keys 页，红框是创建按钮")}
        </li>
        <li>
          名字可以填「躺投」，再点红框「创建」。
          ${t("deepseek-create.png","创建 API key 对话框，红框是创建按钮")}
        </li>
        <li>
          点红框「复制」。关掉窗口后就看不到这串钥匙了。
          ${t("deepseek-copy-key.png","复制刚创建的 DeepSeek API key")}
        </li>
        <li>
          回到躺投，贴到红字标出的「API Key」。
          ${t("paste-key.png","躺投里 API Key 的粘贴位置")}
        </li>
        <li>
          打开
          <a href="https://api-docs.deepseek.com/zh-cn/" target="_blank" rel="noreferrer">首次调用 API</a>
          ，复制红框里的地址 <code>https://api.deepseek.com</code>。
          ${t("deepseek-url.png","DeepSeek 文档里的 base_url")}
        </li>
        <li>
          贴到红字标出的「API Base URL」。
          ${t("paste-url.png","躺投里 API Base URL 的粘贴位置")}
        </li>
        <li>
          模型名复制红框里的一个即可。日常用 <code>deepseek-flash</code>。想更强可以改成 <code>deepseek-v4-pro</code>。
          ${t("deepseek-models.png","DeepSeek 文档里的模型名")}
        </li>
        <li>
          贴到红字标出的「模型名」。
          ${t("paste-model.png","躺投里模型名的粘贴位置")}
        </li>
        <li>
          点红框「测试连接」。页面最上方出现「连接成功」后，再点「保存」，就可以开始用了。
          ${t("test-save.png","测试连接成功后再点保存")}
        </li>
      </ol>
    </div>
  `}function B(){return`
    <div data-guide-panel="glm" hidden>
      <ol class="api-guide-steps">
        <li>
          先看余额。打开
          <a href="https://bigmodel.cn/finance-center/finance/overview" target="_blank" rel="noreferrer">财务总览</a>
          ，红框里的可用余额要大于 0。
          ${t("glm-balance.png","智谱财务总览，红框是余额")}
        </li>
        <li>
          打开
          <a href="https://bigmodel.cn/apikey/platform" target="_blank" rel="noreferrer">API Key 页</a>
          ，点右上角红框「新建 API Key」。
          ${t("glm-keys.png","智谱 API Key 页，红框是新建按钮")}
        </li>
        <li>
          名字可以填「躺投」，再点红框「确定」。
          ${t("glm-create.png","智谱新建 API Key，红框是确定按钮")}
        </li>
        <li>
          点红框「复制」，贴到躺投的「API Key」。
          ${t("glm-copy-key.png","复制智谱 API Key")}
          ${t("paste-key.png","躺投里 API Key 的粘贴位置")}
        </li>
        <li>
          打开
          <a href="https://docs.bigmodel.cn/cn/api/introduction" target="_blank" rel="noreferrer">快速开始</a>
          ，点红框复制地址 <code>https://open.bigmodel.cn/api/paas/v4</code>，贴到「API Base URL」。
          ${t("glm-url.png","智谱文档里的 API 端点")}
          ${t("paste-url.png","躺投里 API Base URL 的粘贴位置")}
        </li>
        <li>
          打开
          <a href="https://docs.bigmodel.cn/cn/guide/start/model-overview" target="_blank" rel="noreferrer">模型概览</a>
          ，点红框「GLM-5.3-Flash」（能看图片和文件）。
          ${t("glm-pick-model.png","模型概览里选择 GLM-5.3-Flash")}
        </li>
        <li>
          在模型页往下滑，找到「如何使用」。先看输入模态里有没有图像、文件。有的话，只复制红框里的 <code>glm-5.3-flash</code>，不要把逗号和后面的 <code>glm-5.3-flashx</code> 一起贴上。想更快可以单独改成 <code>glm-5.3-flashx</code>。贴到「模型名」。
          ${t("glm-model-code.png","确认输入模态后复制模型名")}
          ${t("paste-model.png","躺投里模型名的粘贴位置")}
        </li>
        <li>
          点「测试连接」。页面最上方出现「连接成功」后，再点「保存」。
          ${t("test-save.png","测试连接成功后再点保存")}
        </li>
      </ol>
    </div>
  `}function w(){return`
    <div data-guide-panel="qwen" hidden>
      <ol class="api-guide-steps">
        <li>
          先看余额。打开
          <a href="https://platform.qianwenai.com/home" target="_blank" rel="noreferrer">千问首页</a>
          ，可用余额要大于 0。
          ${t("qwen-balance.png","千问首页的可用余额")}
        </li>
        <li>
          打开
          <a href="https://platform.qianwenai.com/home/api-keys" target="_blank" rel="noreferrer">API Keys 页</a>
          ，点右下角红框「创建 API Key」。
          ${t("qwen-keys.png","千问 API Keys 页，红框是创建按钮")}
        </li>
        <li>
          描述可以填「躺投」，再点红框「生成 API Key」。
          ${t("qwen-create.png","千问创建 API Key，红框是生成按钮")}
        </li>
        <li>
          点红框复制钥匙，贴到躺投的「API Key」。关掉窗口后就看不到完整钥匙了。
          ${t("qwen-copy-key.png","复制千问 API Key")}
          ${t("paste-key.png","躺投里 API Key 的粘贴位置")}
        </li>
        <li>
          回到 API Keys 页，点红框，复制「OpenAI 兼容」那一栏的地址，贴到「API Base URL」。不要复制旁边 Anthropic 那一栏。
          ${t("qwen-copy-url.png","复制千问 OpenAI 兼容 Base URL")}
          ${t("paste-url.png","躺投里 API Base URL 的粘贴位置")}
        </li>
        <li>
          「模型名」请原样填写小写。推荐 <code>qwen3.7-plus</code>，能看图片和文件，日常够用。也可以改成 <code>qwen3.6-plus</code>。不要写成 Qwen3.7-Plus。
          ${t("paste-model.png","躺投里模型名的粘贴位置")}
        </li>
        <li>
          点「测试连接」。页面最上方出现「连接成功」后，再点「保存」。
          ${t("test-save.png","测试连接成功后再点保存")}
        </li>
      </ol>
    </div>
  `}function t(e,a){return`<img class="api-guide-shot" src="${v}/${e}" alt="${a}" />`}function U(e){const a=(e.employmentType??"").trim();return a.length===0||a==="internship"}export{C as a,G as f,q as g,U as i,K as m,S as r};
