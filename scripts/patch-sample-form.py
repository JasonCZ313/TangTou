"""更新样例表：必填、双学位、实习/项目字段、目录。"""
from pathlib import Path

path = Path(r"m:\项目\躺投\fixtures\sample-form.html")
text = path.read_text(encoding="utf-8")

# CSS
needle = """      @media (max-width: 720px) {
        .grid {
          grid-template-columns: 1fr;
        }
        .span-2 {
          grid-column: auto;
        }
      }
    </style>"""
css_add = """      .sample-toc {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0 0 16px;
        padding: 10px 12px;
        background: #fff;
        border: 1px solid var(--tt-border);
        border-radius: 12px;
      }
      .sample-toc a {
        padding: 6px 10px;
        border-radius: 999px;
        background: #ccfbf1;
        color: var(--tt-primary);
        text-decoration: none;
        font-size: 12px;
        font-weight: 650;
      }
      .sample-toc a:hover { background: var(--tt-primary); color: #fff; }
      #second-degree-block[hidden] { display: none !important; }
      @media (max-width: 720px) {
        .grid { grid-template-columns: 1fr; }
        .span-2 { grid-column: auto; }
      }
    </style>"""
if needle not in text:
    raise SystemExit("css media missing")
text = text.replace(needle, css_add)

# lead + toc
old_lead = """      <p class="lead">
        与扩展档案分区对齐。标 <span class="req">*</span> 为常见强制项。
      </p>"""
new_lead = """      <nav class="sample-toc" aria-label="样例表目录">
        <a href="#fs-basic">基本信息</a>
        <a href="#fs-intent">求职意向</a>
        <a href="#fs-edu">教育经历</a>
        <a href="#fs-exp">实习工作</a>
        <a href="#fs-proj">项目经历</a>
        <a href="#fs-skills">技能</a>
        <a href="#fs-lang">语言</a>
        <a href="#fs-cert">证书奖项</a>
      </nav>
      <p class="lead">
        与扩展档案分区对齐。标 <span class="req">*</span> 为硬必填/常见强制项。学位选「双学位」时填写第二学位区。
      </p>"""
if old_lead not in text:
    raise SystemExit("lead missing")
text = text.replace(old_lead, new_lead)

# fieldset ids by legend
legend_ids = [
    ("基本信息", "fs-basic"),
    ("求职意向", "fs-intent"),
    ("教育经历（最高学历）", "fs-edu"),
    ("最近一段工作/实习", "fs-exp"),
    ("项目经历", "fs-proj"),
    ("技能与计算机", "fs-skills"),
    ("语言能力", "fs-lang"),
    ("证书 / 奖项", "fs-cert"),
]
for legend, fid in legend_ids:
    old = f"<fieldset>\n          <legend>{legend}</legend>"
    new = f'<fieldset id="{fid}">\n          <legend>{legend}</legend>'
    if old not in text:
        raise SystemExit(f"fieldset missing: {legend}")
    text = text.replace(old, new, 1)

# required marks
text = text.replace(
    '<label>国籍<input name="nationality" type="text" /></label>',
    '<label>国籍 <span class="req">*</span><input name="nationality" type="text" required /></label>',
)
text = text.replace(
    '<label>籍贯<input name="nativePlace" type="text" /></label>',
    '<label>籍贯 <span class="req">*</span><input name="nativePlace" type="text" required /></label>',
)
text = text.replace(
    '<label>证件类型\n              <select name="idType">',
    '<label>证件类型 <span class="req">*</span>\n              <select name="idType" required>',
)
text = text.replace(
    '<label>证件号码<input name="idNumber" type="text" /></label>',
    '<label>证件号码 <span class="req">*</span><input name="idNumber" type="text" required /></label>',
)
text = text.replace(
    '<label>政治面貌\n              <select name="politicalStatus">',
    '<label>政治面貌 <span class="req">*</span>\n              <select name="politicalStatus" required>',
)
text = text.replace(
    '<label>婚姻状况\n              <select name="maritalStatus">',
    '<label>婚姻状况 <span class="req">*</span>\n              <select name="maritalStatus" required>',
)
text = text.replace(
    '<label>入学日期<input name="eduStartDate" type="date" /></label>',
    '<label>入学日期 <span class="req">*</span><input name="eduStartDate" type="date" required /></label>',
)
text = text.replace(
    '<label>毕业日期<input name="eduEndDate" type="date" /></label>',
    '<label>毕业日期 <span class="req">*</span><input name="eduEndDate" type="date" /></label>',
)

# dual degree block
old_deg = """            <label>学位
              <select name="academicDegree">
                <option value="">请选择</option>
                <option value="无学位">无学位</option>
                <option value="学士">学士</option>
                <option value="硕士">硕士</option>
                <option value="博士">博士</option>
                <option value="双学位">双学位</option>
                <option value="其他">其他</option>
              </select>
            </label>
            <label>GPA<input name="gpa" type="text" /></label>
            <label>排名<input name="rank" type="text" /></label>
            <label class="span-2">教育说明<textarea name="eduDescription"></textarea></label>
          </div>
        </fieldset>"""

new_deg = """            <label>学位
              <select name="academicDegree" id="academicDegreeSelect">
                <option value="">请选择</option>
                <option value="无学位">无学位</option>
                <option value="学士">学士</option>
                <option value="硕士">硕士</option>
                <option value="博士">博士</option>
                <option value="双学位">双学位</option>
                <option value="其他">其他</option>
              </select>
            </label>
            <label>GPA<input name="gpa" type="text" /></label>
            <label>排名<input name="rank" type="text" /></label>
            <label class="span-2">教育说明<textarea name="eduDescription"></textarea></label>
            <div class="span-2" id="second-degree-block" hidden>
              <p class="hint">第二学位信息（选择双学位时填写）</p>
              <div class="grid">
                <label>第二学位学校 <span class="req">*</span><input name="secondSchool" type="text" /></label>
                <label>第二学位专业 <span class="req">*</span><input name="secondMajor" type="text" /></label>
                <label>第二学历层次<input name="secondDegreeLevel" type="text" /></label>
                <label>第二入学日期<input name="secondStartDate" type="date" /></label>
                <label>第二毕业日期<input name="secondEndDate" type="date" /></label>
                <label class="span-2">第二学位说明<textarea name="secondEduDescription"></textarea></label>
              </div>
            </div>
          </div>
        </fieldset>"""
if old_deg not in text:
    raise SystemExit("degree block missing")
text = text.replace(old_deg, new_deg)

old_exp = """            <label class="span-2">职责描述<textarea name="expDescription"></textarea></label>
          </div>
        </fieldset>

        <fieldset id="fs-proj">"""
new_exp = """            <label>所属行业<input name="industry" type="text" placeholder="如：互联网/电商" /></label>
            <label>公司性质<input name="companyType" type="text" /></label>
            <label class="span-2">工作职责<textarea name="responsibilities" placeholder="条目/要点"></textarea></label>
            <label class="span-2">工作内容<textarea name="workContent" placeholder="日常做了什么"></textarea></label>
            <label class="span-2">业绩/成果<textarea name="achievements" placeholder="量化优先"></textarea></label>
            <label class="span-2">总述<textarea name="expDescription"></textarea></label>
          </div>
        </fieldset>

        <fieldset id="fs-proj">"""
if old_exp not in text:
    raise SystemExit("exp missing")
text = text.replace(old_exp, new_exp)

old_proj = """            <label class="span-2">项目描述<textarea name="projectDescription"></textarea></label>
          </div>
        </fieldset>

        <fieldset id="fs-skills">"""
new_proj = """            <label class="span-2">项目内容<textarea name="projectContent"></textarea></label>
            <label class="span-2">项目价值/成果<textarea name="projectValue"></textarea></label>
            <label class="span-2">总述<textarea name="projectDescription"></textarea></label>
          </div>
        </fieldset>

        <fieldset id="fs-skills">"""
if old_proj not in text:
    raise SystemExit("proj missing")
text = text.replace(old_proj, new_proj)

text = text.replace(
    '<label class="span-2">技能（逗号或空格分隔）<input name="skills" type="text" /></label>',
    '<label>技能名称<input name="skillName" type="text" placeholder="如：TypeScript" /></label>\n            <label>技能熟练度<input name="skillLevel" type="text" placeholder="熟练" /></label>',
)

# cert description
text = text.replace(
    """            <label>奖项级别
              <select name="awardLevel">
                <option value="">请选择</option>
                <option value="校级">校级</option>
                <option value="市级">市级</option>
                <option value="省级">省级</option>
                <option value="国家级">国家级</option>
                <option value="国际级">国际级</option>
                <option value="其他">其他</option>
              </select>
            </label>
          </div>
        </fieldset>""",
    """            <label>奖项级别
              <select name="awardLevel">
                <option value="">请选择</option>
                <option value="校级">校级</option>
                <option value="市级">市级</option>
                <option value="省级">省级</option>
                <option value="国家级">国家级</option>
                <option value="国际级">国际级</option>
                <option value="其他">其他</option>
              </select>
            </label>
            <label>证书获证日期<input name="certificateDate" type="date" /></label>
            <label>奖项日期<input name="awardDate" type="date" /></label>
            <label class="span-2">证书说明<textarea name="certificateDescription"></textarea></label>
            <label class="span-2">奖项说明<textarea name="awardDescription"></textarea></label>
          </div>
        </fieldset>""",
)

old_script = """    <script>
      // 仅阻止本地打开时的默认提交跳转，方便手工点测；扩展本身不得调用 submit。
      document
        .getElementById('sample-application-form')
        .addEventListener('submit', function onSubmit(event) {
          event.preventDefault();
          alert('表单已手动提交（验收用）；扩展不应触发此行为。');
        });
    </script>"""
new_script = """    <script>
      document
        .getElementById('sample-application-form')
        .addEventListener('submit', function onSubmit(event) {
          event.preventDefault();
          alert('表单已手动提交（验收用）；扩展不应触发此行为。');
        });
      var degreeSelect = document.getElementById('academicDegreeSelect');
      var secondBlock = document.getElementById('second-degree-block');
      function syncSecondDegree() {
        if (!degreeSelect || !secondBlock) return;
        secondBlock.hidden = degreeSelect.value !== '双学位';
      }
      if (degreeSelect) {
        degreeSelect.addEventListener('change', syncSecondDegree);
        syncSecondDegree();
      }
    </script>"""
if old_script not in text:
    raise SystemExit("script missing")
text = text.replace(old_script, new_script)

path.write_text(text, encoding="utf-8")
print("sample-form OK")
